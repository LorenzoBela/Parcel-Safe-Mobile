import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, ScrollView, Platform, Linking } from 'react-native';
import { Text, Button, Card, TextInput, Portal, Modal, IconButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';

import * as ImagePicker from 'expo-image-picker';

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
    calculateDistanceMeters,
    GeofenceConfig,
    CONFIG as GeoConfig,
} from '../../services/addressUpdateService';

import {
    startBackgroundLocation,
    stopBackgroundLocation,
    isBackgroundLocationRunning,
    subscribeToBackgroundLocationState,
    setTrackingPhase,
    BackgroundLocationState,
} from '../../services/backgroundLocationService';

import {
    subscribeToLocation,
    subscribeToLockout,
    LockoutState,
    subscribeToBattery,
    BatteryState,
    subscribeToTamper,
    TamperState,
    // EC-97: Low-Light Detection
    subscribeToLowLight,
    LowLightState,
    isLowLightFallbackRequired,
    getLowLightMessage,
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
import { subscribeToDelivery, updateDeliveryStatus } from '../../services/riderMatchingService';
import useAuthStore from '../../store/authStore';
import SwipeConfirmButton from '../../components/SwipeConfirmButton';
import { uploadPickupPhoto } from '../../services/proofPhotoService';

interface RouteParams {
    deliveryId: string;
    boxId: string;
    targetLat: number;
    targetLng: number;
    targetAddress: string;
    customerPhone?: string;
    riderName?: string;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ArrivalScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const params = route.params as RouteParams | undefined;
    const insets = useSafeAreaInsets();

    if (!params?.deliveryId || !params?.boxId) {
        return (
            <View style={[styles.container, { justifyContent: 'center', padding: 24 }]}>
                <Text variant="titleMedium" style={{ marginBottom: 12 }}>
                    Missing delivery context.
                </Text>
                <Button mode="contained" onPress={() => navigation.goBack()}>
                    Go Back
                </Button>
            </View>
        );
    }

    // Geofence State
    // EC-XX: Dual-Check Geofence State
    const [isInsideGeoFence, setIsInsideGeoFence] = useState(false); // Master switch (Phone && (Box || Offline))
    const [isPhoneInside, setIsPhoneInside] = useState(false);
    const [isBoxInside, setIsBoxInside] = useState(false);
    const [isBoxOffline, setIsBoxOffline] = useState(false);
    const [boxLocationLastSeen, setBoxLocationLastSeen] = useState<number>(0);

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
    const [pickupPhotoUri, setPickupPhotoUri] = useState<string | null>(null);
    const [pickupPhotoUrl, setPickupPhotoUrl] = useState<string | null>(null);

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

    // EC-97: Low-Light State
    const [lowLightState, setLowLightState] = useState<LowLightState | null>(null);
    const tamperDeliveryFlaggedRef = useRef(false);

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
    const [hasBeenInsideGeofence, setHasBeenInsideGeofence] = useState(false);
    const [autoPickupFallbackApplied, setAutoPickupFallbackApplied] = useState(false);
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const riderId = authedUserId;
    const [deliveryStatus, setDeliveryStatus] = useState<string>('ASSIGNED');

    // EC-15: Background location starts automatically when screen mounts
    useEffect(() => {
        if (!isBackgroundLocationRunning()) {
            startBackgroundLocation(params.boxId);
        }
        // EC-15: Switch to ARRIVAL phase for maximum GPS precision near destination
        setTrackingPhase('ARRIVAL');

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
                if (!tamperDeliveryFlaggedRef.current) {
                    tamperDeliveryFlaggedRef.current = true;
                    updateDeliveryStatus(params.deliveryId, 'TAMPERED', {
                        tampered_at: Date.now(),
                        tamper_lockdown: Boolean(state.lockdown),
                    });
                }
                Alert.alert(
                    'SECURITY ALERT',
                    'Box tamper detected! The box is now in lockdown mode. Contact support.',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
            }
        });

        // EC-97: Subscribe to low-light state
        const unsubscribeLowLight = subscribeToLowLight(params.boxId, (state) => {
            setLowLightState(state);
            if (state && isLowLightFallbackRequired(state)) {
                Alert.alert(
                    '📷 Low Light Condition',
                    'Camera cannot detect face due to poor lighting. Alternative verification will be required.',
                    [{ text: 'OK' }]
                );
            }
        });

        return () => {
            unsubscribeBgLocation();
            unsubscribeLockout();
            unsubscribeBattery();
            unsubscribeTamper();
            unsubscribeLowLight();
        };
    }, [params.boxId, params.deliveryId]);

    const [deliveryOtp, setDeliveryOtp] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = subscribeToDelivery(params.deliveryId, (delivery) => {
            if (!delivery?.status) {
                return;
            }
            setDeliveryStatus(delivery.status);
        });

        // Fetch OTP from Supabase (source of truth for OTP)
        const fetchOtp = async () => {
            try {
                const { supabase } = await import('../../services/supabaseClient');
                if (supabase) {
                    const { data } = await supabase
                        .from('deliveries')
                        .select('otp_code')
                        .eq('id', params.deliveryId)
                        .single();
                    if (data?.otp_code) {
                        setDeliveryOtp(data.otp_code);
                    }
                }
            } catch (e) {
                console.error('[ArrivalScreen] Failed to fetch OTP:', e);
            }
        };
        fetchOtp();

        return unsubscribe;
    }, [params.deliveryId]);

    const isPickupConfirmed = ['IN_TRANSIT', 'COMPLETED'].includes(deliveryStatus);

    // 1. Track PHONE Location (The "Golden Rule")
    useEffect(() => {
        let subscription: Location.LocationSubscription | null = null;

        const startPhoneTracking = async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Phone location is required to verify arrival.');
                return;
            }

            subscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 2000,
                    distanceInterval: 5,
                },
                (location) => {
                    const position = {
                        lat: location.coords.latitude,
                        lng: location.coords.longitude,
                        accuracy: location.coords.accuracy || 25,
                    };

                    // Update current position for UI/Map
                    setCurrentPosition(position);

                    // Check if Phone is inside
                    const result = checkGeofence(position, geofence);
                    setIsPhoneInside(result.isInside);
                    setDistanceMeters(result.distanceMeters); // Distance from Phone to Target

                    if (result.isInside) {
                        setHasBeenInsideGeofence(true);
                    }
                }
            );
        };

        startPhoneTracking();

        return () => {
            if (subscription) {
                subscription.remove();
            }
        };
    }, [geofence]);

    // 2. Track BOX Location (The "Secondary Check")
    useEffect(() => {
        const unsubscribeLocation = subscribeToLocation(params.boxId, (location) => {
            if (!location) {
                setIsBoxOffline(true);
                return;
            }

            const now = Date.now();
            const dataTimestamp = location.server_timestamp || location.timestamp || 0;
            const isStale = (now - dataTimestamp) > 120000; // 2 minutes

            setBoxLocationLastSeen(dataTimestamp);
            setIsBoxOffline(isStale);

            if (!isStale) {
                const position = {
                    lat: location.latitude,
                    lng: location.longitude,
                    accuracy: 15, // Assume acceptable accuracy for Box GPS
                };
                const result = checkGeofence(position, geofence);
                setIsBoxInside(result.isInside);
            }
        });

        return unsubscribeLocation;
    }, [geofence, params.boxId]);

    // 3. The "Master Switch" (Dual Check Logic)
    useEffect(() => {
        // Rule 1: Phone MUST be inside
        if (!isPhoneInside) {
            setIsInsideGeoFence(false);
            return;
        }

        // Rule 2: Box MUST be inside OR Box is Offline (Fallback)
        // If Box is online and reporting location, it must be close.
        // If Box is offline/stale, we trust the Rider's phone location (Fallback).
        if (isBoxOffline) {
            setIsInsideGeoFence(true); // Allow fallback
        } else {
            setIsInsideGeoFence(isBoxInside); // Strict check
        }
    }, [isPhoneInside, isBoxInside, isBoxOffline]);

    useEffect(() => {
        const canAutoRecoverPickup = ['ASSIGNED', 'PICKUP_PENDING', 'ARRIVED'].includes(deliveryStatus);

        if (!hasBeenInsideGeofence || isInsideGeoFence || isPickupConfirmed || autoPickupFallbackApplied || !canAutoRecoverPickup) {
            return;
        }

        // EC-XX: Refined Auto-Pickup Logic (100m Buffer)
        // Check distance from pickup point to prevent premature trigger
        const distanceFromPickup = calculateDistanceMeters(
            currentPosition.lat,
            currentPosition.lng,
            geofence.centerLat,
            geofence.centerLng
        );

        // Only trigger if rider is significantly away (> 100m)
        if (distanceFromPickup < 100) {
            return;
        }

        setAutoPickupFallbackApplied(true);

        // Auto-pickup without a photo is blocked; alert rider to take photo first
        if (!pickupPhotoUri) {
            Alert.alert(
                'Photo Required',
                'Please capture a pickup photo before the system can auto-confirm pickup.',
                [{ text: 'OK' }]
            );
            setAutoPickupFallbackApplied(false);
            return;
        }

        const applyAutoPickupFallback = async () => {
            // Upload pickup photo first
            const uploadResult = await uploadPickupPhoto({
                deliveryId: params.deliveryId,
                boxId: params.boxId,
                localUri: pickupPhotoUri,
            });

            if (!uploadResult.success) {
                setAutoPickupFallbackApplied(false);
                return;
            }
            setPickupPhotoUrl(uploadResult.url || null);

            const now = Date.now();
            const pickedUpOk = await updateDeliveryStatus(params.deliveryId, 'IN_TRANSIT', {
                picked_up_at: now,
                pickup_confirmed_fallback: true,
                pickup_fallback_reason: 'AUTO_GEOFENCE_EXIT',
                in_transit_at: now,
                in_transit_reason: 'AUTO_GEOFENCE_EXIT',
                pickup_photo_url: uploadResult.url,
            });

            if (!pickedUpOk) {
                setAutoPickupFallbackApplied(false);
                return;
            }

            // Removed redundant update call as IN_TRANSIT is set above

            setDeliveryStatus('IN_TRANSIT');
            Alert.alert(
                'Auto Recovery Applied',
                'Pickup was auto-confirmed because geofence exit was detected after arrival zone entry.'
            );
        };

        applyAutoPickupFallback();
    }, [
        autoPickupFallbackApplied,
        deliveryStatus,
        hasBeenInsideGeofence,
        isInsideGeoFence,
        isPickupConfirmed,
        params.deliveryId,
        currentPosition,
        geofence,
    ]);

    const ensurePickupConfirmed = useCallback(async () => {
        if (isPickupConfirmed) {
            return true;
        }

        if (!pickupPhotoUri) {
            Alert.alert('Photo Required', 'Please capture a pickup photo before confirming pickup.');
            return false;
        }

        // Upload pickup photo first
        const uploadResult = await uploadPickupPhoto({
            deliveryId: params.deliveryId,
            boxId: params.boxId,
            localUri: pickupPhotoUri,
        });

        if (!uploadResult.success) {
            Alert.alert('Upload Failed', 'Pickup photo upload failed. Please retry.');
            return false;
        }
        setPickupPhotoUrl(uploadResult.url || null);

        const success = await updateDeliveryStatus(params.deliveryId, 'IN_TRANSIT', {
            picked_up_at: Date.now(),
            pickup_confirmed_fallback: true,
            in_transit_at: Date.now(),
            pickup_photo_url: uploadResult.url,
        });

        if (!success) {
            Alert.alert('Action Failed', 'Could not update pickup status. Please try again.');
            return false;
        }

        setDeliveryStatus('IN_TRANSIT');
        return true;
    }, [isPickupConfirmed, params.deliveryId, params.boxId, pickupPhotoUri]);

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
            Alert.alert('Camera Error', 'Unable to capture pickup photo right now.');
        }
    };

    const handlePickupSwipe = async () => {
        if (!isInsideGeoFence) {
            Alert.alert('Location Required', 'Check GPS first and move inside the geofence before confirming pickup.');
            return;
        }

        if (!pickupPhotoUri) {
            Alert.alert('Photo Required', 'Please capture a pickup photo before confirming pickup.');
            return;
        }

        setIsLoading(true);
        try {
            // Upload pickup photo first
            const uploadResult = await uploadPickupPhoto({
                deliveryId: params.deliveryId,
                boxId: params.boxId,
                localUri: pickupPhotoUri,
            });

            if (!uploadResult.success) {
                Alert.alert('Upload Failed', 'Pickup photo upload failed. Please retry.');
                return;
            }
            setPickupPhotoUrl(uploadResult.url || null);

            const success = await updateDeliveryStatus(params.deliveryId, 'IN_TRANSIT', {
                picked_up_at: Date.now(),
                in_transit_at: Date.now(),
                pickup_photo_url: uploadResult.url,
            });

            if (!success) {
                Alert.alert('Action Failed', 'Unable to confirm pickup right now.');
                return;
            }

            setDeliveryStatus('IN_TRANSIT');
            Alert.alert('Pickup Confirmed', 'Package marked as picked up. Continue to handover flow.');
        } finally {
            setIsLoading(false);
        }
    };

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

    // EC-11: Start wait timer (Customer Not Home)
    const handleCustomerNotHome = async () => {
        setIsLoading(true);

        let photoUri: string | null = null;

        // Capture arrival photo
        try {
            const photoResult = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.6,
                allowsEditing: false,
            });

            if (!photoResult.canceled && photoResult.assets?.[0]) {
                photoUri = photoResult.assets[0].uri;
                setArrivalPhotoUri(photoUri);
            }
        } catch (e) {
            console.log('[ArrivalScreen] Camera error:', e);
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
    const handleCustomerArrived = async () => {
        const pickupOk = await ensurePickupConfirmed();
        if (!pickupOk) {
            return;
        }

        const newState = markCustomerArrived(waitTimerState);
        setWaitTimerState(newState);
        writeWaitTimerToFirebase(newState);
        navigation.navigate('DeliveryCompletion', {
            deliveryId: params.deliveryId,
            boxId: params.boxId,
        });
    };

    const handleProceedToHandover = async () => {
        const pickupOk = await ensurePickupConfirmed();
        if (!pickupOk) {
            return;
        }

        if (isInsideGeoFence && !['ARRIVED', 'COMPLETED'].includes(deliveryStatus)) {
            await updateDeliveryStatus(params.deliveryId, 'ARRIVED', {
                arrived_at: Date.now(),
            });
        }

        navigation.navigate('DeliveryCompletion', {
            deliveryId: params.deliveryId,
            boxId: params.boxId,
        });
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
        if (!deliveryOtp) {
            Alert.alert('OTP Unavailable', 'Could not retrieve the delivery OTP. Please try again.');
            return;
        }

        setShowBleModal(true);
        setBleStatus('scanning');
        setBleMessage('Scanning for nearby box...');

        try {
            const result = await bleOtpService.sendOtpToBox(
                params.boxId,
                deliveryOtp,
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
                riderId: riderId || '',
                riderName: params.riderName,
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

    const handleNavigate = () => {
        // Check for valid coordinates (not null/undefined and not 0,0)
        const hasCoords = params?.targetLat && params?.targetLng && (params.targetLat !== 0 || params.targetLng !== 0);

        if (hasCoords) {
            const latLng = `${params!.targetLat},${params!.targetLng}`;
            const label = params?.targetAddress || 'Destination';

            // EC-FIX: Use precise coordinates in prefix AND query
            const url = Platform.select({
                ios: `maps:?ll=${latLng}&q=${label}`,
                android: `geo:${latLng}?q=${latLng}(${label})`
            });
            if (url) Linking.openURL(url);
        } else {
            // Fallback if coordinates missing
            if (params?.targetAddress) {
                const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
                const url = Platform.select({
                    ios: `${scheme}${params.targetAddress}`,
                    android: `${scheme}${params.targetAddress}`
                });
                if (url) Linking.openURL(url);
            }
        }
    };

    // EC-12: Render System Status (Horizontal Scroll)
    const renderSystemStatus = () => {
        const statuses = [];

        // Tamper (Always Critical - Keep as full banner above, but also show here if we want, or skip)
        // Leaving Tamper as full banner because it's a security emergency.

        // Lockout
        if (lockoutState?.active) {
            statuses.push(
                <Card key="lockout" style={[styles.statusPill, styles.statusPillError]}>
                    <View style={styles.pillContent}>
                        <Text style={styles.pillIcon}>🔒</Text>
                        <View>
                            <Text style={[styles.pillTitle, styles.textError]}>LOCKED</Text>
                            <Text style={[styles.pillText, styles.textError]}>{lockoutCountdown}</Text>
                        </View>
                    </View>
                </Card>
            );
        }

        // Battery
        if (batteryState?.lowBatteryWarning) {
            const isCritical = batteryState.criticalBatteryWarning;
            statuses.push(
                <Card key="battery" style={[styles.statusPill, isCritical ? styles.statusPillError : styles.statusPillWarning]}>
                    <View style={styles.pillContent}>
                        <Text style={styles.pillIcon}>{isCritical ? '🔴' : '🟡'}</Text>
                        <View>
                            <Text style={[styles.pillTitle, isCritical ? styles.textError : styles.textWarning]}>
                                {isCritical ? 'CRITICAL' : 'BATTERY'}
                            </Text>
                            <Text style={[styles.pillText, isCritical ? styles.textError : styles.textWarning]}>
                                {batteryState.percentage}%
                            </Text>
                        </View>
                    </View>
                </Card>
            );
        }

        // GPS
        if (bgLocationState && bgLocationState.status !== 'RUNNING') {
            statuses.push(
                <Card key="gps" style={[styles.statusPill, styles.statusPillInfo]}>
                    <View style={styles.pillContent}>
                        <Text style={styles.pillIcon}>📍</Text>
                        <View>
                            <Text style={[styles.pillTitle, styles.textInfo]}>GPS PAUSED</Text>
                            <Text style={[styles.pillText, styles.textInfo]}>Check Settings</Text>
                        </View>
                    </View>
                </Card>
            );
        }

        // Low Light
        if (lowLightState?.isLowLight) {
            const isCritical = lowLightState.fallbackRequired;
            statuses.push(
                <Card key="light" style={[styles.statusPill, isCritical ? styles.statusPillError : styles.statusPillWarning]}>
                    <View style={styles.pillContent}>
                        <Text style={styles.pillIcon}>{isCritical ? '📷' : '🌙'}</Text>
                        <View>
                            <Text style={[styles.pillTitle, isCritical ? styles.textError : styles.textWarning]}>
                                {isCritical ? 'FALLBACK' : 'LOW LIGHT'}
                            </Text>
                            <Text style={[styles.pillText, isCritical ? styles.textError : styles.textWarning]}>
                                {isCritical ? 'FaceID N/A' : 'Flash On'}
                            </Text>
                        </View>
                    </View>
                </Card>
            );
        }

        if (statuses.length === 0) return null;

        return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.systemStatusContainer} contentContainerStyle={styles.systemStatusContent}>
                {statuses}
            </ScrollView>
        );
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>
            {/* Critical Security Alerts (Full Width) */}
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

            {/* System Status Pills */}
            {renderSystemStatus()}

            <Text variant="headlineMedium" style={styles.pageTitle}>
                Arrival & Verification
            </Text>

            {/* New Visual Geofence Card */}
            <Card mode="elevated" style={[styles.statusCard, isInsideGeoFence ? styles.borderSuccess : styles.borderError]}>
                <Card.Content>
                    <View style={styles.statusHeader}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: '#333' }}>
                            Verification Zone
                        </Text>
                        {distanceMeters !== null && (
                            <View style={styles.distanceBadge}>
                                <Text style={styles.distanceText}>{distanceMeters}m away</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.checksContainer}>
                        {/* Phone Status */}
                        <View style={styles.checkItem}>
                            <View style={[styles.checkCircle, isPhoneInside ? styles.bgSuccess : styles.bgError]}>
                                <Text style={styles.checkIcon}>{isPhoneInside ? '✓' : '✗'}</Text>
                            </View>
                            <Text style={styles.checkLabel}>Phone GPS</Text>
                        </View>

                        <View style={styles.checkDivider} />

                        {/* Box Status */}
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
                                ? (isBoxOffline ? '⚠️ Box is offline. Using Phone GPS backup.' : 'You are at the location.')
                                : (!isPhoneInside
                                    ? 'Move closer to the drop-off point.'
                                    : 'Phone is here, but Box is detected elsewhere.')}
                        </Text>
                    </View>

                    {/* Address & Navigation */}
                    <View style={styles.addressRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.addressLabel}>TARGET ADDRESS</Text>
                            <Text numberOfLines={2} style={styles.address}>{params.targetAddress}</Text>
                        </View>
                        <View style={styles.navActions}>
                            <IconButton
                                icon="map-marker-question"
                                size={20}
                                onPress={() => setShowAddressModal(true)}
                            />
                            <IconButton
                                icon="navigation"
                                mode="contained"
                                containerColor="#E3F2FD"
                                iconColor="#1976D2"
                                size={24}
                                onPress={handleNavigate}
                            />
                        </View>
                    </View>
                </Card.Content>
            </Card>

            {!isPickupConfirmed && (
                <Card style={styles.actionCard}>
                    <Card.Content>
                        <Text style={styles.actionTitle}>Step 1: Confirm Pickup</Text>
                        <View style={{ marginTop: 12 }}>
                            <Button
                                mode="outlined"
                                icon="camera"
                                onPress={handleCapturePickupPhoto}
                                disabled={isLoading}
                            >
                                {pickupPhotoUri ? 'Retake pickup photo' : 'Capture pickup photo (required)'}
                            </Button>
                            {pickupPhotoUri ? (
                                <Text style={{ marginTop: 6, color: '#16a34a', textAlign: 'center' }}>
                                    ✅ Pickup photo ready{pickupPhotoUrl ? ' (uploaded)' : ''}.
                                </Text>
                            ) : (
                                <Text style={{ marginTop: 6, color: '#6b7280', textAlign: 'center' }}>
                                    A pickup photo is required to proceed.
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
                        <Button
                            mode="text"
                            compact
                            labelStyle={{ fontSize: 12, color: '#666' }}
                            style={{ marginTop: 8, alignSelf: 'center' }}
                            onPress={ensurePickupConfirmed}
                            disabled={!pickupPhotoUri || isLoading}
                        >
                            Trouble? Use Fallback
                        </Button>
                    </Card.Content>
                </Card>
            )}

            {/* Show waiting UI if timer is active */}
            {(waitTimerState.status === 'WAITING' || waitTimerState.status === 'EXPIRED') ? (
                renderWaitingUI()
            ) : (
                <>
                    {/* Customer Not Home Button */}
                    {isInsideGeoFence && (
                        <Button
                            mode="outlined"
                            onPress={handleCustomerNotHome}
                            style={styles.auxButton}
                            icon="account-off"
                            textColor="#555"
                            loading={isLoading}
                        >
                            Customer Not Home
                        </Button>
                    )}

                    {!(!isPickupConfirmed) && ( // Ensure we don't show Arrival swipe if Pickup isn't done, though logic handles flow
                        <View style={{ marginTop: 24, paddingHorizontal: 4 }}>
                            <Text style={[styles.actionTitle, { marginBottom: 16, marginLeft: 4 }]}>Step 2: Confirm Arrival</Text>
                            <SwipeConfirmButton
                                label="Swipe to Arrive"
                                onConfirm={handleProceedToHandover}
                                disabled={!isInsideGeoFence || isLoading}
                            />
                        </View>
                    )}
                </>
            )}

            {/* Helper Cards (BLE, Cancel) */}
            <View style={styles.helperCardsRow}>
                {/* BLE Card */}
                <Card style={[styles.helperCard, styles.bleCard]} onPress={handleBleTransfer}>
                    <Card.Content style={styles.helperCardContent}>
                        <View style={styles.helperIconContainer}>
                            <Text style={{ fontSize: 20 }}>📡</Text>
                        </View>
                        <View>
                            <Text style={styles.helperTitle}>BLE Transfer</Text>
                            <Text style={styles.helperText}>Send OTP Manually</Text>
                        </View>
                    </Card.Content>
                </Card>

                {/* Cancel Card */}
                <Card style={[styles.helperCard, styles.cancelCard]} onPress={() => setShowCancelModal(true)}>
                    <Card.Content style={styles.helperCardContent}>
                        <View style={styles.helperIconContainer}>
                            <Text style={{ fontSize: 20 }}>❌</Text>
                        </View>
                        <View>
                            <Text style={[styles.helperTitle, { color: '#ef4444' }]}>Cancel</Text>
                            <Text style={styles.helperText}>Abort Delivery</Text>
                        </View>
                    </Card.Content>
                </Card>
            </View>

            {/* Modals ... */}
            {/* ... keeping existing modals ... */}
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
        backgroundColor: '#f8f9fa', // Lighter gray for better contrast
    },
    content: {
        flexGrow: 1,
        paddingHorizontal: 16,
    },
    pageTitle: {
        textAlign: 'center',
        marginBottom: 20,
        fontWeight: 'bold',
        color: '#1a1a1a',
    },

    // System Status Container
    systemStatusContainer: {
        marginBottom: 20,
    },
    systemStatusContent: {
        gap: 12,
        paddingRight: 16, // Padding for horizontal scroll
    },
    statusPill: {
        width: 130, // Fixed width cards for horizontal scroll
        borderRadius: 16,
        elevation: 2,
    },
    pillContent: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        paddingVertical: 10,
    },
    pillIcon: {
        fontSize: 20,
        marginRight: 8,
    },
    pillTitle: {
        fontSize: 10,
        fontWeight: 'bold',
        textTransform: 'uppercase',
    },
    pillText: {
        fontSize: 12,
        fontWeight: '600',
    },

    // Status Colors
    statusPillError: { backgroundColor: '#FEE2E2', borderLeftWidth: 4, borderLeftColor: '#EF4444' }, // Red-ish
    statusPillWarning: { backgroundColor: '#FEF3C7', borderLeftWidth: 4, borderLeftColor: '#F59E0B' }, // Amber
    statusPillInfo: { backgroundColor: '#DBEAFE', borderLeftWidth: 4, borderLeftColor: '#3B82F6' }, // Blue
    textError: { color: '#B91C1C' },
    textWarning: { color: '#B45309' },
    textInfo: { color: '#1E40AF' },
    textSuccess: { color: '#15803d' },

    // Geofence Card (Verification Zone)
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

    // Checks (Phone/Box)
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
        top: -14, // align with circles
    },

    // Status Message Box
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

    // Address
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

    // Action Card
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

    // Helper Buttons Row
    helperCardsRow: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 10,
        marginBottom: 30,
    },
    helperCard: {
        flex: 1,
        borderRadius: 12,
    },
    helperCardContent: {
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    helperIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f5f5f5',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    helperTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#333',
    },
    helperText: {
        fontSize: 10,
        color: '#666',
    },
    bleCard: { backgroundColor: '#F0F9FF', borderLeftWidth: 0 },
    cancelCard: { backgroundColor: '#FEF2F2', borderLeftWidth: 0 },

    // BLE Modal
    bleModal: {
        backgroundColor: 'white',
        padding: 20,
        margin: 20,
        borderRadius: 12,
        alignItems: 'center',
    },
    bleStatusContainer: {
        marginBottom: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bleStatusIcon: {
        fontSize: 48,
        marginBottom: 8,
    },
    bleStatusText: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
    },
    bleMessageText: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 20,
    },
    bleActions: {
        width: '100%',
        gap: 10,
    },

    // Generic Modal & Forms
    modal: {
        backgroundColor: 'white',
        padding: 20,
        margin: 20,
        borderRadius: 12,
    },
    modalTitle: {
        textAlign: 'center',
        fontWeight: 'bold',
        marginBottom: 8,
    },
    modalSubtext: {
        textAlign: 'center',
        color: '#666',
        marginBottom: 20,
    },
    input: {
        marginBottom: 12,
        backgroundColor: 'white',
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 16,
    },
    button: {
        marginTop: 8,
        borderColor: '#ccc',
    },

    // Misc (retained)
    auxButton: {
        marginTop: 10,
        borderColor: '#ccc',
    },

    // Waiting UI (Updated slightly)
    waitCard: {
        marginVertical: 16,
        backgroundColor: '#fffbeb',
        borderColor: '#fbbf24',
        borderWidth: 2,
        borderRadius: 16,
    },
    timerContainer: { alignItems: 'center', marginBottom: 20 },
    timerLabel: { fontSize: 12, fontWeight: '800', color: '#b45309', letterSpacing: 1.5 },
    timerDisplay: { fontSize: 64, fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: '#d97706' },
    timerSubtext: { fontSize: 14, color: '#78350f' },
    photoPreview: { backgroundColor: '#ecfccb', padding: 12, borderRadius: 8, marginBottom: 16 },
    photoLabel: { color: '#365314', textAlign: 'center', fontWeight: 'bold' },
    waitActions: { gap: 12 },

    // Retained for critical banner compatibility if needed
    bannerContent: { flexDirection: 'row', alignItems: 'center' },
    bannerIcon: { fontSize: 24, marginRight: 12 },
    tamperBanner: { backgroundColor: '#DC2626', marginBottom: 12, borderRadius: 12 },
    tamperTitle: { color: 'white', fontWeight: 'bold', fontSize: 14 },
    tamperText: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
});
