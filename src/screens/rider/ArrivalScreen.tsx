import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Alert, ScrollView, Platform } from 'react-native';
import { Text, Button, Card, TextInput, Portal, Modal } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';

// Optional expo-image-picker import (may not be available in all environments)
let ImagePicker: any = null;
try {
    ImagePicker = require('expo-image-picker');
} catch (e) {
    console.log('[ArrivalScreen] expo-image-picker not available');
}

// Services
import {
    initWaitTimerState,
    startWaitTimer,
    isWaitTimerExpired,
    getFormattedRemainingTime,
    markCustomerArrived,
    initiateReturn,
    recordArrivalPhoto,
    recordNotificationSent,
    canInitiateReturn,
    writeWaitTimerToFirebase,
    sendDriverWaitingNotification,
    WaitTimerState,
    CONFIG as WaitConfig,
} from '../../services/customerNotHomeService';

import {
    checkGeofence,
    createDefaultGeofence,
    expandGeofence,
    createAddressUpdateRequest,
    validateAddressUpdateRequest,
    submitAddressUpdate,
    GeofenceConfig,
    CONFIG as GeoConfig,
} from '../../services/addressUpdateService';

import {
    startBackgroundLocation,
    stopBackgroundLocation,
    isBackgroundLocationRunning,
} from '../../services/backgroundLocationService';

interface RouteParams {
    deliveryId: string;
    boxId: string;
    targetLat: number;
    targetLng: number;
    targetAddress: string;
    customerPhone?: string;
    riderName?: string;
}

