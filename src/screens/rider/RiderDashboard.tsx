import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Switch, ImageBackground, Alert, RefreshControl, TouchableOpacity, Dimensions, Linking, Platform } from 'react-native';
import { Text, Card, Button, Avatar, ProgressBar, MD3Colors, Surface, Chip, useTheme, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import * as Location from 'expo-location';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import LottieView from 'lottie-react-native';
import { useLocationRedundancy, getStatusMessage, getStatusColor } from '../../hooks/useLocationRedundancy';
import { subscribeToBattery, BatteryState, subscribeToTamper, TamperState, subscribeToLocation, LocationData, subscribeToKeypad, KeypadState, subscribeToHinge, HingeState } from '../../services/firebaseClient';
import { offlineCache, PendingSync } from '../../services/offlineCache';
import { isSpeedAnomaly, isClockSyncRequired, canAddToPhotoQueue, isGpsStale, SAFETY_CONSTANTS } from '../../services/SafetyLogic';
import RecallService from '../../services/recallService';
// NetInfo - conditionally imported to prevent startup crashes
let NetInfo: any = null;
try {
    NetInfo = require('@react-native-community/netinfo').default;
} catch (error) {
    if (__DEV__) console.log('[RiderDashboard] NetInfo not available');
}
import IncomingOrderModal from '../../components/IncomingOrderModal';
import TripPreviewModal from '../../components/modals/TripPreviewModal';
import {
    subscribeToRiderRequests,
    acceptOrder,
    rejectOrder,
    updateRiderStatus,
    removeRiderFromOnline,
    RiderOrderRequest
} from '../../services/riderMatchingService';
import {
    registerForPushNotifications,
    setupNotificationChannels,
    showIncomingOrderNotification,
    addNotificationReceivedListener,
} from '../../services/pushNotificationService';
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
// EC-89: Token Refresh
import { SessionExpiryBanner } from '../../components/SessionExpiryBanner';
import {
    startTokenRefreshService,
    stopTokenRefreshService,
    getTokenStatus,
    TokenStatus,
    forceTokenRefresh,
} from '../../services/tokenRefreshService';
import statusUpdateService from '../../services/statusUpdateService';
import {
    BoxPairingState,
    isPairingActive,
    subscribeToRiderPairing,
} from '../../services/boxPairingService';
// EC-90: Power State
import { subscribeToPower, PowerState, isSolenoidBlockedByVoltage } from '../../services/firebaseClient';
import useAuthStore from '../../store/authStore';
import { fetchWeather, weatherBackgroundImages, WeatherData } from '../../services/weatherService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PAIRED_BOX_CACHE_KEY_PREFIX = 'parcelSafe:lastPairedBoxId:';

export default function RiderDashboard() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [isOnline, setIsOnline] = useState(true);
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [riderLocation, setRiderLocation] = useState<Location.LocationObject | null>(null);
    const [distance, setDistance] = useState<string>('Calculating...');
    const [isLocked, setIsLocked] = useState(true);
    const animationRef = useRef<LottieView>(null);

    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    // Route data for map
    const [routeGeometry, setRouteGeometry] = useState<any>(null);

    // EC-03: Battery Monitoring
    const [batteryState, setBatteryState] = useState<BatteryState | null>(null);

    // EC-18: Tamper Detection
    const [tamperState, setTamperState] = useState<TamperState | null>(null);

    // EC-82: Keypad State
    const [keypadState, setKeypadState] = useState<KeypadState | null>(null);

    // EC-83: Hinge State
    const [hingeState, setHingeState] = useState<HingeState | null>(null);

    // EC-01/EC-06: Offline Mode & Sync Status
    const [isOffline, setIsOffline] = useState(false);
    const [pendingSyncs, setPendingSyncs] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);

    // EC-08: GPS Spoofing Detection
    const [gpsSpoofWarning, setGpsSpoofWarning] = useState(false);
    const [lastGpsLocation, setLastGpsLocation] = useState<LocationData | null>(null);

    // EC-46: Clock Skew Warning
    const [clockSkewWarning, setClockSkewWarning] = useState(false);

    // EC-Update: Route Duration State
    const [duration, setDuration] = useState('-- min');

    // EC-10: Photo Queue Status
    const [photoQueueCount, setPhotoQueueCount] = useState(0);
    const [photoQueueFull, setPhotoQueueFull] = useState(false);

    // GPS Redundancy Hook - monitors box connectivity and handles failover
    const {
        source: gpsSource,
        isBoxOnline,
        phoneGpsActive,
        startMonitoring,
        activateTracking,
        deactivateTracking,
        gpsHealth // EC-84
    } = useLocationRedundancy();

    // EC-85: Recall State
    const [recallState, setRecallState] = useState<{ isRecalled: boolean; returnOtp: string | null }>({ isRecalled: false, returnOtp: null });

    // Incoming Order State (for rider matching)
    const [incomingRequest, setIncomingRequest] = useState<{ requestId: string; data: RiderOrderRequest } | null>(null);
    const [showOrderModal, setShowOrderModal] = useState(false);
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const authedUser = useAuthStore((state: any) => state.user) as any;
    const riderId = authedUserId;
    const riderName = authedUser?.fullName || authedUser?.name || undefined;
    const riderPhone = authedUser?.phone || undefined;
    const [pushToken, setPushToken] = useState<string | null>(null);
    const [pairingState, setPairingState] = useState<BoxPairingState | null>(null);
    const [cachedBoxId, setCachedBoxId] = useState<string | null>(null);

    // EC-32: Cancellation State
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);

    // EC-78: Delivery Reassignment State
    const [reassignmentState, setReassignmentState] = useState<ReassignmentState | null>(null);
    const [showReassignmentModal, setShowReassignmentModal] = useState(false);

    // EC-89: Token Refresh State
    const [tokenStatus, setTokenStatus] = useState<TokenStatus>('HEALTHY');

    // EC-90: Power State
    const [powerState, setPowerState] = useState<PowerState | null>(null);

    // Active delivery tracking
    const [hasActiveDelivery, setHasActiveDelivery] = useState(false);

    const isPaired = isPairingActive(pairingState);
    const pairedBoxId = pairingState?.box_id;
    const pairingModeLabel = pairingState?.mode === 'ONE_TIME' ? 'One-time' : 'Session';
    const boxIdForMonitoring = pairedBoxId ?? cachedBoxId;

    // Load last paired box id for cross-screen persistence.
    useEffect(() => {
        if (!riderId) {
            setCachedBoxId(null);
            return;
        }
        AsyncStorage.getItem(`${PAIRED_BOX_CACHE_KEY_PREFIX}${riderId}`)
            .then((value) => setCachedBoxId(value || null))
            .catch(() => setCachedBoxId(null));
    }, [riderId]);

    const [activeDelivery, setActiveDelivery] = useState<any>(null);

    // Dynamic delivery state — populated from real sources when available
    const nextDelivery = useMemo(() => activeDelivery ? {
        id: activeDelivery.id,
        boxId: activeDelivery.assigned_box_id || activeDelivery.box_id, // Ensure boxId is passed
        address: activeDelivery.dropoff_address,
        customer: activeDelivery.recipient_name || 'Customer',
        time: activeDelivery.expected_arrival || '--:--',
        phone: activeDelivery.recipient_phone || 'No Phone',
        pickupAddress: activeDelivery.pickup_address,
        pickupTime: activeDelivery.created_at ? dayjs(activeDelivery.created_at).format('h:mm A') : '--:--',
        dropoffTime: activeDelivery.expected_arrival ? dayjs(activeDelivery.expected_arrival).format('h:mm A') : '--:--',
        fare: activeDelivery.estimated_fare ? `₱${activeDelivery.estimated_fare}` : '--',
        distance: distance, // Updated by Mapbox
        estimatedTime: duration, // Updated by Mapbox
        packageType: 'Standard', // Default
        weight: 'N/A',
        priority: 'Standard',
        specialInstructions: activeDelivery.package_description || '',
        pickupLat: activeDelivery.pickup_lat,
        pickupLng: activeDelivery.pickup_lng,
        dropoffLat: activeDelivery.dropoff_lat,
        dropoffLng: activeDelivery.dropoff_lng,
    } : null, [activeDelivery, distance, duration]);

    // Use active delivery destination if available, otherwise default
    const destination = useMemo(() => nextDelivery ? {
        latitude: nextDelivery.dropoffLat,
        longitude: nextDelivery.dropoffLng,
        title: "Delivery Destination",
        description: nextDelivery.address
    } : {
        latitude: 14.5831,
        longitude: 120.9794,
        title: "Delivery Destination",
        description: "Rizal Park, Manila"
    }, [nextDelivery]);

    // Check for active deliveries
    useEffect(() => {
        if (!riderId) return;

        const checkActiveDeliveries = async () => {
            try {
                const { supabase } = await import('../../services/supabaseClient');
                if (!supabase) {
                    setHasActiveDelivery(false);
                    return;
                }
                const { data, error } = await supabase
                    .from('deliveries')
                    .select('*')
                    .eq('rider_id', riderId)
                    .in('status', ['ASSIGNED', 'PENDING', 'IN_TRANSIT', 'ARRIVED']) // EC-Update: Added ASSIGNED
                    .limit(1);

                if (!error && data && data.length > 0) {
                    setHasActiveDelivery(true);
                    setActiveDelivery(data[0]);
                } else {
                    setHasActiveDelivery(false);
                    setActiveDelivery(null);
                }
            } catch (err) {
                console.error('[RiderDashboard] Failed to check active deliveries:', err);
                setHasActiveDelivery(false);
                setActiveDelivery(null);
            }
        };

        checkActiveDeliveries();
        // Re-check every 30 seconds
        const interval = setInterval(checkActiveDeliveries, 30000);
        return () => clearInterval(interval);
    }, [riderId]);

    // Auto-start monitoring when component mounts
    useEffect(() => {
        if (boxIdForMonitoring) {
            startMonitoring(boxIdForMonitoring);
        }

        // EC-03: Subscribe to battery state
        // EC-03: Subscribe to battery state
        const unsubscribeBattery = boxIdForMonitoring ? subscribeToBattery(boxIdForMonitoring, (state) => {
            setBatteryState(state);

            // Show alert on low battery
            if (state?.lowBatteryWarning && !state?.criticalBatteryWarning) {
                Alert.alert(
                    'Low Battery Warning',
                    `Box battery is at ${state.percentage}%. Consider completing current delivery soon.`,
                    [{ text: 'OK' }]
                );
            } else if (state?.criticalBatteryWarning) {
                Alert.alert(
                    '⚠️ Critical Battery',
                    `Box battery is critically low at ${state.percentage}%! Delivery may fail if battery dies.`,
                    [{ text: 'Understood' }]
                );
            }
        }) : () => { };

        // EC-18: Subscribe to tamper state
        const unsubscribeTamper = subscribeToTamper(boxIdForMonitoring, (state) => {
            setTamperState(state);

            // Show critical alert on tamper detection
            if (state?.detected) {
                Alert.alert(
                    '🚨 SECURITY ALERT',
                    'Unauthorized access detected on your assigned box! The box is now in lockdown mode. Contact support immediately.',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
            }
        });

        // EC-01/EC-06: Monitor network connectivity
        const unsubscribeNetInfo = NetInfo
            ? NetInfo.addEventListener(state => {
                setIsOffline(!state.isConnected);
            })
            : null;

        // EC-08: Subscribe to GPS location for spoofing detection
        const unsubscribeLocation = subscribeToLocation(boxIdForMonitoring, (location) => {
            if (location && lastGpsLocation) {
                // Calculate distance using Haversine approximation
                const R = 6371000;
                const dLat = (location.latitude - lastGpsLocation.latitude) * Math.PI / 180;
                const dLon = (location.longitude - lastGpsLocation.longitude) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lastGpsLocation.latitude * Math.PI / 180) * Math.cos(location.latitude * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distanceMeters = R * c;

                const timeDelta = (location.timestamp - lastGpsLocation.timestamp) / 1000;
                if (timeDelta > 0 && isSpeedAnomaly(distanceMeters, timeDelta)) {
                    setGpsSpoofWarning(true);
                    Alert.alert(
                        '⚠️ GPS Anomaly Detected',
                        'Unusual location jump detected. This may indicate GPS issues or spoofing.',
                        [{ text: 'Dismiss', onPress: () => setGpsSpoofWarning(false) }]
                    );
                }

                // EC-46: Check for clock skew
                if (location.server_timestamp && isClockSyncRequired(location.server_timestamp)) {
                    setClockSkewWarning(true);
                }
            }
            setLastGpsLocation(location);
        });

        // EC-82: Subscribe to Keypad
        const unsubscribeKeypad = subscribeToKeypad(boxIdForMonitoring, (state) => {
            setKeypadState(state);
            if (state?.is_stuck) {
                Alert.alert(
                    '⚠️ Keypad Malfunction',
                    `Key '${state.stuck_key}' is stuck! You may need to use App Unlock for OTP.`,
                    [{ text: 'OK' }]
                );
            }
        });

        // EC-83: Subscribe to Hinge
        const unsubscribeHinge = subscribeToHinge(boxIdForMonitoring, (state) => {
            setHingeState(state);
            if (state?.status === 'DAMAGED') {
                Alert.alert(
                    '🚨 PHYSICAL DAMAGE DETECTED',
                    'Door sensor mismatch detected while locked. Inspect box immediately!',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
            }
        });

        return () => {
            deactivateTracking();
            unsubscribeBattery();
            unsubscribeTamper();
            unsubscribeNetInfo?.();
            unsubscribeLocation();
            unsubscribeKeypad();
            unsubscribeHinge();
        };
    }, [boxIdForMonitoring, lastGpsLocation]);

    // EC-01/EC-06: Check for pending syncs periodically
    useEffect(() => {
        const checkSyncStatus = async () => {
            const status = await offlineCache.getSyncStatus();
            setPendingSyncs(status.pendingCount);
            setPhotoQueueCount(status.pendingCount);
            setPhotoQueueFull(!canAddToPhotoQueue(status.pendingCount));
        };

        checkSyncStatus();
        const interval = setInterval(checkSyncStatus, 10000); // Check every 10 seconds
        return () => clearInterval(interval);
    }, []);

    // Subscribe to incoming order requests when rider is online
    useEffect(() => {
        if (!riderId) {
            return;
        }

        if (!isOnline) {
            // Remove from online riders when going offline
            removeRiderFromOnline(riderId);
            return;
        }

        // Setup push notifications
        const initNotifications = async () => {
            await setupNotificationChannels();
            const token = await registerForPushNotifications();
            if (token) {
                setPushToken(token);
            }
        };
        initNotifications();

        // Update rider status as online with current location
        const updateLocation = async () => {
            if (riderLocation) {
                await updateRiderStatus(
                    riderId,
                    riderLocation.coords.latitude,
                    riderLocation.coords.longitude,
                    true,
                    pushToken || undefined
                );
            }
        };
        updateLocation();

        // Subscribe to incoming order requests
        const unsubscribeRequests = subscribeToRiderRequests(riderId, (requests) => {
            if (requests.length > 0) {
                // Show the first pending request
                const latestRequest = requests[0];
                setIncomingRequest(latestRequest);
                setShowOrderModal(true);

                // Show local notification
                showIncomingOrderNotification(
                    latestRequest.data.pickupAddress,
                    latestRequest.data.dropoffAddress,
                    latestRequest.data.estimatedFare,
                    latestRequest.data.bookingId
                );
            } else {
                setIncomingRequest(null);
                setShowOrderModal(false);
            }
        });

        // Listen for notifications while app is in foreground
        const notificationListener = addNotificationReceivedListener((notification) => {
            const data = notification.request.content.data;
            if (data?.type === 'INCOMING_ORDER') {
                // Notification handled by Firebase subscription above
            }
        });

        return () => {
            unsubscribeRequests();
            notificationListener.remove();
            removeRiderFromOnline(riderId);
        };
    }, [isOnline, riderLocation, riderId, pushToken]);

    useEffect(() => {
        if (!isOnline || !riderLocation || !riderId) {
            return;
        }

        updateRiderStatus(
            riderId,
            riderLocation.coords.latitude,
            riderLocation.coords.longitude,
            true,
            pushToken || undefined
        );
    }, [isOnline, riderLocation, riderId, pushToken]);

    // EC-78: Subscribe to Reassignment Updates
    useEffect(() => {
        const boxId = boxIdForMonitoring;
        const unsubscribe = subscribeToReassignment(boxId, (state) => {
            setReassignmentState(state);
        });
        return unsubscribe;
    }, [boxIdForMonitoring]);

    useEffect(() => {
        if (!riderId) return;
        const unsubscribe = subscribeToRiderPairing(riderId, (state) => {
            setPairingState(state);
            // Keep cache warm even if pairing is only available via rider-scoped node.
            if (state?.box_id) {
                AsyncStorage.setItem(`${PAIRED_BOX_CACHE_KEY_PREFIX}${riderId}`, state.box_id).catch(() => undefined);
            }
        });
        return unsubscribe;
    }, [riderId]);

    // EC-78: Handle Reassignment Modal and Timer
    useEffect(() => {
        if (reassignmentState && isReassignmentPending(reassignmentState)) {
            const type = getReassignmentType(reassignmentState, riderId);
            if (type) {
                setShowReassignmentModal(true);
                // Start auto-ack timer
                const cleanup = startAutoAckTimer(boxIdForMonitoring, riderId, reassignmentState, () => {
                    setShowReassignmentModal(false);
                    // Alert provided by service callback or state update logic can go here
                });
                return cleanup;
            }
        } else {
            setShowReassignmentModal(false);
        }
    }, [boxIdForMonitoring, reassignmentState, riderId]);

    // EC-89: Token Refresh Service
    useEffect(() => {
        startTokenRefreshService({
            onStatusChange: (status) => {
                setTokenStatus(status);
            },
            onRefreshFailed: (attempts) => {
                Alert.alert(
                    '⚠️ Session Issue',
                    `Authentication refresh failed after ${attempts} attempts. Please re-login if issues persist.`,
                    [{ text: 'OK' }]
                );
            },
            onForceRelogin: () => {
                Alert.alert(
                    '🔒 Session Expired',
                    'Your session has expired. Please log in again.',
                    [{ text: 'Log In', onPress: () => navigation.navigate('Login') }]
                );
            },
        });

        return () => stopTokenRefreshService();
    }, [navigation]);

    // EC-90: Subscribe to Power State
    useEffect(() => {
        const unsubscribePower = subscribeToPower(boxIdForMonitoring, (state) => {
            setPowerState(state);
            if (state?.solenoid_blocked) {
                Alert.alert(
                    '🔋 Low Battery Alert',
                    `Box battery is critically low (${state.voltage.toFixed(1)}V). Unlock is disabled until charged.`,
                    [{ text: 'OK' }]
                );
            }
        });

        return () => unsubscribePower();
    }, [boxIdForMonitoring]);

    // EC-35: Try to flush any queued status updates while rider is active
    useEffect(() => {
        statusUpdateService.processQueue().catch(() => undefined);
    }, []);

    const handleReassignmentAcknowledge = async () => {
        if (reassignmentState) {
            await acknowledgeReassignment(boxIdForMonitoring, riderId);
            setShowReassignmentModal(false);
        }
    };

    // Handle accepting an order
    const handleAcceptOrder = useCallback(async () => {
        if (!incomingRequest || !riderId) return;

        const success = await acceptOrder(
            riderId,
            incomingRequest.data.bookingId,
            incomingRequest.requestId,
            {
                riderName,
                riderPhone,
                boxId: boxIdForMonitoring,
            }
        );

        if (success) {
            setShowOrderModal(false);

            // Prepare trip details for preview
            const tripDetails = {
                pickupAddress: incomingRequest.data.pickupAddress,
                dropoffAddress: incomingRequest.data.dropoffAddress,
                estimatedFare: incomingRequest.data.estimatedFare,
                distance: `${incomingRequest.data.distance?.toFixed(1) || '--'} km`,
                duration: `${incomingRequest.data.duration?.toFixed(0) || '--'} min`,
                pickupLat: incomingRequest.data.pickupLat,
                pickupLng: incomingRequest.data.pickupLng,
                dropoffLat: incomingRequest.data.dropoffLat,
                dropoffLng: incomingRequest.data.dropoffLng,
                bookingId: incomingRequest.data.bookingId, // Store ID for start
            };

            setAcceptedTripDetails(tripDetails);
            setIncomingRequest(null);
            setShowTripPreview(true);
        } else {
            Alert.alert('Error', 'Failed to accept order. Please try again.');
        }
    }, [incomingRequest, riderId, riderName, riderPhone, boxIdForMonitoring, navigation]);

    // Handle rejecting an order
    const handleRejectOrder = useCallback(async () => {
        if (!incomingRequest) return;

        await rejectOrder(riderId, incomingRequest.requestId);
        setShowOrderModal(false);
        setIncomingRequest(null);
    }, [incomingRequest, riderId]);

    // Handle order request expiring
    const handleOrderExpire = useCallback(() => {
        if (incomingRequest) {
            rejectOrder(riderId, incomingRequest.requestId);
        }
        setShowOrderModal(false);
        setIncomingRequest(null);
    }, [incomingRequest, riderId]);

    // Trip Preview State
    const [showTripPreview, setShowTripPreview] = useState(false);
    const [acceptedTripDetails, setAcceptedTripDetails] = useState<any>(null);

    // EC-32: Handle Cancellation Submit
    const handleCancellationSubmit = async (reason: CancellationReason, details: string) => {
        if (!nextDelivery) {
            Alert.alert('Error', 'No active delivery to cancel');
            return;
        }
        setCancelLoading(true);
        try {
            const result = await requestCancellation({
                deliveryId: nextDelivery.id,
                boxId: boxIdForMonitoring,
                reason,
                reasonDetails: details,
                riderId: riderId || '',
                riderName: riderName || 'Rider',
            });

            if (result.success) {
                setShowCancelModal(false);
                // Navigate to confirmation screen with return OTP
                navigation.navigate('CancellationConfirmation', {
                    deliveryId: nextDelivery.id,
                    returnOtp: result.returnOtp,
                    reason: reason,
                    reasonDetails: details,
                    senderName: nextDelivery.customer,
                    pickupAddress: nextDelivery.address,
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



    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(dayjs());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Initialize Mapbox
    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    // Fetch route from Mapbox Directions API
    const fetchRoute = useCallback(async () => {
        if (!riderLocation || !MAPBOX_TOKEN) {
            setRouteGeometry(null);
            return;
        }



        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${riderLocation.coords.longitude},${riderLocation.coords.latitude};${destination.longitude},${destination.latitude}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                setRouteGeometry(route.geometry);

                // Update distance with actual route distance
                const distanceKm = (route.distance / 1000).toFixed(2);
                setDistance(`${distanceKm} km`);

                // Update duration
                const durationMins = Math.round(route.duration / 60);
                setDuration(`${durationMins} min`);
            }
        } catch (error) {
            console.error('Route calculation error:', error);
            setRouteGeometry(null);
        }
    }, [riderLocation, MAPBOX_TOKEN, destination]);

    // Calculate route when rider location changes
    useEffect(() => {
        fetchRoute();
    }, [fetchRoute]);



    useEffect(() => {
        if (animationRef.current) {
            if (isLocked) {
                animationRef.current.play(0, 60); // Play lock animation
            } else {
                animationRef.current.play(60, 120); // Play unlock animation (approx frames)
            }
        }
    }, [isLocked]);

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Radius of the earth in km
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d.toFixed(2);
    };

    const deg2rad = (deg) => {
        return deg * (Math.PI / 180);
    };

    const fetchLocation = useCallback(async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            setLocationName('Permission denied');
            Alert.alert('Permission to access location was denied');
            return;
        }

        try {
            // EC-FIX: Try to get last known position first for immediate UI feedback
            const lastKnown = await Location.getLastKnownPositionAsync({});
            if (lastKnown) {
                setRiderLocation(lastKnown);

                // Calculate initial distance with cached location
                const dist = calculateDistance(
                    lastKnown.coords.latitude,
                    lastKnown.coords.longitude,
                    destination.latitude,
                    destination.longitude
                );
                setDistance(`${dist} km`);
            }

            // Then fetch fresh high-accuracy location
            let location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });
            setRiderLocation(location);

            // Calculate distance
            const dist = calculateDistance(
                location.coords.latitude,
                location.coords.longitude,
                destination.latitude,
                destination.longitude
            );
            setDistance(`${dist} km`);

            let address = await Location.reverseGeocodeAsync({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude
            });

            if (address && address.length > 0) {
                const { city, region, name } = address[0];
                const locString = city ? `${city}, ${region}` : name;
                setLocationName(locString || 'Unknown Location');
            }
        } catch (error) {
            console.log('Error fetching location:', error);
            setLocationName('Location unavailable');
        }
    }, []);

    useEffect(() => {
        fetchLocation();
    }, [fetchLocation]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchLocation();
        setRefreshing(false);
    }, [fetchLocation]);

    const handleNavigate = () => {
        if (!nextDelivery) return;

        const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
        const latLng = `${nextDelivery.dropoffLat},${nextDelivery.dropoffLng}`;
        const label = nextDelivery.address;
        const url = Platform.select({
            ios: `${scheme}${label}@${latLng}`,
            android: `${scheme}${latLng}(${label})`
        });

        if (url) {
            Linking.openURL(url);
        }
    };

    const toggleLock = () => {
        Alert.alert(
            isLocked ? "Unlock Box?" : "Lock Box?",
            isLocked ? "Are you sure you want to unlock the box?" : "Ensure the box is closed before locking.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: isLocked ? "Unlock" : "Lock", onPress: () => {
                        setIsLocked(!isLocked);
                        const action = !isLocked ? "LOCKED" : "UNLOCKED";
                        // Logs removed as per request
                    }
                }
            ]
        );
    };

    // Live weather state
    const [weather, setWeather] = useState<WeatherData | null>(null);



    const boxStatus = {
        battery: batteryState?.percentage ? batteryState.percentage / 100 : 0,
        connection: 'Connected',
        signal: 'Strong',
    };

    // Fetch live weather when rider location is available
    useEffect(() => {
        if (!riderLocation) return;
        fetchWeather(riderLocation.coords.latitude, riderLocation.coords.longitude).then((data) => {
            if (data) setWeather(data);
        });
    }, [riderLocation]);

    // EC-03: Get battery icon based on level
    const getBatteryIcon = () => {
        const pct = batteryState?.percentage ?? 85;
        if (pct > 80) return 'battery';
        if (pct > 60) return 'battery-70';
        if (pct > 40) return 'battery-50';
        if (pct > 20) return 'battery-30';
        return 'battery-alert';
    };

    const getBatteryColor = () => {
        const pct = batteryState?.percentage ?? 85;
        if (pct > 20) return '#2196F3';
        if (pct > 10) return '#FF9800';
        return '#F44336';
    };

    const QuickAction = ({ icon, label, onPress, color }) => (
        <TouchableOpacity style={styles.actionItem} onPress={onPress}>
            <Surface style={[styles.actionIcon, { backgroundColor: color }]} elevation={2}>
                <MaterialCommunityIcons name={icon} size={28} color="white" />
            </Surface>
            <Text variant="labelMedium" style={[styles.actionLabel, { color: theme.colors.onSurface }]}>{label}</Text>
        </TouchableOpacity>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Incoming Order Modal - overlays entire screen */}
            <IncomingOrderModal
                visible={showOrderModal}
                request={incomingRequest?.data || null}
                requestId={incomingRequest?.requestId || ''}
                onAccept={handleAcceptOrder}
                onReject={handleRejectOrder}
                onExpire={handleOrderExpire}
            />

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

            {/* Attractive Header */}
            <ImageBackground
                source={{ uri: weather ? (weatherBackgroundImages[weather.condition] || weatherBackgroundImages['Sunny']) : weatherBackgroundImages['Sunny'] }}
                style={styles.headerBackground}
                imageStyle={{ borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}
                resizeMode="cover"
            >
                <View style={styles.headerOverlay}>
                    <View style={styles.headerContent}>
                        <View>
                            <View style={styles.locationContainer}>
                                <MaterialCommunityIcons name="map-marker" size={16} color="rgba(255,255,255,0.9)" />
                                <Text style={styles.locationText}>{locationName}</Text>
                            </View>
                            <Text style={styles.dateText}>{currentTime.format('dddd, MMMM D')}</Text>
                            <Text style={styles.timeText}>{currentTime.format('h:mm A')}</Text>
                        </View>
                        {weather && (
                            <View style={styles.weatherContainer}>
                                <MaterialCommunityIcons name={weather.icon as any} size={30} color="white" />
                                <Text style={styles.weatherText}>{weather.temp}</Text>
                                <Text style={styles.weatherCondition}>{weather.condition}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </ImageBackground>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                {/* EC-78: Reassignment Pending Banner (Persistent if Modal Dismissed) */}
                {reassignmentState && isReassignmentPending(reassignmentState) && !showReassignmentModal && (
                    <Surface style={[styles.warningBanner, { backgroundColor: '#FFF3E0', marginBottom: 16 }]} elevation={4}>
                        <MaterialCommunityIcons
                            name={getReassignmentType(reassignmentState, riderId) === 'outgoing' ? "swap-horizontal" : "account-switch"}
                            size={24}
                            color="#FF9800"
                        />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.bannerTitle, { color: '#E65100' }]}>
                                {getReassignmentType(reassignmentState, riderId) === 'outgoing' ? 'REASSIGNMENT PENDING' : 'NEW ASSIGNMENT'}
                            </Text>
                            <Text style={[styles.bannerText, { color: '#EF6C00' }]}>
                                Action required for delivery update.
                            </Text>
                        </View>
                        <Button mode="text" onPress={() => setShowReassignmentModal(true)} textColor="#E65100">View</Button>
                    </Surface>
                )}

                {/* EC-89: Session Expiry Banner */}
                <SessionExpiryBanner
                    status={tokenStatus}
                    onReloginRequired={() => navigation.navigate('Login')}
                />
                {/* EC-18: Tamper Alert Banner */}
                {tamperState?.detected && (
                    <Surface style={styles.tamperBanner} elevation={4}>
                        <MaterialCommunityIcons name="alert-decagram" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.tamperTitle}>SECURITY ALERT</Text>
                            <Text style={styles.tamperText}>Unauthorized box access detected!</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-82: Keypad Warning Banner */}
                {keypadState?.is_stuck && (
                    <Surface style={styles.warningBanner} elevation={4}>
                        <MaterialCommunityIcons name="keyboard-off" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>KEYPAD MALFUNCTION</Text>
                            <Text style={styles.bannerText}>Key '{keypadState.stuck_key}' is stuck. Use App Unlock.</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-85: Recall Banner */}
                {recallState.isRecalled && (
                    <Surface style={styles.dangerBanner} elevation={4}>
                        <MaterialCommunityIcons name="backup-restore" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>PACKAGE RECALLED</Text>
                            <Text style={styles.bannerText}>Return to Sender immediately!</Text>
                            {recallState.returnOtp && (
                                <Text style={[styles.bannerText, { fontWeight: 'bold', marginTop: 4 }]}>
                                    Return OTP: {recallState.returnOtp}
                                </Text>
                            )}
                        </View>
                    </Surface>
                )}

                {/* EC-84: GPS Health Warning */}
                {gpsHealth?.isDegraded && (
                    <Surface style={styles.warningBanner} elevation={3}>
                        <MaterialCommunityIcons name="satellite-variant" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>WEAK GPS SIGNAL</Text>
                            <Text style={styles.bannerText}>
                                {gpsHealth.obstructionDetected
                                    ? "Box antenna obstructed! Please clear package."
                                    : `Poor reception (HDOP: ${gpsHealth.hdop.toFixed(1)})`}
                            </Text>
                        </View>
                    </Surface>
                )}

                {/* EC-83: Hinge Damage Banner */}
                {hingeState?.status === 'DAMAGED' && (
                    <Surface style={styles.dangerBanner} elevation={4}>
                        <MaterialCommunityIcons name="door-open" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>HINGE DAMAGE</Text>
                            <Text style={styles.bannerText}>Physical integrity compromised!</Text>
                        </View>
                    </Surface>
                )}

                {hingeState?.status === 'FLAPPING' && (
                    <Surface style={styles.warningBanner} elevation={4}>
                        <MaterialCommunityIcons name="door-open" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>DOOR SENSOR UNSTABLE</Text>
                            <Text style={styles.bannerText}>Check for obstructions near door.</Text>
                        </View>
                    </Surface>
                )}
                {/* EC-01/EC-06: Offline Mode Banner */}
                {isOffline && (
                    <Surface style={styles.offlineBanner} elevation={3}>
                        <MaterialCommunityIcons name="wifi-off" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.offlineTitle}>OFFLINE MODE</Text>
                            <Text style={styles.offlineText}>
                                {pendingSyncs > 0
                                    ? `${pendingSyncs} action${pendingSyncs > 1 ? 's' : ''} pending sync`
                                    : 'Working with cached data'}
                            </Text>
                        </View>
                        {pendingSyncs > 0 && (
                            <View style={styles.syncBadge}>
                                <Text style={styles.syncBadgeText}>{pendingSyncs}</Text>
                            </View>
                        )}
                    </Surface>
                )}

                {/* EC-08: GPS Spoofing Warning */}
                {gpsSpoofWarning && (
                    <Surface style={styles.spoofWarning} elevation={3}>
                        <MaterialCommunityIcons name="map-marker-alert" size={24} color="#7B341E" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.spoofTitle}>GPS ANOMALY</Text>
                            <Text style={styles.spoofText}>Unusual location data detected</Text>
                        </View>
                        <TouchableOpacity onPress={() => setGpsSpoofWarning(false)}>
                            <MaterialCommunityIcons name="close" size={20} color="#7B341E" />
                        </TouchableOpacity>
                    </Surface>
                )}

                {/* EC-46: Clock Skew Warning */}
                {clockSkewWarning && (
                    <Surface style={styles.clockWarning} elevation={2}>
                        <MaterialCommunityIcons name="clock-alert" size={20} color="#1E40AF" />
                        <Text style={styles.clockText}>Device time may be out of sync</Text>
                        <TouchableOpacity onPress={() => setClockSkewWarning(false)}>
                            <MaterialCommunityIcons name="close" size={18} color="#1E40AF" />
                        </TouchableOpacity>
                    </Surface>
                )}

                {/* EC-10: Photo Queue Full Warning */}
                {photoQueueFull && (
                    <Surface style={styles.queueWarning} elevation={2}>
                        <MaterialCommunityIcons name="image-off" size={20} color="#B45309" />
                        <Text style={styles.queueText}>Photo queue full ({photoQueueCount}/{SAFETY_CONSTANTS.MAX_QUEUED_PHOTOS})</Text>
                    </Surface>
                )}

                {/* Status Toggle - EC-ENHANCE: Clear Offline/Online distinction */}
                <View style={[styles.statusToggleContainer, { backgroundColor: theme.colors.surface }]}>
                    <View style={styles.statusContainer}>
                        <View style={[styles.statusDot, { backgroundColor: isOnline ? '#4CAF50' : '#9E9E9E' }]} />
                        <View>
                            <Text variant="titleMedium" style={[styles.statusText, { color: theme.colors.onSurface }]}>
                                {isOnline ? 'You are Online' : 'You are Offline'}
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                {isOnline ? 'Receiving orders' : 'Browsing mode only'}
                            </Text>
                        </View>
                    </View>
                    <Switch value={isOnline} onValueChange={setIsOnline} trackColor={{ true: "#4CAF50", false: "#767577" }} />
                </View>

                {/* GPS Connection Status Indicator */}
                <Surface style={styles.gpsStatusCard} elevation={1}>
                    <View style={styles.gpsStatusRow}>
                        <View style={[
                            styles.gpsStatusIcon,
                            { backgroundColor: hasActiveDelivery ? getStatusColor(gpsSource, isBoxOnline) + '20' : '#F5F5F5' }
                        ]}>
                            <MaterialCommunityIcons
                                name={hasActiveDelivery && gpsSource === 'box' ? 'access-point' : hasActiveDelivery && gpsSource === 'phone' ? 'cellphone' : 'access-point-off'}
                                size={24}
                                color={hasActiveDelivery ? getStatusColor(gpsSource, isBoxOnline) : '#9E9E9E'}
                            />
                        </View>
                        <View style={styles.gpsStatusInfo}>
                            <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>GPS Tracking</Text>
                            <Text variant="bodySmall" style={{ color: hasActiveDelivery ? getStatusColor(gpsSource, isBoxOnline) : '#9E9E9E' }}>
                                {hasActiveDelivery ? getStatusMessage(gpsSource, isBoxOnline) : 'No Active Delivery'}
                            </Text>
                        </View>
                        {phoneGpsActive && hasActiveDelivery && (
                            <Chip
                                compact
                                icon="phone"
                                style={{ backgroundColor: '#FFF3E0' }}
                                textStyle={{ fontSize: 10 }}
                            >
                                Fallback
                            </Chip>
                        )}
                    </View>
                </Surface>

                {/* Pairing Status */}
                <Surface style={styles.pairingCard} elevation={2}>
                    <View style={styles.pairingRow}>
                        <View style={styles.pairingInfo}>
                            <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>
                                {isPaired ? 'Box Paired' : 'No Box Paired'}
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                {isPaired && pairedBoxId
                                    ? `Box ${pairedBoxId} • ${pairingModeLabel}`
                                    : 'Scan a box QR to link controls and health data.'}
                            </Text>
                        </View>
                        <Button
                            mode={isPaired ? 'outlined' : 'contained'}
                            onPress={() => {
                                // "Manage" is for pairing/unpairing; controls are available via Box Status.
                                navigation.navigate('PairBox');
                            }}
                        >
                            {isPaired ? 'Manage' : 'Pair Box'}
                        </Button>
                    </View>
                </Surface>

                {/* Quick Actions */}
                <View style={styles.actionsGrid}>
                    <QuickAction
                        icon="cube-outline"
                        label="Box Status"
                        onPress={() => {
                            if (!isPaired || !pairedBoxId) {
                                Alert.alert('Pair Required', 'Scan your box QR to access controls.');
                                navigation.navigate('PairBox');
                                return;
                            }
                            navigation.navigate('BoxControls', { boxId: pairedBoxId });
                        }}
                        color="#FF9800"
                    />
                    <QuickAction icon="history" label="History" onPress={() => navigation.navigate('DeliveryRecords')} color="#2196F3" />
                    <QuickAction icon="face-agent" label="Support" onPress={() => navigation.navigate('RiderSupport')} color="#9C27B0" />
                    <QuickAction icon="cog" label="Settings" onPress={() => navigation.navigate('RiderSettings')} color="#607D8B" />
                </View>

                {/* Next Delivery Card */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Current Job</Text>
                {nextDelivery ? (
                    <Card style={styles.jobCard} mode="elevated">
                        <View style={styles.mapContainer}>
                            {riderLocation && MAPBOX_TOKEN ? (
                                <MapboxGL.MapView
                                    style={styles.map}
                                    logoEnabled={false}
                                    attributionEnabled={false}
                                    styleURL={MapboxGL.StyleURL.Street}
                                    scrollEnabled={true}
                                    pitchEnabled={true}
                                    rotateEnabled={true}
                                    zoomEnabled={true}
                                >
                                    <MapboxGL.Camera
                                        zoomLevel={14}
                                        centerCoordinate={[riderLocation.coords.longitude, riderLocation.coords.latitude]}
                                        animationMode="easeTo"
                                        animationDuration={500}
                                    />

                                    {/* Rider Location Marker */}
                                    <MapboxGL.PointAnnotation
                                        id="rider-location"
                                        coordinate={[riderLocation.coords.longitude, riderLocation.coords.latitude]}
                                        title="Your Location"
                                    >
                                        <View style={{
                                            width: 30,
                                            height: 30,
                                            borderRadius: 15,
                                            backgroundColor: '#2196F3',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                            borderWidth: 3,
                                            borderColor: 'white',
                                            shadowColor: '#000',
                                            shadowOffset: { width: 0, height: 2 },
                                            shadowOpacity: 0.3,
                                            shadowRadius: 3,
                                            elevation: 5,
                                        }}>
                                            <MaterialCommunityIcons name="motorbike" size={16} color="white" />
                                        </View>
                                    </MapboxGL.PointAnnotation>

                                    {/* Destination Marker */}
                                    <MapboxGL.PointAnnotation
                                        id="destination"
                                        coordinate={[destination.longitude, destination.latitude]}
                                        title="Destination"
                                    >
                                        <View style={{
                                            width: 30,
                                            height: 30,
                                            borderRadius: 15,
                                            backgroundColor: '#F44336',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                            borderWidth: 3,
                                            borderColor: 'white',
                                            shadowColor: '#000',
                                            shadowOffset: { width: 0, height: 2 },
                                            shadowOpacity: 0.3,
                                            shadowRadius: 3,
                                            elevation: 5,
                                        }}>
                                            <MaterialCommunityIcons name="map-marker" size={20} color="white" />
                                        </View>
                                    </MapboxGL.PointAnnotation>

                                    {/* Route Line - Actual Route from Mapbox Directions API */}
                                    {routeGeometry && (
                                        <MapboxGL.ShapeSource
                                            id="route-line"
                                            shape={{
                                                type: 'Feature',
                                                geometry: routeGeometry,
                                                properties: {},
                                            }}
                                        >
                                            <MapboxGL.LineLayer
                                                id="route-line-layer"
                                                style={{
                                                    lineColor: '#2196F3',
                                                    lineWidth: 4,
                                                    lineOpacity: 0.8,
                                                }}
                                            />
                                        </MapboxGL.ShapeSource>
                                    )}
                                </MapboxGL.MapView>
                            ) : (
                                <View style={[styles.mapPlaceholder, { backgroundColor: theme.colors.surfaceVariant }]}>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>
                                        {MAPBOX_TOKEN ? 'Loading Map...' : 'Map unavailable: configure MAPBOX_ACCESS_TOKEN'}
                                    </Text>
                                </View>
                            )}
                        </View>

                        <Card.Content style={styles.jobContent}>
                            <View style={styles.jobHeader}>
                                <View>
                                    <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{nextDelivery.customer}</Text>
                                    <Text variant="bodySmall" style={{ color: '#666' }}>{nextDelivery.id}</Text>
                                </View>
                                <Chip icon="map-marker-distance" compact style={{ backgroundColor: '#E3F2FD' }}>{distance}</Chip>
                            </View>

                            <View style={styles.divider} />

                            <View style={[styles.addressContainer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                    <MaterialCommunityIcons name="map-marker" size={20} color={theme.colors.primary} style={{ marginTop: 2, marginRight: 4 }} />
                                    <Text variant="bodyMedium" style={[styles.address, { flex: 1, marginBottom: 0 }]}>{nextDelivery.address}</Text>
                                </View>
                                <IconButton
                                    icon="navigation"
                                    mode="contained"
                                    containerColor={theme.colors.primaryContainer}
                                    iconColor={theme.colors.primary}
                                    size={24}
                                    onPress={handleNavigate}
                                    style={{ margin: 0, marginLeft: 8 }}
                                />
                            </View>


                            <View style={styles.jobMeta}>
                                <View style={styles.metaItem}>
                                    <MaterialCommunityIcons name="clock-outline" size={16} color="#666" />
                                    <Text style={styles.metaText}>ETA: {nextDelivery.time}</Text>
                                </View>
                            </View>
                        </Card.Content>

                        <Card.Actions style={styles.jobActions}>
                            <Button
                                mode="outlined"
                                style={{ flex: 1, marginRight: 8 }}
                                onPress={() => navigation.navigate('JobDetail', { job: nextDelivery })}
                                textColor={theme.colors.primary}
                            >
                                Details
                            </Button>
                            <Button
                                mode="contained"
                                onPress={() => setShowCancelModal(true)}
                                buttonColor={theme.colors.error}
                                style={{ marginRight: 8 }}
                            >
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                style={{ flex: 1 }}
                                onPress={() => navigation.navigate('Arrival')}
                                buttonColor={theme.colors.primary}
                            >
                                Start Trip
                            </Button>
                        </Card.Actions>
                    </Card>
                ) : (
                    <Card style={[styles.jobCard, { backgroundColor: theme.colors.surfaceVariant }]} mode="elevated">
                        <Card.Content style={{ alignItems: 'center', paddingVertical: 32 }}>
                            <MaterialCommunityIcons name="truck-delivery-outline" size={48} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>No current job</Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Waiting for incoming orders</Text>
                        </Card.Content>
                    </Card>
                )}

                {/* Smart Box Status */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Box Status</Text>
                <Surface style={styles.statusCard} elevation={2}>

                    {/* Enhanced Unlock Button with Lottie */}
                    <View style={styles.unlockContainer}>
                        <View style={styles.unlockInfo}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Lock Mechanism</Text>
                            <Text variant="bodyMedium" style={{ color: !isPaired ? '#9E9E9E' : (isLocked ? '#4CAF50' : '#F44336') }}>
                                {!isPaired ? 'No Box Connected' : (isLocked ? 'Securely Locked' : 'Unlocked')}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={[
                                styles.unlockButton,
                                {
                                    backgroundColor: !isPaired ? '#F5F5F5' : (isLocked ? '#E8F5E9' : '#FFEBEE'),
                                    borderWidth: 1,
                                    borderColor: !isPaired ? '#E0E0E0' : (isLocked ? '#4CAF50' : '#F44336')
                                }
                            ]}
                            onPress={toggleLock}
                            disabled={!isPaired}
                        >
                            <MaterialCommunityIcons
                                name={!isPaired ? "shield-off-outline" : (isLocked ? "shield-lock" : "shield-lock-open")}
                                size={40}
                                color={!isPaired ? "#BDBDBD" : (isLocked ? "#4CAF50" : "#F44336")}
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: isPaired ? getBatteryColor() + '20' : '#F5F5F5' }]}>
                            <MaterialCommunityIcons
                                name={isPaired ? getBatteryIcon() as any : "battery-unknown"}
                                size={24}
                                color={isPaired ? getBatteryColor() : '#BDBDBD'}
                            />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall">Battery Level</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <ProgressBar
                                    progress={isPaired ? boxStatus.battery : 0}
                                    color={isPaired ? getBatteryColor() : '#E0E0E0'}
                                    style={styles.progressBar}
                                />
                                <Text variant="labelSmall" style={{ marginLeft: 8, fontWeight: 'bold', color: isPaired ? getBatteryColor() : '#9E9E9E' }}>
                                    {isPaired ? `${batteryState?.percentage ?? 85}%` : '--%'}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: isPaired ? '#F3E5F5' : '#F5F5F5' }]}>
                            <MaterialCommunityIcons
                                name={isPaired ? "bluetooth" : "bluetooth-off"}
                                size={24}
                                color={isPaired ? "#9C27B0" : "#BDBDBD"}
                            />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall">Connection</Text>
                            <Text variant="bodySmall" style={{ color: '#666' }}>
                                {isPaired ? `${boxStatus.connection} • ${boxStatus.signal}` : 'Not Connected'}
                            </Text>
                        </View>
                    </View>

                    <View style={{ flexDirection: 'row', marginTop: 16, gap: 8 }}>
                        {!isPaired && (
                            <Button
                                mode="contained"
                                style={{ flex: 1 }}
                                onPress={() => navigation.navigate('PairBox')}
                            >
                                Pair Box
                            </Button>
                        )}
                        <Button
                            mode="outlined"
                            style={{ flex: 1 }}
                            onPress={() => navigation.navigate('BoxControls')}
                        >
                            Advanced Controls
                        </Button>
                    </View>
                </Surface>



            </ScrollView >
        </View >
    );
}

