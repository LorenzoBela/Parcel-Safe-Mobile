import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, Linking, Image, ActivityIndicator } from 'react-native';
import { Text, Card, Button, IconButton, Switch } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadDeliveryProofPhoto } from '../../../services/proofPhotoService';
import { updateDeliveryStatus } from '../../../services/riderMatchingService';
import { subscribeToDeliveryProof, subscribeToPhotoAuditLog, subscribeToBoxState, BoxState, subscribeToCamera, CameraState, subscribeToLockEvents, LockEvent, updateBoxState, getDeliveryProofSnapshot, getPhotoAuditLogSnapshot, getLockEventSnapshot, getBoxStateSnapshot, subscribeToPhotoUploadState, PhotoUploadState } from '../../../services/firebaseClient';
import { loadDropoffVerificationSnapshot, saveDropoffVerificationSnapshot, clearDropoffVerificationSnapshot } from '../../../services/dropoffVerificationStorageService';
import { enqueueBoxCommand, flushQueuedBoxCommands, markLatestSentCommandAcked } from '../../../services/boxCommandQueueService';
import { PremiumAlert } from '../../../services/PremiumAlertService';
import { useAppTheme } from '../../../context/ThemeContext';
import { getDropoffProofGate } from '../../../services/dropoffProofGateService';

// Import MapboxWrapper for geofence preview map
import MapboxGL, { isMapboxNativeAvailable, StyleURL } from '../../../components/map/MapboxWrapper';
import AnimatedRiderMarker from '../../../components/map/AnimatedRiderMarker';

// Same rider image used across all tracking pages (AnimatedRiderMarker)
const RiderImage = require('../../../../assets/Rider.jpg');

