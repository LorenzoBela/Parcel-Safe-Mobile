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
    subscribeToBackgroundLocationState,
    BackgroundLocationState,
} from '../../services/backgroundLocationService';

import {
    subscribeToLockout,
    LockoutState,
    subscribeToBattery,
    BatteryState,
    subscribeToTamper,
    TamperState,
} from '../../services/firebaseClient';

import { bleOtpService, BleBoxDevice } from '../../services/bleOtpService';

// EC-32: Cancellation Service
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason } from '../../services/cancellationService';
import ReassignmentAlertModal from '../../components/ReassignmentAlertModal';
import {
    subscribeToReassignment,
    ReassignmentState,
    getReassignmentType,
    startAutoAckTimer,
    acknowledgeReassignment,
    isReassignmentPending
} from '../../services/deliveryReassignmentService';

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

    // EC-04: OTP Lockout State
    const [lockoutState, setLockoutState] = useState<LockoutState | null>(null);
    const [lockoutCountdown, setLockoutCountdown] = useState('');

    // EC-03: Battery State
    const [batteryState, setBatteryState] = useState<BatteryState | null>(null);

    // EC-18: Tamper State
    const [tamperState, setTamperState] = useState<TamperState | null>(null);

    // EC-15: Background Location State
    const [bgLocationState, setBgLocationState] = useState<BackgroundLocationState | null>(null);

    // EC-02: BLE Transfer State
    const [showBleModal, setShowBleModal] = useState(false);
    const [bleStatus, setBleStatus] = useState<'idle' | 'scanning' | 'connecting' | 'transferring' | 'success' | 'error'>('idle');
    const [bleMessage, setBleMessage] = useState('');

    // EC-32: Cancellation State
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);

    // EC-78: Delivery Reassignment State
    const [reassignmentState, setReassignmentState] = useState<ReassignmentState | null>(null);
    const [showReassignmentModal, setShowReassignmentModal] = useState(false);
    const riderId = 'RIDER_001'; // Should be dynamic in prod

    // EC-15: Background location starts automatically when screen mounts
    useEffect(() => {
        if (!isBackgroundLocationRunning()) {
            startBackgroundLocation(params.boxId);
        }

        // Subscribe to background location state
        const unsubscribeBgLocation = subscribeToBackgroundLocationState(setBgLocationState);

        // EC-04: Subscribe to OTP lockout state
        const unsubscribeLockout = subscribeToLockout(params.boxId, (state) => {
            setLockoutState(state);
            if (state?.active) {
                Alert.alert(
                    '🔒 OTP Lockout Active',
                    `Too many failed OTP attempts. Box is locked for ${Math.ceil((state.expires_at - Date.now()) / 60000)} minutes.`,
                    [{ text: 'OK' }]
                );
            }
        });

        // EC-03: Subscribe to battery state
        const unsubscribeBattery = subscribeToBattery(params.boxId, (state) => {
            setBatteryState(state);
            if (state?.criticalBatteryWarning) {
                Alert.alert(
                    '⚠️ Critical Battery',
                    `Box battery is critically low (${state.percentage}%). Complete delivery quickly!`,
                    [{ text: 'OK' }]
                );
            }
        });

        // EC-18: Subscribe to tamper state
        const unsubscribeTamper = subscribeToTamper(params.boxId, (state) => {
            setTamperState(state);
            if (state?.detected) {
                Alert.alert(
                    '🚨 SECURITY ALERT',
                    'Box tamper detected! The box is now in lockdown mode. Contact support.',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
            }
        });

        return () => {
            unsubscribeBgLocation();
            unsubscribeLockout();
            unsubscribeBattery();
            unsubscribeTamper();
        };
    }, [params.boxId]);

    // EC-04: Lockout countdown timer
    useEffect(() => {
        if (!lockoutState?.active) {
            setLockoutCountdown('');
            return;
        }

        const updateCountdown = () => {
            const now = Date.now();
            const remaining = lockoutState.expires_at - now;
            if (remaining <= 0) {
                setLockoutCountdown('Expired');
            } else {
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                setLockoutCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);
        return () => clearInterval(interval);
    }, [lockoutState]);

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

    // EC-02: BLE OTP Transfer
    const handleBleTransfer = async () => {
        setShowBleModal(true);
        setBleStatus('scanning');
        setBleMessage('Scanning for nearby box...');

        try {
            const result = await bleOtpService.sendOtpToBox(
                params.boxId,
                '123456', // Would come from delivery OTP
                params.deliveryId,
                {
                    onScanStart: () => {
                        setBleStatus('scanning');
                        setBleMessage('Scanning for nearby Smart Box...');
                    },
                    onDeviceFound: (device) => {
                        setBleMessage(`Found: ${device.name}`);
                    },
                    onConnecting: (name) => {
                        setBleStatus('connecting');
                        setBleMessage(`Connecting to ${name}...`);
                    },
                    onTransferring: () => {
                        setBleStatus('transferring');
                        setBleMessage('Transferring OTP...');
                    },
                    onSuccess: (name) => {
                        setBleStatus('success');
                        setBleMessage(`OTP sent to ${name} successfully!`);
                    },
                    onError: (error) => {
                        setBleStatus('error');
                        setBleMessage(error);
                    }
                }
            );

            if (!result.success) {
                setBleStatus('error');
                setBleMessage(result.message);
            }
        } catch (error) {
            setBleStatus('error');
            setBleMessage('BLE transfer failed');
        }
    };

    const closeBleModal = () => {
        setShowBleModal(false);
        setBleStatus('idle');
        setBleMessage('');
        bleOtpService.stopScan();
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

    // EC-32: Handle Cancellation Submit
    const handleCancellationSubmit = async (reason: CancellationReason, details: string) => {
        setCancelLoading(true);
        try {
            const result = await requestCancellation({
                deliveryId: params.deliveryId,
                boxId: params.boxId,
                reason,
                reasonDetails: details,
                riderId: 'RIDER_001', // Would come from auth in production
                riderName: params.riderName || 'Rider',
            });

            if (result.success) {
                setShowCancelModal(false);
                navigation.navigate('CancellationConfirmation', {
                    deliveryId: params.deliveryId,
                    returnOtp: result.returnOtp,
                    reason: reason,
                    reasonDetails: details,
                    senderName: 'Customer', // Would come from delivery data
                    pickupAddress: params.targetAddress,
                });
            } else {
                Alert.alert('Cancellation Failed', result.error || 'Unknown error');
            }
        } catch (err) {
            Alert.alert('Error', 'An unexpected error occurred');
        } finally {
            setCancelLoading(false);
        }
    };

    // EC-78: Subscribe to Reassignment Updates
    useEffect(() => {
        // Use params.boxId if available, or fallback to 'BOX_001' for demo
        const targetBoxId = params.boxId || 'BOX_001';
        const unsubscribe = subscribeToReassignment(targetBoxId, (state) => {
            setReassignmentState(state);
        });
        return unsubscribe;
    }, [params.boxId]);

    // EC-78: Handle Reassignment Modal and Timer
    useEffect(() => {
        if (reassignmentState && isReassignmentPending(reassignmentState)) {
            const type = getReassignmentType(reassignmentState, riderId);
            if (type) {
                setShowReassignmentModal(true);
                // Start auto-ack timer associated with this screen's context
                const cleanup = startAutoAckTimer(params.boxId || 'BOX_001', riderId, reassignmentState, () => {
                    handlePostAcknowledge(type);
                });
                return cleanup;
            }
        } else {
            setShowReassignmentModal(false);
        }
    }, [reassignmentState, riderId, params.boxId]);

    const handleReassignmentAcknowledge = async () => {
        if (reassignmentState) {
            await acknowledgeReassignment(params.boxId || 'BOX_001', riderId);
            const type = getReassignmentType(reassignmentState, riderId);
            handlePostAcknowledge(type);
        }
    };

    const handlePostAcknowledge = (type: 'outgoing' | 'incoming' | null) => {
        setShowReassignmentModal(false);
        if (type === 'outgoing') {
            // Delivery reassigned AWAY from this rider
            Alert.alert(
                'Delivery Reassigned',
                'This delivery has been assigned to another rider. Returning to dashboard.',
                [{ text: 'OK', onPress: () => navigation.navigate('RiderDashboard') }]
            );
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
            {/* EC-18: Tamper Alert Banner */}
            {tamperState?.detected && (
                <Card style={styles.tamperBanner}>
                    <Card.Content style={styles.bannerContent}>
                        <Text style={styles.bannerIcon}>🚨</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.tamperTitle}>SECURITY ALERT</Text>
                            <Text style={styles.tamperText}>Box tamper detected - Lockdown active</Text>
                        </View>
                    </Card.Content>
                </Card>
            )}

            {/* EC-04: OTP Lockout Banner */}
            {lockoutState?.active && (
                <Card style={styles.lockoutBanner}>
                    <Card.Content style={styles.bannerContent}>
                        <Text style={styles.bannerIcon}>🔒</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.lockoutTitle}>OTP LOCKOUT</Text>
                            <Text style={styles.lockoutText}>
                                {lockoutState.attempt_count} failed attempts • Unlocks in {lockoutCountdown}
                            </Text>
                        </View>
                    </Card.Content>
                </Card>
            )}

            {/* EC-03: Battery Warning Banner */}
            {batteryState?.lowBatteryWarning && (
                <Card style={[styles.batteryBanner, batteryState.criticalBatteryWarning && styles.criticalBattery]}>
                    <Card.Content style={styles.bannerContent}>
                        <Text style={styles.bannerIcon}>{batteryState.criticalBatteryWarning ? '🔴' : '🟡'}</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.batteryTitle, batteryState.criticalBatteryWarning && { color: 'white' }]}>
                                {batteryState.criticalBatteryWarning ? 'CRITICAL BATTERY' : 'LOW BATTERY'}
                            </Text>
                            <Text style={[styles.batteryText, batteryState.criticalBatteryWarning && { color: 'rgba(255,255,255,0.9)' }]}>
                                Box battery at {batteryState.percentage}%
                            </Text>
                        </View>
                    </Card.Content>
                </Card>
            )}

            {/* EC-15: Background Location Status */}
            {bgLocationState && bgLocationState.status !== 'RUNNING' && (
                <Card style={styles.bgLocationBanner}>
                    <Card.Content style={styles.bannerContent}>
                        <Text style={styles.bannerIcon}>📍</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.bgLocationTitle}>GPS TRACKING {bgLocationState.status}</Text>
                            <Text style={styles.bgLocationText}>
                                {bgLocationState.lastError || 'Background tracking not active'}
                            </Text>
                        </View>
                    </Card.Content>
                </Card>
            )}

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

            {/* EC-02: BLE OTP Transfer Card */}
            <Card style={styles.bleCard}>
                <Card.Content>
                    <Text style={styles.infoTitle}>📡 Box Offline?</Text>
                    <Text style={styles.infoText}>
                        If the box was offline during assignment, send OTP via Bluetooth.
                    </Text>
                    <Button
                        mode="outlined"
                        onPress={handleBleTransfer}
                        icon="bluetooth"
                        style={{ marginTop: 12 }}
                    >
                        Send OTP via Bluetooth
                    </Button>
                </Card.Content>
            </Card>

            {/* EC-32: Cancel Delivery Card */}
            <Card style={styles.cancelCard}>
                <Card.Content>
                    <Text style={styles.infoTitle}>⚠️ Need to Cancel?</Text>
                    <Text style={styles.infoText}>
                        If you cannot complete this delivery, you can cancel and return the package.
                    </Text>
                    <Button
                        mode="outlined"
                        onPress={() => setShowCancelModal(true)}
                        icon="cancel"
                        textColor="#ef4444"
                        style={{ marginTop: 12, borderColor: '#ef4444' }}
                    >
                        Cancel Delivery
                    </Button>
                </Card.Content>
            </Card>

            {/* EC-02: BLE Transfer Modal */}
            <Portal>
                <Modal
                    visible={showBleModal}
                    onDismiss={closeBleModal}
                    contentContainerStyle={styles.bleModal}
                >
                    <Text variant="titleLarge" style={{ marginBottom: 16, fontWeight: 'bold' }}>
                        BLE OTP Transfer
                    </Text>

                    <View style={styles.bleStatusContainer}>
                        {(bleStatus === 'scanning' || bleStatus === 'connecting' || bleStatus === 'transferring') && (
                            <Text style={styles.bleStatusIcon}>⏳</Text>
                        )}
                        {bleStatus === 'success' && <Text style={styles.bleStatusIcon}>✅</Text>}
                        {bleStatus === 'error' && <Text style={styles.bleStatusIcon}>❌</Text>}
                    </View>

                    <Text style={styles.bleStatusText}>
                        {bleStatus === 'scanning' ? 'Scanning...' :
                            bleStatus === 'connecting' ? 'Connecting...' :
                                bleStatus === 'transferring' ? 'Transferring...' :
                                    bleStatus === 'success' ? 'Success!' :
                                        bleStatus === 'error' ? 'Failed' : 'Ready'}
                    </Text>
                    <Text style={styles.bleMessageText}>{bleMessage}</Text>

                    <View style={styles.bleActions}>
                        {bleStatus === 'error' && (
                            <Button mode="contained" onPress={handleBleTransfer}>
                                Retry
                            </Button>
                        )}
                        {bleStatus === 'success' && (
                            <Button mode="contained" onPress={closeBleModal} buttonColor="#22c55e">
                                Done
                            </Button>
                        )}
                        <Button mode="outlined" onPress={closeBleModal} style={{ marginTop: 8 }}>
                            {bleStatus === 'success' ? 'Close' : 'Cancel'}
                        </Button>
                    </View>
                </Modal>
            </Portal>

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

            {/* EC-32: Cancellation Modal */}
            <CancellationModal
                visible={showCancelModal}
                onDismiss={() => setShowCancelModal(false)}
                onSubmit={handleCancellationSubmit}
                loading={cancelLoading}
            />

            {/* EC-78: Reassignment Alert Modal */}
            <ReassignmentAlertModal
                visible={showReassignmentModal}
                state={reassignmentState}
                type={getReassignmentType(reassignmentState, riderId)}
                onAcknowledge={handleReassignmentAcknowledge}
            />
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
    // EC-18: Tamper Banner
    tamperBanner: {
        backgroundColor: '#DC2626',
        marginBottom: 12,
        borderRadius: 12,
    },
    bannerContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bannerIcon: {
        fontSize: 24,
        marginRight: 12,
    },
    tamperTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    tamperText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 12,
    },
    // EC-04: Lockout Banner
    lockoutBanner: {
        backgroundColor: '#FFEDD5',
        marginBottom: 12,
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: '#EA580C',
    },
    lockoutTitle: {
        color: '#C2410C',
        fontWeight: 'bold',
        fontSize: 14,
    },
    lockoutText: {
        color: '#EA580C',
        fontSize: 12,
    },
    // EC-03: Battery Banner
    batteryBanner: {
        backgroundColor: '#FEF3C7',
        marginBottom: 12,
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: '#D97706',
    },
    criticalBattery: {
        backgroundColor: '#DC2626',
        borderLeftColor: '#DC2626',
    },
    batteryTitle: {
        color: '#92400E',
        fontWeight: 'bold',
        fontSize: 14,
    },
    batteryText: {
        color: '#B45309',
        fontSize: 12,
    },
    // EC-15: Background Location Banner
    bgLocationBanner: {
        backgroundColor: '#DBEAFE',
        marginBottom: 12,
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: '#2563EB',
    },
    bgLocationTitle: {
        color: '#1E40AF',
        fontWeight: 'bold',
        fontSize: 14,
    },
    bgLocationText: {
        color: '#3B82F6',
        fontSize: 12,
    },
    bleCard: {
        marginTop: 16,
        backgroundColor: '#EFF6FF',
        borderLeftWidth: 4,
        borderLeftColor: '#3B82F6',
    },
    // EC-32: Cancel Card
    cancelCard: {
        marginTop: 16,
        backgroundColor: '#FEF2F2',
        borderLeftWidth: 4,
        borderLeftColor: '#EF4444',
    },
    bleModal: {
        backgroundColor: 'white',
        padding: 24,
        margin: 20,
        borderRadius: 16,
    },
    bleStatusContainer: {
        alignItems: 'center',
        marginVertical: 24,
    },
    bleStatusIcon: {
        fontSize: 64,
    },
    bleStatusText: {
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 8,
    },
    bleMessageText: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 24,
    },
    bleActions: {
        alignItems: 'center',
    },
});
