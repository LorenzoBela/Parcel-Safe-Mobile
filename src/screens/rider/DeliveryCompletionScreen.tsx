import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, ScrollView, Animated } from 'react-native';
import { useEntryAnimation, useScalePopAnimation } from '../../hooks/useEntryAnimation';
import { Text, Button, Card, Avatar } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import SwipeConfirmButton from '../../components/SwipeConfirmButton';
import { subscribeToDelivery, updateDeliveryStatus, calculateHaversineDistance, markRiderAvailable, DeliveryRecord } from '../../services/riderMatchingService';
import useAuthStore from '../../store/authStore';
import { uploadDeliveryProofPhoto, uploadPickupPhoto } from '../../services/proofPhotoService';
import { subscribeToLocation, LocationData } from '../../services/firebaseClient';

import statusUpdateService from '../../services/statusUpdateService';
import { supabase } from '../../services/supabaseClient';
import * as ImagePicker from 'expo-image-picker';

interface CompletionRouteParams {
    deliveryId?: string;
    boxId?: string;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumAlert } from '../../services/PremiumAlertService';

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
    const [pickupPhotoUri, setPickupPhotoUri] = useState<string | null>(null);
    const [pickupPhotoUrl, setPickupPhotoUrl] = useState<string | null>(null);
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
        if (!['IN_TRANSIT', 'ARRIVED', 'COMPLETED'].includes(status)) {
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
        () => ['IN_TRANSIT', 'COMPLETED'].includes(status),
        [status]
    );
    const isArrived = useMemo(() => ['ARRIVED', 'COMPLETED'].includes(status), [status]);
    const isCompleted = status === 'COMPLETED';

    const requireDeliveryId = () => {
        if (deliveryId) {
            return true;
        }
        PremiumAlert.alert('Missing Delivery', 'Delivery ID is missing. Returning to dashboard.');
        navigation.navigate('RiderApp');
        return false;
    };

    const handleCapturePickupPhoto = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
            });

            if (!result.canceled && result.assets?.[0]?.uri) {
                setPickupPhotoUri(result.assets[0].uri);
                setPickupPhotoUrl(null);
            }
        } catch (e) {
            PremiumAlert.alert('Camera Error', 'Unable to capture pickup photo right now.');
        }
    };

    const handleFallbackPickup = async () => {
        if (!requireDeliveryId()) return;

        if (!pickupPhotoUri) {
            PremiumAlert.alert('Photo Required', 'Please capture a pickup photo before confirming pickup.');
            return;
        }

        setIsSaving(true);
        try {
            // Upload pickup photo first
            const uploadResult = await uploadPickupPhoto({
                deliveryId: deliveryId!,
                boxId: boxId || 'UNKNOWN_BOX',
                localUri: pickupPhotoUri,
            });

            if (!uploadResult.success) {
                PremiumAlert.alert('Upload Failed', 'Pickup photo upload failed. Please retry.');
                return;
            }
            setPickupPhotoUrl(uploadResult.url || null);

            // Set to IN_TRANSIT directly (merging PICKED_UP state)
            const ok = await updateDeliveryStatus(deliveryId!, 'IN_TRANSIT', {
                picked_up_at: Date.now(),
                pickup_confirmed_fallback: true,
                in_transit_at: Date.now(),
                pickup_photo_url: uploadResult.url,
            });
            if (!ok) {
                PremiumAlert.alert('Failed', 'Could not update pickup status.');
                return;
            }
            setStatus('IN_TRANSIT');
        } finally {
            setIsSaving(false);
        }
    };

    const handleArrived = async () => {
        if (!requireDeliveryId()) return;

        if (!isPickedUp) {
            const fallbackDone = await updateDeliveryStatus(deliveryId!, 'IN_TRANSIT', {
                picked_up_at: Date.now(),
                pickup_confirmed_fallback: true,
                in_transit_at: Date.now(),
            });
            if (!fallbackDone) {
                PremiumAlert.alert('Failed', 'Could not auto-fix pickup step.');
                return;
            }
        }

        const ok = await updateDeliveryStatus(deliveryId!, 'ARRIVED', {
            arrived_at: Date.now(),
        });
        if (!ok) {
            PremiumAlert.alert('Failed', 'Could not mark arrival.');
            return;
        }
        setStatus('ARRIVED');
    };

    const handleComplete = async () => {
        if (!requireDeliveryId()) return;

        if (!proofPhotoUri) {
            PremiumAlert.alert('Proof Required', 'Capture a proof photo before completing the delivery.');
            return;
        }

        setIsSaving(true);
        try {
            if (!isPickedUp) {
                const pickupOk = await updateDeliveryStatus(deliveryId!, 'IN_TRANSIT', {
                    picked_up_at: Date.now(),
                    pickup_confirmed_fallback: true,
                    in_transit_at: Date.now(),
                });
                if (!pickupOk) {
                    PremiumAlert.alert('Failed', 'Could not auto-fix pickup step.');
                    return;
                }
            }

            if (!isArrived) {
                const arrivedOk = await updateDeliveryStatus(deliveryId!, 'ARRIVED', {
                    arrived_at: Date.now(),
                    arrived_confirmed_fallback: true,
                });
                if (!arrivedOk) {
                    PremiumAlert.alert('Failed', 'Could not auto-fix arrival step.');
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
                    PremiumAlert.alert('Proof Upload Failed', 'Proof photo is required. Please retry.');
                    return;
                } else {
                    setProofPhotoUrl(uploadResult.url || null);
                }
            }

            const completed = await updateDeliveryStatus(deliveryId!, 'COMPLETED', {
                completed_at: Date.now(),
            });

            if (!completed) {
                PremiumAlert.alert('Failed', 'Could not complete delivery.');
                return;
            }

            setStatus('COMPLETED');

            // --- EMAIL RECEIPT TRIGGER ---
            try {
                if (delivery && delivery.customer_id) {
                    // Fetch Customer Email from Supabase (Requires Email access)
                    const { data: profileData, error: profileError } = await supabase
                        .from('profiles')
                        .select('email')
                        .eq('id', delivery.customer_id)
                        .maybeSingle();

                    if (!profileError && profileData?.email) {
                        const parseDate = (dString: string | number | null | undefined) => {
                            if (!dString) return new Date().getTime();
                            if (typeof dString === 'number') return dString;
                            let safeStr = dString;
                            if (safeStr.includes(' ') && !safeStr.includes('T')) {
                                safeStr = safeStr.replace(' ', 'T') + 'Z';
                            }
                            const t = new Date(safeStr).getTime();
                            if (isNaN(t)) return new Date().getTime();
                            return t;
                        };

                        const formatDuration = (d: any) => {
                            if (d.duration) {
                                if (d.duration < 60) return `${Math.round(d.duration)} mins`;
                                const hrs = Math.floor(d.duration / 60);
                                const mins = Math.round(d.duration % 60);
                                return `${hrs}h ${mins}m`;
                            }
                            const start = parseDate(d.accepted_at || d.created_at);
                            const end = parseDate(d.delivered_at || new Date().toISOString());
                            const diffMins = Math.round((end - start) / 60000);
                            if (diffMins < 60) return `${Math.max(1, diffMins)} mins`;
                            const hrs = Math.floor(diffMins / 60);
                            const mins = diffMins % 60;
                            if (hrs > 48) return `N/A`;
                            return `${hrs}h ${mins}m`;
                        };

                        let finalDistanceStr = 'N/A';
                        if (delivery.distance != null) {
                            finalDistanceStr = `${Number(delivery.distance).toFixed(2)} km`;
                        } else if (delivery.pickup_lat && delivery.pickup_lng && delivery.dropoff_lat && delivery.dropoff_lng) {
                            const distMeters = calculateHaversineDistance(
                                delivery.pickup_lat,
                                delivery.pickup_lng,
                                delivery.dropoff_lat,
                                delivery.dropoff_lng
                            );
                            finalDistanceStr = `${(distMeters / 1000).toFixed(2)} km`;
                        }

                        // Gather data for the email
                        const emailData = {
                            email: profileData.email,
                            trackingNumber: delivery.tracking_number,
                            date: new Date().toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' }),
                            distance: finalDistanceStr,
                            duration: formatDuration(delivery),
                            fare: delivery.estimated_fare ? `₱ ${delivery.estimated_fare.toFixed(2)}` : 'N/A',
                            customerName: delivery.recipient_name || 'Customer', // Use explicitly provided recipient name if available
                            senderName: delivery.sender_name || 'Sender',
                            senderPhone: delivery.sender_phone || 'N/A',
                            pickupAddress: delivery.pickup_address,
                            dropoffAddress: delivery.dropoff_address,
                            pickupPhotoUrl: delivery.pickup_photo_url || undefined, // Existing URL in DB
                            pickupPhotoTime: parseDate(delivery.picked_up_at) ? new Date(parseDate(delivery.picked_up_at)).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : undefined,
                            proofPhotoUrl: proofPhotoUrl || undefined, // URL from the upload
                            proofPhotoTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), // Just taken now
                            websiteUrl: 'https://parcel-safe.vercel.app',
                        };

                        const apiUrl = `${process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL}/api/send-receipt`;
                        console.log('[DeliveryCompletion] Triggering Email Receipt API:', apiUrl);

                        const emailResponse = await fetch(apiUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(emailData),
                        });

                        if (!emailResponse.ok) {
                            console.error('[DeliveryCompletion] Failed to send receipt email. Status:', emailResponse.status);
                        } else {
                            console.log('[DeliveryCompletion] Successfully triggered email receipt API.');
                        }
                    } else {
                        console.warn('[DeliveryCompletion] Customer email not found, could not send receipt.');
                    }
                }
            } catch (emailTriggerError) {
                console.error('[DeliveryCompletion] Error triggering email receipt:', emailTriggerError);
            }
            // --- END EMAIL RECEIPT TRIGGER ---

            // Restore rider availability so they can receive new orders
            if (riderId) {
                await markRiderAvailable(riderId);
            }

            PremiumAlert.alert('Delivery Completed', 'All required delivery states are now satisfied.', [
                {
                    text: 'Back to Dashboard',
                    onPress: () => navigation.navigate('RiderApp'),
                },
            ]);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCaptureProofPhoto = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
            });

            if (!result.canceled && result.assets?.[0]?.uri) {
                setProofPhotoUri(result.assets[0].uri);
                setProofPhotoUrl(null);
            }
        } catch (e) {
            PremiumAlert.alert('Camera Error', 'Unable to capture photo right now.');
        }
    };

    const iconPop = useScalePopAnimation(0);
    const contentAnim = useEntryAnimation(80);

    return (
        <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>
            <Animated.View style={iconPop.style}>
            <Avatar.Icon size={88} icon={isCompleted ? 'check-circle' : 'package-variant-closed-check'} style={styles.icon} color="white" />
            </Animated.View>
            <Animated.View style={contentAnim.style}>
            <Text variant="headlineMedium" style={styles.title}>Delivery Flow Checkpoint</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>Current status: {status}</Text>

            <Card style={styles.card}>
                <Card.Content>
                    <Text style={styles.cardTitle}>1) Pickup Confirmation</Text>
                    <Text style={styles.cardText}>
                        {isPickedUp ? 'Package pickup is already recorded.' : 'Take a photo and swipe to confirm pickup.'}
                    </Text>
                    {!isPickedUp && (
                        <View style={{ marginTop: 12 }}>
                            <Button
                                mode="outlined"
                                icon="camera"
                                onPress={handleCapturePickupPhoto}
                                disabled={isSaving}
                            >
                                {pickupPhotoUri ? 'Retake pickup photo' : 'Capture pickup photo (required)'}
                            </Button>
                            {pickupPhotoUri ? (
                                <Text style={{ marginTop: 6, color: '#16a34a' }}>
                                    ✅ Pickup photo ready{pickupPhotoUrl ? ' (uploaded)' : ''}.
                                </Text>
                            ) : (
                                <Text style={{ marginTop: 6, color: '#6b7280' }}>
                                    A pickup photo is required to proceed.
                                </Text>
                            )}
                        </View>
                    )}
                    {!isPickedUp && !isInsideGeofence && (
                        <Text style={{ color: '#ef4444', fontFamily: 'Inter_700Bold', marginTop: 4 }}>
                            ⚠️ Outside Geofence ({distanceToTarget}m). Move closer.
                        </Text>
                    )}
                    {!isPickedUp && (
                        <View style={styles.swipeWrap}>
                            <SwipeConfirmButton
                                label="Swipe to confirm pickup"
                                onConfirm={handleFallbackPickup}
                                disabled={isSaving || !isInsideGeofence || !pickupPhotoUri}
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
                        <Text style={{ color: '#ef4444', fontFamily: 'Inter_700Bold', marginTop: 4 }}>
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
                        <Text style={{ color: '#ef4444', fontFamily: 'Inter_700Bold', marginTop: 4 }}>
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

            <Button mode="outlined" onPress={() => navigation.navigate('RiderApp')} style={styles.backButton}>
                Back to Dashboard
            </Button>
            </Animated.View>
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
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