// ───────────── Distance Formatter ─────────────
function formatDistance(meters: number | null | undefined): string {
    if (meters == null) return '';
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)}km`;
    }
    return `${meters}m`;
}

function withProofCacheBust(url: string | null, version: number): string | null {
    if (!url) return null;
    return `${url}${url.includes('?') ? '&' : '?'}t=${version || 1}`;
}

// ───────────── Geofence Circle GeoJSON Builder ─────────────
function buildGeofenceCircleGeoJSON(
    centerLng: number,
    centerLat: number,
    radiusM: number,
    segments: number = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
    const coords: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const dLat = (radiusM / 111320) * Math.cos(angle);
        const dLng = (radiusM / (111320 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(angle);
        coords.push([centerLng + dLng, centerLat + dLat]);
    }
    return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
    };
}

interface DropoffVerificationProps {
    deliveryId: string;
    boxId: string;
    targetAddress: string;
    targetLat: number;
    targetLng: number;
    recipientName?: string;
    customerPhone?: string;
    deliveryNotes?: string;
    deliveryStatus: string;

    isInsideGeoFence: boolean;
    distanceMeters: number | null;
    isPhoneInside: boolean;
    isBoxInside: boolean;
    isBoxOffline: boolean;
    lastBoxHeartbeatAt?: number;
    lastPhoneGpsAt?: number;

    // Rider's current GPS position for map preview
    currentLat: number;
    currentLng: number;
    currentHeading?: number | null;
    geofenceRadiusM?: number;

    onDeliveryCompleted: () => void;

    onNavigate: () => void;

    // Props for modals
    onShowBleModal: () => void;
    onShowCancelModal: () => void;
    onShowCustomerNotHome: () => void;
    isWaitTimerActive: boolean;
    canAutoArrive: boolean;
}

type DropoffVerificationCacheState = {
    boxOtpValidated: boolean;
    faceDetected: boolean;
    cameraFailed: boolean;
    hardwareSuccess: boolean;
    fallbackPhotoUri: string | null;
    hardwarePreviewUrl: string | null;
    auditPreviewUrl: string | null;
    hardwareProofUrl: string | null;
    auditProofUrl: string | null;
    previewVersion: number;
    proofVersion: number;
    manualModeEnabled: boolean;
};

const verificationCacheByDelivery: Record<string, DropoffVerificationCacheState> = {};

export default function DropoffVerification({
    deliveryId,
    boxId,
    targetAddress,
    targetLat,
    targetLng,
    recipientName,
    customerPhone,
    deliveryNotes,
    deliveryStatus,
    isInsideGeoFence,
    distanceMeters,
    isPhoneInside,
    isBoxInside,
    isBoxOffline,
    lastBoxHeartbeatAt,
    lastPhoneGpsAt,
    currentLat,
    currentLng,
    currentHeading = null,
    geofenceRadiusM = 50,
    onDeliveryCompleted,

    onNavigate,
    onShowBleModal,
    onShowCancelModal,
    onShowCustomerNotHome,
    isWaitTimerActive,
    canAutoArrive,
}: DropoffVerificationProps) {
    const [isLoading, setIsLoading] = useState(false);
    const { isDarkMode } = useAppTheme();

    // ──── Geofence Map Preview memoized data ────
    const mapAvailable = isMapboxNativeAvailable();
    const hasRiderPosition = currentLat !== 0 || currentLng !== 0;
    const geofenceCircle = useMemo(
        () => buildGeofenceCircleGeoJSON(targetLng, targetLat, geofenceRadiusM),
        [targetLng, targetLat, geofenceRadiusM]
    );
    const c = {
        card: isDarkMode ? '#1e1e1e' : '#ffffff',
        text: isDarkMode ? '#ffffff' : '#333333',
        textTitle: isDarkMode ? '#ffffff' : '#1a1a1a',
        textLabel: isDarkMode ? '#a1a1aa' : '#888888',
        border: isDarkMode ? '#27272a' : '#E5E7EB',
        borderHard: isDarkMode ? '#3f3f46' : '#f0f0f0',
        badgeBg: isDarkMode ? '#27272a' : '#F3F4F6',
        badgeText: isDarkMode ? '#d4d4d8' : '#4B5563',
        successBg: isDarkMode ? '#064e3b' : '#DCFCE7',
        successText: isDarkMode ? '#34d399' : '#15803d',
        errorBg: isDarkMode ? '#7f1d1d' : '#FEE2E2',
        errorText: isDarkMode ? '#f87171' : '#B91C1C',
        warningBg: isDarkMode ? '#78350f' : '#FEF3C7',
        warningText: isDarkMode ? '#fbbf24' : '#b45309',
        hintText: isDarkMode ? '#a1a1aa' : '#6b7280',
        subtleText: isDarkMode ? '#a1a1aa' : '#64748b',
        blueBg: isDarkMode ? '#1e3a8a' : '#DBEAFE',
        blueText: isDarkMode ? '#60a5fa' : '#1d4ed8',
        whiteBorder: isDarkMode ? '#1e1e1e' : 'white',
    };
    const [fallbackPhotoUri, setFallbackPhotoUri] = useState<string | null>(null);
    const [hardwareSuccess, setHardwareSuccess] = useState(false);
    const [hardwarePreviewUrl, setHardwarePreviewUrl] = useState<string | null>(null);
    const [auditPreviewUrl, setAuditPreviewUrl] = useState<string | null>(null);
    const [hardwareProofUrl, setHardwareProofUrl] = useState<string | null>(null);
    const [auditProofUrl, setAuditProofUrl] = useState<string | null>(null);
    const [previewVersion, setPreviewVersion] = useState<number>(0);
    const [proofVersion, setProofVersion] = useState<number>(0);
    const [previewProofLoaded, setPreviewProofLoaded] = useState(false);
    const [previewProofFailed, setPreviewProofFailed] = useState(false);
    const [hardwareProofLoaded, setHardwareProofLoaded] = useState(false);
    const [hardwareProofFailed, setHardwareProofFailed] = useState(false);
    const [fallbackPhotoLoaded, setFallbackPhotoLoaded] = useState(false);
    const [proofWaitTimedOut, setProofWaitTimedOut] = useState(false);
    const [manualModeEnabled, setManualModeEnabled] = useState(false);
    const [manualCommandLoading, setManualCommandLoading] = useState(false);
    const [otpConfirmedByCloud, setOtpConfirmedByCloud] = useState(false);
    const [faceConfirmedByCloud, setFaceConfirmedByCloud] = useState(false);
    const [otpSyncPending, setOtpSyncPending] = useState(false);
    const [faceSyncPending, setFaceSyncPending] = useState(false);
    const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);

    // ━━━ SECURITY GATE: Box must confirm OTP before completion is possible ━━━
    const [boxOtpValidated, setBoxOtpValidated] = useState(false);
    const [cameraFailed, setCameraFailed] = useState(false);
    const [cameraState, setCameraState] = useState<CameraState | null>(null);
    const [photoUploadState, setPhotoUploadState] = useState<PhotoUploadState | null>(null);
    const [boxState, setBoxState] = useState<BoxState | null>(null);

    // ━━━ LOCK EVENTS: Real-time OTP + Face Detection from hardware ━━━
    const [lockEvent, setLockEvent] = useState<LockEvent | null>(null);
    const [faceDetected, setFaceDetected] = useState(false);
    const [boxReportedUnlocked, setBoxReportedUnlocked] = useState(false);
    const [unlockCommandAcked, setUnlockCommandAcked] = useState(false);
    const lockEventSubscriptionStartRef = useRef<number>(Date.now());
    const boxStateSubscriptionStartRef = useRef<number>(Date.now());
    const boxReportedUnlockedRef = useRef<boolean>(false);
    const unlockCommandAckedRef = useRef<boolean>(false);
    const lastCloudSignalAtRef = useRef<number>(Date.now());
    const recoveryInFlightRef = useRef<boolean>(false);
    const retryExhausted = lockEvent?.face_retry_exhausted === true || lockEvent?.fallback_required === true;
    const lowLightFallbackRequired = retryExhausted && lockEvent?.failure_reason === 'LOW_LIGHT';
    const effectivePreviewProofUrl = hardwarePreviewUrl || auditPreviewUrl;
    const effectiveHardwareProofUrl = hardwareProofUrl || auditProofUrl;
    const hasFallbackProof = !!fallbackPhotoUri;
    const fallbackModeActive = retryExhausted || cameraFailed || lowLightFallbackRequired;
    const displayedPreviewProofUrl = withProofCacheBust(effectivePreviewProofUrl, previewVersion);
    const displayedHardwareProofUrl = withProofCacheBust(effectiveHardwareProofUrl, proofVersion);
    const displayedProofUrl =
        displayedHardwareProofUrl && (hardwareProofLoaded || !displayedPreviewProofUrl || !previewProofLoaded)
            ? displayedHardwareProofUrl
            : displayedPreviewProofUrl;
    const displayedProofIsFull = displayedProofUrl === displayedHardwareProofUrl;
    const hiddenFullProofUrl =
        displayedHardwareProofUrl && displayedPreviewProofUrl && previewProofLoaded && !hardwareProofLoaded
            ? displayedHardwareProofUrl
            : null;
    const showFinalProofProgress = previewProofLoaded && !hardwareProofLoaded && !fallbackPhotoLoaded;
    const liveUploadProgress =
        photoUploadState &&
        photoUploadState.delivery_id === deliveryId &&
        photoUploadState.status !== 'COMPLETED'
            ? Math.max(0, Math.min(100, photoUploadState.progress_percent || 0))
            : null;
    const finalProofProgress = liveUploadProgress ?? (effectiveHardwareProofUrl ? 85 : 60);
    const finalProofProgressTitle = effectiveHardwareProofUrl
        ? (hardwareProofFailed
            ? 'Final proof uploaded. Keeping preview visible.'
            : 'Final proof uploaded. Loading high-quality photo...')
        : (photoUploadState?.status === 'FAILED'
            ? 'Final proof upload failed. Waiting for retry...'
            : photoUploadState?.status === 'UPLOADING'
                ? `Final proof upload ${finalProofProgress}%`
                : cameraState?.last_upload_role === 'full'
            ? 'Final proof upload is in progress...'
            : 'Preview ready. Final proof is uploading...');
    const finalProofProgressBody = effectiveHardwareProofUrl
        ? 'The high-quality ESP-CAM photo is replacing this preview as soon as it renders.'
        : (photoUploadState?.status === 'FAILED' && photoUploadState.error_message
            ? photoUploadState.error_message
            : 'This photo is only the quick preview. The ESP-CAM is sending the final uploaded version through LTE now.');
    const proofRenderFailed =
        (displayedHardwareProofUrl ? hardwareProofFailed : false) ||
        (displayedPreviewProofUrl ? previewProofFailed : false);
    const proofGate = getDropoffProofGate({
        otpConfirmedByCloud,
        espPreviewRendered: previewProofLoaded,
        espFullProofRendered: hardwareProofLoaded,
        fallbackPhotoRendered: fallbackPhotoLoaded,
        hasFallbackPhoto: hasFallbackProof,
        fallbackModeActive,
        proofWaitTimedOut,
        proofRenderFailed,
    });

    const markOtpVerified = useCallback(() => {
        setBoxOtpValidated(true);
        setOtpConfirmedByCloud(true);
        setOtpSyncPending(false);
    }, []);

    const markFaceVerified = useCallback(() => {
        markOtpVerified();
        setFaceDetected(true);
        setFaceConfirmedByCloud(true);
        setFaceSyncPending(false);
    }, [markOtpVerified]);

    const markHardwareVerified = useCallback(() => {
        setHardwareSuccess(true);
        markFaceVerified();
    }, [markFaceVerified]);

    // Auto-arrive logic
    useEffect(() => {
        let mounted = true;

        const hydrate = async () => {
            const memoryCached = verificationCacheByDelivery[deliveryId];
            const diskCached = await loadDropoffVerificationSnapshot(deliveryId);
            const cached = memoryCached || diskCached;
            if (!mounted || !cached) return;

            setBoxOtpValidated(cached.boxOtpValidated);
            setFaceDetected(cached.faceDetected);
            setCameraFailed(cached.cameraFailed);
            setHardwareSuccess(cached.hardwareSuccess);
            setFallbackPhotoUri(cached.fallbackPhotoUri);
            setHardwarePreviewUrl(cached.hardwarePreviewUrl ?? null);
            setAuditPreviewUrl(cached.auditPreviewUrl ?? null);
            setHardwareProofUrl(cached.hardwareProofUrl);
            setAuditProofUrl(cached.auditProofUrl);
            setPreviewVersion(cached.previewVersion ?? 0);
            setProofVersion(cached.proofVersion);
            setManualModeEnabled(cached.manualModeEnabled);
            if (cached.boxOtpValidated) {
                setOtpConfirmedByCloud(true);
                setOtpSyncPending(false);
            }
            if (cached.faceDetected) {
                setFaceConfirmedByCloud(true);
                setFaceSyncPending(false);
            }
        };

        hydrate();

        return () => {
            mounted = false;
        };
    }, [deliveryId]);

    useEffect(() => {
        const snapshot = {
            boxOtpValidated,
            faceDetected,
            cameraFailed,
            hardwareSuccess,
            fallbackPhotoUri,
            hardwarePreviewUrl,
            auditPreviewUrl,
            hardwareProofUrl,
            auditProofUrl,
            previewVersion,
            proofVersion,
            manualModeEnabled,
        };

        verificationCacheByDelivery[deliveryId] = snapshot;
        saveDropoffVerificationSnapshot(deliveryId, snapshot);
    }, [
        deliveryId,
        boxOtpValidated,
        faceDetected,
        cameraFailed,
        hardwareSuccess,
        fallbackPhotoUri,
        hardwarePreviewUrl,
        auditPreviewUrl,
        hardwareProofUrl,
        auditProofUrl,
        previewVersion,
        proofVersion,
        manualModeEnabled,
    ]);

    useEffect(() => {
        if (deliveryStatus === 'COMPLETED' || deliveryStatus === 'CANCELLED' || deliveryStatus === 'RETURNING') {
            clearDropoffVerificationSnapshot(deliveryId);
            delete verificationCacheByDelivery[deliveryId];
            setOtpSyncPending(false);
            setFaceSyncPending(false);
            setOtpConfirmedByCloud(false);
            setFaceConfirmedByCloud(false);
        }
    }, [deliveryId, deliveryStatus]);

    useEffect(() => {
        if (canAutoArrive && isInsideGeoFence && deliveryStatus === 'IN_TRANSIT') {
            // Automatically mark as ARRIVED when entering geofence
            const autoArrive = async () => {
                await updateDeliveryStatus(deliveryId, 'ARRIVED', {
                    arrived_at: Date.now(),
                    arrival_source: 'dropoff_verification_auto_arrive',
                    boxId,
                });
            };
            autoArrive();
        }
    }, [canAutoArrive, isInsideGeoFence, deliveryStatus, deliveryId, boxId]);

    const canProcessOtpSignals =
        canAutoArrive &&
        isInsideGeoFence &&
        (deliveryStatus === 'ARRIVED' || deliveryStatus === 'COMPLETED');

    const runCloudReconcile = async (reason: 'pending-timeout' | 'watchdog') => {
        if (recoveryInFlightRef.current || !canProcessOtpSignals) return;
        recoveryInFlightRef.current = true;
        try {
            const [proof, photoAudit, lockEventSnapshot, boxSnapshot] = await Promise.all([
                getDeliveryProofSnapshot(deliveryId),
                getPhotoAuditLogSnapshot(deliveryId),
                getLockEventSnapshot(boxId),
                getBoxStateSnapshot(boxId),
            ]);

            lastCloudSignalAtRef.current = Date.now();

            if (proof?.proof_photo_url) {
                setHardwareProofUrl(proof.proof_photo_url);
                setProofVersion(
                    typeof proof.proof_photo_uploaded_at === 'number'
                        ? proof.proof_photo_uploaded_at
                        : Date.now()
                );
                markHardwareVerified();
            }

            if (proof?.proof_photo_preview_url) {
                setHardwarePreviewUrl(proof.proof_photo_preview_url);
                setPreviewVersion(
                    typeof proof.proof_photo_preview_uploaded_at === 'number'
                        ? proof.proof_photo_preview_uploaded_at
                        : Date.now()
                );
                markHardwareVerified();
            }

            if (!proof?.proof_photo_url && photoAudit?.latest_photo_url) {
                setAuditProofUrl(photoAudit.latest_photo_url);
                setProofVersion(
                    typeof photoAudit.latest_photo_uploaded_at === 'number'
                        ? photoAudit.latest_photo_uploaded_at
                        : Date.now()
                );
                markHardwareVerified();
            }

            if (!proof?.proof_photo_preview_url && photoAudit?.latest_photo_preview_url) {
                setAuditPreviewUrl(photoAudit.latest_photo_preview_url);
                setPreviewVersion(
                    typeof photoAudit.latest_photo_preview_uploaded_at === 'number'
                        ? photoAudit.latest_photo_preview_uploaded_at
                        : Date.now()
                );
                markHardwareVerified();
            }

            if (lockEventSnapshot) {
                setLockEvent(lockEventSnapshot);
                const otpPassed =
                    lockEventSnapshot.otp_valid ||
                    lockEventSnapshot.face_detected ||
                    lockEventSnapshot.unlocked;
                const facePassed = lockEventSnapshot.face_detected || lockEventSnapshot.unlocked;

                if (otpPassed) {
                    markOtpVerified();
                } else {
                    setOtpSyncPending(false);
                }

                if (facePassed) {
                    markFaceVerified();
                } else if (lockEventSnapshot.otp_valid) {
                    setFaceSyncPending(false);
                }

                if (lockEventSnapshot.unlocked) {
                    markHardwareVerified();
                }
            }

            if (boxSnapshot) {
                setBoxState(boxSnapshot);
                const unlockedNow = boxSnapshot.status === 'UNLOCKING';
                setBoxReportedUnlocked(unlockedNow);
                boxReportedUnlockedRef.current = unlockedNow;

                const ackAt = typeof boxSnapshot.command_ack_at === 'number' ? boxSnapshot.command_ack_at : 0;
                const ackFresh = ackAt >= (boxStateSubscriptionStartRef.current - 1500);
                const ackUnlockSuccess =
                    boxSnapshot.command_ack_command === 'UNLOCKING' &&
                    (boxSnapshot.command_ack_status === 'executed' || boxSnapshot.command_ack_status === 'already_unlocked') &&
                    ackFresh;

                if (ackUnlockSuccess) {
                    setUnlockCommandAcked(true);
                    unlockCommandAckedRef.current = true;
                    await markLatestSentCommandAcked({
                        deliveryId,
                        boxId,
                        command: 'UNLOCKING',
                        ackStatus: boxSnapshot.command_ack_status,
                        ackDetails: boxSnapshot.command_ack_details,
                    });
                }
            }

            if (reason === 'watchdog') {
                setSubscriptionEpoch((value) => value + 1);
            }
        } catch {
            if (reason === 'watchdog') {
                setSubscriptionEpoch((value) => value + 1);
            }
        } finally {
            recoveryInFlightRef.current = false;
        }
    };

    useEffect(() => {
        if (deliveryStatus !== 'ARRIVED' && deliveryStatus !== 'COMPLETED' && deliveryStatus !== 'IN_TRANSIT') {
            setLockEvent(null);
        }
    }, [deliveryStatus]);

    useEffect(() => {
        if (!canProcessOtpSignals || (!otpSyncPending && !faceSyncPending)) return;

        const timeout = setTimeout(() => {
            runCloudReconcile('pending-timeout').catch(() => {
                // Best-effort reconcile fallback.
            });
        }, 3500);

        return () => clearTimeout(timeout);
    }, [canProcessOtpSignals, otpSyncPending, faceSyncPending, deliveryId, boxId]);

    useEffect(() => {
        if (!canProcessOtpSignals) return;

        const interval = setInterval(() => {
            const staleMs = Date.now() - lastCloudSignalAtRef.current;
            if (staleMs > 12000) {
                runCloudReconcile('watchdog').catch(() => {
                    // Self-healing path only.
                });
            }
        }, 6000);

        return () => clearInterval(interval);
    }, [canProcessOtpSignals, deliveryId, boxId]);

    useEffect(() => {
        setPreviewProofLoaded(false);
        setPreviewProofFailed(false);
    }, [displayedPreviewProofUrl]);

    useEffect(() => {
        setHardwareProofLoaded(false);
        setHardwareProofFailed(false);
    }, [displayedHardwareProofUrl]);

    useEffect(() => {
        setFallbackPhotoLoaded(false);
    }, [fallbackPhotoUri]);

    useEffect(() => {
        if (!displayedProofUrl) return;
        Image.prefetch(displayedProofUrl).catch(() => {
            // Best-effort warm-up only.
        });
    }, [displayedProofUrl]);

    useEffect(() => {
        setProofWaitTimedOut(false);
        if (!otpConfirmedByCloud || proofGate.visibleProofLoaded) return;
        if (!(hardwareSuccess || faceDetected || boxOtpValidated)) return;

        const timeout = setTimeout(() => {
            setProofWaitTimedOut(true);
        }, 12000);

        return () => clearTimeout(timeout);
    }, [
        deliveryId,
        otpConfirmedByCloud,
        hardwareSuccess,
        faceDetected,
        boxOtpValidated,
        displayedPreviewProofUrl,
        displayedHardwareProofUrl,
        proofGate.visibleProofLoaded,
    ]);

    // Monitor box state for OTP validation
    useEffect(() => {
        // Reset event gate whenever this subscription context changes.
        lockEventSubscriptionStartRef.current = Date.now();
        boxStateSubscriptionStartRef.current = Date.now();
        lastCloudSignalAtRef.current = Date.now();

        flushQueuedBoxCommands(async (item) => {
            await updateBoxState(item.boxId, {
                command: item.command,
                command_request_id: item.requestId,
                command_requested_by: item.requestedBy,
            } as any);
        }).catch(() => {
            // Best-effort flush on mount.
        });

        const unsubscribeBox = subscribeToBoxState(boxId, (state) => {
            lastCloudSignalAtRef.current = Date.now();
            setBoxState(state);
            const unlockedNow = state?.status === 'UNLOCKING';
            setBoxReportedUnlocked(unlockedNow);
            boxReportedUnlockedRef.current = unlockedNow;

            const ackAt = typeof state?.command_ack_at === 'number' ? state.command_ack_at : 0;
            const ackFresh = ackAt >= (boxStateSubscriptionStartRef.current - 1500);
            const ackUnlockSuccess =
                state?.command_ack_command === 'UNLOCKING' &&
                (state?.command_ack_status === 'executed' || state?.command_ack_status === 'already_unlocked') &&
                ackFresh;

            const ackLockSuccess =
                state?.command_ack_command === 'LOCKED' &&
                (state?.command_ack_status === 'executed' || state?.command_ack_status === 'already_locked') &&
                ackFresh;

            if (ackUnlockSuccess) {
                markLatestSentCommandAcked({
                    deliveryId,
                    boxId,
                    command: 'UNLOCKING',
                    ackStatus: state?.command_ack_status,
                    ackDetails: state?.command_ack_details,
                }).catch(() => { });
            }

            if (ackLockSuccess) {
                markLatestSentCommandAcked({
                    deliveryId,
                    boxId,
                    command: 'LOCKED',
                    ackStatus: state?.command_ack_status,
                    ackDetails: state?.command_ack_details,
                }).catch(() => { });
            }

            setUnlockCommandAcked(ackUnlockSuccess);
            unlockCommandAckedRef.current = ackUnlockSuccess;
        });

        // Monitor delivery proof for hardware camera success
        const unsubscribeProof = subscribeToDeliveryProof(deliveryId, (proof) => {
            lastCloudSignalAtRef.current = Date.now();
            if (canProcessOtpSignals && proof && proof.proof_photo_preview_url) {
                setHardwarePreviewUrl(proof.proof_photo_preview_url);
                if (typeof proof.proof_photo_preview_uploaded_at === 'number') {
                    setPreviewVersion(proof.proof_photo_preview_uploaded_at);
                } else {
                    setPreviewVersion(Date.now());
                }
                markHardwareVerified();
            }
            if (canProcessOtpSignals && proof && proof.proof_photo_url) {
                setHardwareProofUrl(proof.proof_photo_url);
                if (typeof proof.proof_photo_uploaded_at === 'number') {
                    setProofVersion(proof.proof_photo_uploaded_at);
                } else {
                    setProofVersion(Date.now());
                }
                markHardwareVerified(); // proof_photo_url implies box validated OTP + face
            }
        });

        // Fallback source: firmware writes latest photo URL under audit_logs/{deliveryId}
        const unsubscribePhotoAudit = subscribeToPhotoAuditLog(deliveryId, (audit) => {
            lastCloudSignalAtRef.current = Date.now();
            if (!canProcessOtpSignals || !audit) return;
            if (audit.latest_photo_preview_url) {
                setAuditPreviewUrl(audit.latest_photo_preview_url);
                if (typeof audit.latest_photo_preview_uploaded_at === 'number') {
                    setPreviewVersion(audit.latest_photo_preview_uploaded_at);
                } else {
                    setPreviewVersion(Date.now());
                }
                markHardwareVerified();
            }
            if (audit.latest_photo_url) {
                setAuditProofUrl(audit.latest_photo_url);
                if (typeof audit.latest_photo_uploaded_at === 'number') {
                    setProofVersion(audit.latest_photo_uploaded_at);
                } else {
                    setProofVersion(Date.now());
                }
                markHardwareVerified();
            }
        });

        // Monitor camera state for failures
        const unsubscribeCamera = subscribeToCamera(boxId, (camState) => {
            lastCloudSignalAtRef.current = Date.now();
            setCameraState(camState);
            if (camState && (camState.status === 'FAILED' || camState.status === 'HARDWARE_ERROR')) {
                setCameraFailed(true);
            }
        });

        const unsubscribePhotoUpload = subscribeToPhotoUploadState(boxId, (uploadState) => {
            lastCloudSignalAtRef.current = Date.now();
            setPhotoUploadState(uploadState);
            if (!uploadState || uploadState.delivery_id !== deliveryId) return;
            if (uploadState.status === 'COMPLETED') {
                markHardwareVerified();
            } else if (uploadState.status === 'FAILED') {
                setCameraFailed(true);
            }
        });

        // ━━━ Monitor lock events for OTP + face detection results ━━━
        const unsubscribeLockEvents = subscribeToLockEvents(boxId, (event) => {
            lastCloudSignalAtRef.current = Date.now();
            if (!canProcessOtpSignals || !event) return;

            // Ignore stale snapshot replay from previous delivery/session.
            // Firebase onValue emits latest existing value immediately.
            const eventMs =
                typeof event.timestamp === 'number' ? event.timestamp :
                typeof event.device_epoch === 'number' ? event.device_epoch * 1000 :
                null;
            if (eventMs && eventMs + 1500 < lockEventSubscriptionStartRef.current) {
                return;
            }

            setLockEvent(event);
            const otpPassed = event.otp_valid || event.face_detected || event.unlocked;
            const facePassed = event.face_detected || event.unlocked;

            if (otpPassed) {
                markOtpVerified();
            } else if (event.otp_valid === false) {
                setOtpSyncPending(false);
            }
            if (event.face_retry_exhausted || event.fallback_required) {
                setCameraFailed(true);
            }
            if (facePassed) {
                markFaceVerified();
            } else if (event.face_detected === false && event.otp_valid) {
                setFaceSyncPending(false);
            }
            if (event.unlocked) {
                // Box confirmed OTP + face + solenoid fired
                markHardwareVerified();
            }
        });

        return () => {
            unsubscribeBox();
            unsubscribeProof();
            unsubscribePhotoAudit();
            unsubscribeCamera();
            unsubscribePhotoUpload();
            unsubscribeLockEvents();
        };
    }, [
        boxId,
        deliveryId,
        canProcessOtpSignals,
        subscriptionEpoch,
        markOtpVerified,
        markFaceVerified,
        markHardwareVerified,
    ]);

    useEffect(() => {
        const flush = async () => {
            await flushQueuedBoxCommands(async (item) => {
                await updateBoxState(item.boxId, {
                    command: item.command,
                    command_request_id: item.requestId,
                    command_requested_by: item.requestedBy,
                } as any);
            }, 20);
        };

        const interval = setInterval(() => {
            flush().catch(() => {
                // Best-effort retry loop.
            });
        }, 3000);

        return () => clearInterval(interval);
    }, [boxId]);

    const handleCaptureFallbackPhoto = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
            });
            if (!result.canceled && result.assets?.[0]?.uri) {
                setFallbackPhotoUri(result.assets[0].uri);
            }
        } catch (e) {
            PremiumAlert.alert('Camera Error', 'Unable to capture fallback photo.');
        }
    };

    const handleManualBoxCommand = async (command: 'UNLOCKING' | 'LOCKED') => {
        if (!manualModeEnabled || !isInsideGeoFence || !otpConfirmedByCloud || !faceConfirmedByCloud) {
            PremiumAlert.alert('Manual Control Locked', 'Enable manual mode and complete geofence, OTP, and face checks first.');
            return;
        }

        setManualCommandLoading(true);
        try {
            const requestId = `dropoff_manual_${Date.now()}`;
            const requestedBy = 'mobile_rider_dropoff_manual';

            await enqueueBoxCommand({
                deliveryId,
                boxId,
                command,
                requestId,
                requestedBy,
            });

            const flushResult = await flushQueuedBoxCommands(async (item) => {
                await updateBoxState(item.boxId, {
                    command: item.command,
                    command_request_id: item.requestId,
                    command_requested_by: item.requestedBy,
                } as any);
            }, 10);

            PremiumAlert.alert(
                'Manual Command Sent',
                flushResult.sent > 0
                    ? (command === 'UNLOCKING'
                        ? 'Unlock command queued and sent to box.'
                        : 'Lock command queued and sent to box. If lid is still open, app will show lock pending until reed-close is confirmed.')
                    : 'Command queued locally. It will send automatically when connectivity stabilizes.'
            );
        } catch (error) {
            PremiumAlert.alert('Manual Command Failed', 'Could not send manual command. Please try again.');
        } finally {
            setManualCommandLoading(false);
        }
    };

    const waitForBoxUnlock = async (timeoutMs = 15000): Promise<boolean> => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (boxReportedUnlockedRef.current && unlockCommandAckedRef.current) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return false;
    };

    const handleDeliverySwipe = async () => {
        if (deliveryStatus === 'COMPLETED') {
            // Already completed by hardware
            onDeliveryCompleted();
            return;
        }

        // ━━━ SECURITY CHECK: Box must have validated OTP ━━━
        if (!otpConfirmedByCloud) {
            PremiumAlert.alert(
                'OTP Not Verified',
                'Waiting for cloud confirmation of OTP validation. Please wait a moment.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (!proofGate.visibleProofLoaded) {
            if (retryExhausted) {
                PremiumAlert.alert('Fallback Required', 'Camera could not produce a visible proof. Capture a fallback photo before completing delivery.');
            } else if (hardwareSuccess) {
                PremiumAlert.alert('Proof Photo Pending', 'Face verification succeeded, but the proof photo is not visible yet. Please wait a moment.');
            } else {
                PremiumAlert.alert('Cannot Complete', 'Hardware verification pending. If the box camera failed, please capture a fallback photo.');
            }
            return;
        }

        setIsLoading(true);
        try {
            let resolvedProofUrl: string | null = effectiveHardwareProofUrl || effectivePreviewProofUrl || null;

            if (fallbackPhotoUri && fallbackPhotoLoaded && !hardwareProofLoaded && !previewProofLoaded) {
                const uploadResult = await uploadDeliveryProofPhoto({
                    deliveryId,
                    boxId,
                    localUri: fallbackPhotoUri,
                });

                if (!uploadResult.success) {
                    PremiumAlert.alert('Upload Failed', 'Fallback photo upload failed. Please retry.');
                    return;
                }

                resolvedProofUrl = uploadResult.url || null;

                if (!hardwareSuccess) {
                    await updateBoxState(boxId, {
                        command: 'UNLOCKING',
                    });

                    const unlockConfirmed = await waitForBoxUnlock();
                    if (!unlockConfirmed) {
                        PremiumAlert.alert('Unlock Pending', 'Fallback photo was uploaded, but box unlock was not confirmed yet. Please retry in a moment.');
                        return;
                    }
                }
            }

            const completedAt = Date.now();
            const statusSaved = await updateDeliveryStatus(deliveryId, 'COMPLETED', {
                completed_at: completedAt,
                proof_photo_url: resolvedProofUrl,
                proof_photo_uploaded_at: completedAt,
                proof_photo_preview_url: effectivePreviewProofUrl || null,
                box_id: boxId,
            });

            if (!statusSaved) {
                PremiumAlert.alert('Action Failed', 'Could not mark this delivery as completed. Please check connection and try again.');
                return;
            }

            PremiumAlert.alert('Delivery Completed', 'Package delivered successfully.');
            onDeliveryCompleted();
        } finally {
            setIsLoading(false);
        }
    };

    // ━━━ Determine handover card status message ━━━
    const getHandoverStatusMessage = (): { text: string; color: string; bgColor: string } => {
        if (hardwareSuccess && proofGate.visibleProofLoaded) {
            return { text: '✅ Box unlocked! OTP verified and proof photo is visible.', color: c.successText, bgColor: c.successBg };
        }
        if (boxOtpValidated && hardwareSuccess && !proofGate.visibleProofLoaded) {
            return { text: '📷 Face verification passed. Waiting for proof photo preview to render.', color: c.blueText, bgColor: c.blueBg };
        }
        if (boxOtpValidated && fallbackPhotoUri && boxReportedUnlocked) {
            return { text: '✅ Fallback photo verified and unlock confirmed. Ready to complete.', color: c.successText, bgColor: c.successBg };
        }
        if (boxOtpValidated && !faceDetected && !retryExhausted && typeof lockEvent?.face_attempts === 'number' && lockEvent.face_attempts > 0) {
            const attempt = Math.min(lockEvent.face_attempts, 3);
            return { text: `🔎 Face scan attempt ${attempt}/3 in progress...`, color: c.blueText, bgColor: c.blueBg };
        }
        if (boxOtpValidated && retryExhausted && typeof lockEvent?.face_attempts === 'number' && lockEvent.face_attempts >= 3) {
                return { text: '⚠️ Face scan attempt 3/3 failed. Capture fallback photo to proceed.', color: c.warningText, bgColor: c.warningBg };
        }
        if (boxOtpValidated && !faceDetected && lockEvent?.otp_valid && lockEvent?.face_detected === false) {
            return { text: '⚠️ OTP correct but NO face detected — box remains locked. Ask customer to stand in front of camera.', color: c.warningText, bgColor: c.warningBg };
        }
        if (boxOtpValidated && retryExhausted && !fallbackPhotoUri) {
            return { text: '⚠️ Face check failed after 3 attempts. Capture fallback photo to proceed.', color: c.warningText, bgColor: c.warningBg };
        }
        if (fallbackPhotoUri && !hardwareSuccess && !unlockCommandAcked) {
            return { text: '📤 Fallback photo uploaded. Waiting for box unlock confirmation...', color: c.blueText, bgColor: c.blueBg };
        }
        if (boxOtpValidated && cameraFailed && fallbackPhotoUri) {
            return { text: '📸 OTP verified ✓  Fallback photo captured. Ready to complete.', color: c.successText, bgColor: c.successBg };
        }
        if (cameraFailed && fallbackPhotoUri) {
            return { text: '📸 Box camera failed. Fallback photo captured. Ready to complete.', color: c.successText, bgColor: c.successBg };
        }
        if (boxOtpValidated && cameraFailed) {
            return { text: '⚠️ OTP verified ✓  Box camera failed. Please capture a fallback photo.', color: c.warningText, bgColor: c.warningBg };
        }
        if (cameraFailed) {
            return { text: '⚠️ Box camera failed. Please capture a fallback photo to proceed.', color: c.warningText, bgColor: c.warningBg };
        }
        if (boxOtpValidated && faceDetected) {
            return { text: '🔓 OTP verified & face detected ✓  Finalizing unlock...', color: c.blueText, bgColor: c.blueBg };
        }
        if (boxOtpValidated) {
            return { text: '🔓 OTP verified ✓  Waiting for face detection...', color: c.blueText, bgColor: c.blueBg };
        }
        if (lockEvent?.otp_valid === false) {
            return { text: '❌ Wrong OTP entered! Customer should try again.', color: c.errorText, bgColor: c.errorBg };
        }
        return { text: '🔒 Waiting for customer to enter OTP on the box...', color: c.textLabel, bgColor: c.badgeBg };
    };

    // Can the rider swipe to complete?
    const canSwipe = proofGate.canSwipe;
    // Can the rider see the fallback photo button?
    const showFallbackButton = proofGate.fallbackAllowed;
    const canManualControl = manualModeEnabled && isInsideGeoFence && otpConfirmedByCloud && faceConfirmedByCloud;
    const isSyncPending = otpSyncPending || faceSyncPending;
    const lockAckCommand = (boxState as any)?.command_ack_command;
    const lockAckStatus = (boxState as any)?.command_ack_status;
    const lockAckDetails = (boxState as any)?.command_ack_details;
    const lockAwaitingClose = lockAckCommand === 'LOCKED' && lockAckStatus === 'waiting_close';
    const lockAwaitingCloseNeedsAssist = lockAwaitingClose && lockAckDetails === 'reed_open';
    const lockCloseConfirmed = lockAckCommand === 'LOCKED' && lockAckStatus === 'executed' && lockAckDetails === 'reed_closed_confirmed';
    const canRevealManualControls = isInsideGeoFence && otpConfirmedByCloud && faceConfirmedByCloud;
    const showManualControls = lockAwaitingClose || lockCloseConfirmed || (manualModeEnabled && canRevealManualControls);
    const zoneStatusText = !isInsideGeoFence
        ? 'Navigate to the drop-off zone.'
        : canSwipe
            ? 'Verification complete. Swipe to finish delivery.'
            : boxOtpValidated && faceDetected
                ? 'OTP and face confirmed. Waiting for proof photo.'
                : boxOtpValidated
                    ? 'OTP accepted. Waiting for face check.'
                    : deliveryStatus === 'ARRIVED'
                        ? 'Arrived. Customer can enter the OTP on the box.'
                        : 'Inside drop-off zone. Syncing the box now.';

    const getCompactHandoverStatusText = (): string => {
        if (hardwareSuccess && proofGate.visibleProofLoaded) {
            return 'Box unlocked and visible proof photo received. Ready to complete.';
        }
        if (boxOtpValidated && hardwareSuccess && !proofGate.visibleProofLoaded) {
            return 'Box unlocked. Waiting for the proof photo preview.';
        }
        if (boxOtpValidated && fallbackPhotoUri && boxReportedUnlocked) {
            return 'Fallback photo captured and unlock confirmed. Ready to complete.';
        }
        if (boxOtpValidated && !faceDetected && !retryExhausted && typeof lockEvent?.face_attempts === 'number' && lockEvent.face_attempts > 0) {
            return `Face check ${Math.min(lockEvent.face_attempts, 3)}/3 in progress.`;
        }
        if (boxOtpValidated && retryExhausted) {
            return 'Face check failed. Capture a fallback photo to proceed.';
        }
        if (boxOtpValidated && !faceDetected && lockEvent?.otp_valid && lockEvent?.face_detected === false) {
            return 'OTP accepted. Ask the customer to face the camera.';
        }
        if (fallbackPhotoUri && !hardwareSuccess && !unlockCommandAcked) {
            return 'Fallback photo captured. Waiting for box unlock confirmation.';
        }
        if (boxOtpValidated && cameraFailed && fallbackPhotoUri) {
            return 'OTP accepted and fallback photo captured. Ready to complete.';
        }
        if (cameraFailed && fallbackPhotoUri) {
            return 'Fallback photo captured. Ready to complete.';
        }
        if (boxOtpValidated && cameraFailed) {
            return 'OTP accepted. Box camera failed, capture a fallback photo.';
        }
        if (cameraFailed) {
            return 'Box camera failed. Capture a fallback photo to proceed.';
        }
        if (boxOtpValidated && faceDetected) {
            return 'OTP and face confirmed. Finalizing unlock.';
        }
        if (boxOtpValidated) {
            return 'OTP accepted. Waiting for face check.';
        }
        if (lockEvent?.otp_valid === false) {
            return 'Wrong OTP. Ask the customer to try again.';
        }
        return 'Ask the customer to enter the OTP on the box.';
    };

    const statusMsg = { ...getHandoverStatusMessage(), text: getCompactHandoverStatusText() };

    const formatAge = (timestamp?: number): string => {
        if (!timestamp || timestamp <= 0) return '—';
        const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffH = Math.floor(diffMin / 60);
        return `${diffH}h ago`;
    };

    return (
        <View style={styles.container}>
            {/* Header Status Block */}
            <View style={styles.modernHeader}>
                <View style={[styles.modernHeaderIcon, { backgroundColor: isInsideGeoFence ? c.successBg : c.errorBg }]}>
                    <Text style={{ fontSize: 24 }}>{isInsideGeoFence ? '📍' : '🧭'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                    <Text style={[styles.modernHeaderTitle, { color: c.textTitle }]}>Drop-Off Zone</Text>
                    <Text style={[styles.modernHeaderSubtitle, { color: isInsideGeoFence ? c.successText : c.errorText }]}>
                        {isInsideGeoFence ? 'You are inside the zone' : distanceMeters !== null ? `${formatDistance(distanceMeters)} away` : 'Locating...'}
                    </Text>
                </View>
            </View>

            {/* Check Badges */}
            <View style={styles.checksContainer}>
                <View style={styles.checksRowMulti}>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: isPhoneInside ? c.successBg : c.errorBg }]}>
                        <Text style={{ fontSize: 12, color: isPhoneInside ? c.successText : c.errorText, fontFamily: 'Inter_600SemiBold' }}>
                            {isPhoneInside ? '✓ Phone GPS' : '✗ Phone GPS'}
                        </Text>
                    </View>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: isBoxOffline ? c.warningBg : (isBoxInside ? c.successBg : c.errorBg) }]}>
                        <Text style={{ fontSize: 12, color: isBoxOffline ? c.warningText : (isBoxInside ? c.successText : c.errorText), fontFamily: 'Inter_600SemiBold' }}>
                            {isBoxOffline ? '? Box Offline' : (isBoxInside ? '✓ Smart Box' : '✗ Smart Box')}
                        </Text>
                    </View>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: boxOtpValidated ? c.successBg : (lockEvent?.otp_valid === false ? c.errorBg : c.warningBg) }]}>
                        <Text style={{ fontSize: 12, color: boxOtpValidated ? c.successText : (lockEvent?.otp_valid === false ? c.errorText : c.warningText), fontFamily: 'Inter_600SemiBold' }}>
                            {boxOtpValidated ? '✓ OTP' : (lockEvent?.otp_valid === false ? '✗ OTP' : '⏳ OTP')}
                        </Text>
                    </View>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: faceDetected ? c.successBg : (lockEvent?.otp_valid && !lockEvent?.face_detected ? c.errorBg : c.warningBg) }]}>
                        <Text style={{ fontSize: 12, color: faceDetected ? c.successText : (lockEvent?.otp_valid && !lockEvent?.face_detected ? c.errorText : c.warningText), fontFamily: 'Inter_600SemiBold' }}>
                            {faceDetected ? '✓ Face' : (lockEvent?.otp_valid && !lockEvent?.face_detected ? '✗ Face' : '⏳ Face')}
                        </Text>
                    </View>
                </View>
                <Text style={{ fontSize: 11, color: c.subtleText, marginTop: 12, textAlign: 'center' }}>
                    Phone GPS: {formatAge(lastPhoneGpsAt)} • Box heartbeat: {formatAge(lastBoxHeartbeatAt)}
                </Text>
            </View>

            <View style={[styles.statusMessageContainer, { backgroundColor: isInsideGeoFence ? c.successBg : c.errorBg }]}>
                <Text style={[styles.statusMessageText, { color: isInsideGeoFence ? c.successText : c.errorText }]}>
                    {zoneStatusText}
                </Text>
            </View>

            {/* Map Preview */}
            {mapAvailable && targetLat !== 0 && (
                <View style={styles.mapContainer}>
                    <MapboxGL.MapView
                        style={styles.map}
                        styleURL={isDarkMode ? StyleURL.Dark : StyleURL.Light}
                        logoEnabled={false}
                        attributionEnabled={false}
                        scrollEnabled={false}
                        zoomEnabled={false}
                        pitchEnabled={false}
                        rotateEnabled={false}
                    >
                        <MapboxGL.Camera
                            centerCoordinate={[targetLng, targetLat]}
                            zoomLevel={16}
                            animationMode="none"
                        />
                        <MapboxGL.ShapeSource id="dropoff-geofence-circle" shape={geofenceCircle}>
                            <MapboxGL.FillLayer
                                id="dropoff-geofence-fill"
                                style={{
                                    fillColor: isInsideGeoFence ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                    fillOutlineColor: isInsideGeoFence ? '#22c55e' : '#ef4444',
                                }}
                            />
                        </MapboxGL.ShapeSource>
                        <MapboxGL.MarkerView id="dropoff-target" coordinate={[targetLng, targetLat]}>
                            <View style={styles.targetMarker}><Text style={styles.targetMarkerText}>📍</Text></View>
                        </MapboxGL.MarkerView>
                        {hasRiderPosition && currentLat != null && currentLng != null && (
                            <AnimatedRiderMarker
                                latitude={currentLat}
                                longitude={currentLng}
                                rotation={currentHeading ?? undefined}
                                isSelected={isPhoneInside}
                            />
                        )}
                    </MapboxGL.MapView>
                    {distanceMeters !== null && (
                        <View style={[styles.mapDistanceOverlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)' }]}>
                            <Text style={[styles.mapDistanceText, { color: isInsideGeoFence ? '#22c55e' : c.text }]}>
                                {isInsideGeoFence ? '✓ Inside Zone' : `${formatDistance(distanceMeters)} to zone`}
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {!mapAvailable && hasRiderPosition && distanceMeters !== null && (
                <View style={[styles.proximityFallback, { backgroundColor: c.badgeBg, borderColor: c.border }]}>
                    <Text style={{ fontSize: 24, marginBottom: 4 }}>
                        {isInsideGeoFence ? '📍' : '🧭'}
                    </Text>
                    <Text style={[styles.proximityText, { color: c.text }]}>
                        {isInsideGeoFence
                            ? 'You are inside the drop-off zone'
                            : `${formatDistance(distanceMeters)} from drop-off zone (${formatDistance(geofenceRadiusM)} radius)`
                        }
                    </Text>
                </View>
            )}

            {/* Location & Recipient Details Block */}
            <View style={[styles.detailsBlock, { backgroundColor: isDarkMode ? '#18181b' : '#fafafa', borderColor: c.border }]}>
                <View style={styles.locationHeaderRow}>
                    <View style={{ flex: 1, paddingRight: 16 }}>
                        <Text style={[styles.sectionLabel, { color: c.textLabel }]}>DROPOFF LOCATION</Text>
                        <Text style={[styles.detailText, { color: c.textTitle }]}>{targetAddress}</Text>
                    </View>
                    <IconButton icon="navigation-variant" size={24} mode="contained" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} iconColor={isDarkMode ? '#e4e4e7' : '#18181b'} onPress={onNavigate} style={{ margin: 0 }} />
                </View>

                {recipientName ? (
                    <View style={[styles.senderRow, { borderTopColor: c.border }]}>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.sectionLabel, { color: c.textLabel }]}>RECIPIENT</Text>
                            <Text style={[styles.detailText, { color: c.textTitle }]}>{recipientName}</Text>
                            {customerPhone ? <Text style={{ fontSize: 13, color: c.textLabel, marginTop: 2 }}>{customerPhone}</Text> : null}
                        </View>
                        {customerPhone && (
                            <View style={styles.actionButtons}>
                                <IconButton icon="message-text" size={20} iconColor={c.textTitle} mode="contained-tonal" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} onPress={() => Linking.openURL(`sms:${customerPhone}`)} style={{ margin: 0 }} />
                                <IconButton icon="phone" size={20} iconColor={c.textTitle} mode="contained-tonal" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} onPress={() => Linking.openURL(`tel:${customerPhone}`)} style={{ margin: 0 }} />
                            </View>
                        )}
                    </View>
                ) : null}

                {deliveryNotes ? (
                    <View style={[styles.notesRow, { backgroundColor: isDarkMode ? '#27272a' : '#f4f4f5' }]}>
                        <Text style={[styles.sectionLabel, { color: c.textLabel }]}>DELIVERY NOTES</Text>
                        <Text style={{ fontSize: 14, color: c.textTitle, marginTop: 4 }}>{deliveryNotes}</Text>
                    </View>
                ) : null}
            </View>

            {/* Handover Flow UI only shows if inside Geofence */}
            {isInsideGeoFence && (
                <View style={[styles.verificationBlock, { backgroundColor: isDarkMode ? '#18181b' : '#fafafa', borderColor: c.border }]}>
                    <View style={styles.verificationHeader}>
                        <Text style={[styles.verificationTitle, { color: c.textTitle }]}>Handover Parcel</Text>
                        <Text style={{ fontSize: 13, color: c.textLabel, marginTop: 2 }}>Secure unlock & verify identity</Text>
                    </View>
                    
                    <View style={{ padding: 16 }}>
                        {/* Dynamic status message */}
                        <View style={[styles.statusMessageContainer, { marginBottom: 16, backgroundColor: statusMsg.bgColor }]}>
                            <Text style={[styles.statusMessageText, { color: statusMsg.color }]}>
                                {statusMsg.text}
                            </Text>
                        </View>

                        {isSyncPending && (
                            <View style={[styles.statusMessageContainer, { marginBottom: 16, backgroundColor: c.warningBg }]}>
                                <Text style={[styles.statusMessageText, { color: c.warningText }]}>
                                    Syncing box verification. Wait a moment.
                                </Text>
                            </View>
                        )}

                        <View style={[styles.proofPanel, { borderColor: c.borderHard, backgroundColor: isDarkMode ? '#000' : '#f8f9fa' }]}>
                            <Text style={[styles.proofTitle, { color: c.textTitle }]}>Verification Photo</Text>
                            {displayedProofUrl ? (
                                <>
                                    <View style={[styles.photoPreviewWrapper, { borderColor: isDarkMode ? '#064e3b' : '#dcfce7', backgroundColor: isDarkMode ? '#000' : '#f8f9fa' }]}>
                                        <Image
                                            source={{ uri: displayedProofUrl }}
                                            style={styles.photoImage}
                                            resizeMode="cover"
                                            progressiveRenderingEnabled
                                            onLoad={() => {
                                                if (displayedProofIsFull) {
                                                    setHardwareProofLoaded(true);
                                                    setHardwareProofFailed(false);
                                                } else {
                                                    setPreviewProofLoaded(true);
                                                    setPreviewProofFailed(false);
                                                }
                                            }}
                                            onError={() => {
                                                if (displayedProofIsFull) {
                                                    setHardwareProofFailed(true);
                                                } else {
                                                    setPreviewProofFailed(true);
                                                }
                                            }}
                                        />
                                        {hiddenFullProofUrl && (
                                            <Image
                                                source={{ uri: hiddenFullProofUrl }}
                                                style={styles.hiddenProofImage}
                                                resizeMode="cover"
                                                progressiveRenderingEnabled
                                                onLoad={() => {
                                                    setHardwareProofLoaded(true);
                                                    setHardwareProofFailed(false);
                                                }}
                                                onError={() => setHardwareProofFailed(true)}
                                            />
                                        )}
                                        {proofGate.visibleProofLoaded && (
                                            <View style={styles.photoVerifiedOverlay}>
                                                <Text style={styles.photoVerifiedText}>✅ Photo Verified</Text>
                                            </View>
                                        )}
                                    </View>
                                    <Text style={[styles.proofHintSuccess, { color: proofGate.visibleProofLoaded ? c.successText : c.textLabel }]}>
                                        {proofGate.visibleProofLoaded
                                            ? (displayedProofIsFull && hardwareProofLoaded
                                                ? 'Full ESP-CAM proof is visible. You can now swipe to complete.'
                                                : 'ESP-CAM proof preview is visible. You can now swipe while the full photo finishes.')
                                            : 'Loading proof image preview...'}
                                    </Text>
                                    {showFinalProofProgress && (
                                        <View style={[styles.finalProofNotice, { borderColor: c.borderHard, backgroundColor: c.card }]}>
                                            <ActivityIndicator size="small" color={c.blueText} />
                                            <View style={styles.finalProofNoticeText}>
                                                <Text style={[styles.finalProofNoticeTitle, { color: c.textTitle }]}>
                                                    {finalProofProgressTitle}
                                                </Text>
                                                <Text style={[styles.finalProofNoticeBody, { color: c.textLabel }]}>
                                                    {finalProofProgressBody}
                                                </Text>
                                                <View style={[styles.finalProofProgressTrack, { backgroundColor: c.borderHard }]}>
                                                    <View
                                                        style={[
                                                            styles.finalProofProgressFill,
                                                            { width: `${finalProofProgress}%`, backgroundColor: c.blueText },
                                                        ]}
                                                    />
                                                </View>
                                            </View>
                                        </View>
                                    )}
                                </>
                            ) : (
                                <>
                                    <Text style={[styles.proofHintPending, { color: c.textLabel }]}>
                                        Waiting for ESP-CAM proof preview to appear before swipe completion.
                                    </Text>
                                    {liveUploadProgress !== null && (
                                        <View style={[styles.finalProofNotice, { borderColor: c.borderHard, backgroundColor: c.card }]}>
                                            <ActivityIndicator size="small" color={c.blueText} />
                                            <View style={styles.finalProofNoticeText}>
                                                <Text style={[styles.finalProofNoticeTitle, { color: c.textTitle }]}>
                                                    {photoUploadState?.status === 'FAILED'
                                                        ? 'ESP-CAM upload failed. Waiting for retry...'
                                                        : `ESP-CAM upload ${liveUploadProgress}%`}
                                                </Text>
                                                <Text style={[styles.finalProofNoticeBody, { color: c.textLabel }]}>
                                                    {photoUploadState?.error_message || 'The box has detected the face and is relaying the proof photo through LTE.'}
                                                </Text>
                                                <View style={[styles.finalProofProgressTrack, { backgroundColor: c.borderHard }]}>
                                                    <View
                                                        style={[
                                                            styles.finalProofProgressFill,
                                                            { width: `${liveUploadProgress}%`, backgroundColor: c.blueText },
                                                        ]}
                                                    />
                                                </View>
                                            </View>
                                        </View>
                                    )}
                                </>
                            )}
                        </View>

                        {/* Fallback photo button — visible after box confirms OTP or if camera fails */}
                        {showFallbackButton && (
                            <View style={{ marginTop: 16 }}>
                                <Button
                                    mode="outlined"
                                    icon="camera-retake"
                                    onPress={handleCaptureFallbackPhoto}
                                    disabled={isLoading}
                                    textColor={c.textTitle}
                                    style={{ borderColor: c.borderHard }}
                                >
                                    {fallbackPhotoUri ? 'Retake fallback photo' : 'Capture fallback photo'}
                                </Button>
                                {fallbackPhotoUri && (
                                    <>
                                        <View style={[styles.photoPreviewWrapper, { borderColor: c.borderHard, backgroundColor: isDarkMode ? '#000' : '#f8f9fa', marginTop: 12 }]}>
                                            <Image
                                                source={{ uri: fallbackPhotoUri }}
                                                style={styles.photoImage}
                                                resizeMode="cover"
                                                onLoad={() => setFallbackPhotoLoaded(true)}
                                                onError={() => setFallbackPhotoLoaded(false)}
                                            />
                                        </View>
                                        <Text style={{ marginTop: 6, color: fallbackPhotoLoaded ? c.successText : c.textLabel, textAlign: 'center', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                                            {fallbackPhotoLoaded
                                                ? 'Fallback photo is visible. You may now complete delivery.'
                                                : 'Loading fallback photo preview before completion.'}
                                        </Text>
                                    </>
                                )}
                            </View>
                        )}

                        <View style={{ marginTop: 20 }}>
                            <SwipeConfirmButton
                                label="Swipe Parcel Delivered"
                                onConfirm={handleDeliverySwipe}
                                disabled={!canSwipe || isLoading}
                            />
                        </View>
                    </View>
                </View>
            )}

            {/* Smart Box Controls */}
            <View style={styles.boxControlSection}>
                <View style={styles.boxControlHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 18 }}>📦</Text>
                        <Text style={[styles.boxControlTitle, { color: c.textTitle }]}>Box Control</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.connectionDot, { backgroundColor: boxState ? c.successText : c.errorText }]} />
                        <Text style={[styles.connectionText, { color: boxState ? c.successText : c.errorText }]}>
                            {boxState ? 'Connected' : 'Offline'}
                        </Text>
                    </View>
                </View>



                {isInsideGeoFence ? (
                    canRevealManualControls ? (
                        <View style={{ marginTop: 8 }}>
                            <View style={[styles.manualOverrideRow, { borderTopColor: c.border }]}>
                                <Text style={[styles.manualOverrideText, { color: c.textTitle }]}>Manual override</Text>
                                <Switch value={manualModeEnabled} onValueChange={setManualModeEnabled} color={isDarkMode ? '#f4f4f5' : '#18181b'} trackColor={{ false: isDarkMode ? '#3f3f46' : '#e4e4e7', true: isDarkMode ? '#f4f4f5' : '#18181b' }} thumbColor={isDarkMode ? '#18181b' : '#ffffff'} />
                            </View>

                            {manualModeEnabled && (
                                <View style={{ paddingTop: 16 }}>
                                    <View style={{ flexDirection: 'row', gap: 12 }}>
                                        <Button
                                            mode={boxState?.status === 'UNLOCKING' ? 'contained' : 'outlined'}
                                            icon={boxState?.status === 'UNLOCKING' ? 'check' : 'lock-open-outline'}
                                            onPress={() => handleManualBoxCommand('UNLOCKING')}
                                            disabled={!canManualControl || manualCommandLoading || boxState?.status === 'UNLOCKING'}
                                            loading={manualCommandLoading && boxState?.status === 'UNLOCKING'}
                                            style={[styles.boxButton, { borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7' }]}
                                            buttonColor={boxState?.status === 'UNLOCKING' ? (isDarkMode ? '#f4f4f5' : '#18181b') : 'transparent'}
                                            textColor={boxState?.status === 'UNLOCKING' ? (isDarkMode ? '#000' : '#fff') : c.textTitle}
                                        >
                                            {boxState?.status === 'UNLOCKING' ? 'Unlocked' : 'Unlock'}
                                        </Button>
                                        <Button
                                            mode={boxState?.status === 'LOCKED' ? 'contained' : 'outlined'}
                                            icon={boxState?.status === 'LOCKED' ? 'lock' : 'lock-outline'}
                                            onPress={() => handleManualBoxCommand('LOCKED')}
                                            disabled={!canManualControl || manualCommandLoading || boxState?.status === 'LOCKED'}
                                            loading={manualCommandLoading && boxState?.status !== 'UNLOCKING'}
                                            style={[styles.boxButton, { borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7' }]}
                                            buttonColor={boxState?.status === 'LOCKED' ? (isDarkMode ? '#f4f4f5' : '#18181b') : 'transparent'}
                                            textColor={boxState?.status === 'LOCKED' ? (isDarkMode ? '#000' : '#fff') : c.textTitle}
                                        >
                                            {boxState?.status === 'LOCKED' ? 'Locked' : 'Lock'}
                                        </Button>
                                    </View>

                                    {lockAwaitingClose && (
                                        <Text style={[styles.boxAlertText, { color: c.warningText }]}>
                                            {lockAwaitingCloseNeedsAssist ? '⚠️ Close lid until latch aligns. Press # to retract briefly if needed.' : '⚠️ Push lid down to secure lock'}
                                        </Text>
                                    )}

                                    {lockCloseConfirmed && (
                                        <Text style={[styles.boxAlertText, { color: c.successText }]}>✓ Box is physically secured</Text>
                                    )}
                                </View>
                            )}

                            {!canManualControl && (
                                <Text style={{ marginTop: 16, fontSize: 13, color: c.subtleText, textAlign: 'center' }}>
                                    Available after geofence, OTP, and face checks are confirmed.
                                </Text>
                            )}
                        </View>
                    ) : (
                        <View style={[styles.autoControlsMsg, { borderTopColor: c.border }]}>
                            <Text style={{ fontSize: 13, color: c.hintText }}>Controls unlock after OTP and face checks.</Text>
                        </View>
                    )
                ) : (
                    <View style={[styles.autoControlsMsg, { borderTopColor: c.border }]}>
                        <Text style={{ fontSize: 13, color: c.hintText }}>Controls unlock automatically upon arrival.</Text>
                    </View>
                )}
            </View>

            {/* Helper Buttons */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
                {isInsideGeoFence && !isWaitTimerActive && (
                    <Button
                        mode="contained-tonal"
                        onPress={onShowCustomerNotHome}
                        style={{ flex: 1 }}
                        buttonColor={isDarkMode ? '#27272a' : '#f4f4f5'}
                        textColor={c.textTitle}
                        disabled={isLoading}
                    >
                        Not Home
                    </Button>
                )}
                <Button
                    mode="contained-tonal"
                    onPress={onShowCancelModal}
                    style={{ flex: 1 }}
                    buttonColor={isDarkMode ? '#450a0a' : '#fee2e2'}
                    textColor={isDarkMode ? '#fca5a5' : '#ef4444'}
                    disabled={isLoading}
                >
                    Cancel
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingBottom: 24,
    },
    modernHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    modernHeaderIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modernHeaderTitle: {
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
        marginBottom: 2,
    },
    modernHeaderSubtitle: {
        fontSize: 14,
        fontFamily: 'Inter_500Medium',
    },
    checksContainer: {
        marginBottom: 20,
    },
    checksRowMulti: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'center',
    },
    minimalCheckBadge: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    statusMessageContainer: {
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        alignItems: 'center',
    },
    statusMessageText: {
        textAlign: 'center',
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    mapContainer: {
        height: 180,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 24,
        position: 'relative',
    },
    map: {
        flex: 1,
    },
    targetMarker: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    targetMarkerText: {
        fontSize: 24,
    },
    mapDistanceOverlay: {
        position: 'absolute',
        bottom: 8,
        left: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    mapDistanceText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    proximityFallback: {
        padding: 16,
        borderRadius: 10,
        marginBottom: 24,
        alignItems: 'center',
        borderWidth: 1,
    },
    boxControlSection: {
        paddingHorizontal: 4,
    },
    boxControlHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    boxControlTitle: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    connectionDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    connectionText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    manualOverrideRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderTopWidth: 1,
    },
    manualOverrideText: {
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
    },
    boxButton: {
        flex: 1,
        borderRadius: 8,
        borderWidth: 1,
    },
    boxAlertText: {
        marginTop: 16,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
        textAlign: 'center',
    },
    autoControlsMsg: {
        paddingVertical: 16,
        borderTopWidth: 1,
    },

    detailsBlock: {
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 24,
        overflow: 'hidden',
    },
    locationHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
    },
    sectionLabel: {
        fontSize: 11,
        fontFamily: 'Inter_700Bold',
        marginBottom: 4,
        letterSpacing: 0.5,
    },
    detailText: {
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        lineHeight: 22,
    },
    senderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderTopWidth: 1,
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    notesRow: {
        padding: 16,
    },
    verificationBlock: {
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 24,
        overflow: 'hidden',
    },
    verificationHeader: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(150,150,150,0.1)',
    },
    verificationTitle: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    proofPanel: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        alignItems: 'center',
    },
    proofTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
        marginBottom: 12,
    },
    photoPreviewWrapper: {
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 2,
        width: '100%',
    },
    photoImage: {
        width: '100%',
        height: 220,
    },
    hiddenProofImage: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0,
    },
    photoVerifiedOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 12,
        backgroundColor: 'rgba(0,0,0,0.65)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoVerifiedText: {
        color: '#fff',
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    proofHintPending: {
        fontSize: 12,
        textAlign: 'center',
    },
    proofHintSuccess: {
        marginTop: 12,
        fontSize: 12,
        textAlign: 'center',
        fontFamily: 'Inter_600SemiBold',
    },
    finalProofNotice: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
    },
    finalProofNoticeText: {
        flex: 1,
        marginLeft: 12,
    },
    finalProofNoticeTitle: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
    },
    finalProofNoticeBody: {
        marginTop: 2,
        fontSize: 12,
        lineHeight: 16,
    },
    finalProofProgressTrack: {
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        marginTop: 8,
    },
    finalProofProgressFill: {
        height: '100%',
    },
    proximityText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
    },
});
