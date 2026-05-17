import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadReturnPhoto } from '../../../services/proofPhotoService';
import { markPackageRetrieved } from '../../../services/cancellationService';
import {
    BoxState,
    CameraState,
    DeliveryProofState,
    LockEvent,
    PhotoUploadState,
    getBoxStateSnapshot,
    getDeliveryProofSnapshot,
    getLockEventSnapshot,
    getPhotoAuditLogSnapshot,
    subscribeToBoxState,
    subscribeToCamera,
    subscribeToDeliveryProof,
    subscribeToLockEvents,
    subscribeToPhotoAuditLog,
    subscribeToPhotoUploadState,
} from '../../../services/firebaseClient';
import { PremiumAlert } from '../../../services/PremiumAlertService';
import { useAppTheme } from '../../../context/ThemeContext';
import { getDropoffProofGate } from '../../../services/dropoffProofGateService';
import { MapboxGL, isMapboxNativeAvailable, StyleURL } from '../../../components/map/MapboxWrapper';
import AnimatedRiderMarker from '../../../components/map/AnimatedRiderMarker';

function formatDistance(meters: number | null | undefined): string {
    if (meters == null) return '';
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
    return `${Math.round(meters)}m`;
}

function withProofCacheBust(url: string | null, version: number): string | null {
    if (!url) return null;
    return `${url}${url.includes('?') ? '&' : '?'}t=${version || 1}`;
}

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

interface ReturnVerificationProps {
    deliveryId: string;
    boxId: string;
    targetAddress: string;
    targetLat: number;
    targetLng: number;
    senderName?: string;
    senderPhone?: string;
    deliveryNotes?: string;
    deliveryStatus: string;

    isInsideGeoFence: boolean;
    distanceMeters: number | null;
    isPhoneInside: boolean;
    isBoxInside: boolean;
    isBoxOffline: boolean;
    lastBoxHeartbeatAt?: number;
    lastPhoneGpsAt?: number;

    currentLat: number;
    currentLng: number;
    currentHeading?: number | null;
    geofenceRadiusM?: number;

    onReturnCompleted: () => void;
    onNavigate: () => void;
    onShowCancelModal: () => void;
}

type ReturnVerificationCacheState = {
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
};

const verificationCacheByDelivery: Record<string, ReturnVerificationCacheState> = {};

