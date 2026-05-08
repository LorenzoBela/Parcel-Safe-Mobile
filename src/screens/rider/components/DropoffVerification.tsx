import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, Linking, Image, ActivityIndicator } from 'react-native';
import { Text, Card, Button, IconButton, Switch } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadDeliveryProofPhoto } from '../../../services/proofPhotoService';
import { updateDeliveryStatus } from '../../../services/riderMatchingService';
import { subscribeToDeliveryProof, subscribeToPhotoAuditLog, subscribeToBoxState, BoxState, subscribeToCamera, CameraState, subscribeToLockEvents, LockEvent, updateBoxState, getDeliveryProofSnapshot, getPhotoAuditLogSnapshot, getLockEventSnapshot, getBoxStateSnapshot } from '../../../services/firebaseClient';
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
    const finalProofProgress = effectiveHardwareProofUrl ? 85 : 60;
    const finalProofProgressTitle = effectiveHardwareProofUrl
        ? (hardwareProofFailed
            ? 'Final proof uploaded. Keeping preview visible.'
            : 'Final proof uploaded. Loading high-quality photo...')
        : (cameraState?.last_upload_role === 'full'
            ? 'Final proof upload is in progress...'
            : 'Preview ready. Final proof is uploading...');
    const finalProofProgressBody = effectiveHardwareProofUrl
        ? 'The high-quality ESP-CAM photo is replacing this preview as soon as it renders.'
        : 'This photo is only the quick preview. The ESP-CAM is sending the final uploaded version through LTE now.';
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
            <Card mode="elevated" style={[styles.statusCard, { backgroundColor: c.card }, isInsideGeoFence ? styles.borderSuccess : styles.borderError]}>
                <Card.Content>
                    <View style={styles.statusHeader}>
                        <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: c.textTitle }}>
                            Drop-Off Zone
                        </Text>
                        {distanceMeters !== null && (
                            <View style={[styles.distanceBadge, { backgroundColor: c.badgeBg }]}>
                                <Text style={[styles.distanceText, { color: c.badgeText }]}>
                                    {distanceMeters > 999
                                        ? `${(distanceMeters / 1000).toFixed(1)} km away`
                                        : `${distanceMeters}m away`}
                                </Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.checksContainer}>
                        {/* Row 1: Phone GPS + Smart Box */}
                        <View style={styles.checksRow}>
                            <View style={styles.checkItem}>
                                <View style={[styles.checkCircle, { borderColor: c.whiteBorder }, isPhoneInside ? styles.bgSuccess : styles.bgError]}>
                                    <Text style={styles.checkIcon}>{isPhoneInside ? '✓' : '✗'}</Text>
                                </View>
                                <Text style={[styles.checkLabel, { color: c.textLabel }]}>Phone GPS</Text>
                            </View>
                            <View style={[styles.checkDivider, { backgroundColor: c.border }]} />
                            <View style={styles.checkItem}>
                                <View style={[
                                    styles.checkCircle,
                                    { borderColor: c.whiteBorder },
                                    isBoxOffline ? styles.bgWarning : (isBoxInside ? styles.bgSuccess : styles.bgError)
                                ]}>
                                    <Text style={styles.checkIcon}>
                                        {isBoxOffline ? '?' : (isBoxInside ? '✓' : '✗')}
                                    </Text>
                                </View>
                                <Text style={[styles.checkLabel, { color: c.textLabel }]}>{isBoxOffline ? 'Box Offline' : 'Smart Box'}</Text>
                            </View>
                        </View>
                        <Text style={{ textAlign: 'center', fontSize: 11, color: c.subtleText, marginTop: 2 }}>
                            Phone GPS: {formatAge(lastPhoneGpsAt)} • Box heartbeat: {formatAge(lastBoxHeartbeatAt)}
                        </Text>
                        {/* Row 2: OTP Verified + Face Check */}
                        <View style={styles.checksRow}>
                            <View style={styles.checkItem}>
                                <View style={[styles.checkCircle, { borderColor: c.whiteBorder }, boxOtpValidated ? styles.bgSuccess : (lockEvent?.otp_valid === false ? styles.bgError : styles.bgWarning)]}>
                                    <Text style={styles.checkIcon}>{boxOtpValidated ? '✓' : (lockEvent?.otp_valid === false ? '✗' : '⏳')}</Text>
                                </View>
                                <Text style={[styles.checkLabel, { color: c.textLabel }]}>OTP Verified</Text>
                            </View>
                            <View style={[styles.checkDivider, { backgroundColor: c.border }]} />
                            <View style={styles.checkItem}>
                                <View style={[styles.checkCircle, { borderColor: c.whiteBorder }, faceDetected ? styles.bgSuccess : (lockEvent?.otp_valid && !lockEvent?.face_detected ? styles.bgError : styles.bgWarning)]}>
                                    <Text style={styles.checkIcon}>{faceDetected ? '✓' : (lockEvent?.otp_valid && !lockEvent?.face_detected ? '✗' : '⏳')}</Text>
                                </View>
                                <Text style={[styles.checkLabel, { color: c.textLabel }]}>Face Check</Text>
                            </View>
                        </View>
                    </View>

                    <View style={[styles.statusMessageContainer, { backgroundColor: isInsideGeoFence ? c.successBg : c.errorBg }]}>
                        <Text style={[styles.statusMessageText, { color: isInsideGeoFence ? c.successText : c.errorText }]}>
                            {zoneStatusText}
                        </Text>
                    </View>

                    {/* ──── Geofence Map Preview ──── */}
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

                                {/* Geofence circle */}
                                <MapboxGL.ShapeSource id="dropoff-geofence-circle" shape={geofenceCircle}>
                                    <MapboxGL.FillLayer
                                        id="dropoff-geofence-fill"
                                        style={{
                                            fillColor: isInsideGeoFence ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                            fillOutlineColor: isInsideGeoFence ? '#22c55e' : '#ef4444',
                                        }}
                                    />
                                </MapboxGL.ShapeSource>

                                {/* Dropoff target marker */}
                                <MapboxGL.MarkerView
                                    id="dropoff-target"
                                    coordinate={[targetLng, targetLat]}
                                >
                                    <View style={styles.targetMarker}>
                                        <Text style={styles.targetMarkerText}>📍</Text>
                                    </View>
                                </MapboxGL.MarkerView>

                                {/* Rider live position — same Rider.jpg icon as tracking pages */}
                                {hasRiderPosition && currentLat != null && currentLng != null && (
                                    <AnimatedRiderMarker
                                        latitude={currentLat}
                                        longitude={currentLng}
                                        rotation={currentHeading ?? undefined}
                                        isSelected={isPhoneInside}
                                    />
                                )}
                            </MapboxGL.MapView>

                            {/* Distance overlay */}
                            {distanceMeters !== null && (
                                <View style={[styles.mapDistanceOverlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)' }]}>
                                    <Text style={[styles.mapDistanceText, { color: isInsideGeoFence ? '#22c55e' : c.text }]}>
                                        {isInsideGeoFence ? '✓ Inside Zone' : `${formatDistance(distanceMeters)} to zone`}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Text-based proximity fallback when map isn't available */}
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

                    <View style={[styles.addressRow, { borderTopColor: c.borderHard }]}>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.addressLabel, { color: c.textLabel }]}>DROPOFF LOCATION</Text>
                            <Text numberOfLines={2} style={[styles.address, { color: c.text }]}>{targetAddress}</Text>

                            {recipientName ? (
                                <View style={{ marginTop: 12 }}>
                                    <Text style={[styles.addressLabel, { color: c.textLabel }]}>RECIPIENT</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <Text style={[styles.address, { flex: 1, marginRight: 8, color: c.text }]}>{recipientName}{customerPhone ? ` • ${customerPhone}` : ''}</Text>
                                        {customerPhone && (
                                            <View style={{ flexDirection: 'row' }}>
                                                <IconButton icon="phone" size={20} mode="contained-tonal" containerColor={c.blueBg} iconColor={c.blueText} onPress={() => Linking.openURL(`tel:${customerPhone}`)} style={{ margin: 0, marginRight: 8 }} />
                                                <IconButton icon="message-text" size={20} mode="contained-tonal" containerColor={c.blueBg} iconColor={c.blueText} onPress={() => Linking.openURL(`sms:${customerPhone}`)} style={{ margin: 0 }} />
                                            </View>
                                        )}
                                    </View>
                                </View>
                            ) : null}

                            {deliveryNotes ? (
                                <View style={{ marginTop: 12, padding: 8, backgroundColor: c.badgeBg, borderRadius: 6 }}>
                                    <Text style={[styles.addressLabel, { color: c.textLabel }]}>DELIVERY NOTES</Text>
                                    <Text style={[styles.address, { color: c.text }]}>{deliveryNotes}</Text>
                                </View>
                            ) : null}
                        </View>
                        <View style={styles.navActions}>
                            <IconButton icon="navigation" mode="contained" containerColor={c.blueBg} iconColor={c.blueText} size={24} onPress={onNavigate} />
                        </View>
                    </View>
                </Card.Content>
            </Card>

            {/* Handover Flow UI only shows if inside Geofence */}
            {isInsideGeoFence && (
                <Card style={[styles.actionCard, { backgroundColor: c.card }]}>
                    <Card.Content>
                        <Text style={[styles.actionTitle, { color: c.textTitle }]}>Handover Parcel</Text>

                        {/* Dynamic status message */}
                        <View style={[styles.statusMessageContainer, { marginTop: 12, backgroundColor: statusMsg.bgColor }]}>
                            <Text style={[styles.statusMessageText, { color: statusMsg.color }]}>
                                {statusMsg.text}
                            </Text>
                        </View>

                        {isSyncPending && (
                            <View style={[styles.statusMessageContainer, { marginTop: 8, backgroundColor: c.warningBg }]}>
                                <Text style={[styles.statusMessageText, { color: c.warningText }]}>
                                    Syncing box verification. Wait a moment.
                                </Text>
                            </View>
                        )}

                        {canRevealManualControls && !showManualControls && (
                            <Button
                                mode="text"
                                compact
                                icon="tune"
                                onPress={() => setManualModeEnabled(true)}
                                style={{ alignSelf: 'center', marginTop: 2, marginBottom: 4 }}
                            >
                                Manual controls
                            </Button>
                        )}

                        {showManualControls && (
                        <View style={{ marginTop: 8, marginBottom: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderHard, backgroundColor: c.badgeBg }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View style={{ flex: 1, paddingRight: 10 }}>
                                    <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: c.textTitle }}>Manual controls</Text>
                                    <Text style={{ fontSize: 12, color: c.textLabel, marginTop: 2 }}>
                                        Use only if the box does not respond automatically.
                                    </Text>
                                </View>
                                <Switch value={manualModeEnabled} onValueChange={setManualModeEnabled} />
                            </View>

                            <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
                                <Button
                                    mode="contained"
                                    onPress={() => handleManualBoxCommand('UNLOCKING')}
                                    disabled={!canManualControl || manualCommandLoading || boxState?.status === 'UNLOCKING'}
                                    loading={manualCommandLoading && boxState?.status === 'UNLOCKING'}
                                    style={{ flex: 1, backgroundColor: canManualControl ? '#16a34a' : '#94a3b8' }}
                                >
                                    Unlock
                                </Button>
                                <Button
                                    mode="outlined"
                                    onPress={() => handleManualBoxCommand('LOCKED')}
                                    disabled={!canManualControl || manualCommandLoading}
                                    loading={manualCommandLoading && boxState?.status !== 'UNLOCKING'}
                                    style={{ flex: 1 }}
                                >
                                    Lock
                                </Button>
                            </View>

                            {lockAwaitingClose && (
                                <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: c.warningBg, borderWidth: 1, borderColor: c.warningText }}>
                                    <Text style={{ fontSize: 12, color: c.warningText, fontFamily: 'Inter_700Bold' }}>
                                        Lock pending physical close
                                    </Text>
                                    <Text style={{ marginTop: 4, fontSize: 12, color: c.warningText }}>
                                        {lockAwaitingCloseNeedsAssist
                                            ? 'Close the lid until the latch aligns. If needed, press # on the keypad to retract briefly, then close again.'
                                            : 'Close the lid fully so the reed can confirm the lock.'}
                                    </Text>
                                </View>
                            )}

                            {lockCloseConfirmed && (
                                <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: c.successBg, borderWidth: 1, borderColor: c.successText }}>
                                    <Text style={{ fontSize: 12, color: c.successText, fontFamily: 'Inter_700Bold' }}>
                                        Lock confirmed
                                    </Text>
                                    <Text style={{ marginTop: 4, fontSize: 12, color: c.successText }}>
                                        Reed close detected. The box is now physically locked.
                                    </Text>
                                </View>
                            )}

                            {!canManualControl && (
                                <Text style={{ marginTop: 8, fontSize: 12, color: c.subtleText }}>
                                    Available after geofence, OTP, and face checks are confirmed.
                                </Text>
                            )}
                        </View>
                        )}

                        <View style={[styles.proofPanel, { borderColor: c.borderHard, backgroundColor: c.badgeBg }]}>
                            <Text style={[styles.proofTitle, { color: c.textTitle }]}>Verification Photo</Text>
                            {displayedProofUrl ? (
                                <>
                                    <Image
                                        source={{ uri: displayedProofUrl }}
                                        style={[styles.proofImage, { backgroundColor: c.borderHard }]}
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
                                <Text style={[styles.proofHintPending, { color: c.textLabel }]}>
                                    Waiting for ESP-CAM proof preview to appear before swipe completion.
                                </Text>
                            )}
                        </View>

                        {/* Fallback photo button — visible after box confirms OTP or if camera fails */}
                        {showFallbackButton && (
                            <View style={{ marginTop: 12 }}>
                                <Button
                                    mode="outlined"
                                    icon="camera-retake"
                                    onPress={handleCaptureFallbackPhoto}
                                    disabled={isLoading}
                                >
                                    {fallbackPhotoUri ? 'Retake fallback photo' : 'Capture fallback photo'}
                                </Button>
                                {fallbackPhotoUri && (
                                    <>
                                        <Image
                                            source={{ uri: fallbackPhotoUri }}
                                            style={[styles.fallbackImage, { backgroundColor: c.borderHard }]}
                                            resizeMode="cover"
                                            onLoad={() => setFallbackPhotoLoaded(true)}
                                            onError={() => setFallbackPhotoLoaded(false)}
                                        />
                                        <Text style={{ marginTop: 6, color: fallbackPhotoLoaded ? c.successText : c.textLabel, textAlign: 'center', fontSize: 13 }}>
                                            {fallbackPhotoLoaded
                                                ? 'Fallback photo is visible. You may now complete delivery.'
                                                : 'Loading fallback photo preview before completion.'}
                                        </Text>
                                    </>
                                )}
                            </View>
                        )}

                        <View style={{ marginTop: 16 }}>
                            <SwipeConfirmButton
                                label="Swipe Parcel Delivered"
                                onConfirm={handleDeliverySwipe}
                                disabled={!canSwipe || isLoading}
                            />
                        </View>
                    </Card.Content>
                </Card>
            )}

            {/* Helper Buttons */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
                {isInsideGeoFence && !isWaitTimerActive && (
                    <Button
                        mode="outlined"
                        onPress={onShowCustomerNotHome}
                        style={{ flex: 1, borderColor: c.borderHard }}
                        textColor={c.textLabel}
                        disabled={isLoading}
                    >
                        Not Home
                    </Button>
                )}
                <Button
                    mode="outlined"
                    onPress={onShowCancelModal}
                    style={{ flex: 1, borderColor: c.errorText }}
                    textColor={c.errorText}
                    disabled={isLoading}
                >
                    Cancel
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    statusCard: {
        marginBottom: 20,
        borderRadius: 16,
        borderWidth: 2,
        elevation: 3,
        backgroundColor: 'white',
    },
    borderSuccess: { borderColor: '#22c55e' },
    borderError: { borderColor: '#ef4444' },
    statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    distanceBadge: { backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    distanceText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#4B5563' },
    checksContainer: { marginBottom: 20 },
    checksRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    checkItem: { alignItems: 'center', width: 90 },
    checkCircle: {
        width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
        marginBottom: 8, borderWidth: 2, borderColor: 'white', elevation: 2,
    },
    checkIcon: { fontSize: 24, color: 'white', fontFamily: 'Inter_700Bold' },
    bgSuccess: { backgroundColor: '#22c55e' },
    bgError: { backgroundColor: '#ef4444' },
    bgWarning: { backgroundColor: '#F59E0B' },
    checkLabel: { fontSize: 12, color: '#555', fontFamily: 'Inter_600SemiBold' },
    checkDivider: { height: 2, width: 20, backgroundColor: '#E5E7EB', marginHorizontal: 6, top: -14 },
    statusMessageContainer: { padding: 12, borderRadius: 8, marginBottom: 16, alignItems: 'center' },
    bgSubtleSuccess: { backgroundColor: '#DCFCE7' },
    bgSubtleError: { backgroundColor: '#FEE2E2' },
    statusMessageText: { textAlign: 'center', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
    textSuccess: { color: '#15803d' },
    textError: { color: '#B91C1C' },
    addressRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 12 },
    addressLabel: { fontSize: 10, color: '#888', fontFamily: 'Inter_700Bold', marginBottom: 2 },
    address: { fontSize: 14, color: '#333' },
    navActions: { flexDirection: 'row', alignItems: 'center' },
    actionCard: { backgroundColor: 'white', borderRadius: 12, elevation: 1, marginBottom: 20 },
    actionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#1a1a1a', marginBottom: 4 },
    proofPanel: {
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 10,
        padding: 10,
        backgroundColor: '#f8fafc',
    },
    proofTitle: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
        color: '#334155',
        marginBottom: 8,
    },
    proofImage: {
        width: '100%',
        height: 180,
        borderRadius: 8,
        backgroundColor: '#e2e8f0',
    },
    hiddenProofImage: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0,
    },
    fallbackImage: {
        width: '100%',
        height: 160,
        borderRadius: 8,
        marginTop: 10,
        backgroundColor: '#e2e8f0',
    },
    proofHintPending: {
        color: '#475569',
        fontSize: 12,
        textAlign: 'center',
    },
    proofHintSuccess: {
        marginTop: 8,
        color: '#15803d',
        fontSize: 12,
        textAlign: 'center',
        fontFamily: 'Inter_600SemiBold',
    },
    // ──── Geofence Map Preview ────
    finalProofNotice: {
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
    },
    finalProofNoticeText: {
        flex: 1,
        marginLeft: 10,
    },
    finalProofNoticeTitle: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    finalProofNoticeBody: {
        marginTop: 2,
        fontSize: 12,
        lineHeight: 16,
    },
    finalProofProgressTrack: {
        height: 4,
        borderRadius: 999,
        overflow: 'hidden',
        marginTop: 8,
    },
    finalProofProgressFill: {
        height: '100%',
        borderRadius: 999,
    },
    mapContainer: {
        height: 180,
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 16,
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
    riderMarkerOuter: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'white',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2.5,
        borderColor: '#0f172a',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 6,
    },
    riderMarkerOuterInside: {
        borderColor: '#22c55e',
    },
    riderMarkerImage: {
        width: 35,
        height: 35,
        borderRadius: 17.5,
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
    // ──── Text Proximity Fallback ────
    proximityFallback: {
        padding: 16,
        borderRadius: 10,
        marginBottom: 16,
        alignItems: 'center',
        borderWidth: 1,
    },
    proximityText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
    },
});