const styles = StyleSheet.create({
    bannerTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    bannerText: {
        color: 'white',
        fontSize: 12,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
        backgroundColor: '#F57C00', // Orange for warning
    },
    dangerBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
        backgroundColor: '#D32F2F', // Red for critical
    },
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    headerBackground: {
        height: 180,
        justifyContent: 'flex-end',
    },
    headerOverlay: {
        backgroundColor: 'rgba(0,0,0,0.1)',
        height: '100%',
        justifyContent: 'flex-end',
        paddingBottom: 20,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
    },
    headerContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
    },
    locationContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    locationText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    dateText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
        fontWeight: 'bold',
    },
    timeText: {
        color: 'white',
        fontSize: 32,
        fontWeight: 'bold',
    },
    weatherContainer: {
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        padding: 8,
        borderRadius: 12,
    },
    weatherText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    weatherCondition: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 12,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 80,
    },
    statusToggleContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
        marginTop: 10,
        // backgroundColor: 'white', // Handled by theme
        padding: 16,
        borderRadius: 16,
        elevation: 1,
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 10,
    },
    statusText: {
        fontWeight: 'bold',
        color: '#444',
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#333',
    },
    jobCard: {
        marginBottom: 24,
        // backgroundColor: 'white', // Handled by theme
        overflow: 'hidden',
        borderRadius: 16,
    },
    mapContainer: {
        height: 150,
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    map: {
        width: '100%',
        height: '100%',
    },
    mapPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    myLocationButton: {
        position: 'absolute',
        bottom: 10,
        right: 10,
        margin: 0,
    },
    jobContent: {
        padding: 16,
    },
    jobHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    addressContainer: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    address: {
        color: '#444',
        marginLeft: 8,
        flex: 1,
    },
    jobMeta: {
        flexDirection: 'row',
        marginTop: 4,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    metaText: {
        marginLeft: 4,
        color: '#666',
        fontSize: 12,
        fontWeight: 'bold',
    },
    jobActions: {
        padding: 16,
        paddingTop: 0,
    },
    statusCard: {
        // backgroundColor: 'white', // Handled by theme
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    statusIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    statusInfo: {
        flex: 1,
    },
    progressBar: {
        height: 6,
        borderRadius: 3,
        flex: 1,
    },
    divider: {
        height: 1,
        backgroundColor: '#F0F0F0',
        marginVertical: 8,
    },
    actionsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    actionItem: {
        alignItems: 'center',
        width: '22%',
    },
    actionIcon: {
        width: 50,
        height: 50,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    actionLabel: {
        color: '#555',
    },
    unlockContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    unlockInfo: {
        flex: 1,
    },
    unlockButton: {
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 1,
    },

    gpsStatusCard: {
        // backgroundColor: 'white', // Handled by theme
        borderRadius: 16,
        padding: 12,
        marginBottom: 16,
    },
    pairingCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    pairingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    pairingInfo: {
        flex: 1,
        marginRight: 16,
    },
    gpsStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    gpsStatusIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    gpsStatusInfo: {
        flex: 1,
    },
    tamperBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#D32F2F',
        marginHorizontal: 16,
        marginTop: 16,
        padding: 16,
        borderRadius: 12,
    },
    tamperTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    tamperText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
    },
    // EC-01/EC-06: Offline Mode Styles
    offlineBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#475569',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 14,
        borderRadius: 12,
    },
    offlineTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    offlineText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 12,
    },
    syncBadge: {
        backgroundColor: '#EF4444',
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    syncBadgeText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
    // EC-08: GPS Spoofing Warning Styles
    spoofWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 12,
        borderRadius: 10,
        borderLeftWidth: 4,
        borderLeftColor: '#D97706',
    },
    spoofTitle: {
        color: '#92400E',
        fontWeight: 'bold',
        fontSize: 13,
    },
    spoofText: {
        color: '#B45309',
        fontSize: 12,
    },
    // EC-46: Clock Skew Warning Styles
    clockWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#DBEAFE',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        gap: 8,
    },
    clockText: {
        flex: 1,
        color: '#1E40AF',
        fontSize: 12,
    },
    // EC-10: Photo Queue Warning Styles
    queueWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        gap: 8,
    },
    queueText: {
        flex: 1,
        color: '#B45309',
        fontSize: 12,
    },
});
