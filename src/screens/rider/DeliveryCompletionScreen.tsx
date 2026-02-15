import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, ScrollView } from 'react-native';
import { Text, Button, Card, Avatar } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import SwipeConfirmButton from '../../components/SwipeConfirmButton';
import { subscribeToDelivery, updateDeliveryStatus, calculateHaversineDistance, markRiderAvailable, DeliveryRecord } from '../../services/riderMatchingService';
import useAuthStore from '../../store/authStore';
import { uploadDeliveryProofPhoto } from '../../services/proofPhotoService';
import { subscribeToLocation, LocationData } from '../../services/firebaseClient';

// Optional expo-image-picker import (may not be available in all environments)
let ImagePicker: any = null;
try {
    ImagePicker = require('expo-image-picker');
} catch (e) {
    // ignore
}

interface CompletionRouteParams {
    deliveryId?: string;
    boxId?: string;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function DeliveryCompletionScreen() {
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const route = useRoute();
    const params = (route.params as CompletionRouteParams | undefined) || {};
    const riderId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const deliveryId = params.deliveryId;
    const boxId = params.boxId || '';
    const [status, setStatus] = useState<string>('IN_TRANSIT');
    const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [proofPhotoUri, setProofPhotoUri] = useState<string | null>(null);
    const [proofPhotoUrl, setProofPhotoUrl] = useState<string | null>(null);
    const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
    const [distanceToTarget, setDistanceToTarget] = useState<number | null>(null);
    const [isInsideGeofence, setIsInsideGeofence] = useState(false);

    useEffect(() => {
        if (!deliveryId) {
            return;
        }

        const unsubscribe = subscribeToDelivery(deliveryId, (data) => {
            if (data) {
                setDelivery(data);
                if (data.status) {
                    setStatus(data.status);
                }
            }
        });

        return unsubscribe;
    }, [deliveryId]);

    // Subscribe to real-time location
    useEffect(() => {
        if (!boxId) return;
        const unsubscribe = subscribeToLocation(boxId, (loc) => {
            setCurrentLocation(loc);
        });
        return unsubscribe;
    }, [boxId]);

    // Calculate geofence status
    useEffect(() => {
        if (!currentLocation || !delivery) return;

        let targetLat, targetLng;
        // If not picked up, target is pickup.
        // If picked up but not arrived/completed, target is dropoff.
        // Logic depends on 'isPickedUp' derived state
        if (!['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED'].includes(status)) {
            targetLat = delivery.pickup_lat;
            targetLng = delivery.pickup_lng;
        } else {
            targetLat = delivery.dropoff_lat;
            targetLng = delivery.dropoff_lng;
        }

        if (targetLat && targetLng) {
            const distKm = calculateHaversineDistance(
                currentLocation.latitude, currentLocation.longitude,
                targetLat, targetLng
            );
            const distMeters = Math.round(distKm * 1000);
            setDistanceToTarget(distMeters);
            setIsInsideGeofence(distMeters <= 50); // 50m radius
        }
    }, [currentLocation, delivery, status]);

    const isPickedUp = useMemo(
        () => ['PICKED_UP', 'IN_TRANSIT', 'COMPLETED'].includes(status),
        [status]
    );
    const isArrived = useMemo(() => ['ARRIVED', 'COMPLETED'].includes(status), [status]);
    const isCompleted = status === 'COMPLETED';

    const requireDeliveryId = () => {
        if (deliveryId) {
            return true;
        }
        Alert.alert('Missing Delivery', 'Delivery ID is missing. Returning to dashboard.');
        navigation.navigate('RiderDashboard');
        return false;
    };

    const handleFallbackPickup = async () => {
        if (!requireDeliveryId()) return;
        setIsSaving(true);
        try {
            const ok = await updateDeliveryStatus(deliveryId!, 'PICKED_UP', {
                picked_up_at: Date.now(),
                pickup_confirmed_fallback: true,
            });
            if (!ok) {
                Alert.alert('Failed', 'Could not update pickup status.');
                return;
            }
            setStatus('PICKED_UP');
        } finally {
            setIsSaving(false);
        }
    };

    const handleArrived = async () => {
        if (!requireDeliveryId()) return;

        if (!isPickedUp) {
            const fallbackDone = await updateDeliveryStatus(deliveryId!, 'PICKED_UP', {
                picked_up_at: Date.now(),
                pickup_confirmed_fallback: true,
            });
            if (!fallbackDone) {
                Alert.alert('Failed', 'Could not auto-fix pickup step.');
                return;
            }
        }

        const ok = await updateDeliveryStatus(deliveryId!, 'ARRIVED', {
            arrived_at: Date.now(),
        });
        if (!ok) {
            Alert.alert('Failed', 'Could not mark arrival.');
            return;
        }
        setStatus('ARRIVED');
    };

    const handleComplete = async () => {
        if (!requireDeliveryId()) return;

        if (!proofPhotoUri) {
            Alert.alert('Proof Required', 'Capture a proof photo before completing the delivery.');
            return;
        }

        setIsSaving(true);
        try {
            if (!isPickedUp) {
                const pickupOk = await updateDeliveryStatus(deliveryId!, 'PICKED_UP', {
                    picked_up_at: Date.now(),
                    pickup_confirmed_fallback: true,
                });
                if (!pickupOk) {
                    Alert.alert('Failed', 'Could not auto-fix pickup step.');
                    return;
                }
            }

            if (!isArrived) {
                const arrivedOk = await updateDeliveryStatus(deliveryId!, 'ARRIVED', {
                    arrived_at: Date.now(),
                    arrived_confirmed_fallback: true,
                });
                if (!arrivedOk) {
                    Alert.alert('Failed', 'Could not auto-fix arrival step.');
                    return;
                }
            }

            if (proofPhotoUri && !proofPhotoUrl) {
                const uploadResult = await uploadDeliveryProofPhoto({
                    deliveryId: deliveryId!,
                    boxId: boxId || 'UNKNOWN_BOX',
                    localUri: proofPhotoUri,
                });

                if (!uploadResult.success) {
                    await updateDeliveryStatus(deliveryId!, status, {
                        proof_photo_upload_failed: true,
                        proof_photo_upload_failed_at: Date.now(),
                        proof_photo_upload_error: uploadResult.error || 'Unknown error',
                    });
                    Alert.alert('Proof Upload Failed', 'Proof photo is required. Please retry.');
                    return;
                } else {
                    setProofPhotoUrl(uploadResult.url || null);
                }
            }

            const completed = await updateDeliveryStatus(deliveryId!, 'COMPLETED', {
                completed_at: Date.now(),
            });

            if (!completed) {
                Alert.alert('Failed', 'Could not complete delivery.');
                return;
            }

            setStatus('COMPLETED');

            // Restore rider availability so they can receive new orders
            if (riderId) {
                await markRiderAvailable(riderId);
            }

            Alert.alert('Delivery Completed', 'All required delivery states are now satisfied.', [
                {
                    text: 'Back to Dashboard',
                    onPress: () => navigation.navigate('RiderDashboard'),
                },
            ]);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCaptureProofPhoto = async () => {
        if (!ImagePicker) {
            Alert.alert('Camera Unavailable', 'expo-image-picker is not available in this build.');
            return;
        }

        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'Images',
                quality: 0.7,
                allowsEditing: false,
            });

            if (!result.canceled && result.assets?.[0]?.uri) {
                setProofPhotoUri(result.assets[0].uri);
                setProofPhotoUrl(null);
            }
        } catch (e) {
            Alert.alert('Camera Error', 'Unable to capture photo right now.');
        }
    };

