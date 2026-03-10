import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Switch, ImageBackground, Alert, RefreshControl, TouchableOpacity, Dimensions, Linking, Platform, AppState, Animated } from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { Text, Card, Button, Avatar, ProgressBar, MD3Colors, Chip, useTheme, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TIMEZONE = 'Asia/Manila';
import * as Location from 'expo-location';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import AnimatedRiderMarker from '../../components/map/AnimatedRiderMarker';
import LottieView from 'lottie-react-native';
import { useLocationRedundancy, getStatusMessage, getStatusColor } from '../../hooks/useLocationRedundancy';
import { subscribeToBattery, BatteryState, subscribeToTamper, TamperState, subscribeToLocation, LocationData, subscribeToKeypad, KeypadState, subscribeToHinge, HingeState, subscribeToBoxState, BoxState, updateBoxState, writePhoneLocation } from '../../services/firebaseClient';
import { offlineCache, PendingSync } from '../../services/offlineCache';
import { NetworkStatusBanner } from '../../components';
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
    setTrackingPhase,
} from '../../services/backgroundLocationService';
import { checkOemProtection, markOemProtectionDone } from '../../services/oemProtection';

// Helper to fix double-shifted times
const formatTimeWithHeuristic = (timeStr: string) => {
    if (!timeStr || timeStr === '--:--') return '--:--';

    // Check for T-prefixed time strings (common Postgres time format issue or partial ISO)
    if (timeStr.startsWith('T') && timeStr.includes(':')) {
        // e.g. T04:18:38.479 -> 04:18:38 -> 4:18 AM
        const cleanTime = timeStr.substring(1).split('.')[0];
        // Create a dummy date with this time to format it
        const dummyDate = dayjs(`2000-01-01T${cleanTime}`);
        if (dummyDate.isValid()) {
            // Add 8 hours if needed? If it's raw time, it might be UTC or local.
            // Assuming it's already local if just time, or UTC. 
            // Safest is to just show it formatted 12h.
            return dummyDate.format('h:mm A');
        }
        return cleanTime;
    }

    const d = dayjs(timeStr);
    if (!d.isValid()) {
        console.warn('[RiderDashboard] Invalid date string:', timeStr);
        return timeStr;
    }

    let phTime = d.tz(PH_TIMEZONE);
    const now = dayjs().tz(PH_TIMEZONE);

    // If time is > 2 hours in future, it's a double shift error. Subtract 8 hours.
    if (phTime.diff(now, 'hour') > 2) {
        phTime = phTime.subtract(8, 'hour');
    }
    return phTime.format('h:mm A');
};

const sanitizeBoxId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined' || lowered === 'unknown_box') return null;
    return trimmed;
};
import {
    subscribeToRiderRequests,
    subscribeToDelivery,
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
    showStatusNotification,
    NOTIFICATION_CHANNELS,
    addNotificationReceivedListener,
} from '../../services/pushNotificationService';
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason } from '../../services/cancellationService';
import ReassignmentAlertModal from '../../components/ReassignmentAlertModal';
import PhoneEntryModal from '../../components/modals/PhoneEntryModal';
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
import { getAuth } from 'firebase/auth'; // EC-Fix: Fallback auth
import { supabase } from '../../services/supabaseClient'; // EC-Fix: Session restoration

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { useExitAppConfirmation } from '../../hooks/useExitAppConfirmation';
import ExitConfirmationModal from '../../components/modals/ExitConfirmationModal';
import { StatusBar } from 'expo-status-bar';
import { PremiumAlert } from '../../services/PremiumAlertService';

// ── Uber-style dual palette ──
const lightC = {
    bg: '#FFFFFF', card: '#FFFFFF', search: '#F2F2F7',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    border: '#E5E5EA', accent: '#000000', accentText: '#FFFFFF',
    divider: '#F2F2F7',
    greenBg: '#ECFDF5', greenText: '#059669',
    redBg: '#FEF2F2', redText: '#DC2626',
    orangeBg: '#FFF7ED', orangeText: '#EA580C',
    blueBg: '#EFF6FF', blueText: '#2563EB',
};
const darkC = {
    bg: '#000000', card: '#1C1C1E', search: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    border: '#38383A', accent: '#FFFFFF', accentText: '#000000',
    divider: '#2C2C2E',
    greenBg: '#052E16', greenText: '#4ADE80',
    redBg: '#450A0A', redText: '#FCA5A5',
    orangeBg: '#431407', orangeText: '#FDBA74',
    blueBg: '#172554', blueText: '#93C5FD',
};