export default function ReturnVerification({
    deliveryId,
    boxId,
    targetAddress,
    targetLat,
    targetLng,
    senderName,
    senderPhone,
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
    onReturnCompleted,
    onNavigate,
    onShowCancelModal,
}: ReturnVerificationProps) {
    const { isDarkMode } = useAppTheme();
    const [isLoading, setIsLoading] = useState(false);
    const [fallbackPhotoUri, setFallbackPhotoUri] = useState<string | null>(null);
    const [fallbackPhotoLoaded, setFallbackPhotoLoaded] = useState(false);
    const [hardwareSuccess, setHardwareSuccess] = useState(false);
    const [hardwarePreviewUrl, setHardwarePreviewUrl] = useState<string | null>(null);
    const [auditPreviewUrl, setAuditPreviewUrl] = useState<string | null>(null);
    const [hardwareProofUrl, setHardwareProofUrl] = useState<string | null>(null);
    const [auditProofUrl, setAuditProofUrl] = useState<string | null>(null);
    const [previewVersion, setPreviewVersion] = useState(0);
    const [proofVersion, setProofVersion] = useState(0);
    const [previewProofLoaded, setPreviewProofLoaded] = useState(false);
    const [previewProofFailed, setPreviewProofFailed] = useState(false);
    const [hardwareProofLoaded, setHardwareProofLoaded] = useState(false);
    const [hardwareProofFailed, setHardwareProofFailed] = useState(false);
    const [proofWaitTimedOut, setProofWaitTimedOut] = useState(false);
    const [otpConfirmedByCloud, setOtpConfirmedByCloud] = useState(false);
    const [otpSyncPending, setOtpSyncPending] = useState(false);
    const [faceSyncPending, setFaceSyncPending] = useState(false);
    const [boxOtpValidated, setBoxOtpValidated] = useState(false);
    const [faceDetected, setFaceDetected] = useState(false);
    const [cameraFailed, setCameraFailed] = useState(false);
    const [cameraState, setCameraState] = useState<CameraState | null>(null);
    const [photoUploadState, setPhotoUploadState] = useState<PhotoUploadState | null>(null);
    const [boxState, setBoxState] = useState<BoxState | null>(null);
    const [lockEvent, setLockEvent] = useState<LockEvent | null>(null);
    const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);
    const lockEventSubscriptionStartRef = useRef(Date.now());
    const lastCloudSignalAtRef = useRef(Date.now());
    const recoveryInFlightRef = useRef(false);

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
        successBg: isDarkMode ? '#064e3b' : '#DCFCE7',
        successText: isDarkMode ? '#34d399' : '#15803d',
        errorBg: isDarkMode ? '#7f1d1d' : '#FEE2E2',
        errorText: isDarkMode ? '#f87171' : '#B91C1C',
        warningBg: isDarkMode ? '#78350f' : '#FEF3C7',
        warningText: isDarkMode ? '#fbbf24' : '#b45309',
        subtleText: isDarkMode ? '#a1a1aa' : '#64748b',
        blueBg: isDarkMode ? '#1e3a8a' : '#DBEAFE',
        blueText: isDarkMode ? '#60a5fa' : '#1d4ed8',
    };

    const retryExhausted = lockEvent?.face_retry_exhausted === true || lockEvent?.fallback_required === true;
    const lowLightFallbackRequired = retryExhausted && lockEvent?.failure_reason === 'LOW_LIGHT';
    const effectivePreviewProofUrl = hardwarePreviewUrl || auditPreviewUrl;
    const effectiveHardwareProofUrl = hardwareProofUrl || auditProofUrl;
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
    const liveUploadProgress =
        photoUploadState &&
        photoUploadState.delivery_id === deliveryId &&
        photoUploadState.status !== 'COMPLETED'
            ? Math.max(0, Math.min(100, photoUploadState.progress_percent || 0))
            : null;
    const finalProofProgress = liveUploadProgress ?? (effectiveHardwareProofUrl ? 85 : 60);
    const proofRenderFailed =
        (displayedHardwareProofUrl ? hardwareProofFailed : false) ||
        (displayedPreviewProofUrl ? previewProofFailed : false);
    const proofGate = getDropoffProofGate({
        otpConfirmedByCloud,
        espPreviewRendered: previewProofLoaded,
        espFullProofRendered: hardwareProofLoaded,
        fallbackPhotoRendered: fallbackPhotoLoaded,
        hasFallbackPhoto: !!fallbackPhotoUri,
        fallbackModeActive,
        proofWaitTimedOut,
        proofRenderFailed,
    });

    const canProcessOtpSignals =
        isInsideGeoFence &&
        ['RETURNING', 'TAMPERED', 'RETURNED'].includes(String(deliveryStatus || '').toUpperCase());

    const markOtpVerified = useCallback(() => {
        setBoxOtpValidated(true);
        setOtpConfirmedByCloud(true);
        setOtpSyncPending(false);
    }, []);

    const markFaceVerified = useCallback(() => {
        markOtpVerified();
        setFaceDetected(true);
        setFaceSyncPending(false);
    }, [markOtpVerified]);

    const markHardwareVerified = useCallback(() => {
        setHardwareSuccess(true);
        markFaceVerified();
    }, [markFaceVerified]);

    const applyProofSnapshot = useCallback((proof: DeliveryProofState | null) => {
        if (!proof) return;
        if (proof.return_photo_url) {
            setHardwareProofUrl(proof.return_photo_url);
            setProofVersion(proof.return_photo_uploaded_at || Date.now());
            markHardwareVerified();
            return;
        }
        if (proof.proof_photo_url) {
            setHardwareProofUrl(proof.proof_photo_url);
            setProofVersion(proof.proof_photo_uploaded_at || Date.now());
            markHardwareVerified();
        }
        if (proof.proof_photo_preview_url) {
            setHardwarePreviewUrl(proof.proof_photo_preview_url);
            setPreviewVersion(proof.proof_photo_preview_uploaded_at || Date.now());
            markHardwareVerified();
        }
    }, [markHardwareVerified]);

    const runCloudReconcile = useCallback(async () => {
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
            applyProofSnapshot(proof);

            if (photoAudit?.latest_photo_url) {
                setAuditProofUrl(photoAudit.latest_photo_url);
                setProofVersion(photoAudit.latest_photo_uploaded_at || Date.now());
                markHardwareVerified();
            }
            if (photoAudit?.latest_photo_preview_url) {
                setAuditPreviewUrl(photoAudit.latest_photo_preview_url);
                setPreviewVersion(photoAudit.latest_photo_preview_uploaded_at || Date.now());
                markHardwareVerified();
            }

            if (lockEventSnapshot) {
                setLockEvent(lockEventSnapshot);
                if (lockEventSnapshot.otp_valid || lockEventSnapshot.face_detected || lockEventSnapshot.unlocked) {
                    markOtpVerified();
                }
                if (lockEventSnapshot.face_detected || lockEventSnapshot.unlocked) {
                    markFaceVerified();
                }
                if (lockEventSnapshot.face_retry_exhausted || lockEventSnapshot.fallback_required) {
                    setCameraFailed(true);
                }
                if (lockEventSnapshot.unlocked) {
                    markHardwareVerified();
                }
            }

            if (boxSnapshot) setBoxState(boxSnapshot);
            setSubscriptionEpoch((value) => value + 1);
        } finally {
            recoveryInFlightRef.current = false;
        }
    }, [applyProofSnapshot, boxId, canProcessOtpSignals, deliveryId, markFaceVerified, markHardwareVerified, markOtpVerified]);

    useEffect(() => {
        const cached = verificationCacheByDelivery[deliveryId];
        if (!cached) return;
        setBoxOtpValidated(cached.boxOtpValidated);
        setFaceDetected(cached.faceDetected);
        setCameraFailed(cached.cameraFailed);
        setHardwareSuccess(cached.hardwareSuccess);
        setFallbackPhotoUri(cached.fallbackPhotoUri);
        setHardwarePreviewUrl(cached.hardwarePreviewUrl);
        setAuditPreviewUrl(cached.auditPreviewUrl);
        setHardwareProofUrl(cached.hardwareProofUrl);
        setAuditProofUrl(cached.auditProofUrl);
        setPreviewVersion(cached.previewVersion);
        setProofVersion(cached.proofVersion);
        if (cached.boxOtpValidated) setOtpConfirmedByCloud(true);
    }, [deliveryId]);

    useEffect(() => {
        verificationCacheByDelivery[deliveryId] = {
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
        };
    }, [
        auditPreviewUrl,
        auditProofUrl,
        boxOtpValidated,
        cameraFailed,
        deliveryId,
        faceDetected,
        fallbackPhotoUri,
        hardwarePreviewUrl,
        hardwareProofUrl,
        hardwareSuccess,
        previewVersion,
        proofVersion,
    ]);

    useEffect(() => {
        if (String(deliveryStatus).toUpperCase() !== 'RETURNED') return;
        delete verificationCacheByDelivery[deliveryId];
    }, [deliveryId, deliveryStatus]);

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
        Image.prefetch(displayedProofUrl).catch(() => { });
    }, [displayedProofUrl]);

    useEffect(() => {
        setProofWaitTimedOut(false);
        if (!otpConfirmedByCloud || proofGate.visibleProofLoaded) return;
        if (!(hardwareSuccess || faceDetected || boxOtpValidated)) return;
        const timeout = setTimeout(() => setProofWaitTimedOut(true), 12000);
        return () => clearTimeout(timeout);
    }, [
        boxOtpValidated,
        deliveryId,
        displayedHardwareProofUrl,
        displayedPreviewProofUrl,
        faceDetected,
        hardwareSuccess,
        otpConfirmedByCloud,
        proofGate.visibleProofLoaded,
    ]);

    useEffect(() => {
        if (!canProcessOtpSignals || (!otpSyncPending && !faceSyncPending)) return;
        const timeout = setTimeout(() => {
            runCloudReconcile().catch(() => { });
        }, 3500);
        return () => clearTimeout(timeout);
    }, [canProcessOtpSignals, faceSyncPending, otpSyncPending, runCloudReconcile]);

    useEffect(() => {
        if (!canProcessOtpSignals) return;
        const interval = setInterval(() => {
            if (Date.now() - lastCloudSignalAtRef.current > 12000) {
                runCloudReconcile().catch(() => { });
            }
        }, 6000);
        return () => clearInterval(interval);
    }, [canProcessOtpSignals, runCloudReconcile]);

    useEffect(() => {
        lockEventSubscriptionStartRef.current = Date.now();
        lastCloudSignalAtRef.current = Date.now();

        const unsubscribeBox = subscribeToBoxState(boxId, (state) => {
            lastCloudSignalAtRef.current = Date.now();
            setBoxState(state);
        });

        const unsubscribeProof = subscribeToDeliveryProof(deliveryId, (proof) => {
            lastCloudSignalAtRef.current = Date.now();
            if (!canProcessOtpSignals) return;
            applyProofSnapshot(proof);
        });

        const unsubscribePhotoAudit = subscribeToPhotoAuditLog(deliveryId, (audit) => {
            lastCloudSignalAtRef.current = Date.now();
            if (!canProcessOtpSignals || !audit) return;
            if (audit.latest_photo_preview_url) {
                setAuditPreviewUrl(audit.latest_photo_preview_url);
                setPreviewVersion(audit.latest_photo_preview_uploaded_at || Date.now());
                markHardwareVerified();
            }
            if (audit.latest_photo_url) {
                setAuditProofUrl(audit.latest_photo_url);
                setProofVersion(audit.latest_photo_uploaded_at || Date.now());
                markHardwareVerified();
            }
        });

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

        const unsubscribeLockEvents = subscribeToLockEvents(boxId, (event) => {
            lastCloudSignalAtRef.current = Date.now();
            if (!canProcessOtpSignals || !event) return;
            const eventMs =
                typeof event.timestamp === 'number' ? event.timestamp :
                    typeof event.device_epoch === 'number' ? event.device_epoch * 1000 :
                        null;
            if (eventMs && eventMs + 1500 < lockEventSubscriptionStartRef.current) return;

            setLockEvent(event);
            if (event.otp_valid || event.face_detected || event.unlocked) {
                markOtpVerified();
            } else if (event.otp_valid === false) {
                setOtpSyncPending(false);
            }
            if (event.face_retry_exhausted || event.fallback_required) {
                setCameraFailed(true);
            }
            if (event.face_detected || event.unlocked) {
                markFaceVerified();
            } else if (event.face_detected === false && event.otp_valid) {
                setFaceSyncPending(false);
            }
            if (event.unlocked) {
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
        applyProofSnapshot,
        boxId,
        canProcessOtpSignals,
        deliveryId,
        markFaceVerified,
        markHardwareVerified,
        markOtpVerified,
        subscriptionEpoch,
    ]);

    const handleCaptureFallbackPhoto = async () => {
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                PremiumAlert.alert('Permission Required', 'Camera access is needed to capture the return proof photo.');
                return;
            }
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
            });
            if (!result.canceled && result.assets?.[0]?.uri) {
                setFallbackPhotoUri(result.assets[0].uri);
            }
        } catch {
            PremiumAlert.alert('Camera Error', 'Unable to capture fallback photo.');
        }
    };

    const handleReturnSwipe = async () => {
        if (String(deliveryStatus).toUpperCase() === 'RETURNED') {
            onReturnCompleted();
            return;
        }
        if (!otpConfirmedByCloud) {
            PremiumAlert.alert('Return OTP Not Verified', 'Waiting for cloud confirmation of the Return OTP. Please wait a moment.');
            return;
        }
        if (!proofGate.visibleProofLoaded) {
            if (retryExhausted || cameraFailed) {
                PremiumAlert.alert('Fallback Required', 'Camera could not produce a visible return proof. Capture a fallback photo before completing return.');
            } else {
                PremiumAlert.alert('Return Proof Pending', 'Verification passed, but the return proof photo is not visible yet. Please wait a moment.');
            }
            return;
        }

        setIsLoading(true);
        try {
            let resolvedProofUrl: string | undefined = effectiveHardwareProofUrl || effectivePreviewProofUrl || undefined;
            if (fallbackPhotoUri && fallbackPhotoLoaded && !hardwareProofLoaded && !previewProofLoaded) {
                const uploadResult = await uploadReturnPhoto({ deliveryId, boxId, localUri: fallbackPhotoUri });
                if (!uploadResult.success) {
                    PremiumAlert.alert('Upload Failed', uploadResult.error || 'Fallback return photo upload failed. Please retry.');
                    return;
                }
                resolvedProofUrl = uploadResult.url;
            }

            const ok = await markPackageRetrieved(deliveryId, boxId, resolvedProofUrl);
            if (!ok) {
                PremiumAlert.alert('Action Failed', 'Could not mark this package as returned. Please check connection and try again.');
                return;
            }

            PremiumAlert.alert('Return Completed', 'Package returned successfully.');
            onReturnCompleted();
        } finally {
            setIsLoading(false);
        }
    };

    const formatAge = (timestamp?: number): string => {
        if (!timestamp || timestamp <= 0) return '-';
        const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        return `${Math.floor(diffMin / 60)}h ago`;
    };

    const canSwipe = proofGate.canSwipe;
    const showFallbackButton = proofGate.fallbackAllowed;
    const isSyncPending = otpSyncPending || faceSyncPending;
    const zoneStatusText = !isInsideGeoFence
        ? 'Navigate to the return location.'
        : canSwipe
            ? 'Return verification complete. Swipe to finish.'
            : boxOtpValidated && faceDetected
                ? 'Return OTP and face confirmed. Waiting for proof photo.'
                : boxOtpValidated
                    ? 'Return OTP accepted. Waiting for face check.'
                    : 'Inside return zone. Sender can enter the Return OTP.';
    const verificationStatusText = hardwareSuccess && proofGate.visibleProofLoaded
        ? 'Box verification complete and return proof is visible.'
        : boxOtpValidated && retryExhausted
            ? 'Face check failed. Capture a fallback return photo.'
            : boxOtpValidated && faceDetected
                ? 'Return OTP and face confirmed. Waiting for proof.'
                : boxOtpValidated
                    ? 'Return OTP accepted. Waiting for sender face check.'
                    : lockEvent?.otp_valid === false
                        ? 'Wrong Return OTP. Ask the sender to try again.'
                        : 'Ask the sender to enter the Return OTP shown in their app.';
    const verificationStatusColor = hardwareSuccess && proofGate.visibleProofLoaded
        ? c.successText
        : lockEvent?.otp_valid === false || retryExhausted
            ? c.warningText
            : c.blueText;
    const verificationStatusBg = hardwareSuccess && proofGate.visibleProofLoaded
        ? c.successBg
        : lockEvent?.otp_valid === false || retryExhausted
            ? c.warningBg
            : c.blueBg;

    return (
        <View style={styles.container}>
            <View style={styles.modernHeader}>
                <View style={[styles.modernHeaderIcon, { backgroundColor: isInsideGeoFence ? c.successBg : c.errorBg }]}>
                    <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold' }}>{isInsideGeoFence ? 'RTN' : 'GPS'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                    <Text style={[styles.modernHeaderTitle, { color: c.textTitle }]}>Return Verification</Text>
                    <Text style={[styles.modernHeaderSubtitle, { color: isInsideGeoFence ? c.successText : c.errorText }]}>
                        {isInsideGeoFence ? 'You are inside the return zone' : distanceMeters !== null ? `${formatDistance(distanceMeters)} away` : 'Locating...'}
                    </Text>
                </View>
            </View>

            <View style={styles.checksContainer}>
                <View style={styles.checksRowMulti}>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: isPhoneInside ? c.successBg : c.errorBg }]}>
                        <Text style={{ fontSize: 12, color: isPhoneInside ? c.successText : c.errorText, fontFamily: 'Inter_600SemiBold' }}>
                            {isPhoneInside ? 'OK Phone GPS' : 'No Phone GPS'}
                        </Text>
                    </View>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: isBoxOffline ? c.warningBg : (isBoxInside ? c.successBg : c.errorBg) }]}>
                        <Text style={{ fontSize: 12, color: isBoxOffline ? c.warningText : (isBoxInside ? c.successText : c.errorText), fontFamily: 'Inter_600SemiBold' }}>
                            {isBoxOffline ? 'Box Offline' : (isBoxInside ? 'OK Smart Box' : 'No Smart Box')}
                        </Text>
                    </View>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: boxOtpValidated ? c.successBg : (lockEvent?.otp_valid === false ? c.errorBg : c.warningBg) }]}>
                        <Text style={{ fontSize: 12, color: boxOtpValidated ? c.successText : (lockEvent?.otp_valid === false ? c.errorText : c.warningText), fontFamily: 'Inter_600SemiBold' }}>
                            {boxOtpValidated ? 'OK Return OTP' : (lockEvent?.otp_valid === false ? 'Bad OTP' : 'Waiting OTP')}
                        </Text>
                    </View>
                    <View style={[styles.minimalCheckBadge, { backgroundColor: faceDetected ? c.successBg : (lockEvent?.otp_valid && !lockEvent?.face_detected ? c.errorBg : c.warningBg) }]}>
                        <Text style={{ fontSize: 12, color: faceDetected ? c.successText : (lockEvent?.otp_valid && !lockEvent?.face_detected ? c.errorText : c.warningText), fontFamily: 'Inter_600SemiBold' }}>
                            {faceDetected ? 'OK Face' : (lockEvent?.otp_valid && !lockEvent?.face_detected ? 'No Face' : 'Waiting Face')}
                        </Text>
                    </View>
                </View>
                <Text style={{ fontSize: 11, color: c.subtleText, marginTop: 12, textAlign: 'center' }}>
                    Phone GPS: {formatAge(lastPhoneGpsAt)} | Box heartbeat: {formatAge(lastBoxHeartbeatAt)}
                </Text>
            </View>

            <View style={[styles.statusMessageContainer, { backgroundColor: isInsideGeoFence ? c.successBg : c.errorBg }]}>
                <Text style={[styles.statusMessageText, { color: isInsideGeoFence ? c.successText : c.errorText }]}>
                    {zoneStatusText}
                </Text>
            </View>

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
                        <MapboxGL.Camera centerCoordinate={[targetLng, targetLat]} zoomLevel={16} animationMode="none" />
                        <MapboxGL.ShapeSource id="return-geofence-circle" shape={geofenceCircle}>
                            <MapboxGL.FillLayer
                                id="return-geofence-fill"
                                style={{
                                    fillColor: isInsideGeoFence ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                    fillOutlineColor: isInsideGeoFence ? '#22c55e' : '#ef4444',
                                }}
                            />
                        </MapboxGL.ShapeSource>
                        <MapboxGL.MarkerView id="return-target" coordinate={[targetLng, targetLat]}>
                            <View style={styles.targetMarker}><Text style={styles.targetMarkerText}>R</Text></View>
                        </MapboxGL.MarkerView>
                        {hasRiderPosition && (
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
                                {isInsideGeoFence ? 'Inside Return Zone' : `${formatDistance(distanceMeters)} to zone`}
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {!mapAvailable && hasRiderPosition && distanceMeters !== null && (
                <View style={[styles.proximityFallback, { backgroundColor: c.badgeBg, borderColor: c.border }]}>
                    <Text style={[styles.proximityText, { color: c.text }]}>
                        {isInsideGeoFence
                            ? 'You are inside the return zone'
                            : `${formatDistance(distanceMeters)} from return zone (${formatDistance(geofenceRadiusM)} radius)`}
                    </Text>
                </View>
            )}

            <View style={[styles.detailsBlock, { backgroundColor: isDarkMode ? '#18181b' : '#fafafa', borderColor: c.border }]}>
                <View style={styles.locationHeaderRow}>
                    <View style={{ flex: 1, paddingRight: 16 }}>
                        <Text style={[styles.sectionLabel, { color: c.textLabel }]}>RETURN LOCATION</Text>
                        <Text style={[styles.detailText, { color: c.textTitle }]}>{targetAddress}</Text>
                    </View>
                    <IconButton icon="navigation-variant" size={24} mode="contained" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} iconColor={isDarkMode ? '#e4e4e7' : '#18181b'} onPress={onNavigate} style={{ margin: 0 }} />
                </View>

                <View style={[styles.senderRow, { borderTopColor: c.border }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.sectionLabel, { color: c.textLabel }]}>SENDER</Text>
                        <Text style={[styles.detailText, { color: c.textTitle }]}>{senderName || 'Sender'}</Text>
                        {senderPhone ? <Text style={{ fontSize: 13, color: c.textLabel, marginTop: 2 }}>{senderPhone}</Text> : null}
                    </View>
                    {senderPhone && (
                        <View style={styles.actionButtons}>
                            <IconButton icon="message-text" size={20} iconColor={c.textTitle} mode="contained-tonal" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} onPress={() => Linking.openURL(`sms:${senderPhone}`)} style={{ margin: 0 }} />
                            <IconButton icon="phone" size={20} iconColor={c.textTitle} mode="contained-tonal" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} onPress={() => Linking.openURL(`tel:${senderPhone}`)} style={{ margin: 0 }} />
                        </View>
                    )}
                </View>

                {deliveryNotes ? (
                    <View style={[styles.notesRow, { backgroundColor: isDarkMode ? '#27272a' : '#f4f4f5' }]}>
                        <Text style={[styles.sectionLabel, { color: c.textLabel }]}>RETURN NOTES</Text>
                        <Text style={{ fontSize: 14, color: c.textTitle, marginTop: 4 }}>{deliveryNotes}</Text>
                    </View>
                ) : null}
            </View>

            {isInsideGeoFence && (
                <View style={[styles.verificationBlock, { backgroundColor: isDarkMode ? '#18181b' : '#fafafa', borderColor: c.border }]}>
                    <View style={styles.verificationHeader}>
                        <Text style={[styles.verificationTitle, { color: c.textTitle }]}>Return Package</Text>
                        <Text style={{ fontSize: 13, color: c.textLabel, marginTop: 2 }}>Sender OTP, face check, and return proof</Text>
                    </View>

                    <View style={{ padding: 16 }}>
                        <View style={[styles.statusMessageContainer, { marginBottom: 16, backgroundColor: verificationStatusBg }]}>
                            <Text style={[styles.statusMessageText, { color: verificationStatusColor }]}>
                                {verificationStatusText}
                            </Text>
                        </View>

                        {isSyncPending && (
                            <View style={[styles.statusMessageContainer, { marginBottom: 16, backgroundColor: c.warningBg }]}>
                                <Text style={[styles.statusMessageText, { color: c.warningText }]}>
                                    Syncing return verification. Wait a moment.
                                </Text>
                            </View>
                        )}

                        <View style={[styles.proofPanel, { borderColor: c.borderHard, backgroundColor: isDarkMode ? '#000' : '#f8f9fa' }]}>
                            <Text style={[styles.proofTitle, { color: c.textTitle }]}>Return Proof Photo</Text>
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
                                                if (displayedProofIsFull) setHardwareProofFailed(true);
                                                else setPreviewProofFailed(true);
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
                                                <Text style={styles.photoVerifiedText}>Photo Verified</Text>
                                            </View>
                                        )}
                                    </View>
                                    <Text style={[styles.proofHintSuccess, { color: proofGate.visibleProofLoaded ? c.successText : c.textLabel }]}>
                                        {proofGate.visibleProofLoaded
                                            ? 'Return proof is visible. You can now swipe to complete.'
                                            : 'Loading return proof preview...'}
                                    </Text>
                                    {previewProofLoaded && !hardwareProofLoaded && !fallbackPhotoLoaded && (
                                        <View style={[styles.finalProofNotice, { borderColor: c.borderHard, backgroundColor: c.card }]}>
                                            <ActivityIndicator size="small" color={c.blueText} />
                                            <View style={styles.finalProofNoticeText}>
                                                <Text style={[styles.finalProofNoticeTitle, { color: c.textTitle }]}>
                                                    {effectiveHardwareProofUrl ? 'Final return proof uploaded. Loading high-quality photo...' : `Return proof upload ${finalProofProgress}%`}
                                                </Text>
                                                <Text style={[styles.finalProofNoticeBody, { color: c.textLabel }]}>
                                                    {cameraState?.last_upload_role === 'full'
                                                        ? 'The ESP-CAM is sending the final return proof through LTE.'
                                                        : 'The preview is visible while the final proof finishes.'}
                                                </Text>
                                                <View style={[styles.finalProofProgressTrack, { backgroundColor: c.borderHard }]}>
                                                    <View style={[styles.finalProofProgressFill, { width: `${finalProofProgress}%`, backgroundColor: c.blueText }]} />
                                                </View>
                                            </View>
                                        </View>
                                    )}
                                </>
                            ) : (
                                <>
                                    <Text style={[styles.proofHintPending, { color: c.textLabel }]}>
                                        Waiting for return proof preview before swipe completion.
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
                                                    {photoUploadState?.error_message || 'The box is relaying the return proof photo through LTE.'}
                                                </Text>
                                                <View style={[styles.finalProofProgressTrack, { backgroundColor: c.borderHard }]}>
                                                    <View style={[styles.finalProofProgressFill, { width: `${liveUploadProgress}%`, backgroundColor: c.blueText }]} />
                                                </View>
                                            </View>
                                        </View>
                                    )}
                                </>
                            )}
                        </View>

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
                                    {fallbackPhotoUri ? 'Retake fallback return photo' : 'Capture fallback return photo'}
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
                                                ? 'Fallback return photo is visible. You may now complete return.'
                                                : 'Loading fallback return photo preview before completion.'}
                                        </Text>
                                    </>
                                )}
                            </View>
                        )}

                        <View style={{ marginTop: 20 }}>
                            <SwipeConfirmButton
                                label="Swipe Package Returned"
                                onConfirm={handleReturnSwipe}
                                disabled={!canSwipe || isLoading}
                            />
                        </View>
                    </View>
                </View>
            )}

            <View style={styles.boxControlSection}>
                <View style={styles.boxControlHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold' }}>BOX</Text>
                        <Text style={[styles.boxControlTitle, { color: c.textTitle }]}>Box Status</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.connectionDot, { backgroundColor: boxState ? c.successText : c.errorText }]} />
                        <Text style={[styles.connectionText, { color: boxState ? c.successText : c.errorText }]}>
                            {boxState ? 'Connected' : 'Offline'}
                        </Text>
                    </View>
                </View>
                <View style={[styles.autoControlsMsg, { borderTopColor: c.border }]}>
                    <Text style={{ fontSize: 13, color: c.subtleText }}>
                        Return unlock is controlled by the sender Return OTP.
                    </Text>
                </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
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
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#111827',
    },
    targetMarkerText: {
        fontSize: 22,
        color: '#ffffff',
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
    proximityText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
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
    autoControlsMsg: {
        paddingVertical: 16,
        borderTopWidth: 1,
    },
});
