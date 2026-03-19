import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, Linking, Image } from 'react-native';
import { Text, Card, Button, IconButton, Switch } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadDeliveryProofPhoto } from '../../../services/proofPhotoService';
import { updateDeliveryStatus } from '../../../services/riderMatchingService';
import { subscribeToDeliveryProof, DeliveryProofState, subscribeToPhotoAuditLog, subscribeToBoxState, BoxState, subscribeToCamera, CameraState, subscribeToLockEvents, LockEvent, updateBoxState, getDeliveryProofSnapshot, getLockEventSnapshot, getBoxStateSnapshot } from '../../../services/firebaseClient';
import { loadDropoffVerificationSnapshot, saveDropoffVerificationSnapshot, clearDropoffVerificationSnapshot } from '../../../services/dropoffVerificationStorageService';
import { enqueueBoxCommand, flushQueuedBoxCommands, markLatestSentCommandAcked } from '../../../services/boxCommandQueueService';
import { PremiumAlert } from '../../../services/PremiumAlertService';

interface DropoffVerificationProps {
    deliveryId: string;
    boxId: string;
    targetAddress: string;
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
    hardwareProofUrl: string | null;
    auditProofUrl: string | null;
    proofVersion: number;
    manualModeEnabled: boolean;
};

const verificationCacheByDelivery: Record<string, DropoffVerificationCacheState> = {};