export default function ArrivalScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const params = route.params as RouteParams || {
        deliveryId: 'demo-delivery',
        boxId: 'demo-box',
        targetLat: 14.5995,
        targetLng: 120.9842,
        targetAddress: '123 Sample Street, Manila',
    };

    // Geofence State
    const [isInsideGeoFence, setIsInsideGeoFence] = useState(false);
    const [currentPosition, setCurrentPosition] = useState({ lat: 0, lng: 0, accuracy: 25 });
    const [geofence, setGeofence] = useState<GeofenceConfig>(
        createDefaultGeofence(params.targetLat, params.targetLng)
    );
    const [distanceMeters, setDistanceMeters] = useState<number | null>(null);

    // EC-11: Customer Not Home State
    const [waitTimerState, setWaitTimerState] = useState<WaitTimerState>(
        initWaitTimerState(params.deliveryId, params.boxId)
    );
    const [displayTime, setDisplayTime] = useState('5:00');
    const [arrivalPhotoUri, setArrivalPhotoUri] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // EC-12: Address Update State
    const [showAddressModal, setShowAddressModal] = useState(false);
    const [newAddress, setNewAddress] = useState('');
    const [addressReason, setAddressReason] = useState('');

    // EC-15: Background location starts automatically when screen mounts
    useEffect(() => {
        if (!isBackgroundLocationRunning()) {
            startBackgroundLocation(params.boxId);
        }
        return () => {
            // Keep running until delivery completes
        };
    }, [params.boxId]);

    // Timer update effect
    useEffect(() => {
        if (waitTimerState.status !== 'WAITING') return;

        const interval = setInterval(() => {
            const now = Date.now();
            setDisplayTime(getFormattedRemainingTime(waitTimerState, now));

            if (isWaitTimerExpired(waitTimerState, now)) {
                setWaitTimerState(prev => ({ ...prev, status: 'EXPIRED' }));
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [waitTimerState]);

    // Simulated GPS check (in real app, use expo-location)
    const checkLocation = useCallback(() => {
        // Simulate getting current position
        const simulatedLat = params.targetLat + (Math.random() - 0.5) * 0.001;
        const simulatedLng = params.targetLng + (Math.random() - 0.5) * 0.001;
        const position = { lat: simulatedLat, lng: simulatedLng, accuracy: 15 };

        setCurrentPosition(position);
        const result = checkGeofence(position, geofence);
        setIsInsideGeoFence(result.isInside);
        setDistanceMeters(result.distanceMeters);

        // EC-12: Suggest geofence expansion if needed
        if (!result.isInside && result.needsExpansion) {
            Alert.alert(
                'GPS Accuracy Issue',
                `You appear to be ${result.distanceMeters}m from the delivery point. Would you like to expand the geofence?`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Expand',
                        onPress: () => {
                            const expanded = expandGeofence(geofence, result.suggestedRadiusMeters);
                            setGeofence(expanded);
                            // Re-check with expanded geofence
                            const newResult = checkGeofence(position, expanded);
                            setIsInsideGeoFence(newResult.isInside);
                        }
                    }
                ]
            );
        }
    }, [geofence, params.targetLat, params.targetLng]);

    // EC-11: Start wait timer (Customer Not Home)
    const handleCustomerNotHome = async () => {
        setIsLoading(true);

        let photoUri: string | null = null;

        // Capture arrival photo if ImagePicker is available
        if (ImagePicker) {
            try {
                const photoResult = await ImagePicker.launchCameraAsync({
                    mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'Images',
                    quality: 0.6,
                    allowsEditing: false,
                });

                if (!photoResult.canceled && photoResult.assets?.[0]) {
                    photoUri = photoResult.assets[0].uri;
                    setArrivalPhotoUri(photoUri);
                }
            } catch (e) {
                console.log('[ArrivalScreen] Camera not available:', e);
            }
        }

        // Start wait timer (with or without photo)
        let newState = startWaitTimer(waitTimerState, Date.now());
        
        if (photoUri) {
            newState = recordArrivalPhoto(newState, photoUri);
        }

        // Send notification to customer
        if (params.customerPhone && params.riderName) {
            const notified = await sendDriverWaitingNotification(
                params.deliveryId,
                params.customerPhone,
                params.riderName
            );
            if (notified) {
                newState = recordNotificationSent(newState, Date.now());
            }
        }

        setWaitTimerState(newState);
        await writeWaitTimerToFirebase(newState);
        setIsLoading(false);
    };

    // EC-11: Customer arrived during wait
    const handleCustomerArrived = () => {
        const newState = markCustomerArrived(waitTimerState);
        setWaitTimerState(newState);
        writeWaitTimerToFirebase(newState);
        navigation.navigate('DeliveryCompletion');
    };

    // EC-11: Return with package
    const handleReturn = async () => {
        if (!canInitiateReturn(waitTimerState, Date.now())) {
            Alert.alert('Please Wait', 'You must wait the full 5 minutes before returning.');
            return;
        }

        Alert.alert(
            'Confirm Return',
            'Are you sure you want to return with the package? The customer will be notified.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Return',
                    style: 'destructive',
                    onPress: async () => {
                        const newState = initiateReturn(waitTimerState, Date.now());
                        setWaitTimerState(newState);
                        await writeWaitTimerToFirebase(newState);
                        navigation.navigate('RiderDashboard');
                    }
                }
            ]
        );
    };

    // EC-12: Submit address update
    const handleAddressUpdate = async () => {
        const request = createAddressUpdateRequest(
            params.deliveryId,
            'RIDER',
            {
                address: params.targetAddress,
                latitude: params.targetLat,
                longitude: params.targetLng,
            },
            {
                address: newAddress,
                latitude: currentPosition.lat,
                longitude: currentPosition.lng,
            },
            addressReason
        );

        const validation = validateAddressUpdateRequest(request);
        if (!validation.isValid) {
            Alert.alert('Invalid Request', validation.errors.join('\n'));
            return;
        }

        setIsLoading(true);
        const success = await submitAddressUpdate(request);
        setIsLoading(false);

        if (success) {
            Alert.alert('Success', 'Address update request submitted. Awaiting approval.');
            setShowAddressModal(false);
            setNewAddress('');
            setAddressReason('');
        } else {
            Alert.alert('Error', 'Failed to submit address update.');
        }
    };

    // Render different UI based on wait timer state
    const renderWaitingUI = () => (
        <Card style={styles.waitCard}>
            <Card.Content>
                <View style={styles.timerContainer}>
                    <Text style={styles.timerLabel}>WAITING FOR CUSTOMER</Text>
                    <Text style={styles.timerDisplay}>{displayTime}</Text>
                    <Text style={styles.timerSubtext}>
                        {waitTimerState.status === 'EXPIRED'
                            ? 'Timer expired - You may return'
                            : 'Customer has been notified'}
                    </Text>
                </View>

                {arrivalPhotoUri && (
                    <View style={styles.photoPreview}>
                        <Text style={styles.photoLabel}>📷 Arrival photo captured</Text>
                    </View>
                )}

                <View style={styles.waitActions}>
                    <Button
                        mode="contained"
                        onPress={handleCustomerArrived}
                        style={[styles.button, { backgroundColor: '#22c55e' }]}
                        icon="check"
                    >
                        Customer Arrived
                    </Button>

                    <Button
                        mode="contained"
                        onPress={handleReturn}
                        disabled={!canInitiateReturn(waitTimerState, Date.now())}
                        style={[styles.button, { backgroundColor: '#ef4444' }]}
                        icon="keyboard-return"
                    >
                        Return with Package
                    </Button>
                </View>
            </Card.Content>
        </Card>
    );

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text variant="headlineMedium" style={styles.title}>
                Arrival & Verification
            </Text>

            {/* Geofence Status Card */}
            <Card style={[styles.statusCard, { borderColor: isInsideGeoFence ? '#22c55e' : '#ef4444' }]}>
                <Card.Content>
                    <View style={styles.statusHeader}>
                        <Text variant="titleLarge" style={{ color: isInsideGeoFence ? '#22c55e' : '#ef4444' }}>
                            {isInsideGeoFence ? '✓ INSIDE GEO-FENCE' : '✗ OUTSIDE GEO-FENCE'}
                        </Text>
                        {distanceMeters !== null && (
                            <Text style={styles.distance}>{distanceMeters}m away</Text>
                        )}
                    </View>
                    <Text variant="bodyMedium" style={styles.statusText}>
                        {isInsideGeoFence
                            ? 'You can now proceed with the delivery.'
                            : 'Please move closer to the delivery point.'}
                    </Text>

                    {/* EC-12: Address info and update button */}
                    <View style={styles.addressContainer}>
                        <Text style={styles.addressLabel}>Delivery Address:</Text>
                        <Text style={styles.address}>{params.targetAddress}</Text>
                        <Button
                            mode="text"
                            onPress={() => setShowAddressModal(true)}
                            icon="map-marker-question"
                            compact
                        >
                            Wrong Address?
                        </Button>
                    </View>
                </Card.Content>
            </Card>

            <Button mode="contained" onPress={checkLocation} style={styles.button}>
                📍 Check GPS Location
            </Button>

            {/* Show waiting UI if timer is active */}
            {(waitTimerState.status === 'WAITING' || waitTimerState.status === 'EXPIRED') ? (
                renderWaitingUI()
            ) : (
                <>
                    {/* EC-11: Customer Not Home Button */}
                    {isInsideGeoFence && (
                        <Button
                            mode="outlined"
                            onPress={handleCustomerNotHome}
                            style={styles.button}
                            icon="account-off"
                            loading={isLoading}
                        >
                            Customer Not Home
                        </Button>
                    )}

                    <Button
                        mode="contained"
                        disabled={!isInsideGeoFence}
                        onPress={() => navigation.navigate('DeliveryCompletion')}
                        style={styles.button}
                    >
                        Proceed to Handover
                    </Button>
                </>
            )}

            {/* Geofence Info */}
            <Card style={styles.infoCard}>
                <Card.Content>
                    <Text style={styles.infoTitle}>Geofence Settings</Text>
                    <Text style={styles.infoText}>
                        Radius: {geofence.radiusMeters}m (adjustable for GPS errors)
                    </Text>
                </Card.Content>
            </Card>

            {/* EC-12: Address Update Modal */}
            <Portal>
                <Modal
                    visible={showAddressModal}
                    onDismiss={() => setShowAddressModal(false)}
                    contentContainerStyle={styles.modal}
                >
                    <Text variant="titleLarge" style={styles.modalTitle}>
                        Update Delivery Address
                    </Text>
                    <Text style={styles.modalSubtext}>
                        Current: {params.targetAddress}
                    </Text>

                    <TextInput
                        label="Correct Address"
                        value={newAddress}
                        onChangeText={setNewAddress}
                        mode="outlined"
                        style={styles.input}
                        multiline
                    />

                    <TextInput
                        label="Reason for Update"
                        value={addressReason}
                        onChangeText={setAddressReason}
                        mode="outlined"
                        style={styles.input}
                        placeholder="e.g., Wrong building number"
                    />

                    <View style={styles.modalActions}>
                        <Button onPress={() => setShowAddressModal(false)}>
                            Cancel
                        </Button>
                        <Button
                            mode="contained"
                            onPress={handleAddressUpdate}
                            loading={isLoading}
                        >
                            Submit Update
                        </Button>
                    </View>
                </Modal>
            </Portal>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    content: {
        padding: 20,
        paddingBottom: 40,
    },
    title: {
        textAlign: 'center',
        marginBottom: 24,
        fontWeight: 'bold',
    },
    statusCard: {
        marginBottom: 16,
        borderWidth: 3,
        borderRadius: 12,
    },
    statusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    distance: {
        fontSize: 14,
        color: '#666',
        fontWeight: '600',
    },
    statusText: {
        color: '#666',
        marginBottom: 12,
    },
    addressContainer: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
    },
    addressLabel: {
        fontSize: 12,
        color: '#888',
        marginBottom: 4,
    },
    address: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 8,
    },
    button: {
        marginBottom: 12,
    },
    waitCard: {
        marginVertical: 16,
        backgroundColor: '#fff8e1',
        borderColor: '#ffc107',
        borderWidth: 2,
    },
    timerContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    timerLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#f59e0b',
        letterSpacing: 1,
    },
    timerDisplay: {
        fontSize: 64,
        fontWeight: 'bold',
        fontFamily: 'monospace',
        color: '#d97706',
    },
    timerSubtext: {
        fontSize: 14,
        color: '#666',
    },
    photoPreview: {
        backgroundColor: '#e8f5e9',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
    },
    photoLabel: {
        color: '#2e7d32',
        textAlign: 'center',
        fontWeight: '500',
    },
    waitActions: {
        gap: 12,
    },
    infoCard: {
        marginTop: 8,
        backgroundColor: '#f0f9ff',
    },
    infoTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#0369a1',
        marginBottom: 4,
    },
    infoText: {
        fontSize: 13,
        color: '#666',
    },
    modal: {
        backgroundColor: 'white',
        padding: 24,
        margin: 20,
        borderRadius: 12,
    },
    modalTitle: {
        marginBottom: 8,
    },
    modalSubtext: {
        color: '#666',
        marginBottom: 16,
    },
    input: {
        marginBottom: 12,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 8,
    },
});
