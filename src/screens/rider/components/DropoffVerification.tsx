import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert, Linking } from 'react-native';
import { Text, Card, Button, IconButton } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadDeliveryProofPhoto } from '../../../services/proofPhotoService';
import { updateDeliveryStatus } from '../../../services/riderMatchingService';
import { subscribeToDeliveryProof, DeliveryProofState, subscribeToBoxState, BoxState, subscribeToCamera, CameraState } from '../../../services/firebaseClient';

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

    onDeliveryCompleted: () => void;
    onShowAddressModal: () => void;
    onNavigate: () => void;

    // Props for modals
    onShowBleModal: () => void;
    onShowCancelModal: () => void;
    onShowCustomerNotHome: () => void;
    isWaitTimerActive: boolean;
}

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
    onDeliveryCompleted,
    onShowAddressModal,
    onNavigate,
    onShowBleModal,
    onShowCancelModal,
    onShowCustomerNotHome,
    isWaitTimerActive
}: DropoffVerificationProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [fallbackPhotoUri, setFallbackPhotoUri] = useState<string | null>(null);
    const [hardwareSuccess, setHardwareSuccess] = useState(false);

    // ━━━ SECURITY GATE: Box must confirm OTP before completion is possible ━━━
    const [boxOtpValidated, setBoxOtpValidated] = useState(false);
    const [cameraFailed, setCameraFailed] = useState(false);

    // Auto-arrive logic
    useEffect(() => {
        if (isInsideGeoFence && deliveryStatus === 'IN_TRANSIT') {
            // Automatically mark as ARRIVED when entering geofence
            const autoArrive = async () => {
                await updateDeliveryStatus(deliveryId, 'ARRIVED', {
                    arrived_at: Date.now(),
                });
            };
            autoArrive();
        }
    }, [isInsideGeoFence, deliveryStatus, deliveryId]);

    // Monitor box state for OTP validation
    useEffect(() => {
        const unsubscribeBox = subscribeToBoxState(boxId, (state) => {
            if (state?.status === 'UNLOCKING' || state?.status === 'ACTIVE') {
                // Box confirmed OTP was entered correctly — this is the security gate
                setBoxOtpValidated(true);
            }
        });

        // Monitor delivery proof for hardware camera success
        const unsubscribeProof = subscribeToDeliveryProof(deliveryId, (proof) => {
            if (proof && proof.proof_photo_url) {
                setHardwareSuccess(true);
                setBoxOtpValidated(true); // proof_photo_url implies box validated OTP
            }
        });

        // Monitor camera state for failures
        const unsubscribeCamera = subscribeToCamera(boxId, (camState) => {
            if (camState && (camState.status === 'FAILED' || camState.status === 'HARDWARE_ERROR')) {
                setCameraFailed(true);
            }
        });

        return () => {
            unsubscribeBox();
            unsubscribeProof();
            unsubscribeCamera();
        };
    }, [boxId, deliveryId]);

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
            Alert.alert('Camera Error', 'Unable to capture fallback photo.');
        }
    };

    const handleDeliverySwipe = async () => {
        if (deliveryStatus === 'COMPLETED') {
            // Already completed by hardware
            onDeliveryCompleted();
            return;
        }

        // ━━━ SECURITY CHECK: Box must have validated OTP ━━━
        if (!boxOtpValidated) {
            Alert.alert(
                'OTP Not Verified',
                'The customer must enter the OTP on the physical box before delivery can be completed.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (!hardwareSuccess && !fallbackPhotoUri) {
            Alert.alert('Cannot Complete', 'Hardware verification pending. If the box camera failed, please capture a fallback photo.');
            return;
        }

        setIsLoading(true);
        try {
            if (fallbackPhotoUri && !hardwareSuccess) {
                const uploadResult = await uploadDeliveryProofPhoto({
                    deliveryId,
                    boxId,
                    localUri: fallbackPhotoUri,
                });

                if (!uploadResult.success) {
                    Alert.alert('Upload Failed', 'Fallback photo upload failed. Please retry.');
                    return;
                }

                await updateDeliveryStatus(deliveryId, 'COMPLETED', {
                    completed_at: Date.now(),
                    proof_photo_url: uploadResult.url || null,
                });
            } else {
                // Hardware already succeeded, just finalize rider state
                await updateDeliveryStatus(deliveryId, 'COMPLETED', {
                    completed_at: Date.now(),
                });
            }

            Alert.alert('Delivery Completed', 'Package delivered successfully.');
            onDeliveryCompleted();
        } finally {
            setIsLoading(false);
        }
    };

    // ━━━ Determine handover card status message ━━━
    const getHandoverStatusMessage = (): { text: string; color: string; bgColor: string } => {
        if (hardwareSuccess) {
            return { text: '✅ Hardware verification successful. Box unlocked!', color: '#15803d', bgColor: '#DCFCE7' };
        }
        if (boxOtpValidated && cameraFailed && fallbackPhotoUri) {
            return { text: '📸 OTP verified ✓  Fallback photo captured. Ready to complete.', color: '#15803d', bgColor: '#DCFCE7' };
        }
        if (boxOtpValidated && cameraFailed) {
            return { text: '⚠️ OTP verified ✓  Box camera failed. Please capture a fallback photo.', color: '#b45309', bgColor: '#FEF3C7' };
        }
        if (boxOtpValidated) {
            return { text: '🔓 OTP verified ✓  Waiting for box camera to capture proof photo...', color: '#1d4ed8', bgColor: '#DBEAFE' };
        }
        return { text: '🔒 Waiting for customer to enter OTP on the box...', color: '#4b5563', bgColor: '#F3F4F6' };
    };

    // Can the rider swipe to complete?
    const canSwipe = boxOtpValidated && (hardwareSuccess || fallbackPhotoUri);
    // Can the rider see the fallback photo button?
    const showFallbackButton = boxOtpValidated && !hardwareSuccess;

    const statusMsg = getHandoverStatusMessage();

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
                                <Text style={styles.distanceText}>{distanceMeters}m away</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.checksContainer}>
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
                        <View style={styles.checkDivider} />
                        <View style={styles.checkItem}>
                            <View style={[styles.checkCircle, boxOtpValidated ? styles.bgSuccess : styles.bgWarning]}>
                                <Text style={styles.checkIcon}>{boxOtpValidated ? '✓' : '⏳'}</Text>
                            </View>
                            <Text style={styles.checkLabel}>OTP Verified</Text>
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
                            <IconButton icon="map-marker-question" size={20} onPress={onShowAddressModal} />
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

                        {/* Fallback photo button — ONLY visible after box confirms OTP */}
                        {showFallbackButton && (
                            <View style={{ marginTop: 12 }}>
                                <Button
                                    mode="outlined"
                                    icon="camera-retake"
                                    onPress={handleCaptureFallbackPhoto}
                                    disabled={isLoading || hardwareSuccess}
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
                    onPress={onShowBleModal}
                    style={{ flex: 1, borderColor: '#cbd5e1' }}
                    textColor="#475569"
                    disabled={isLoading}
                >
                    BLE Transfer
                </Button>
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
    checksContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
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
});