export default function RiderDashboard() {
    const { showExitModal, setShowExitModal, handleExit } = useExitAppConfirmation();
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const insets = useSafeAreaInsets();
    const [isOnline, setIsOnline] = useState(true);
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [riderLocation, setRiderLocation] = useState<Location.LocationObject | null>(null);
    const [isRestoringSession, setIsRestoringSession] = useState(false); // EC-Fix: Session restoration state
    const [distance, setDistance] = useState<string>('Calculating...');
    const [boxState, setBoxState] = useState<BoxState | null>(null);
    const isLocked = boxState?.status === 'LOCKED';
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
    const lastGpsLocationRef = useRef<LocationData | null>(null);

    // EC-46: Clock Skew Warning
    const [clockSkewWarning, setClockSkewWarning] = useState(false);

    // EC-Update: Route Duration State
    const [duration, setDuration] = useState('-- min');

    // EC-10: Photo Queue Status
    const [photoQueueCount, setPhotoQueueCount] = useState(0);

    // EC-Update: Phone Verification State
    const [showPhoneModal, setShowPhoneModal] = useState(false);
    const [pendingRequestItem, setPendingRequestItem] = useState<{ requestId: string; data: RiderOrderRequest } | null>(null);

    const [photoQueueFull, setPhotoQueueFull] = useState(false);

    // GPS Redundancy Hook - monitors box connectivity and handles failover
    const {
        source: gpsSource,
        isBoxOnline,
        phoneGpsActive,
        startMonitoring,
        stopMonitoring,
        activateTracking,
        deactivateTracking,
        gpsHealth, // EC-84
        lastLocation // EC-Redundancy: Use this for reliable updates
    } = useLocationRedundancy();

    // EC-FIX: Local phone location state for fallback
    const [localPhoneLocation, setLocalPhoneLocation] = useState<Location.LocationObject | null>(null);
    // Ref so the foreground watcher callback can access the current boxId without a stale closure
    const activeBoxIdRef = useRef<string | null>(null);
    const lastForegroundWriteRef = useRef<number>(0);
    // Track previous delivery status so we can detect changes on the rider's side
    const prevRiderDeliveryStatus = useRef<string | null>(null);

    // EC-FIX: Continuous Phone GPS Watchdog (Foreground)
    // This ensures we always have the REAL phone location available, even if the
    // redundancy service (Box/Background) is failing or reporting "none".
    useEffect(() => {
        let subscription: Location.LocationSubscription | null = null;

        const startWatching = async () => {
            try {
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status === 'granted') {
                    subscription = await Location.watchPositionAsync(
                        {
                            accuracy: Location.Accuracy.High,
                            timeInterval: 2000,
                            distanceInterval: 0, // Fire on time interval alone — GPS is pre-warmed
                        },
                        (location) => {
                            setLocalPhoneLocation(location);

                            // First-fix accuracy guard — reject garbage cell-tower/WiFi
                            // readings that cause snap-back lines on the map.
                            const accuracy = location.coords.accuracy ?? 999;
                            if (accuracy > 100 && lastForegroundWriteRef.current === 0) {
                                if (__DEV__) console.log(`[RiderDashboard] ✗ Skipping garbage first fix (acc=${accuracy.toFixed(0)}m)`);
                                return;
                            }

                            // Direct Firebase write — bulletproof fallback in case the
                            // background service task isn't firing (zombie/permission issue).
                            // Rate-limited to once per 3s to match background service interval.
                            const boxId = activeBoxIdRef.current;
                            const now = Date.now();
                            if (boxId && now - lastForegroundWriteRef.current >= 3000) {
                                lastForegroundWriteRef.current = now;
                                writePhoneLocation(
                                    boxId,
                                    location.coords.latitude,
                                    location.coords.longitude,
                                    location.coords.speed ?? 0,
                                    location.coords.heading ?? 0
                                ).then(() => {
                                    if (__DEV__) console.log(`[RiderDashboard] ✓ Foreground write OK | box=${boxId} | lat=${location.coords.latitude.toFixed(5)} lng=${location.coords.longitude.toFixed(5)}`);
                                }).catch((err) => {
                                    console.warn('[RiderDashboard] ✗ Foreground Firebase write failed:', err);
                                });
                            }

                            if (__DEV__) {
                                console.log('[RiderDashboard] Phone Location Update:', {
                                    lat: location.coords.latitude,
                                    lng: location.coords.longitude,
                                    source: gpsSource
                                });
                            }
                        }
                    );
                }
            } catch (err) {
                console.warn('[RiderDashboard] WatchPosition failed:', err);
            }
        };

        startWatching();

        return () => {
            if (subscription) {
                subscription.remove();
            }
        };
    }, []);

    // EC-FIX: Sync riderLocation state with redundancy service updates OR fallback to local phone
    // EC-FIX: Decouple Rider Location from Box Location
    useEffect(() => {
        // Priority 1: Local Phone GPS (Foreground) - This represents the Rider.
        if (localPhoneLocation) {
            setRiderLocation(localPhoneLocation);
            return;
        }

        // Priority 2: Background Service Phone Location (if available and no local)
        if (gpsSource === 'phone' && lastLocation) {
            setRiderLocation({
                coords: {
                    latitude: lastLocation.latitude,
                    longitude: lastLocation.longitude,
                    altitude: null,
                    accuracy: null,
                    altitudeAccuracy: null,
                    heading: lastLocation.heading || 0,
                    speed: lastLocation.speed || 0,
                },
                timestamp: lastLocation.timestamp,
            });
            return;
        }

        // Priority 3: Box Location (Fallback only if we have NO phone data)
        // We only use this if we are completely blind on the phone side.
        if (gpsSource === 'box' && lastLocation) {
            setRiderLocation({
                coords: {
                    latitude: lastLocation.latitude,
                    longitude: lastLocation.longitude,
                    altitude: null,
                    accuracy: null,
                    altitudeAccuracy: null,
                    heading: lastLocation.heading || 0,
                    speed: lastLocation.speed || 0,
                },
                timestamp: lastLocation.timestamp,
            });
        }
    }, [localPhoneLocation, lastLocation, gpsSource]);



    // EC-85: Recall State
    const [recallState, setRecallState] = useState<{ isRecalled: boolean; returnOtp: string | null }>({ isRecalled: false, returnOtp: null });

    // Incoming Order State (for rider matching)
    const [incomingRequests, setIncomingRequests] = useState<Array<{ requestId: string; data: RiderOrderRequest }>>([]);

    const [showOrderModal, setShowOrderModal] = useState(false);
    // EC-NEW: Trip Preview Modal State
    const [showTripPreview, setShowTripPreview] = useState(false);
    const [acceptedTripDetails, setAcceptedTripDetails] = useState<{
        pickupAddress: string;
        dropoffAddress: string;
        estimatedFare: number;
        distance: string;
        duration: string;
        pickupLat: number;
        pickupLng: number;
        dropoffLat: number;
        dropoffLng: number;
        bookingId: string;
        customerName: string;
    } | null>(null);
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const authedUser = useAuthStore((state: any) => state.user) as any;
    const riderId = authedUserId;
    const riderName = authedUser?.fullName || authedUser?.name || undefined;
    const riderPhone = authedUser?.phone || undefined;
    const [pushToken, setPushToken] = useState<string | null>(null);
    const [pairingState, setPairingState] = useState<BoxPairingState | null>(null);

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
    const [activeDelivery, setActiveDelivery] = useState<any>(null);
    const [hasActiveDelivery, setHasActiveDelivery] = useState(false);
    const [hasResolvedInitialActiveDelivery, setHasResolvedInitialActiveDelivery] = useState(false);
    const [hasResolvedPairingState, setHasResolvedPairingState] = useState(false);

    const isPaired = isPairingActive(pairingState);
    const pairedBoxId = sanitizeBoxId(pairingState?.box_id);
    const pairingModeLabel = pairingState?.mode === 'ONE_TIME' ? 'One-time' : 'Session';
    const boxIdForMonitoring = pairedBoxId;
    const activeDeliveryBoxId = sanitizeBoxId(activeDelivery?.assigned_box_id || activeDelivery?.box_id);
    const trackedBoxId = (isPaired && pairedBoxId) ? pairedBoxId : activeDeliveryBoxId;

    // Keep the ref in sync so the foreground watcher callback can access current boxId
    useEffect(() => {
        activeBoxIdRef.current = trackedBoxId;
    }, [trackedBoxId]);

    // EC-Fix: Auto-restore session if authStore is empty but Firebase Auth is active
    // This prevents "Rider ID Required" errors after reloading the app
    useEffect(() => {
        const restoreSession = async () => {
            if (!riderId && !isRestoringSession) {
                const auth = getAuth();
                const firebaseUser = auth.currentUser;

                if (firebaseUser) {
                    console.log('[RiderDashboard] Session missing but Firebase auth exists. Restoring...');
                    setIsRestoringSession(true);
                    try {
                        // Fetch profile from Supabase
                        const { data: profile, error } = await supabase
                            .from('profiles')
                            .select('*')
                            .eq('id', firebaseUser.uid)
                            .single();

                        if (profile) {
                            (useAuthStore.getState() as any).login({
                                userId: profile.id,
                                email: firebaseUser.email,
                                role: profile.role,
                                fullName: profile.full_name,
                                phone: profile.phone_number,
                            });
                            console.log('[RiderDashboard] Session restored via hydration.');
                        }
                    } catch (err) {
                        console.error('[RiderDashboard] Failed to restore session:', err);
                    } finally {
                        setIsRestoringSession(false);
                    }
                }
            }
        };

        restoreSession();
    }, [riderId]);
    // Dynamic delivery state — populated from real sources when available
    const nextDelivery = useMemo(() => activeDelivery ? {
        id: activeDelivery.id,
        boxId: sanitizeBoxId(activeDelivery.assigned_box_id || activeDelivery.box_id) || 'UNKNOWN_BOX',
        status: activeDelivery.status, // Add status
        address: activeDelivery.dropoff_address,
        customer: activeDelivery.recipient_name || activeDelivery.customer?.full_name || 'Customer',
        time: activeDelivery.accepted_at ? formatTimeWithHeuristic(activeDelivery.accepted_at) : (activeDelivery.created_at ? formatTimeWithHeuristic(activeDelivery.created_at) : '--:--'),
        phone: activeDelivery.recipient_phone || activeDelivery.customer?.phone_number || 'No Phone',
        pickupAddress: activeDelivery.pickup_address,
        pickupTime: activeDelivery.created_at, // RAW ISO for JobDetail
        dropoffTime: activeDelivery.accepted_at || activeDelivery.created_at, // RAW ISO for JobDetail
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
        snappedPickupLat: activeDelivery.snapped_pickup_lat,
        snappedPickupLng: activeDelivery.snapped_pickup_lng,
        snappedDropoffLat: activeDelivery.snapped_dropoff_lat,
        snappedDropoffLng: activeDelivery.snapped_dropoff_lng,
        senderName: activeDelivery.sender_name,
        senderPhone: activeDelivery.sender_phone,
        deliveryNotes: activeDelivery.delivery_notes,
    } : null, [activeDelivery, distance, duration]);

    // Derive destination directly from activeDelivery (NOT nextDelivery) to avoid
    // circular dependency: nextDelivery → destination → fetchRoute → distance/duration → nextDelivery
    const destination = useMemo(() => {
        if (!activeDelivery) {
            return {
                latitude: 14.5831,
                longitude: 120.9794,
                title: "Delivery Destination",
                description: "Rizal Park, Manila"
            };
        }

        const isPickup = !['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED'].includes(activeDelivery.status);

        if (isPickup) {
            return {
                latitude: activeDelivery.snapped_pickup_lat ?? activeDelivery.pickup_lat,
                longitude: activeDelivery.snapped_pickup_lng ?? activeDelivery.pickup_lng,
                title: "Pickup Location",
                description: activeDelivery.pickup_address
            };
        } else {
            return {
                latitude: activeDelivery.snapped_dropoff_lat ?? activeDelivery.dropoff_lat,
                longitude: activeDelivery.snapped_dropoff_lng ?? activeDelivery.dropoff_lng,
                title: "Dropoff Destination",
                description: activeDelivery.dropoff_address
            };
        }
    }, [activeDelivery]);

    // Check for active deliveries
    const checkActiveDeliveries = useCallback(async () => {
        if (!riderId) {
            setHasResolvedInitialActiveDelivery(false);
            return;
        }
        try {
            const { supabase } = await import('../../services/supabaseClient');
            if (!supabase) {
                setHasActiveDelivery(false);
                setActiveDelivery(null);
                return;
            }
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, customer:profiles!deliveries_customer_id_fkey(full_name, phone_number)')
                .eq('rider_id', riderId)
                .in('status', ['ASSIGNED', 'PENDING', 'IN_TRANSIT', 'ARRIVED', 'RETURNING', 'TAMPERED'])
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
        } finally {
            setHasResolvedInitialActiveDelivery(true);
        }
    }, [riderId]);

    useEffect(() => {
        if (!riderId) return;

        setHasResolvedInitialActiveDelivery(false);
        checkActiveDeliveries();
        // Re-check every 30 seconds
        const interval = setInterval(checkActiveDeliveries, 30000);
        return () => clearInterval(interval);
    }, [riderId, checkActiveDeliveries]);

    // Rider-side delivery status watcher — fires lock-screen notifications for events
    // the rider didn't initiate (customer cancellation, box tamper, delivery confirmed).
    useEffect(() => {
        if (!activeDelivery?.id) {
            prevRiderDeliveryStatus.current = null;
            return;
        }

        const deliveryId = activeDelivery.id;

        const unsubscribe = subscribeToDelivery(deliveryId, (data) => {
            if (
                data?.status &&
                prevRiderDeliveryStatus.current !== null &&
                data.status !== prevRiderDeliveryStatus.current
            ) {
                // Only notify the rider about statuses they didn't personally trigger.
                const RIDER_ALERT_MESSAGES: Record<string, { title: string; body: string }> = {
                    CANCELLED: { title: '❌ Order Cancelled', body: 'The customer has cancelled this delivery.' },
                    TAMPERED: { title: '⚠️ Security Alert!', body: 'Box tamper detected on your active delivery!' },
                    COMPLETED: { title: '✅ Delivery Confirmed', body: 'Customer confirmed delivery. Great work!' },
                };
                const msg = RIDER_ALERT_MESSAGES[data.status];
                if (msg) {
                    showStatusNotification(msg.title, msg.body, { deliveryId, status: data.status })
                        .catch(console.error);
                }
            }
            prevRiderDeliveryStatus.current = data?.status ?? null;
        });

        return unsubscribe;
    }, [activeDelivery?.id]);

    // EC-15: OEM Kill Protection — show one-time dialog for aggressive manufacturers
    useEffect(() => {
        if (!isOnline) return; // Only when rider first goes online

        const showOemWarning = async () => {
            try {
                const { needsAction, info } = await checkOemProtection();
                if (needsAction && info) {
                    PremiumAlert.alert(
                        `${info.name} Battery Optimization`,
                        `Your ${info.name} device may kill background apps. To ensure reliable GPS tracking during deliveries:\n\n${info.instructions}`,
                        [
                            { text: 'Open Guide', onPress: () => Linking.openURL(info.url) },
                            { text: 'Done', onPress: () => markOemProtectionDone() },
                            { text: 'Remind Later', style: 'cancel' },
                        ]
                    );
                }
            } catch (e) {
                console.error('[RiderDashboard] OEM check failed:', e);
            }
        };

        showOemWarning();
    }, [isOnline]);

    // ── Tracking activation: responds to pairing changes.
    //    When paired + online, we MUST start the background location service
    //    so phone GPS data is written to locations/{boxId} in Firebase.
    //    activateTracking() alone only controls the redundancy service power state;
    //    the actual Firebase writes come from the background location service.
    //    NOTE: Race condition is now fixed in stop(), so we safely call it when unpaired. ──
    useEffect(() => {
        const trackingBoxId = (isPaired && pairedBoxId) ? pairedBoxId : activeDeliveryBoxId;
        const isTrackingContextPending = (
            isRestoringSession
            || !riderId
            || !hasResolvedInitialActiveDelivery
            || !hasResolvedPairingState
        );

        // Track whenever there is a box to track — isOnline does NOT gate location.
        // isOnline only controls the rider's availability in the new-order matching pool.
        if (trackingBoxId) {
            console.log('[RiderDashboard] trackingBoxId present — tracking always on:', trackingBoxId);
            startMonitoring(trackingBoxId);
            activateTracking();
        } else {
            if (isTrackingContextPending) {
                console.log('[RiderDashboard] Tracking context still hydrating — preserving current background service state');
                return;
            }

            // No box associated at all — nothing to track
            console.log('[RiderDashboard] No trackingBoxId after hydration — stopping tracking');
            deactivateTracking();
            stopMonitoring();
        }
    }, [
        isOnline,
        isPaired,
        pairedBoxId,
        activeDelivery?.id,
        activeDelivery?.status,
        activeDelivery?.assigned_box_id,
        activeDelivery?.box_id,
        isRestoringSession,
        riderId,
        hasResolvedInitialActiveDelivery,
        hasResolvedPairingState,
    ]);

    // Auto-start monitoring for hardware state (read-only subscriptions)
    useEffect(() => {
        if (boxIdForMonitoring && isPaired) {
            startMonitoring(boxIdForMonitoring);
        }

        // EC-Update: Subscribe to box state for lock status
        const unsubscribeBox = boxIdForMonitoring ? subscribeToBoxState(boxIdForMonitoring, (state) => {
            setBoxState(state);
        }) : () => { };

        // EC-03: Subscribe to battery state
        const unsubscribeBattery = boxIdForMonitoring ? subscribeToBattery(boxIdForMonitoring, (state) => {
            setBatteryState(state);

            // Show alert on low battery
            if (state?.lowBatteryWarning && !state?.criticalBatteryWarning) {
                PremiumAlert.alert(
                    'Low Battery Warning',
                    `Box battery is at ${state.percentage}%. Consider completing current delivery soon.`,
                    [{ text: 'OK' }]
                );
            } else if (state?.criticalBatteryWarning) {
                PremiumAlert.alert(
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
                PremiumAlert.alert(
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
            if (location && lastGpsLocationRef.current) {
                // Calculate distance using Haversine approximation
                const R = 6371000;
                const dLat = (location.latitude - lastGpsLocationRef.current.latitude) * Math.PI / 180;
                const dLon = (location.longitude - lastGpsLocationRef.current.longitude) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lastGpsLocationRef.current.latitude * Math.PI / 180) * Math.cos(location.latitude * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distanceMeters = R * c;

                const timeDelta = (location.timestamp - lastGpsLocationRef.current.timestamp) / 1000;
                if (timeDelta > 0 && isSpeedAnomaly(distanceMeters, timeDelta)) {
                    setGpsSpoofWarning(true);
                    PremiumAlert.alert(
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
            lastGpsLocationRef.current = location;
        });

        // EC-82: Subscribe to Keypad
        const unsubscribeKeypad = subscribeToKeypad(boxIdForMonitoring, (state) => {
            setKeypadState(state);
            if (state?.is_stuck) {
                PremiumAlert.alert(
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
                PremiumAlert.alert(
                    '🚨 PHYSICAL DAMAGE DETECTED',
                    'Door sensor mismatch detected while locked. Inspect box immediately!',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
            }
        });

        return () => {
            unsubscribeBox();
            unsubscribeBattery();
            unsubscribeTamper();
            unsubscribeNetInfo?.();
            unsubscribeLocation();
            unsubscribeKeypad();
            unsubscribeHinge();
        };
    }, [boxIdForMonitoring, isPaired]);

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

    // Subscribe to incoming order requests (and setup notifications)
    useEffect(() => {
        console.log('[RiderDashboard] Order Listener Effect. isOnline:', isOnline, 'riderId:', riderId, 'active:', hasActiveDelivery);

        if (!riderId) return;

        // 1. Handle "Offline" state explicitly
        if (!isOnline) {
            console.log('[RiderDashboard] Rider is offline. Removing from online_riders.');
            removeRiderFromOnline(riderId);
            // Don't subscribe to anything if offline
            return;
        }

        // 2. Setup push notifications (idempotent-ish)
        const initNotifications = async () => {
            await setupNotificationChannels();
            const token = await registerForPushNotifications();
            if (token) {
                setPushToken(token);
            }
        };
        initNotifications();

        let unsubscribeRequests = () => { };

        // 3. Subscribe to orders ONLY if no active delivery
        if (!hasActiveDelivery) {
            console.log('[RiderDashboard] Subscribing to rider requests for:', riderId);
            unsubscribeRequests = subscribeToRiderRequests(riderId, (requests) => {
                console.log('[RiderDashboard] Received rider requests update. Count:', requests.length);
                setIncomingRequests(requests);

                if (requests.length > 0) {
                    setShowOrderModal(true);
                    const latestRequest = requests[0];
                    showIncomingOrderNotification(
                        latestRequest.data.pickupAddress,
                        latestRequest.data.dropoffAddress,
                        latestRequest.data.estimatedFare,
                        latestRequest.data.bookingId
                    );
                } else {
                    setShowOrderModal(false);
                }
            });
        } else {
            // Ensure modal is closed if we have a delivery
            setShowOrderModal(false);
            setIncomingRequests([]);
        }

        // 4. Notification Listener
        const notificationListener = addNotificationReceivedListener((notification) => {
            const data = notification.request.content.data;
            if (data?.type === 'INCOMING_ORDER') {
                // handled via firebase subscription
            }
        });

        // Cleanup
        return () => {
            unsubscribeRequests();
            notificationListener?.remove?.();
            // NOTE: We do NOT removeRiderFromOnline here. 
            // We only remove if isOnline becomes false (handled at start of effect)
            // or if unmounting (handled by onDisconnect in service typically, or we could add a sturdy cleanup).
        };
    }, [isOnline, riderId, hasActiveDelivery]);

    useEffect(() => {
        if (!riderId) {
            return;
        }

        // EC-FIX: Intelligent Location Source Selection
        // Only prefer "redundant" location if it comes from the BOX and the box is ONLINE.
        // If the box is offline, or the source is 'phone', we prefer our own fresh riderLocation
        // to avoid stale loopbacks from Firebase.
        const shouldUseRedundancy = lastLocation && (lastLocation.source === 'box' || isBoxOnline);

        const loc = shouldUseRedundancy ? {
            latitude: lastLocation!.latitude,
            longitude: lastLocation!.longitude
        } : (riderLocation ? {
            latitude: riderLocation.coords.latitude,
            longitude: riderLocation.coords.longitude
        } : null);

        if (loc) {
            updateRiderStatus(
                riderId,
                loc.latitude,
                loc.longitude,
                !hasActiveDelivery, // Only available if NO active delivery
                pushToken || undefined
            );
        }
    }, [isOnline, lastLocation, riderLocation, riderId, pushToken, hasActiveDelivery]);

    // EC-78: Subscribe to Reassignment Updates
    useEffect(() => {
        const boxId = boxIdForMonitoring;
        const unsubscribe = subscribeToReassignment(boxId, (state) => {
            setReassignmentState(state);
        });
        return unsubscribe;
    }, [boxIdForMonitoring]);

    useEffect(() => {
        if (!riderId) {
            setHasResolvedPairingState(false);
            setPairingState(null);
            return;
        }

        setHasResolvedPairingState(false);
        const unsubscribe = subscribeToRiderPairing(riderId, (state) => {
            setPairingState(isPairingActive(state) ? state : null);
            setHasResolvedPairingState(true);
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
                PremiumAlert.alert(
                    '⚠️ Session Issue',
                    `Authentication refresh failed after ${attempts} attempts. Please re-login if issues persist.`,
                    [{ text: 'OK' }]
                );
            },
            onForceRelogin: () => {
                PremiumAlert.alert(
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
                PremiumAlert.alert(
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
    const handleAcceptOrder = useCallback(async (requestItem: { requestId: string; data: RiderOrderRequest }, phoneOverride?: string) => {
        if (!riderId || !requestItem) return;

        // GUARDRAIL: Rider must have a paired box
        if (!isPaired || !boxIdForMonitoring) {
            PremiumAlert.alert(
                'No Box Paired',
                'You must pair with a Smart Box before accepting orders to ensure safety and tracking.',
                [{ text: 'OK', onPress: () => navigation.navigate('BoxPairing') }]
            );
            return;
        }

        // GUARDRAIL: Rider must have a mobile number
        const phoneToUse = phoneOverride || riderPhone;

        if (!phoneToUse || phoneToUse.trim() === '') {
            // Store request and show modal to enter number
            setPendingRequestItem(requestItem);
            setShowPhoneModal(true);
            return;
        }

        console.log(`[ACCEPT] boxIdForMonitoring='${boxIdForMonitoring}' isPaired=${isPaired}`);
        const success = await acceptOrder(
            riderId,
            requestItem.data.bookingId,
            requestItem.requestId,
            {
                riderName,
                riderPhone: phoneToUse,
                boxId: boxIdForMonitoring,
            }
        );

        if (success) {
            setShowOrderModal(false);
            setIncomingRequests([]); // Clear requests optimistically
            setHasActiveDelivery(true); // Stop listening for new requests immediately
            checkActiveDeliveries(); // Fetch active delivery details right away for the dashboard

            // Prepare trip details for preview
            const tripDetails = {
                pickupAddress: requestItem.data.pickupAddress,
                dropoffAddress: requestItem.data.dropoffAddress,
                estimatedFare: requestItem.data.estimatedFare,
                distance: `${requestItem.data.distance?.toFixed(1) || '--'} km`,
                duration: `${requestItem.data.duration?.toFixed(0) || '--'} min`,
                pickupLat: requestItem.data.pickupLat,
                pickupLng: requestItem.data.pickupLng,
                dropoffLat: requestItem.data.dropoffLat,
                dropoffLng: requestItem.data.dropoffLng,
                bookingId: requestItem.data.bookingId, // Store ID for start
                customerName: requestItem.data.customerName || 'Customer', // EC-Fix: Added
            };

            setAcceptedTripDetails(tripDetails);
            setShowTripPreview(true);
        } else {
            // Booking was already accepted by another rider (race condition handled)
            PremiumAlert.alert(
                'Order Unavailable',
                'This delivery was already accepted by another rider.',
                [{ text: 'OK' }]
            );
        }
    }, [riderId, riderName, riderPhone, boxIdForMonitoring, isPaired, navigation]);

    // Handle rejecting an order
    const handleRejectOrder = useCallback(async (requestId: string) => {
        await rejectOrder(riderId, requestId);
        // Subscription will automatically update the list
    }, [riderId]);

    // Trip Preview State


    // EC-32: Handle Cancellation Submit
    const handleCancellationSubmit = async (reason: CancellationReason, details: string) => {
        if (!nextDelivery) {
            PremiumAlert.alert('Error', 'No active delivery to cancel');
            return;
        }
        setCancelLoading(true);
        try {
            const result = await requestCancellation({
                deliveryId: nextDelivery.id,
                boxId: boxIdForMonitoring,
                reason,
                reasonDetails: details,
                riderId: riderId || getAuth().currentUser?.uid || '', // EC-Fix: Fallback to Firebase Auth
                riderName: riderName || 'Rider',
                currentStatus: nextDelivery.status,
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
                PremiumAlert.alert('Cancellation Failed', result.error || 'Unknown error');
            }
        } catch (err) {
            PremiumAlert.alert('Error', 'An unexpected error occurred');
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

    const lastRouteFetchLocation = useRef<{ latitude: number, longitude: number } | null>(null);
    const lastRouteDestination = useRef<{ latitude: number, longitude: number } | null>(null);

    // Track last ETA update to prevent DB spam
    const lastEtaUpdateRef = useRef<number>(0);

    // Fetch route from Mapbox Directions API
    const fetchRoute = useCallback(async () => {
        // EC-FIX: Use lastLocation (live) if available, otherwise riderLocation (initial)
        const currentLoc = lastLocation ? {
            latitude: lastLocation.latitude,
            longitude: lastLocation.longitude
        } : (riderLocation ? {
            latitude: riderLocation.coords.latitude,
            longitude: riderLocation.coords.longitude
        } : null);

        if (!currentLoc || !MAPBOX_TOKEN || !destination) {
            // Keep existing geometry if we just lost location momentarily
            return;
        }

        // Throttle: Only fetch if moved > 20 meters from last fetch
        let shouldFetch = true;

        // EC-FIX: Check if destination changed. If so, force fetch to get accurate ETA/Route.
        const destinationChanged = !lastRouteDestination.current ||
            lastRouteDestination.current.latitude !== destination.latitude ||
            lastRouteDestination.current.longitude !== destination.longitude;

        if (!destinationChanged && lastRouteFetchLocation.current) {
            const dist = calculateDistance(
                currentLoc.latitude,
                currentLoc.longitude,
                lastRouteFetchLocation.current.latitude,
                lastRouteFetchLocation.current.longitude
            );
            // calculateDistance returns string "X.XX km" - parse it
            const distKm = parseFloat(dist);
            if (distKm < 0.02) { // 20 meters
                shouldFetch = false;
            }
        }

        if (!shouldFetch) return;

        lastRouteDestination.current = { latitude: destination.latitude, longitude: destination.longitude };

        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${currentLoc.longitude},${currentLoc.latitude};${destination.longitude},${destination.latitude}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                setRouteGeometry(route.geometry);
                lastRouteFetchLocation.current = currentLoc;

                // Update distance with actual route distance
                const distanceKm = (route.distance / 1000).toFixed(2);
                setDistance(`${distanceKm} km`);

                // Update duration
                const durationMins = Math.round(route.duration / 60);

                // Calculate Clock Time ETA
                const etaTime = dayjs().add(durationMins, 'minute').format('h:mm A');
                setDuration(`${durationMins} min (Arrives ~${etaTime})`);

                // EC-FIX: Update estimated_dropoff_time in DB
                // Only if we have an active delivery and it's been > 60s since last update
                if (activeDelivery?.id && activeDelivery.status === 'IN_TRANSIT') {
                    const now = Date.now();
                    if (now - lastEtaUpdateRef.current > 60000) { // 1 minute throttle
                        const etaTimestamp = dayjs().add(route.duration, 'second').toISOString();

                        // Fire and forget update
                        supabase
                            .from('deliveries')
                            .update({ estimated_dropoff_time: etaTimestamp })
                            .eq('id', activeDelivery.id)
                            .then(({ error }) => {
                                if (error) console.log('[RiderDashboard] Failed to update ETA:', error);
                                else {
                                    console.log('[RiderDashboard] Updated ETA:', etaTimestamp);
                                    lastEtaUpdateRef.current = now;
                                }
                            });
                    }
                }
            }
        } catch (error) {
            console.error('Route calculation error:', error);
            // do not clear geometry on error, keep stale route
        }
    }, [riderLocation, lastLocation, MAPBOX_TOKEN, destination, activeDelivery?.id, activeDelivery?.status]);

    // Calculate route when location changes
    useEffect(() => {
        fetchRoute();
    }, [fetchRoute, lastLocation]); // Add lastLocation dependency explicitly



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
            PremiumAlert.alert('Permission to access location was denied');
            return;
        }

        try {
            // EC-FIX: Try to get last known position first for immediate UI feedback
            const lastKnown = await Location.getLastKnownPositionAsync({});
            console.log('[RiderDashboard] fetchLocation - lastKnown:', lastKnown);
            if (lastKnown) {
                setRiderLocation(lastKnown);

                // Only calculate initial straight-line distance if we don't have a route yet
                if (!routeGeometry) {
                    const dist = calculateDistance(
                        lastKnown.coords.latitude,
                        lastKnown.coords.longitude,
                        destination.latitude,
                        destination.longitude
                    );
                    setDistance(`${dist} km`);
                }
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
        await Promise.all([
            fetchLocation(),
            checkActiveDeliveries()
        ]);
        setRefreshing(false);
    }, [fetchLocation, checkActiveDeliveries]);

    const handleNavigate = (target: 'PICKUP' | 'DROPOFF' = 'DROPOFF') => {
        if (!nextDelivery) return;

        let lat, lng, label;

        if (target === 'PICKUP') {
            lat = nextDelivery.pickupLat;
            lng = nextDelivery.pickupLng;
            label = nextDelivery.pickupAddress || 'Pickup';
        } else {
            lat = nextDelivery.dropoffLat;
            lng = nextDelivery.dropoffLng;
            label = nextDelivery.address || 'Dropoff';
        }

        // Check for valid coordinates (not null/undefined and not 0,0)
        const hasCoords = lat && lng && (lat !== 0 || lng !== 0);

        if (hasCoords) {
            const latLng = `${lat},${lng}`;
            const url = Platform.select({
                ios: `maps:?ll=${latLng}&q=${label}`,
                android: `geo:${latLng}?q=${latLng}(${label})`
            });
            if (url) Linking.openURL(url);
        } else {
            // Fallback to address query if coordinates are missing/zero
            if (label) {
                const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
                const url = Platform.select({
                    ios: `${scheme}${label}`,
                    android: `${scheme}${label}`
                });
                if (url) Linking.openURL(url);
            }
        }
    };

    const toggleLock = () => {
        if (!boxIdForMonitoring) return;

        PremiumAlert.alert(
            isLocked ? "Unlock Box?" : "Lock Box?",
            isLocked ? "Are you sure you want to unlock the box?" : "Ensure the box is closed before locking.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: isLocked ? "Unlock" : "Lock", onPress: () => {
                        const action = isLocked ? "UNLOCKING" : "LOCKED";
                        updateBoxState(boxIdForMonitoring, { status: action });
                    }
                }
            ]
        );
    };

    // Live weather state
    const [weather, setWeather] = useState<WeatherData | null>(null);



    const boxStatus = {
        battery: batteryState?.percentage ? batteryState.percentage / 100 : 0,
        connection: boxState?.connection || 'Offline',
        signal: boxState?.rssi ? `${boxState.rssi} dBm` : 'No Signal',
    };

    // Fetch live weather when rider location is available
    useEffect(() => {
        if (!riderLocation) return;
        fetchWeather(riderLocation.coords.latitude, riderLocation.coords.longitude).then((data) => {
            if (data) setWeather(data);
        });
    }, [riderLocation]);

    // EC-03: Get battery icon based on level
    // EC-03: Get battery icon based on level
    const getBatteryIcon = () => {
        if (!batteryState) return 'battery-unknown';
        const pct = batteryState.percentage;
        if (pct > 80) return 'battery';
        if (pct > 60) return 'battery-70';
        if (pct > 40) return 'battery-50';
        if (pct > 20) return 'battery-30';
        return 'battery-alert';
    };

    const getBatteryColor = () => {
        if (!batteryState) return '#9E9E9E';
        const pct = batteryState.percentage;
        if (pct > 20) return '#2196F3';
        if (pct > 10) return '#FF9800';
        return '#F44336';
    };

    const QuickAction = ({ icon, label, onPress, color }) => (
        <TouchableOpacity style={styles.actionItem} onPress={onPress} activeOpacity={0.7}>
            <View style={[styles.actionIcon, { backgroundColor: color + '14', borderWidth: 1, borderColor: color + '30' }]}>
                <MaterialCommunityIcons name={icon} size={22} color={color} />
            </View>
            <Text style={[styles.actionLabel, { color: c.textSec }]}>{label}</Text>
        </TouchableOpacity>
    );

    const statusToggleAnim = useEntryAnimation(0);
    const gpsCardAnim = useEntryAnimation(55);
    const pairingAnim = useEntryAnimation(100);
    const actionsAnim = useStaggerAnimation(4, 45, 145);
    const jobAnim = useEntryAnimation(215);

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar style={isDarkMode ? 'light' : 'dark'} />
            {/* Incoming Order Modal - overlays entire screen */}
            <IncomingOrderModal
                visible={showOrderModal}
                requests={incomingRequests}
                onAccept={handleAcceptOrder}
                onReject={handleRejectOrder}

            />

            {/* Trip Preview Modal - shown after accepting an order */}
            <TripPreviewModal
                visible={showTripPreview}
                onDismiss={() => setShowTripPreview(false)}
                onStartTrip={() => {
                    setShowTripPreview(false);
                    // Navigation or state update happens automatically via activeDelivery effect
                }}
                tripDetails={acceptedTripDetails}
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

            <ExitConfirmationModal
                visible={showExitModal}
                onDismiss={() => setShowExitModal(false)}
                onConfirm={handleExit}
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
                    <View style={[styles.warningBanner, { backgroundColor: c.orangeBg, borderWidth: 1, borderColor: c.orangeText, marginBottom: 16 }]}>
                        <MaterialCommunityIcons
                            name={getReassignmentType(reassignmentState, riderId) === 'outgoing' ? "swap-horizontal" : "account-switch"}
                            size={24}
                            color={c.orangeText}
                        />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.bannerTitle, { color: c.orangeText }]}>
                                {getReassignmentType(reassignmentState, riderId) === 'outgoing' ? 'REASSIGNMENT PENDING' : 'NEW ASSIGNMENT'}
                            </Text>
                            <Text style={[styles.bannerText, { color: c.orangeText }]}>
                                Action required for delivery update.
                            </Text>
                        </View>
                        <Button mode="text" onPress={() => setShowReassignmentModal(true)} textColor={c.orangeText}>View</Button>
                    </View>
                )}

                {/* EC-89: Session Expiry Banner */}
                <SessionExpiryBanner
                    status={tokenStatus}
                    onReloginRequired={() => navigation.navigate('Login')}
                />
                {/* EC-18: Tamper Alert Banner */}
                {tamperState?.detected && (
                    <View style={[styles.tamperBanner, { backgroundColor: c.redBg, borderWidth: 1, borderColor: c.redText }]}>
                        <MaterialCommunityIcons name="alert-decagram" size={24} color={c.redText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.tamperTitle, { color: c.redText }]}>SECURITY ALERT</Text>
                            <Text style={[styles.tamperText, { color: c.redText }]}>Unauthorized box access detected!</Text>
                        </View>
                    </View>
                )}

                {/* EC-82: Keypad Warning Banner */}
                {keypadState?.is_stuck && (
                    <View style={[styles.warningBanner, { backgroundColor: c.orangeBg, borderWidth: 1, borderColor: c.orangeText }]}>
                        <MaterialCommunityIcons name="keyboard-off" size={24} color={c.orangeText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.bannerTitle, { color: c.orangeText }]}>KEYPAD MALFUNCTION</Text>
                            <Text style={[styles.bannerText, { color: c.orangeText }]}>Key '{keypadState.stuck_key}' is stuck. Use App Unlock.</Text>
                        </View>
                    </View>
                )}

                {/* EC-85: Recall Banner */}
                {recallState.isRecalled && (
                    <View style={[styles.dangerBanner, { backgroundColor: c.redBg, borderWidth: 1, borderColor: c.redText }]}>
                        <MaterialCommunityIcons name="backup-restore" size={24} color={c.redText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.bannerTitle, { color: c.redText }]}>PACKAGE RECALLED</Text>
                            <Text style={[styles.bannerText, { color: c.redText }]}>Return to Sender immediately!</Text>
                            {recallState.returnOtp && (
                                <Text style={[styles.bannerText, { color: c.redText, fontWeight: 'bold', marginTop: 4 }]}>
                                    Return OTP: {recallState.returnOtp}
                                </Text>
                            )}
                        </View>
                    </View>
                )}

                {/* EC-84: GPS Health Warning */}
                {gpsHealth?.isDegraded && (
                    <View style={[styles.warningBanner, { backgroundColor: c.orangeBg, borderWidth: 1, borderColor: c.orangeText }]}>
                        <MaterialCommunityIcons name="satellite-variant" size={24} color={c.orangeText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.bannerTitle, { color: c.orangeText }]}>WEAK GPS SIGNAL</Text>
                            <Text style={[styles.bannerText, { color: c.orangeText }]}>
                                {gpsHealth.obstructionDetected
                                    ? "Box antenna obstructed! Please clear package."
                                    : `Poor reception (HDOP: ${gpsHealth.hdop.toFixed(1)})`}
                            </Text>
                        </View>
                    </View>
                )}

                {/* EC-83: Hinge Damage Banner */}
                {hingeState?.status === 'DAMAGED' && (
                    <View style={[styles.dangerBanner, { backgroundColor: c.redBg, borderWidth: 1, borderColor: c.redText }]}>
                        <MaterialCommunityIcons name="door-open" size={24} color={c.redText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.bannerTitle, { color: c.redText }]}>HINGE DAMAGE</Text>
                            <Text style={[styles.bannerText, { color: c.redText }]}>Physical integrity compromised!</Text>
                        </View>
                    </View>
                )}

                {hingeState?.status === 'FLAPPING' && (
                    <View style={[styles.warningBanner, { backgroundColor: c.orangeBg, borderWidth: 1, borderColor: c.orangeText }]}>
                        <MaterialCommunityIcons name="door-open" size={24} color={c.orangeText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.bannerTitle, { color: c.orangeText }]}>DOOR SENSOR UNSTABLE</Text>
                            <Text style={[styles.bannerText, { color: c.orangeText }]}>Check for obstructions near door.</Text>
                        </View>
                    </View>
                )}
                {/* EC-01/EC-06: Offline Mode Banner */}
                <NetworkStatusBanner pendingSyncs={pendingSyncs} />

                {/* EC-08: GPS Spoofing Warning */}
                {gpsSpoofWarning && (
                    <View style={[styles.spoofWarning, { backgroundColor: c.orangeBg, borderWidth: 1, borderColor: c.orangeText }]}>
                        <MaterialCommunityIcons name="map-marker-alert" size={24} color={c.orangeText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.spoofTitle, { color: c.orangeText }]}>GPS ANOMALY</Text>
                            <Text style={[styles.spoofText, { color: c.orangeText }]}>Unusual location data detected</Text>
                        </View>
                        <TouchableOpacity onPress={() => setGpsSpoofWarning(false)}>
                            <MaterialCommunityIcons name="close" size={20} color={c.orangeText} />
                        </TouchableOpacity>
                    </View>
                )}

                {/* EC-46: Clock Skew Warning */}
                {clockSkewWarning && (
                    <View style={[styles.clockWarning, { backgroundColor: c.blueBg, borderWidth: 1, borderColor: c.blueText }]}>
                        <MaterialCommunityIcons name="clock-alert" size={20} color={c.blueText} />
                        <Text style={[styles.clockText, { color: c.blueText }]}>Device time may be out of sync</Text>
                        <TouchableOpacity onPress={() => setClockSkewWarning(false)}>
                            <MaterialCommunityIcons name="close" size={18} color={c.blueText} />
                        </TouchableOpacity>
                    </View>
                )}

                {/* EC-10: Photo Queue Full Warning */}
                {photoQueueFull && (
                    <View style={[styles.queueWarning, { backgroundColor: c.orangeBg, borderWidth: 1, borderColor: c.orangeText }]}>
                        <MaterialCommunityIcons name="image-off" size={20} color={c.orangeText} />
                        <Text style={[styles.queueText, { color: c.orangeText }]}>Photo queue full ({photoQueueCount}/{SAFETY_CONSTANTS.MAX_QUEUED_PHOTOS})</Text>
                    </View>
                )}

                {/* Status Toggle - EC-ENHANCE: Clear Offline/Online distinction */}
                <Animated.View style={statusToggleAnim.style}>
                    <View style={[styles.statusToggleContainer, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
                        <View style={styles.statusContainer}>
                            <View style={[styles.statusDot, { backgroundColor: isOnline ? c.greenText : c.textTer }]} />
                            <View>
                                <Text variant="titleMedium" style={[styles.statusText, { color: c.text }]}>
                                    {isOnline ? 'You are Online' : 'You are Offline'}
                                </Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {isOnline ? 'Receiving orders' : 'Browsing mode only'}
                                </Text>
                            </View>
                        </View>
                        <Switch value={isOnline} onValueChange={setIsOnline} trackColor={{ true: c.accent, false: c.search }} thumbColor={isDarkMode ? c.text : c.bg} />
                    </View>
                </Animated.View>

                {/* GPS Connection Status Indicator */}
                <Animated.View style={gpsCardAnim.style}>
                    <View style={[styles.gpsStatusCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
                        <View style={styles.gpsStatusRow}>
                            <View style={[
                                styles.gpsStatusIcon,
                                { backgroundColor: hasActiveDelivery ? getStatusColor(gpsSource, isBoxOnline) + '20' : c.search }
                            ]}>
                                <MaterialCommunityIcons
                                    name={hasActiveDelivery && gpsSource === 'box' ? 'access-point' : hasActiveDelivery && gpsSource === 'phone' ? 'cellphone' : 'access-point-off'}
                                    size={24}
                                    color={hasActiveDelivery ? getStatusColor(gpsSource, isBoxOnline) : c.textTer}
                                />
                            </View>
                            <View style={styles.gpsStatusInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>GPS Tracking</Text>
                                <Text variant="bodySmall" style={{ color: hasActiveDelivery ? (localPhoneLocation && gpsSource === 'none' ? c.orangeText : getStatusColor(gpsSource, isBoxOnline)) : c.textSec }}>
                                    {hasActiveDelivery ?
                                        (localPhoneLocation && gpsSource === 'none' ? 'Using Phone (Local Fallback)' : getStatusMessage(gpsSource, isBoxOnline))
                                        : 'No Active Delivery'}
                                </Text>
                            </View>
                            {phoneGpsActive && hasActiveDelivery && (
                                <Chip
                                    compact
                                    icon="phone"
                                    style={{ backgroundColor: c.orangeBg }}
                                    textStyle={{ fontSize: 10, color: c.orangeText }}
                                >
                                    Fallback
                                </Chip>
                            )}
                        </View>
                    </View>
                </Animated.View>

                {/* Pairing Status */}
                <Animated.View style={pairingAnim.style}>
                    <View style={[styles.pairingCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
                        <View style={styles.pairingRow}>
                            <View style={styles.pairingInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>
                                    {isPaired ? 'Box Paired' : 'No Box Paired'}
                                </Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {isPaired && pairedBoxId
                                        ? `Box ${pairedBoxId} • ${pairingModeLabel}`
                                        : 'Scan a box QR to link controls and health data.'}
                                </Text>
                            </View>
                            <Button
                                mode={isPaired ? 'outlined' : 'contained'}
                                textColor={isPaired ? c.text : c.accentText}
                                buttonColor={isPaired ? 'transparent' : c.accent}
                                style={{ borderColor: isPaired ? c.border : 'transparent' }}
                                onPress={() => {
                                    // "Manage" is for pairing/unpairing; controls are available via Box Status.
                                    navigation.navigate('PairBox');
                                }}
                            >
                                {isPaired ? 'Manage' : 'Pair Box'}
                            </Button>
                        </View>
                    </View>
                </Animated.View>

                {/* Quick Actions */}
                <Animated.View style={actionsAnim[0].style}>
                    <View style={styles.actionsGrid}>
                        <QuickAction
                            icon="cube-outline"
                            label="Box Status"
                            onPress={() => {
                                if (!isPaired || !pairedBoxId) {
                                    PremiumAlert.alert('Pair Required', 'Scan your box QR to access controls.');
                                    navigation.navigate('PairBox');
                                    return;
                                }
                                navigation.navigate('BoxControls', { boxId: pairedBoxId });
                            }}
                            color={c.accent}
                        />
                        <QuickAction icon="history" label="History" onPress={() => navigation.navigate('DeliveryRecords')} color={c.accent} />
                        <QuickAction icon="face-agent" label="Support" onPress={() => navigation.navigate('RiderSupport')} color={c.accent} />
                        <QuickAction icon="cog" label="Settings" onPress={() => navigation.navigate('RiderSettings')} color={c.accent} />
                    </View>
                </Animated.View>

                {/* Next Delivery Card */}
                <Animated.View style={jobAnim.style}>
                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Current Job</Text>
                    {nextDelivery ? (
                        <Card style={[styles.jobCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]} mode="contained" onPress={() => navigation.navigate('JobDetail', { job: nextDelivery })}>
                            <View style={styles.mapContainer}>
                                {(lastLocation || riderLocation) && MAPBOX_TOKEN ? (
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
                                            bounds={{
                                                ne: [
                                                    Math.max(lastLocation ? lastLocation.longitude : riderLocation!.coords.longitude, destination.longitude),
                                                    Math.max(lastLocation ? lastLocation.latitude : riderLocation!.coords.latitude, destination.latitude)
                                                ],
                                                sw: [
                                                    Math.min(lastLocation ? lastLocation.longitude : riderLocation!.coords.longitude, destination.longitude),
                                                    Math.min(lastLocation ? lastLocation.latitude : riderLocation!.coords.latitude, destination.latitude)
                                                ],
                                                paddingTop: 40,
                                                paddingRight: 40,
                                                paddingBottom: 40,
                                                paddingLeft: 40
                                            }}
                                            animationMode="easeTo"
                                            animationDuration={1000}
                                        />

                                        {/* Rider Location Marker */}
                                        <AnimatedRiderMarker
                                            latitude={lastLocation ? lastLocation.latitude : riderLocation!.coords.latitude}
                                            longitude={lastLocation ? lastLocation.longitude : riderLocation!.coords.longitude}
                                            rotation={riderLocation?.coords.heading || 0}
                                            speed={lastLocation?.speed ?? riderLocation?.coords.speed ?? undefined}
                                        />

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
                                    <View style={[styles.mapPlaceholder, { backgroundColor: c.search }]}>
                                        <Text style={{ color: c.textSec }}>
                                            {MAPBOX_TOKEN ? 'Loading Map...' : 'Map unavailable: configure MAPBOX_ACCESS_TOKEN'}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            <Card.Content style={styles.jobContent}>
                                <View style={styles.jobHeader}>
                                    <View style={{ flex: 1, marginRight: 8 }}>
                                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.text }}>{nextDelivery.customer}</Text>
                                        <Text variant="bodySmall" style={{ color: c.textSec }}>{nextDelivery.id}</Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Chip icon="map-marker-distance" compact style={{ backgroundColor: c.search, marginBottom: 4 }} textStyle={{ color: c.text }}>{distance}</Chip>
                                        <Chip compact style={{ backgroundColor: c.greenBg }} textStyle={{ fontSize: 10, color: c.greenText, fontWeight: 'bold' }}>{activeDelivery.status.replace(/_/g, ' ')}</Chip>
                                    </View>
                                </View>

                                <View style={[styles.divider, { backgroundColor: c.divider }]} />

                                {/* Pickup Section */}
                                <View style={{ marginBottom: 16 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                        <View style={[styles.badge, { backgroundColor: c.blueBg, width: 24, height: 24, borderRadius: 12, marginRight: 8 }]}>
                                            <MaterialCommunityIcons name="package-variant" size={14} color={c.blueText} />
                                        </View>
                                        <Text variant="labelSmall" style={{ color: c.blueText, fontWeight: 'bold' }}>PICKUP</Text>
                                    </View>
                                    <View style={[styles.addressContainer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                                        <Text variant="bodyMedium" style={[styles.address, { flex: 1, marginBottom: 0, marginLeft: 0, color: c.text }]}>
                                            {nextDelivery.pickupAddress || 'Pickup Address'}
                                        </Text>
                                        <IconButton
                                            icon="navigation"
                                            mode="contained"
                                            containerColor={c.search}
                                            iconColor={c.text}
                                            size={20}
                                            onPress={() => handleNavigate('PICKUP')}
                                            style={{ margin: 0, marginLeft: 8 }}
                                        />
                                    </View>
                                </View>

                                {/* Conditional Dropoff/Return Section */}
                                {['RETURNING', 'TAMPERED'].includes(activeDelivery.status) ? (
                                    <View style={{ marginBottom: 8 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                            <View style={[styles.badge, { backgroundColor: c.redBg, width: 24, height: 24, borderRadius: 12, marginRight: 8 }]}>
                                                <MaterialCommunityIcons name="keyboard-return" size={14} color={c.redText} />
                                            </View>
                                            <Text variant="labelSmall" style={{ color: c.redText, fontWeight: 'bold' }}>RETURN DESTINATION</Text>
                                        </View>
                                        <View style={[styles.addressContainer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                                            <Text variant="bodyMedium" style={[styles.address, { flex: 1, marginBottom: 0, marginLeft: 0, color: c.text }]}>
                                                {nextDelivery.pickupAddress || 'Pickup Address'}
                                            </Text>
                                            <IconButton
                                                icon="navigation"
                                                mode="contained"
                                                containerColor={c.search}
                                                iconColor={c.text}
                                                size={20}
                                                onPress={() => handleNavigate('PICKUP')}
                                                style={{ margin: 0, marginLeft: 8 }}
                                            />
                                        </View>
                                    </View>
                                ) : (
                                    <View style={{ marginBottom: 8 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                            <View style={[styles.badge, { backgroundColor: c.redBg, width: 24, height: 24, borderRadius: 12, marginRight: 8 }]}>
                                                <MaterialCommunityIcons name="map-marker" size={14} color={c.redText} />
                                            </View>
                                            <Text variant="labelSmall" style={{ color: c.redText, fontWeight: 'bold' }}>DROPOFF</Text>
                                        </View>
                                        <View style={[styles.addressContainer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                                            <Text variant="bodyMedium" style={[styles.address, { flex: 1, marginBottom: 0, marginLeft: 0, color: c.text }]}>
                                                {nextDelivery.address}
                                            </Text>
                                            <IconButton
                                                icon="navigation"
                                                mode="contained"
                                                containerColor={c.search}
                                                iconColor={c.text}
                                                size={20}
                                                onPress={() => handleNavigate('DROPOFF')}
                                                style={{ margin: 0, marginLeft: 8 }}
                                            />
                                        </View>
                                    </View>
                                )}


                                <View style={styles.jobMeta}>
                                    <View style={styles.metaItem}>
                                        <MaterialCommunityIcons name="clock-outline" size={16} color={c.textSec} />
                                        <Text style={[styles.metaText, { color: c.textSec }]}>ETA: {nextDelivery.estimatedTime || '-- min'}</Text>
                                    </View>
                                </View>
                            </Card.Content>

                            <Card.Content style={styles.jobActions}>
                                <Button
                                    mode="contained"
                                    style={{ width: '100%', borderRadius: 8, marginBottom: 12 }}
                                    contentStyle={{ height: 56 }}
                                    labelStyle={{ fontSize: 18, fontWeight: 'bold' }}
                                    onPress={() => {
                                        const isPickup = !['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED'].includes(activeDelivery.status);
                                        navigation.navigate('Arrival', {
                                            deliveryId: nextDelivery.id,
                                            boxId: nextDelivery.boxId,
                                            targetLat: isPickup ? (nextDelivery.snappedPickupLat ?? nextDelivery.pickupLat) : (nextDelivery.snappedDropoffLat ?? nextDelivery.dropoffLat),
                                            targetLng: isPickup ? (nextDelivery.snappedPickupLng ?? nextDelivery.pickupLng) : (nextDelivery.snappedDropoffLng ?? nextDelivery.dropoffLng),
                                            targetAddress: isPickup ? nextDelivery.pickupAddress : nextDelivery.address,
                                            customerPhone: nextDelivery.phone,
                                            senderName: (nextDelivery as any).sender_name || (activeDelivery as any)?.sender_name,
                                            senderPhone: (nextDelivery as any).sender_phone || (activeDelivery as any)?.sender_phone,
                                            recipientName: (nextDelivery as any).recipient_name || (activeDelivery as any)?.recipient_name,
                                            deliveryNotes: (nextDelivery as any).delivery_notes || (activeDelivery as any)?.delivery_notes,
                                            riderName: riderName,
                                            pickupAddress: nextDelivery.pickupAddress,
                                            pickupLat: nextDelivery.pickupLat,
                                            pickupLng: nextDelivery.pickupLng,
                                            dropoffAddress: nextDelivery.address,
                                            dropoffLat: nextDelivery.dropoffLat,
                                            dropoffLng: nextDelivery.dropoffLng,
                                        });
                                    }}
                                    buttonColor={c.accent}
                                    textColor={c.accentText}
                                    icon="navigation"
                                >
                                    {['PICKED_UP', 'IN_TRANSIT', 'ARRIVED'].includes(activeDelivery.status) ? 'Resume Trip' : 'Start Trip'}
                                </Button>

                                <Button
                                    mode="outlined"
                                    style={{ width: '100%', borderRadius: 8, borderColor: c.border, marginBottom: 12 }}
                                    onPress={() => navigation.navigate('JobDetail', { job: nextDelivery })}
                                    textColor={c.text}
                                    icon="file-document-outline"
                                >
                                    View Job Details
                                </Button>

                                {!['RETURNING', 'CANCELLED', 'TAMPERED'].includes(activeDelivery.status) && (
                                    <Button
                                        mode="text"
                                        style={{ width: '100%', borderRadius: 8 }}
                                        onPress={() => setShowCancelModal(true)}
                                        textColor={c.redText}
                                    >
                                        Cancel Delivery
                                    </Button>
                                )}
                            </Card.Content>
                        </Card>
                    ) : (
                        <Card style={[styles.jobCard, { backgroundColor: c.search, borderColor: 'transparent', borderWidth: 0 }]} mode="contained">
                            <Card.Content style={{ alignItems: 'center', paddingVertical: 32 }}>
                                <MaterialCommunityIcons name="truck-delivery-outline" size={48} color={c.textTer} />
                                <Text variant="bodyLarge" style={{ color: c.textSec, marginTop: 12 }}>No current job</Text>
                                <Text variant="bodySmall" style={{ color: c.textTer, marginTop: 4 }}>Waiting for incoming orders</Text>
                            </Card.Content>
                        </Card>
                    )}
                </Animated.View>

                {/* Smart Box Status */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Box Status</Text>
                <View style={[styles.statusCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>

                    {/* Enhanced Unlock Button with Lottie */}
                    <View style={styles.unlockContainer}>
                        <View style={styles.unlockInfo}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.text }}>Lock Mechanism</Text>
                            <Text variant="bodyMedium" style={{ color: !isPaired ? c.textTer : (isLocked ? c.greenText : c.redText) }}>
                                {!isPaired ? 'No Box Connected' : (isLocked ? 'Securely Locked' : 'Unlocked')}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={[
                                styles.unlockButton,
                                {
                                    backgroundColor: !isPaired ? c.search : (isLocked ? c.greenBg : c.redBg),
                                    borderWidth: 1,
                                    borderColor: !isPaired ? c.border : (isLocked ? c.greenText : c.redText)
                                }
                            ]}
                            onPress={toggleLock}
                            disabled={!isPaired}
                        >
                            <MaterialCommunityIcons
                                name={!isPaired ? "shield-off-outline" : (isLocked ? "shield-lock" : "shield-lock-open")}
                                size={40}
                                color={!isPaired ? c.textTer : (isLocked ? c.greenText : c.redText)}
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={[styles.divider, { backgroundColor: c.divider }]} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: isPaired ? getBatteryColor() + '20' : c.search }]}>
                            <MaterialCommunityIcons
                                name={isPaired ? getBatteryIcon() as any : "battery-unknown"}
                                size={24}
                                color={isPaired ? getBatteryColor() : c.textTer}
                            />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall" style={{ color: c.text }}>Battery Level</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <ProgressBar
                                    progress={isPaired ? boxStatus.battery : 0}
                                    color={isPaired ? getBatteryColor() : c.textTer}
                                    style={styles.progressBar}
                                />
                                <Text variant="labelSmall" style={{ marginLeft: 8, fontWeight: 'bold', color: isPaired ? getBatteryColor() : c.textSec }}>
                                    {isPaired ? (batteryState ? `${batteryState.percentage}%` : 'Syncing...') : '--%'}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <View style={[styles.divider, { backgroundColor: c.divider }]} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: isPaired ? c.blueBg : c.search }]}>
                            <MaterialCommunityIcons
                                name={isPaired ? "bluetooth" : "bluetooth-off"}
                                size={24}
                                color={isPaired ? c.blueText : c.textTer}
                            />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall" style={{ color: c.text }}>Connection</Text>
                            <Text variant="bodySmall" style={{ color: c.textSec }}>
                                {isPaired ? `${boxStatus.connection} • ${boxStatus.signal}` : 'Not Connected'}
                            </Text>
                        </View>
                    </View>

                    <View style={{ flexDirection: 'row', marginTop: 16, gap: 8 }}>
                        {!isPaired && (
                            <Button
                                mode="contained"
                                style={{ flex: 1 }}
                                buttonColor={c.accent}
                                textColor={c.accentText}
                                onPress={() => navigation.navigate('PairBox')}
                            >
                                Pair Box
                            </Button>
                        )}
                        <Button
                            mode="outlined"
                            style={{ flex: 1, borderColor: c.border }}
                            textColor={c.text}
                            onPress={() => navigation.navigate('BoxControls')}
                        >
                            Advanced Controls
                        </Button>
                    </View>
                </View>



            </ScrollView >
            {/* Phone Entry Modal */}
            <PhoneEntryModal
                visible={showPhoneModal}
                onDismiss={() => {
                    setShowPhoneModal(false);
                    setPendingRequestItem(null);
                }}
                onSave={async (newPhone) => {
                    console.log('[RiderDashboard] Phone saved:', newPhone);

                    // Persist to auth store so riderPhone stays current across renders
                    const updateUser = (useAuthStore.getState() as any).updateUser;
                    if (updateUser) updateUser({ phone: newPhone });

                    setShowPhoneModal(false);

                    // Retry accepting the pending order with the new phone
                    if (pendingRequestItem) {
                        /* 
                           Override the closure's stale phone number by passing the new one directly.
                           The handleAcceptOrder logic has been updated to accept this override.
                        */
                        await handleAcceptOrder(pendingRequestItem, newPhone);
                        setPendingRequestItem(null);
                    }
                }}
                riderId={riderId || ''}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    bannerTitle: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    bannerText: {
        fontSize: 12,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
    },
    dangerBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
    },
    container: {
        flex: 1,
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
        padding: 16,
        borderRadius: 16,
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
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
    },
    jobCard: {
        marginBottom: 24,
        overflow: 'hidden',
        borderRadius: 16,
        elevation: 0,
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
        fontSize: 12,
        fontWeight: 'bold',
    },
    jobActions: {
        padding: 16,
        paddingTop: 0,
    },
    statusCard: {
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
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 20,
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
    },
    actionLabel: {
        fontSize: 12,
        marginTop: 6,
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
    },

    gpsStatusCard: {
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
        marginHorizontal: 16,
        marginTop: 16,
        padding: 16,
        borderRadius: 12,
    },
    tamperTitle: {
        fontWeight: 'bold',
        fontSize: 16,
    },
    tamperText: {
        fontSize: 14,
    },

    spoofWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
    },
    spoofTitle: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    spoofText: {
        fontSize: 12,
    },
    clockWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 8,
    },
    clockText: {
        flex: 1,
        fontSize: 12,
        marginLeft: 8,
    },
    queueWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: 8,
    },
    queueText: {
        fontSize: 12,
        marginLeft: 8,
        fontWeight: '600',
    },
    badge: {
        justifyContent: 'center',
        alignItems: 'center',
    }
});