export default function DropoffVerification({
    deliveryId,
    boxId,
    targetAddress,
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
    onDeliveryCompleted,

    onNavigate,
    onShowBleModal,
    onShowCancelModal,
    onShowCustomerNotHome,
    isWaitTimerActive,
    canAutoArrive,
}: DropoffVerificationProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [fallbackPhotoUri, setFallbackPhotoUri] = useState<string | null>(null);
    const [hardwareSuccess, setHardwareSuccess] = useState(false);
    const [hardwareProofUrl, setHardwareProofUrl] = useState<string | null>(null);
    const [auditProofUrl, setAuditProofUrl] = useState<string | null>(null);
    const [proofVersion, setProofVersion] = useState<number>(0);
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
    const effectiveHardwareProofUrl = hardwareProofUrl || auditProofUrl;
    const hasHardwareProof = !!effectiveHardwareProofUrl;
    const hasFallbackProof = !!fallbackPhotoUri;
    const hasAnyProof = hasHardwareProof || hasFallbackProof;
    const fallbackModeActive = retryExhausted || cameraFailed;
    const displayedHardwareProofUrl = effectiveHardwareProofUrl
        ? `${effectiveHardwareProofUrl}${effectiveHardwareProofUrl.includes('?') ? '&' : '?'}t=${proofVersion || Date.now()}`
        : null;

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
            setHardwareProofUrl(cached.hardwareProofUrl);
            setAuditProofUrl(cached.auditProofUrl);
            setProofVersion(cached.proofVersion);
            setManualModeEnabled(cached.manualModeEnabled);
            if (cached.boxOtpValidated) {
                setOtpSyncPending(true);
            }
            if (cached.faceDetected) {
                setFaceSyncPending(true);
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
            hardwareProofUrl,
            auditProofUrl,
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
        hardwareProofUrl,
        auditProofUrl,
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
                });
            };
            autoArrive();
        }
    }, [canAutoArrive, isInsideGeoFence, deliveryStatus, deliveryId]);

    const canProcessOtpSignals =
        canAutoArrive &&
        isInsideGeoFence &&
        (deliveryStatus === 'ARRIVED' || deliveryStatus === 'COMPLETED');

    const runCloudReconcile = async (reason: 'pending-timeout' | 'watchdog') => {
        if (recoveryInFlightRef.current || !canProcessOtpSignals) return;
        recoveryInFlightRef.current = true;
        try {
            const [proof, lockEventSnapshot, boxSnapshot] = await Promise.all([
                getDeliveryProofSnapshot(deliveryId),
                getLockEventSnapshot(boxId),
                getBoxStateSnapshot(boxId),
            ]);

            lastCloudSignalAtRef.current = Date.now();

            if (proof?.proof_photo_url) {
                setHardwareSuccess(true);
                setHardwareProofUrl(proof.proof_photo_url);
                setProofVersion(
                    typeof proof.proof_photo_uploaded_at === 'number'
                        ? proof.proof_photo_uploaded_at
                        : Date.now()
                );
                setBoxOtpValidated(true);
                setOtpConfirmedByCloud(true);
                setOtpSyncPending(false);
            }

            if (lockEventSnapshot) {
                setLockEvent(lockEventSnapshot);

                if (lockEventSnapshot.otp_valid) {
                    setBoxOtpValidated(true);
                    setOtpConfirmedByCloud(true);
                    setOtpSyncPending(false);
                } else {
                    setBoxOtpValidated(false);
                    setOtpConfirmedByCloud(false);
                    setOtpSyncPending(false);
                }

                if (lockEventSnapshot.face_detected) {
                    setFaceDetected(true);
                    setFaceConfirmedByCloud(true);
                    setFaceSyncPending(false);
                } else if (lockEventSnapshot.otp_valid) {
                    setFaceDetected(false);
                    setFaceConfirmedByCloud(false);
                    setFaceSyncPending(false);
                }

                if (lockEventSnapshot.unlocked) {
                    setHardwareSuccess(true);
                    setBoxOtpValidated(true);
                    setFaceDetected(true);
                    setOtpConfirmedByCloud(true);
                    setFaceConfirmedByCloud(true);
                    setOtpSyncPending(false);
                    setFaceSyncPending(false);
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
        if (!effectiveHardwareProofUrl) return;
        Image.prefetch(effectiveHardwareProofUrl).catch(() => {
            // Best-effort warm-up only.
        });
    }, [effectiveHardwareProofUrl]);

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
            if (canProcessOtpSignals && proof && proof.proof_photo_url) {
                setHardwareSuccess(true);
                setHardwareProofUrl(proof.proof_photo_url);
                if (typeof proof.proof_photo_uploaded_at === 'number') {
                    setProofVersion(proof.proof_photo_uploaded_at);
                } else {
                    setProofVersion(Date.now());
                }
                setBoxOtpValidated(true); // proof_photo_url implies box validated OTP
                setOtpConfirmedByCloud(true);
                setOtpSyncPending(false);
            }
        });

        // Fallback source: firmware writes latest photo URL under audit_logs/{deliveryId}
        const unsubscribePhotoAudit = subscribeToPhotoAuditLog(deliveryId, (audit) => {
            lastCloudSignalAtRef.current = Date.now();
            if (!canProcessOtpSignals || !audit?.latest_photo_url) return;
            setAuditProofUrl(audit.latest_photo_url);
            if (typeof audit.latest_photo_uploaded_at === 'number') {
                setProofVersion(audit.latest_photo_uploaded_at);
            } else {
                setProofVersion(Date.now());
            }
            setHardwareSuccess(true);
            setBoxOtpValidated(true);
            setOtpConfirmedByCloud(true);
            setOtpSyncPending(false);
        });

        // Monitor camera state for failures
        const unsubscribeCamera = subscribeToCamera(boxId, (camState) => {
            lastCloudSignalAtRef.current = Date.now();
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

            if (event.otp_valid) {
                setBoxOtpValidated(true);
                setOtpConfirmedByCloud(true);
                setOtpSyncPending(false);
            } else if (event.otp_valid === false) {
                setBoxOtpValidated(false);
                setOtpConfirmedByCloud(false);
                setOtpSyncPending(false);
            }
            if (event.face_retry_exhausted || event.fallback_required) {
                setCameraFailed(true);
            }
            if (event.face_detected) {
                setFaceDetected(true);
                setFaceConfirmedByCloud(true);
                setFaceSyncPending(false);
            } else if (event.face_detected === false && event.otp_valid) {
                setFaceDetected(false);
                setFaceConfirmedByCloud(false);
                setFaceSyncPending(false);
            }
            if (event.unlocked) {
                // Box confirmed OTP + face + solenoid fired
                setHardwareSuccess(true);
                setBoxOtpValidated(true);
                setFaceDetected(true);
                setOtpConfirmedByCloud(true);
                setFaceConfirmedByCloud(true);
                setOtpSyncPending(false);
                setFaceSyncPending(false);
            }
        });

        return () => {
            unsubscribeBox();
            unsubscribeProof();
            unsubscribePhotoAudit();
            unsubscribeCamera();
            unsubscribeLockEvents();
        };
    }, [boxId, deliveryId, canProcessOtpSignals, subscriptionEpoch]);

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

        if (!hasAnyProof) {
            if (retryExhausted) {
                PremiumAlert.alert('Fallback Required', 'Camera failed all retry attempts. Capture a fallback photo before completing delivery.');
            } else if (hardwareSuccess) {
                PremiumAlert.alert('Proof Photo Pending', 'Face verification succeeded, but the hardware photo is still not available. Please wait a few seconds or capture a fallback photo.');
            } else {
                PremiumAlert.alert('Cannot Complete', 'Hardware verification pending. If the box camera failed, please capture a fallback photo.');
            }
            return;
        }

        setIsLoading(true);
        try {
            let resolvedProofUrl: string | null = effectiveHardwareProofUrl || null;

            if (fallbackPhotoUri && !hardwareProofUrl) {
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

            const statusSaved = await updateDeliveryStatus(deliveryId, 'COMPLETED', {
                completed_at: Date.now(),
                proof_photo_url: resolvedProofUrl,
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
        if (hardwareSuccess && hasHardwareProof) {
            return { text: '✅ Box unlocked! OTP verified & face detected.', color: '#15803d', bgColor: '#DCFCE7' };
        }
        if (boxOtpValidated && hardwareSuccess && !hasHardwareProof) {
            return { text: '📷 Face verification passed. Waiting for hardware proof photo upload, or capture fallback photo now.', color: '#1d4ed8', bgColor: '#DBEAFE' };
        }
        if (boxOtpValidated && fallbackPhotoUri && boxReportedUnlocked) {
            return { text: '✅ Fallback photo verified and unlock confirmed. Ready to complete.', color: '#15803d', bgColor: '#DCFCE7' };
        }
        if (boxOtpValidated && !faceDetected && !retryExhausted && typeof lockEvent?.face_attempts === 'number' && lockEvent.face_attempts > 0) {
            const attempt = Math.min(lockEvent.face_attempts, 3);
            return { text: `🔎 Face scan attempt ${attempt}/3 in progress...`, color: '#1d4ed8', bgColor: '#DBEAFE' };
        }
        if (boxOtpValidated && retryExhausted && typeof lockEvent?.face_attempts === 'number' && lockEvent.face_attempts >= 3) {
                return { text: '⚠️ Face scan attempt 3/3 failed. Capture fallback photo to proceed.', color: '#b45309', bgColor: '#FEF3C7' };
        }
        if (boxOtpValidated && !faceDetected && lockEvent?.otp_valid && lockEvent?.face_detected === false) {
            return { text: '⚠️ OTP correct but NO face detected — box remains locked. Ask customer to stand in front of camera.', color: '#b45309', bgColor: '#FEF3C7' };
        }
        if (boxOtpValidated && retryExhausted && !fallbackPhotoUri) {
            return { text: '⚠️ Face check failed after 3 attempts. Capture fallback photo to proceed.', color: '#b45309', bgColor: '#FEF3C7' };
        }
        if (fallbackPhotoUri && !hardwareSuccess && !unlockCommandAcked) {
            return { text: '📤 Fallback photo uploaded. Waiting for box unlock confirmation...', color: '#1d4ed8', bgColor: '#DBEAFE' };
        }
        if (boxOtpValidated && cameraFailed && fallbackPhotoUri) {
            return { text: '📸 OTP verified ✓  Fallback photo captured. Ready to complete.', color: '#15803d', bgColor: '#DCFCE7' };
        }
        if (cameraFailed && fallbackPhotoUri) {
            return { text: '📸 Box camera failed. Fallback photo captured. Ready to complete.', color: '#15803d', bgColor: '#DCFCE7' };
        }
        if (boxOtpValidated && cameraFailed) {
            return { text: '⚠️ OTP verified ✓  Box camera failed. Please capture a fallback photo.', color: '#b45309', bgColor: '#FEF3C7' };
        }
        if (cameraFailed) {
            return { text: '⚠️ Box camera failed. Please capture a fallback photo to proceed.', color: '#b45309', bgColor: '#FEF3C7' };
        }
        if (boxOtpValidated && faceDetected) {
            return { text: '🔓 OTP verified & face detected ✓  Finalizing unlock...', color: '#1d4ed8', bgColor: '#DBEAFE' };
        }
        if (boxOtpValidated) {
            return { text: '🔓 OTP verified ✓  Waiting for face detection...', color: '#1d4ed8', bgColor: '#DBEAFE' };
        }
        if (lockEvent && !lockEvent.otp_valid) {
            return { text: '❌ Wrong OTP entered! Customer should try again.', color: '#dc2626', bgColor: '#FEE2E2' };
        }
        return { text: '🔒 Waiting for customer to enter OTP on the box...', color: '#4b5563', bgColor: '#F3F4F6' };
    };

    // Can the rider swipe to complete?
    const canSwipe = otpConfirmedByCloud && (hasHardwareProof || (fallbackModeActive && hasFallbackProof));
    // Can the rider see the fallback photo button?
    const showFallbackButton = fallbackModeActive || (boxOtpValidated && !hasHardwareProof);
    const canManualControl = manualModeEnabled && isInsideGeoFence && otpConfirmedByCloud && faceConfirmedByCloud;
    const isSyncPending = otpSyncPending || faceSyncPending;
    const lockAckCommand = (boxState as any)?.command_ack_command;
    const lockAckStatus = (boxState as any)?.command_ack_status;
    const lockAckDetails = (boxState as any)?.command_ack_details;
    const lockAwaitingClose = lockAckCommand === 'LOCKED' && lockAckStatus === 'waiting_close';
    const lockAwaitingCloseNeedsAssist = lockAwaitingClose && lockAckDetails === 'reed_open';
    const lockCloseConfirmed = lockAckCommand === 'LOCKED' && lockAckStatus === 'executed' && lockAckDetails === 'reed_closed_confirmed';

    const statusMsg = getHandoverStatusMessage();

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
            <Card mode="elevated" style={[styles.statusCard, isInsideGeoFence ? styles.borderSuccess : styles.borderError]}>
                <Card.Content>
                    <View style={styles.statusHeader}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: '#333' }}>
                            Drop-Off Zone
                        </Text>
                        {distanceMeters !== null && (
                            <View style={styles.distanceBadge}>
                                <Text style={styles.distanceText}>
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
                                <View style={[styles.checkCircle, isPhoneInside ? styles.bgSuccess : styles.bgError]}>
                                    <Text style={styles.checkIcon}>{isPhoneInside ? '✓' : '✗'}</Text>
                                </View>
                                <Text style={styles.checkLabel}>Phone GPS</Text>
                            </View>
                            <View style={styles.checkDivider} />
                            <View style={styles.checkItem}>
                                <View style={[
                                    styles.checkCircle,
                                    isBoxOffline ? styles.bgWarning : (isBoxInside ? styles.bgSuccess : styles.bgError)
                                ]}>
                                    <Text style={styles.checkIcon}>
                                        {isBoxOffline ? '?' : (isBoxInside ? '✓' : '✗')}
                                    </Text>
                                </View>
                                <Text style={styles.checkLabel}>{isBoxOffline ? 'Box Offline' : 'Smart Box'}</Text>
                            </View>
                        </View>
                        <Text style={{ textAlign: 'center', fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            Phone GPS: {formatAge(lastPhoneGpsAt)} • Box heartbeat: {formatAge(lastBoxHeartbeatAt)}
                        </Text>
                        {/* Row 2: OTP Verified + Face Check */}
                        <View style={styles.checksRow}>
                            <View style={styles.checkItem}>
                                <View style={[styles.checkCircle, boxOtpValidated ? styles.bgSuccess : (lockEvent && !lockEvent.otp_valid ? styles.bgError : styles.bgWarning)]}>
                                    <Text style={styles.checkIcon}>{boxOtpValidated ? '✓' : (lockEvent && !lockEvent.otp_valid ? '✗' : '⏳')}</Text>
                                </View>
                                <Text style={styles.checkLabel}>OTP Verified</Text>
                            </View>
                            <View style={styles.checkDivider} />
                            <View style={styles.checkItem}>
                                <View style={[styles.checkCircle, faceDetected ? styles.bgSuccess : (lockEvent?.otp_valid && !lockEvent?.face_detected ? styles.bgError : styles.bgWarning)]}>
                                    <Text style={styles.checkIcon}>{faceDetected ? '✓' : (lockEvent?.otp_valid && !lockEvent?.face_detected ? '✗' : '⏳')}</Text>
                                </View>
                                <Text style={styles.checkLabel}>Face Check</Text>
                            </View>
                        </View>
                    </View>

                    <View style={[styles.statusMessageContainer, isInsideGeoFence ? styles.bgSubtleSuccess : styles.bgSubtleError]}>
                        <Text style={[styles.statusMessageText, isInsideGeoFence ? styles.textSuccess : styles.textError]}>
                            {isInsideGeoFence
                                ? (deliveryStatus === 'ARRIVED' ? `Waiting for Customer OTP...` : `Approaching Drop-off...`)
                                : 'Navigate to Drop-off Location.'}
                        </Text>
                    </View>

                    <View style={styles.addressRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.addressLabel}>DROPOFF LOCATION</Text>
                            <Text numberOfLines={2} style={styles.address}>{targetAddress}</Text>

                            {recipientName ? (
                                <View style={{ marginTop: 12 }}>
                                    <Text style={styles.addressLabel}>RECIPIENT</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <Text style={[styles.address, { flex: 1, marginRight: 8 }]}>{recipientName}{customerPhone ? ` • ${customerPhone}` : ''}</Text>
                                        {customerPhone && (
                                            <View style={{ flexDirection: 'row' }}>
                                                <IconButton icon="phone" size={20} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`tel:${customerPhone}`)} style={{ margin: 0, marginRight: 8 }} />
                                                <IconButton icon="message-text" size={20} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`sms:${customerPhone}`)} style={{ margin: 0 }} />
                                            </View>
                                        )}
                                    </View>
                                </View>
                            ) : null}

                            {deliveryNotes ? (
                                <View style={{ marginTop: 12, padding: 8, backgroundColor: '#f1f5f9', borderRadius: 6 }}>
                                    <Text style={[styles.addressLabel, { color: '#475569' }]}>DELIVERY NOTES</Text>
                                    <Text style={[styles.address, { color: '#334155' }]}>{deliveryNotes}</Text>
                                </View>
                            ) : null}
                        </View>
                        <View style={styles.navActions}>
                            <IconButton icon="navigation" mode="contained" containerColor="#E3F2FD" iconColor="#1976D2" size={24} onPress={onNavigate} />
                        </View>
                    </View>
                </Card.Content>
            </Card>

            {/* Handover Flow UI only shows if inside Geofence */}
            {isInsideGeoFence && (
                <Card style={styles.actionCard}>
                    <Card.Content>
                        <Text style={styles.actionTitle}>Handover Parcel</Text>

                        {/* Dynamic status message */}
                        <View style={[styles.statusMessageContainer, { marginTop: 12, backgroundColor: statusMsg.bgColor }]}>
                            <Text style={[styles.statusMessageText, { color: statusMsg.color }]}>
                                {statusMsg.text}
                            </Text>
                        </View>

                        {isSyncPending && (
                            <View style={[styles.statusMessageContainer, { marginTop: 8, backgroundColor: '#fff7ed' }]}>
                                <Text style={[styles.statusMessageText, { color: '#9a3412' }]}>
                                    Sync pending: restoring local verification, waiting for cloud confirmation...
                                </Text>
                            </View>
                        )}

                        <View style={{ marginTop: 8, marginBottom: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View style={{ flex: 1, paddingRight: 10 }}>
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>Manual Box Mode</Text>
                                    <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                                        Enable to allow manual lock/unlock after OTP + face verification.
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
                                <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' }}>
                                    <Text style={{ fontSize: 12, color: '#9a3412', fontWeight: '700' }}>
                                        Lock pending physical close
                                    </Text>
                                    <Text style={{ marginTop: 4, fontSize: 12, color: '#9a3412' }}>
                                        {lockAwaitingCloseNeedsAssist
                                            ? 'Close the lid until the latch aligns. If needed, press # on the keypad to retract briefly, then close again.'
                                            : 'Close the lid fully so the reed can confirm the lock.'}
                                    </Text>
                                </View>
                            )}

                            {lockCloseConfirmed && (
                                <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#bbf7d0' }}>
                                    <Text style={{ fontSize: 12, color: '#166534', fontWeight: '700' }}>
                                        Lock confirmed
                                    </Text>
                                    <Text style={{ marginTop: 4, fontSize: 12, color: '#166534' }}>
                                        Reed close detected. The box is now physically locked.
                                    </Text>
                                </View>
                            )}

                            {!canManualControl && (
                                <Text style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                                    Requirements: inside geofence, OTP verified, face verified, and manual mode enabled.
                                </Text>
                            )}
                        </View>

                        <View style={styles.proofPanel}>
                            <Text style={styles.proofTitle}>Verification Photo</Text>
                            {hasHardwareProof && displayedHardwareProofUrl ? (
                                <>
                                    <Image
                                        source={{ uri: displayedHardwareProofUrl }}
                                        style={styles.proofImage}
                                        resizeMode="cover"
                                        progressiveRenderingEnabled
                                    />
                                    <Text style={styles.proofHintSuccess}>✅ ESP-CAM proof received. You can now swipe to complete.</Text>
                                </>
                            ) : (
                                <Text style={styles.proofHintPending}>
                                    Waiting for ESP-CAM proof image to appear before swipe completion.
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
                                    <Text style={{ marginTop: 6, color: '#15803d', textAlign: 'center', fontSize: 13 }}>
                                        ✓ Fallback photo captured. You may now complete delivery.
                                    </Text>
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
                        style={{ flex: 1, borderColor: '#cbd5e1' }}
                        textColor="#475569"
                        disabled={isLoading}
                    >
                        Not Home
                    </Button>
                )}
                <Button
                    mode="outlined"
                    onPress={onShowCancelModal}
                    style={{ flex: 1, borderColor: '#fca5a5' }}
                    textColor="#ef4444"
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
    distanceText: { fontSize: 12, fontWeight: 'bold', color: '#4B5563' },
    checksContainer: { marginBottom: 20 },
    checksRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    checkItem: { alignItems: 'center', width: 90 },
    checkCircle: {
        width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
        marginBottom: 8, borderWidth: 2, borderColor: 'white', elevation: 2,
    },
    checkIcon: { fontSize: 24, color: 'white', fontWeight: 'bold' },
    bgSuccess: { backgroundColor: '#22c55e' },
    bgError: { backgroundColor: '#ef4444' },
    bgWarning: { backgroundColor: '#F59E0B' },
    checkLabel: { fontSize: 12, color: '#555', fontWeight: '600' },
    checkDivider: { height: 2, width: 20, backgroundColor: '#E5E7EB', marginHorizontal: 6, top: -14 },
    statusMessageContainer: { padding: 12, borderRadius: 8, marginBottom: 16, alignItems: 'center' },
    bgSubtleSuccess: { backgroundColor: '#DCFCE7' },
    bgSubtleError: { backgroundColor: '#FEE2E2' },
    statusMessageText: { textAlign: 'center', fontSize: 13, fontWeight: '600' },
    textSuccess: { color: '#15803d' },
    textError: { color: '#B91C1C' },
    addressRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 12 },
    addressLabel: { fontSize: 10, color: '#888', fontWeight: 'bold', marginBottom: 2 },
    address: { fontSize: 14, color: '#333' },
    navActions: { flexDirection: 'row', alignItems: 'center' },
    actionCard: { backgroundColor: 'white', borderRadius: 12, elevation: 1, marginBottom: 20 },
    actionTitle: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 4 },
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
        fontWeight: '700',
        color: '#334155',
        marginBottom: 8,
    },
    proofImage: {
        width: '100%',
        height: 180,
        borderRadius: 8,
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
        fontWeight: '600',
    },
});
