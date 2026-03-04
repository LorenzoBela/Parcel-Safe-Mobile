import React, { useState } from 'react';
import { View, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { Text, Card, Button, IconButton } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadPickupPhoto } from '../../../services/proofPhotoService';
import { updateDeliveryStatus } from '../../../services/riderMatchingService';

interface PickupVerificationProps {
    deliveryId: string;
    boxId: string;
    targetAddress: string;
    targetLat: number;
    targetLng: number;
    senderName?: string;
    senderPhone?: string;
    deliveryNotes?: string;

    isInsideGeoFence: boolean;
    distanceMeters: number | null;
    isPhoneInside: boolean;
    isBoxInside: boolean;
    isBoxOffline: boolean;

    onPickupConfirmed: () => void;

    onNavigate: () => void;
}

export default function PickupVerification({
    deliveryId,
    boxId,
    targetAddress,
    targetLat,
    targetLng,
    senderName,
    senderPhone,
    deliveryNotes,
    isInsideGeoFence,
    distanceMeters,
    isPhoneInside,
    isBoxInside,
    isBoxOffline,
    onPickupConfirmed,

    onNavigate,
}: PickupVerificationProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [pickupPhotoUri, setPickupPhotoUri] = useState<string | null>(null);

    const handleCapturePickupPhoto = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
            });
            if (!result.canceled && result.assets?.[0]?.uri) {
                setPickupPhotoUri(result.assets[0].uri);
            }
        } catch (e) {
            Alert.alert('Camera Error', 'Unable to capture pickup photo right now.');
        }
    };

    const handlePickupSwipe = async () => {
        if (!isInsideGeoFence) {
            Alert.alert('Location Required', 'Move inside the pickup geofence before confirming pickup.');
            return;
        }

        if (!pickupPhotoUri) {
            Alert.alert('Photo Required', 'Please capture a pickup photo before confirming pickup.');
            return;
        }

        setIsLoading(true);
        try {
            const uploadResult = await uploadPickupPhoto({
                deliveryId,
                boxId,
                localUri: pickupPhotoUri,
            });

            if (!uploadResult.success) {
                Alert.alert('Upload Failed', 'Pickup photo upload failed. Please retry.');
                return;
            }

            const success = await updateDeliveryStatus(deliveryId, 'IN_TRANSIT', {
                picked_up_at: Date.now(),
                in_transit_at: Date.now(),
                pickup_photo_url: uploadResult.url || null,
            });

            if (!success) {
                Alert.alert('Action Failed', 'Unable to confirm pickup right now.');
                return;
            }

            Alert.alert('Pickup Confirmed', 'Package marked as picked up.');
            onPickupConfirmed();
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <Card mode="elevated" style={[styles.statusCard, isInsideGeoFence ? styles.borderSuccess : styles.borderError]}>
                <Card.Content>
                    <View style={styles.statusHeader}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: '#333' }}>
                            Pickup Zone
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

                    <View style={[styles.statusMessageContainer, isInsideGeoFence ? styles.bgSubtleSuccess : styles.bgSubtleError]}>
                        <Text style={[styles.statusMessageText, isInsideGeoFence ? styles.textSuccess : styles.textError]}>
                            {isInsideGeoFence
                                ? 'Arrived at Sender. Capture photo to proceed.'
                                : 'Move closer to the pickup point.'}
                        </Text>
                    </View>

                    <View style={styles.addressRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.addressLabel}>PICKUP LOCATION</Text>
                            <Text numberOfLines={2} style={styles.address}>{targetAddress}</Text>

                            {senderName ? (
                                <View style={{ marginTop: 12 }}>
                                    <Text style={styles.addressLabel}>SENDER</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <Text style={[styles.address, { flex: 1, marginRight: 8 }]}>{senderName}{senderPhone ? ` • ${senderPhone}` : ''}</Text>
                                        {senderPhone && (
                                            <View style={{ flexDirection: 'row' }}>
                                                <IconButton icon="phone" size={20} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`tel:${senderPhone}`)} style={{ margin: 0, marginRight: 8 }} />
                                                <IconButton icon="message-text" size={20} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`sms:${senderPhone}`)} style={{ margin: 0 }} />
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

            <Card style={styles.actionCard}>
                <Card.Content>
                    <Text style={styles.actionTitle}>Pickup Parcel</Text>
                    <View style={{ marginTop: 12 }}>
                        <Button
                            mode="outlined"
                            icon="camera"
                            onPress={handleCapturePickupPhoto}
                            disabled={!isInsideGeoFence || isLoading}
                        >
                            {pickupPhotoUri ? 'Retake pickup photo' : 'Capture pickup photo (required)'}
                        </Button>
                        {pickupPhotoUri ? (
                            <Text style={{ marginTop: 6, color: '#16a34a', textAlign: 'center' }}>
                                ✅ Pickup photo ready.
                            </Text>
                        ) : (
                            <Text style={{ marginTop: 6, color: '#6b7280', textAlign: 'center' }}>
                                Approach pickup point to unlock camera.
                            </Text>
                        )}
                    </View>
                    <View style={{ marginTop: 16 }}>
                        <SwipeConfirmButton
                            label="Swipe to Pick Up"
                            onConfirm={handlePickupSwipe}
                            disabled={!isInsideGeoFence || !pickupPhotoUri || isLoading}
                        />
                    </View>
                </Card.Content>
            </Card>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    statusCard: {
        marginBottom: 20,
        borderRadius: 16,
        borderWidth: 2,
        elevation: 3,
        backgroundColor: 'white',
    },
    borderSuccess: { borderColor: '#22c55e' },
    borderError: { borderColor: '#ef4444' },
    statusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    distanceBadge: {
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    distanceText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#4B5563',
    },
    checksContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    checkItem: {
        alignItems: 'center',
        width: 100,
    },
    checkCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
        borderWidth: 2,
        borderColor: 'white',
        elevation: 2,
    },
    checkIcon: {
        fontSize: 24,
        color: 'white',
        fontWeight: 'bold',
    },
    bgSuccess: { backgroundColor: '#22c55e' },
    bgError: { backgroundColor: '#ef4444' },
    bgWarning: { backgroundColor: '#F59E0B' },
    checkLabel: {
        fontSize: 12,
        color: '#555',
        fontWeight: '600',
    },
    checkDivider: {
        height: 2,
        width: 30,
        backgroundColor: '#E5E7EB',
        marginHorizontal: 10,
        top: -14,
    },
    statusMessageContainer: {
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        alignItems: 'center',
    },
    bgSubtleSuccess: { backgroundColor: '#DCFCE7' },
    bgSubtleError: { backgroundColor: '#FEE2E2' },
    statusMessageText: {
        textAlign: 'center',
        fontSize: 13,
        fontWeight: '600',
    },
    textSuccess: { color: '#15803d' },
    textError: { color: '#B91C1C' },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
        paddingTop: 12,
    },
    addressLabel: {
        fontSize: 10,
        color: '#888',
        fontWeight: 'bold',
        marginBottom: 2,
    },
    address: {
        fontSize: 14,
        color: '#333',
    },
    navActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        elevation: 1,
        marginBottom: 20,
    },
    actionTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#1a1a1a',
        marginBottom: 4,
    },
});