    return (
        <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>
            <Avatar.Icon size={88} icon={isCompleted ? 'check-circle' : 'package-variant-closed-check'} style={styles.icon} color="white" />
            <Text variant="headlineMedium" style={styles.title}>Delivery Flow Checkpoint</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>Current status: {status}</Text>

            <Card style={styles.card}>
                <Card.Content>
                    <Text style={styles.cardTitle}>1) Pickup Confirmation</Text>
                    <Text style={styles.cardText}>
                        {isPickedUp ? 'Package pickup is already recorded.' : 'Swipe to mark package as picked up.'}
                    </Text>
                    {!isPickedUp && !isInsideGeofence && (
                        <Text style={{ color: '#ef4444', fontWeight: 'bold', marginTop: 4 }}>
                            ⚠️ Outside Geofence ({distanceToTarget}m). Move closer.
                        </Text>
                    )}
                    {!isPickedUp && (
                        <View style={styles.swipeWrap}>
                            <SwipeConfirmButton
                                label="Swipe to confirm pickup"
                                onConfirm={handleFallbackPickup}
                                disabled={isSaving || !isInsideGeofence}
                            />
                        </View>
                    )}
                </Card.Content>
            </Card>

            <Card style={styles.card}>
                <Card.Content>
                    <Text style={styles.cardTitle}>2) Arrival at Dropoff</Text>
                    <Text style={styles.cardText}>
                        {isArrived ? 'Arrival is already recorded.' : 'Swipe to mark rider as arrived at destination.'}
                    </Text>
                    {!isArrived && !isInsideGeofence && (
                        <Text style={{ color: '#ef4444', fontWeight: 'bold', marginTop: 4 }}>
                            ⚠️ Outside Geofence ({distanceToTarget}m). Move closer.
                        </Text>
                    )}
                    {!isArrived && (
                        <View style={styles.swipeWrap}>
                            <SwipeConfirmButton
                                label="Swipe to confirm arrival"
                                onConfirm={handleArrived}
                                disabled={isSaving || !isInsideGeofence}
                            />
                        </View>
                    )}
                </Card.Content>
            </Card>

            <Card style={styles.card}>
                <Card.Content>
                    <Text style={styles.cardTitle}>3) Complete Delivery</Text>
                    <Text style={styles.cardText}>
                        Completing will enforce missing prior states through safe fallback updates.
                    </Text>
                    <View style={{ marginTop: 12 }}>
                        <Button
                            mode="outlined"
                            icon="camera"
                            onPress={handleCaptureProofPhoto}
                            disabled={isSaving}
                        >
                            {proofPhotoUri ? 'Retake proof photo' : 'Capture required proof photo'}
                        </Button>
                        {proofPhotoUri ? (
                            <Text style={{ marginTop: 6, color: '#4b5563' }}>
                                Proof photo ready{proofPhotoUrl ? ' (uploaded)' : ''}.
                            </Text>
                        ) : (
                            <Text style={{ marginTop: 6, color: '#6b7280' }}>
                                Proof photo is required to complete.
                            </Text>
                        )}
                    </View>
                    {!isCompleted && !isInsideGeofence && (
                        <Text style={{ color: '#ef4444', fontWeight: 'bold', marginTop: 4 }}>
                            ⚠️ Outside Geofence ({distanceToTarget}m). Move closer.
                        </Text>
                    )}
                    {!isCompleted && (
                        <View style={styles.swipeWrap}>
                            <SwipeConfirmButton
                                label="Swipe to complete order"
                                onConfirm={handleComplete}
                                disabled={isSaving || !proofPhotoUri || !isInsideGeofence}
                            />
                        </View>
                    )}
                </Card.Content>
            </Card>

            <Button mode="outlined" onPress={() => navigation.navigate('RiderDashboard')} style={styles.backButton}>
                Back to Dashboard
            </Button>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        backgroundColor: '#f4f6fb',
        paddingHorizontal: 20,
    },
    icon: {
        backgroundColor: '#2563eb',
        alignSelf: 'center',
        marginBottom: 16,
    },
    title: {
        textAlign: 'center',
        fontWeight: '700',
        marginBottom: 8,
    },
    subtitle: {
        textAlign: 'center',
        color: '#4b5563',
        marginBottom: 18,
    },
    card: {
        marginBottom: 14,
        borderRadius: 12,
    },
    cardTitle: {
        fontWeight: '700',
        marginBottom: 6,
        color: '#111827',
    },
    cardText: {
        color: '#4b5563',
    },
    swipeWrap: {
        marginTop: 12,
    },
    backButton: {
        marginTop: 6,
    },
});
