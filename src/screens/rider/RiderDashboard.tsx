import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Switch, ImageBackground, Alert, RefreshControl, TouchableOpacity, Dimensions, Linking, Platform, AppState, Animated, TouchableWithoutFeedback, FlatList, Modal, TextInput } from 'react-native';
import { useEntryAnimation, useStaggerAnimation, usePressScale } from '../../hooks/useEntryAnimation';
import { Text, Card, Button, Avatar, ProgressBar, MD3Colors, Chip, useTheme, IconButton, ActivityIndicator } from 'react-native-paper';
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
import { useSecurityAlerts } from '../../hooks/useSecurityAlerts';
import { subscribeToBattery, BatteryState, subscribeToTamper, TamperState, subscribeToLocation, LocationData, subscribeToKeypad, KeypadState, subscribeToHinge, HingeState, subscribeToBoxState, BoxState, updateBoxState, writePhoneLocation, updateLivePhoneCompassHeading } from '../../services/firebaseClient';
import {
    verifyRiderBiometricForUnlock,
    verifyRiderPersonalPinForUnlock,
    sendRiderUnlockCommand,
} from '../../services/personalPinService';
import { authenticateBiometricForUnlock } from '../../services/biometricAuthService';
import { useHeadingSmoothing } from '../../hooks/useHeadingSmoothing';
import { offlineCache, PendingSync } from '../../services/offlineCache';
import { NetworkStatusBanner } from '../../components';
import { isSpeedAnomaly, isClockSyncRequired, canAddToPhotoQueue, isGpsStale, SAFETY_CONSTANTS } from '../../services/SafetyLogic';
import RecallService from '../../services/recallService';
import { navigateWhenReady } from '../../navigation/navigationService';
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
    subscribeToAvailableOrders,
    RiderOrderRequest,
    runTimeoutSweep
} from '../../services/riderMatchingService';
import {
    registerForPushNotifications,
    setupNotificationChannels,
    showIncomingOrderNotification,
    showStatusNotification,
    showSecurityNotification,
    NOTIFICATION_CHANNELS,
    addNotificationReceivedListener,
} from '../../services/pushNotificationService';
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason } from '../../services/cancellationService';
import ReassignmentAlertModal from '../../components/ReassignmentAlertModal';
import PhoneEntryModal from '../../components/modals/PhoneEntryModal';
import AvailableOrdersModal from '../../components/modals/AvailableOrdersModal';
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
import NotificationBell from '../../components/NotificationBell';
import { getAuth } from 'firebase/auth'; // EC-Fix: Fallback auth
import { supabase } from '../../services/supabaseClient'; // EC-Fix: Session restoration
import { fetchActiveTamperIncident, RiderTamperIncident } from '../../services/tamperIncidentService';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { useExitAppConfirmation } from '../../hooks/useExitAppConfirmation';
import ExitConfirmationModal from '../../components/modals/ExitConfirmationModal';
import { StatusBar } from 'expo-status-bar';
import { PremiumAlert } from '../../services/PremiumAlertService';
import { authenticateBiometricForSensitiveAction } from '../../services/biometricAuthService';
import EarningsWidget from '../../components/EarningsWidget';

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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAROUSEL_CARD_WIDTH = SCREEN_WIDTH * 0.75;

const PROMO_SLIDES = [
    {
        id: '1',
        icon: 'lightning-bolt' as const,
        headline: 'Surge Pricing Active',
        subtitle: 'Earn up to 1.5x more on deliveries in high-demand zones today.',
        cta: 'View Map',
    },
    {
        id: '2',
        icon: 'shield-check-outline' as const,
        headline: 'Safety First',
        subtitle: 'Always follow traffic rules and wear your safety gear.',
        cta: 'Guidelines',
    },
    {
        id: '3',
        icon: 'star-outline' as const,
        headline: 'Deliver & Win',
        subtitle: 'Complete 20 deliveries this week for an extra ₱500 bonus.',
        cta: 'See Progress',
    },
    {
        id: '4',
        icon: 'account-group-outline' as const,
        headline: 'Refer a Rider',
        subtitle: 'Know someone who wants to ride with us? Refer them and earn ₱1000.',
        cta: 'Invite',
    },
];

export default function RiderDashboard() {
    const { showExitModal, setShowExitModal, handleExit } = useExitAppConfirmation();
    const navigation = useNavigation<any>();
    const [profile, setProfile] = useState<any>(null);

    // Track the booking IDs that we have already notified the user about in this session
    const notifiedBookingIds = useRef<Set<string>>(new Set());

    // AppState management
    const theme = useTheme();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const insets = useSafeAreaInsets();
    const [isOnline, setIsOnline] = useState(true);
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [riderLocation, setRiderLocation] = useState<Location.LocationObject | null>(null);
    const [mapZoomLevel, setMapZoomLevel] = useState(15);
    const headingSmoother = useHeadingSmoothing();
    const [showMapControls, setShowMapControls] = useState(false);

    // Real-time address for map preview card
    const [liveAddress, setLiveAddress] = useState<string>('Locating...');
    const [isGeocodingAddress, setIsGeocodingAddress] = useState(false);
    const lastGeocodedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
    const lastGeocodeTimeRef = useRef<number>(0);
    const GEOCODE_THROTTLE_MS = 30_000; // Re-geocode at most every 30s
    const GEOCODE_DISTANCE_THRESHOLD_M = 50; // Only re-geocode if moved >50m
    const [isRestoringSession, setIsRestoringSession] = useState(false); // EC-Fix: Session restoration state
    const [distance, setDistance] = useState<string>('Calculating...');
    const [boxState, setBoxState] = useState<BoxState | null>(null);
    const isLocked = boxState?.status === 'LOCKED';
    const animationRef = useRef<LottieView>(null);

    // Carousel state
    const [activeSlide, setActiveSlide] = useState(0);
    const flatListRef = useRef<FlatList>(null);
    const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleCarouselScrollEnd = (event: any) => {
        const offset = event.nativeEvent.contentOffset.x;
        const index = Math.round(offset / (CAROUSEL_CARD_WIDTH + 8));
        setActiveSlide(index);
    };

    useEffect(() => {
        autoScrollTimer.current = setInterval(() => {
            setActiveSlide((prev) => {
                const nextSlide = (prev + 1) % PROMO_SLIDES.length;
                flatListRef.current?.scrollToIndex({ index: nextSlide, animated: true });
                return nextSlide;
            });
        }, 4000);
        return () => {
            if (autoScrollTimer.current) clearInterval(autoScrollTimer.current);
        };
    }, []);

    const startTripPress = usePressScale();
    const detailsPress = usePressScale();
    const quickUnlockPress = usePressScale();

    // Quick Unlock state
    const [showQuickUnlockModal, setShowQuickUnlockModal] = useState(false);
    const [quickUnlockPin, setQuickUnlockPin] = useState('');
    const [quickUnlockSubmitting, setQuickUnlockSubmitting] = useState(false);
    const [showQuickUnlockPinText, setShowQuickUnlockPinText] = useState(false);
    const [quickUnlockProgress, setQuickUnlockProgress] = useState(0);
    const [quickUnlockProgressLabel, setQuickUnlockProgressLabel] = useState('');
    const quickUnlockActionLockRef = useRef(false);

    const sanitizeQuickPinInput = (value: string) => value.replace(/\D/g, '').slice(0, 6);

    const isPinOnlyUnlockError = (error: any): boolean => {
        const rawMessage = String(error?.message || '').toLowerCase();
        return rawMessage.includes('pin is required') || rawMessage.includes('high-risk state');
    };

    const resetQuickUnlockProgress = () => {
        setQuickUnlockProgress(0);
        setQuickUnlockProgressLabel('');
    };

    const handleQuickUnlock = async () => {
        if (quickUnlockActionLockRef.current || quickUnlockSubmitting) {
            return;
        }

        if (!isPaired || !pairedBoxId) {
            PremiumAlert.alert('No Box Paired', 'Scan your box QR to access controls.', [
                { text: 'Pair Box', onPress: () => navigation.navigate('PairBox') },
            ]);
            return;
        }
        if (!isLocked) {
            PremiumAlert.alert('Already Unlocked', 'The box is already in an unlocked state.');
            return;
        }

        const openPinModal = () => {
            setQuickUnlockPin('');
            setShowQuickUnlockPinText(false);
            setShowQuickUnlockModal(true);
            resetQuickUnlockProgress();
        };

        // High-risk state policy: PIN-only
        if (tamperState?.detected) {
            PremiumAlert.alert(
                'Personal PIN Required',
                'This box is in a high-risk state. Use your Rider Personal PIN (6 digits). Phone lock PIN/biometric fallback is not accepted for this unlock.'
            );
            openPinModal();
            return;
        }

        try {
            quickUnlockActionLockRef.current = true;
            setQuickUnlockSubmitting(true);
            setQuickUnlockProgress(0.2);
            setQuickUnlockProgressLabel('Verifying biometric...');
            const biometricResult = await authenticateBiometricForUnlock();

            if (!biometricResult.success) {
                openPinModal();
                return;
            }

            setQuickUnlockProgress(0.55);
            setQuickUnlockProgressLabel('Authorizing unlock...');
            const clientRequestId = `rider_quick_unlock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const { unlockToken } = await verifyRiderBiometricForUnlock(pairedBoxId, biometricResult.method, clientRequestId);

            setQuickUnlockProgress(0.85);
            setQuickUnlockProgressLabel('Sending command to box...');
            await sendRiderUnlockCommand(pairedBoxId, unlockToken, clientRequestId);

            setQuickUnlockProgress(1);
            setQuickUnlockProgressLabel('Command sent. Waiting for box acknowledgment...');
            PremiumAlert.alert('Unlock Command Sent', `Unlock queued for ${pairedBoxId}. Waiting for hardware acknowledgment.`);
            setTimeout(() => {
                resetQuickUnlockProgress();
            }, 1200);
        } catch (error: any) {
            console.error('[QuickUnlock] Biometric failed:', error);
            resetQuickUnlockProgress();
            if (isPinOnlyUnlockError(error)) {
                PremiumAlert.alert(
                    'Personal PIN Required',
                    'High-risk unlock requires your Rider Personal PIN. Your phone unlock PIN is different and cannot be used for box unlock authorization.'
                );
            }
            openPinModal();
        } finally {
            setQuickUnlockSubmitting(false);
            quickUnlockActionLockRef.current = false;
        }
    };

    const handleSubmitQuickUnlockPin = async () => {
        if (quickUnlockActionLockRef.current || quickUnlockSubmitting) {
            return;
        }

        const sanitized = sanitizeQuickPinInput(quickUnlockPin);
        if (!/^\d{6}$/.test(sanitized)) {
            PremiumAlert.alert('Invalid PIN', 'Enter your 6-digit Personal PIN to unlock.');
            return;
        }
        try {
            quickUnlockActionLockRef.current = true;
            setQuickUnlockSubmitting(true);
            const clientRequestId = `rider_quick_unlock_pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const { unlockToken } = await verifyRiderPersonalPinForUnlock(pairedBoxId!, sanitized, clientRequestId);
            await sendRiderUnlockCommand(pairedBoxId!, unlockToken, clientRequestId);
            setShowQuickUnlockModal(false);
            setQuickUnlockPin('');
            PremiumAlert.alert('Unlock Command Sent', `Unlock queued for ${pairedBoxId}. Waiting for hardware acknowledgment.`);
        } catch (error: any) {
            console.error('[QuickUnlock] Failed:', error);
            PremiumAlert.alert('Unlock Failed', error?.message || 'Could not authorize unlock. Check your PIN.');
        } finally {
            setQuickUnlockSubmitting(false);
            quickUnlockActionLockRef.current = false;
        }
    };
    const unlockPress = usePressScale();

    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const authedUser = useAuthStore((state: any) => state.user) as any;
    const riderId = authedUserId;
    const riderName = authedUser?.fullName || authedUser?.name || undefined;
    const riderPhone = authedUser?.phone || undefined;

    // Route data for map
    const [routeGeometry, setRouteGeometry] = useState<any>(null);

    // EC-03: Battery Monitoring
    const [batteryState, setBatteryState] = useState<BatteryState | null>(null);

    // EC-18: Tamper Detection
    const [tamperState, setTamperState] = useState<TamperState | null>(null);
    const [activeTamperIncident, setActiveTamperIncident] = useState<RiderTamperIncident | null>(null);
    const [incidentLoading, setIncidentLoading] = useState(false);
    const tamperDetectedEdgeRef = useRef(false);

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

    // EC-New: Available Orders Pool
    const [showAvailableOrders, setShowAvailableOrders] = useState(false);
    const [availableOrdersCount, setAvailableOrdersCount] = useState(0);

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
    const [localPhoneHeading, setLocalPhoneHeading] = useState<number | null>(null);
    const localPhoneHeadingRef = useRef<number | null>(null);
    // Ref so the foreground watcher callback can access the current boxId without a stale closure
    const activeBoxIdRef = useRef<string | null>(null);
    const lastForegroundWriteRef = useRef<number>(0);
    const lastCompassWriteTimeRef = useRef<number>(0);
    const lastCompassWriteHeadingRef = useRef<number>(0);
    /** Throttle noisy dev logs to once per 30s */
    const lastFgLogRef = useRef<number>(0);
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
                                    (location.coords.speed !== null && location.coords.speed < 1.5 && localPhoneHeadingRef.current !== null)
                                        ? localPhoneHeadingRef.current
                                        : (location.coords.heading ?? 0),
                                    localPhoneHeadingRef.current
                                ).then(() => {
                                    if (__DEV__ && now - lastFgLogRef.current >= 30_000) {
                                        lastFgLogRef.current = now;
                                        console.log(`[RiderDashboard] ✓ Foreground write OK | box=${boxId} | lat=${location.coords.latitude.toFixed(5)} lng=${location.coords.longitude.toFixed(5)}`);
                                    }
                                }).catch((err) => {
                                    console.warn('[RiderDashboard] ✗ Foreground Firebase write failed:', err);
                                });
                            }

                            if (__DEV__ && Date.now() - lastFgLogRef.current >= 30_000) {
                                lastFgLogRef.current = Date.now();
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

    // Device Compass Heading (Foreground)
    useEffect(() => {
        let headingSub: Location.LocationSubscription | null = null;
        const startHeadingWatcher = async () => {
            try {
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status === 'granted') {
                    headingSub = await Location.watchHeadingAsync((data) => {
                        const newHeading = data.trueHeading !== -1 ? data.trueHeading : data.magHeading;
                        setLocalPhoneHeading(newHeading);
                        localPhoneHeadingRef.current = newHeading;

                        // Real-time compass telemetry to Firebase
                        const now = Date.now();
                        const timeSinceLastWrite = now - lastCompassWriteTimeRef.current;
                        const deltaHeading = Math.abs((newHeading - lastCompassWriteHeadingRef.current + 540) % 360 - 180);
                        
                        // Write if it changed by > 5 degrees and at least 500ms elapsed
                        if (deltaHeading > 5 && timeSinceLastWrite > 500) {
                            lastCompassWriteTimeRef.current = now;
                            lastCompassWriteHeadingRef.current = newHeading;
                            
                            // Safe to fire-and-forget
                            if (authedUserId) {
                                updateLivePhoneCompassHeading(authedUserId, activeBoxIdRef.current, newHeading).catch(err => {
                                    if (__DEV__) console.warn('Compass push failed', err);
                                });
                            }
                        }
                    }).catch(err => {
                        if (__DEV__) console.warn('Heading watcher failed (Simulator?):', err);
                        return null;
                    });
                }
            } catch (err) {
                if (__DEV__) console.warn('Failed to start heading watcher:', err);
            }
        };
        startHeadingWatcher();
        return () => {
            if (headingSub) headingSub.remove();
        };
    }, [authedUserId]);

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

    const [pushToken, setPushToken] = useState<string | null>(null);
    const [pairingState, setPairingState] = useState<BoxPairingState | null>(null);

    // EC-32: Cancellation State
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const cancelAuthLockRef = useRef(false);

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

    const loadActiveTamperIncident = useCallback(async () => {
        if (!trackedBoxId || !tamperState?.detected) {
            setActiveTamperIncident(null);
            return;
        }

        try {
            setIncidentLoading(true);
            const incident = await fetchActiveTamperIncident({
                boxId: trackedBoxId,
                deliveryId: activeDelivery?.id,
            });
            setActiveTamperIncident(incident);
        } catch (error) {
            console.warn('[RiderDashboard] Failed to load active tamper incident:', error);
        } finally {
            setIncidentLoading(false);
        }
    }, [trackedBoxId, tamperState?.detected, activeDelivery?.id]);

    useEffect(() => {
        loadActiveTamperIncident();
    }, [loadActiveTamperIncident]);

    const riderSecurityLockRequired = Boolean(
        trackedBoxId
        && tamperState?.detected
        && (incidentLoading || !activeTamperIncident || activeTamperIncident.status === 'OPEN')
    );

    // EC-81: Real-time security alerts (push + in-app) for tamper/theft/lockdown
    useSecurityAlerts(trackedBoxId, activeDelivery?.id, riderId);

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

    // Real-time listener for Available Orders
    useEffect(() => {
        if (!isOnline || !riderLocation) {
            setAvailableOrdersCount(0);
            return;
        }

        const unsubscribe = subscribeToAvailableOrders(
            riderLocation.coords.latitude,
            riderLocation.coords.longitude,
            5, // SEARCH_RADIUS_KM
            (orders) => {
                setAvailableOrdersCount(orders.length);
            }
        );

        return unsubscribe;
    }, [isOnline, riderLocation]);

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

        const isReturn = ['RETURNING', 'TAMPERED'].includes(activeDelivery.status);
        const isPickup = !isReturn && !['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED'].includes(activeDelivery.status);

        if (isPickup) {
            return {
                latitude: activeDelivery.snapped_pickup_lat ?? activeDelivery.pickup_lat,
                longitude: activeDelivery.snapped_pickup_lng ?? activeDelivery.pickup_lng,
                title: "Heading to Pickup",
                description: activeDelivery.pickup_address
            };
        } else if (isReturn) {
             return {
                latitude: activeDelivery.snapped_pickup_lat ?? activeDelivery.pickup_lat,
                longitude: activeDelivery.snapped_pickup_lng ?? activeDelivery.pickup_lng,
                title: "Returning to Sender",
                description: activeDelivery.pickup_address
            };
        } else {
            return {
                latitude: activeDelivery.snapped_dropoff_lat ?? activeDelivery.dropoff_lat,
                longitude: activeDelivery.snapped_dropoff_lng ?? activeDelivery.dropoff_lng,
                title: "Heading to Dropoff",
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
                .in('status', ['ASSIGNED', 'PENDING', 'IN_TRANSIT', 'ARRIVED', 'TAMPERED', 'RETURNING'])
                .limit(1);

            if (!error && data && data.length > 0) {
                console.log('[RiderDashboard] Found active delivery:', data[0].id, data[0].status);
                setHasActiveDelivery(true);
                setActiveDelivery(data[0]);
            } else {
                if (error) {
                    console.error('[RiderDashboard] Error fetching active delivery:', error);
                } else {
                    console.log('[RiderDashboard] No active delivery found for rider:', riderId);
                }
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
    const subscriptionStartTime = useRef<number>(0);
    
    useEffect(() => {
        if (!activeDelivery?.id) {
            prevRiderDeliveryStatus.current = null;
            return;
        }

        subscriptionStartTime.current = Date.now();
        const deliveryId = activeDelivery.id;

        const unsubscribe = subscribeToDelivery(deliveryId, (data) => {
            if (
                data?.status &&
                prevRiderDeliveryStatus.current !== null &&
                data.status !== prevRiderDeliveryStatus.current
            ) {
                // Only notify the rider about statuses they didn't personally trigger.
                const cancellationBody = data?.cancellation_reason === 'SECURITY_INCIDENT_CONFIRMED'
                    ? 'Security incident confirmed. This trip was cancelled and refund processing started.'
                    : 'The customer has cancelled this delivery.';

                const RIDER_ALERT_MESSAGES: Record<string, { title: string; body: string }> = {
                    CANCELLED: { title: '❌ Order Cancelled', body: cancellationBody },
                    TAMPERED: { title: '⚠️ Security Alert!', body: 'Box tamper detected on your active delivery!' },
                    IN_TRANSIT: { title: '✅ Delivery Resumed', body: 'Admin review completed. Continue with your active trip.' },
                    COMPLETED: { title: '✅ Delivery Confirmed', body: 'Customer confirmed delivery. Great work!' },
                };
                const msg = RIDER_ALERT_MESSAGES[data.status];
                
                // EC-Fix: Ignore state transitions that happen immediately upon subscription.
                // Firebase offline persistence fires with cached old data first, then 
                // quickly updates with fresh network data. This looks like a state change!
                const isInitialLoadPhase = Date.now() - subscriptionStartTime.current < 3000;
                
                // IGNORE if the new state from Firebase is exactly what we loaded from Supabase 
                // when the dashboard first mounted for this delivery.
                const isSyncingToInitialState = data.status === activeDelivery.status;
                
                if (msg && !isInitialLoadPhase && !isSyncingToInitialState) {
                    showStatusNotification(msg.title, msg.body, { deliveryId, status: data.status })
                        .catch(console.error);
                }

                // Terminal statuses — clear active delivery immediately so the
                // dashboard doesn't show a stale "current job" after cancellation.
                const TERMINAL_STATUSES = ['CANCELLED', 'COMPLETED', 'RETURNED'];
                if (TERMINAL_STATUSES.includes(data.status)) {
                    setActiveDelivery(null);
                    setHasActiveDelivery(false);
                } else {
                    setActiveDelivery((prev: any) => prev ? { ...prev, status: data.status, cancellation_reason: data.cancellation_reason || prev.cancellation_reason } : null);
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
    // Use trackedBoxId so battery/box subscriptions are active even without explicit pairing
    const monitorBoxId = boxIdForMonitoring || trackedBoxId;
    useEffect(() => {
        if (monitorBoxId && isPaired) {
            startMonitoring(monitorBoxId);
        }

        // EC-Update: Subscribe to box state for lock status
        const unsubscribeBox = monitorBoxId ? subscribeToBoxState(monitorBoxId, (state) => {
            setBoxState(state);
        }) : () => { };

        // EC-03: Subscribe to battery state (real-time)
        const unsubscribeBattery = monitorBoxId ? subscribeToBattery(monitorBoxId, (state) => {
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
            const currentlyDetected = Boolean(state?.detected);
            const wasDetected = tamperDetectedEdgeRef.current;
            tamperDetectedEdgeRef.current = currentlyDetected;

            // Trigger alert only on edge transition (false -> true) to avoid
            // repeated popups from realtime snapshot churn.
            if (currentlyDetected && !wasDetected) {
                PremiumAlert.alert(
                    '🔒 Security Hold',
                    'A security incident was detected on your assigned box. Submit incident evidence in Box Controls and wait for admin review.',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
                showSecurityNotification(
                    '🔒 Security Hold Active',
                    `Box ${boxIdForMonitoring} is in security hold. Complete incident response to continue.`,
                    { boxId: boxIdForMonitoring || '', type: 'TAMPER_DETECTED' }
                ).catch(() => {});
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
    }, [boxIdForMonitoring, monitorBoxId, isPaired]);

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
                    if (latestRequest.data.bookingId && !notifiedBookingIds.current.has(latestRequest.data.bookingId)) {
                        // Track this booking ID so we don't notify again
                        notifiedBookingIds.current.add(latestRequest.data.bookingId);
                        showIncomingOrderNotification(
                            latestRequest.data.pickupAddress,
                            latestRequest.data.dropoffAddress,
                            latestRequest.data.estimatedFare,
                            latestRequest.data.bookingId
                        );
                    }
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
            longitude: lastLocation!.longitude,
            speed: lastLocation!.speed,
            heading: lastLocation!.heading,
        } : (riderLocation ? {
            latitude: riderLocation.coords.latitude,
            longitude: riderLocation.coords.longitude,
            speed: riderLocation.coords.speed ?? undefined,
            heading: riderLocation.coords.heading ?? undefined,
        } : null);

        if (loc) {
            // Derive the best heading: if stationary, prefer compass; else GPS heading
            const effectiveSpeed = loc.speed ?? 0;
            const effectiveHeading = (effectiveSpeed < 1.5 && localPhoneHeadingRef.current !== null)
                ? localPhoneHeadingRef.current
                : loc.heading;

            updateRiderStatus(
                riderId,
                loc.latitude,
                loc.longitude,
                !hasActiveDelivery, // Only available if NO active delivery
                pushToken || undefined,
                effectiveSpeed,
                effectiveHeading,
                localPhoneHeadingRef.current // compassHeading — always pass raw device compass
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

    // EC-Sweep: Poll for expired offers in the absence of a dedicated backend
    useEffect(() => {
        // Run sweep every 5 seconds to ensure queue moves quickly
        const sweeper = setInterval(() => {
            if (isOnline) {
                runTimeoutSweep().catch(console.error);
            }
        }, 5000);
        return () => clearInterval(sweeper);
    }, [isOnline]);

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

    const navigateToPairBox = useCallback(() => {
        navigateWhenReady('PairBox');
    }, []);

    const openBoxControls = useCallback((boxId?: string | null) => {
        const resolvedBoxId = sanitizeBoxId(boxId) || pairedBoxId || sanitizeBoxId(boxIdForMonitoring) || trackedBoxId;
        if (!resolvedBoxId) {
            PremiumAlert.alert('Pair Required', 'Scan your box QR to access controls.');
            navigateToPairBox();
            return;
        }
        navigateWhenReady('BoxControls', { boxId: resolvedBoxId });
    }, [pairedBoxId, boxIdForMonitoring, trackedBoxId, navigateToPairBox]);

    // Handle accepting an order
    const handleAcceptOrder = useCallback(async (requestItem: { requestId: string; data: RiderOrderRequest }, phoneOverride?: string) => {
        if (!riderId || !requestItem) return;

        // GUARDRAIL: Rider must have a paired box
        if (!isPaired || !boxIdForMonitoring) {
            PremiumAlert.alert(
                'No Box Paired',
                'You must pair with a Smart Box before accepting orders to ensure safety and tracking.',
                [{ text: 'OK', onPress: navigateToPairBox }]
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

            let freshCustomerName = requestItem.data.customerName || 'Customer';
            try {
                if (requestItem.data.customerId) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('full_name, phone_number')
                        .eq('id', requestItem.data.customerId)
                        .single();

                    if (profile) {
                        if (profile.full_name) {
                            freshCustomerName = profile.full_name;
                        } else if (profile.phone_number) {
                            freshCustomerName = `User ${profile.phone_number.slice(-4)}`;
                        }
                    }
                }
            } catch (err) {
                console.warn('[RiderDashboard] Failed to fetch fresh customer name', err);
            }

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
                customerName: freshCustomerName, // EC-Fix: Added fresh query
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
    }, [riderId, riderName, riderPhone, boxIdForMonitoring, isPaired, navigation, navigateToPairBox]);

    // Handle rejecting an order
    const handleRejectOrder = useCallback(async (requestId: string) => {
        // Find the actual order request object matching the requestId
        const requestToReject = incomingRequests.find(req => req.requestId === requestId);
        
        // Pass the bookingId if present, triggering the cascade to the next rider
        const passedBookingId = requestToReject?.data?.bookingId;

        await rejectOrder(riderId, requestId, passedBookingId);
        
        // Ensure optimistic removal prevents the modal waiting for subscription lag
        setIncomingRequests(prev => prev.filter(req => req.requestId !== requestId));
        if (incomingRequests.length <= 1) {
            setShowOrderModal(false);
        }
    }, [riderId, incomingRequests]);

    // Trip Preview State


    // EC-32: Handle Cancellation Submit
    const handleCancellationSubmit = async (reason: CancellationReason, details: string) => {
        if (cancelAuthLockRef.current || cancelLoading) {
            return;
        }

        if (!nextDelivery) {
            PremiumAlert.alert('Error', 'No active delivery to cancel');
            return;
        }

        cancelAuthLockRef.current = true;

        try {
            const highImpactStatuses = new Set(['IN_TRANSIT', 'ARRIVED', 'RETURNING', 'TAMPERED']);
            const requiresStepUp = highImpactStatuses.has(String(nextDelivery.status || '').toUpperCase());
            if (requiresStepUp) {
                const authResult = await authenticateBiometricForSensitiveAction('Authorize cancellation');
                if (!authResult.success) {
                    PremiumAlert.alert('Authorization Required', `${'message' in authResult ? authResult.message : 'Authorization failed.'} Cancellation was canceled.`);
                    return;
                }
            }

            setCancelLoading(true);
            try {
                const clientRequestId = `rider_cancel_${nextDelivery.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const result = await requestCancellation({
                    deliveryId: nextDelivery.id,
                    boxId: boxIdForMonitoring,
                    reason,
                    reasonDetails: details,
                    riderId: riderId || getAuth().currentUser?.uid || '', // EC-Fix: Fallback to Firebase Auth
                    riderName: riderName || 'Rider',
                    currentStatus: nextDelivery.status,
                    clientRequestId,
                });

                if (result.success) {
                    setShowCancelModal(false);
                    PremiumAlert.alert('Success', 'Delivery cancellation submitted successfully.');
                    // Immediately clear stale delivery state so the dashboard
                    // doesn't show the cancelled job when the rider navigates back.
                    setActiveDelivery(null);
                    setHasActiveDelivery(false);
                    // Navigate to confirmation screen with return OTP
                    navigation.navigate('CancellationConfirmation', {
                        deliveryId: nextDelivery.id,
                        returnOtp: result.returnOtp,
                        reason: reason,
                        reasonDetails: details,
                        senderName: nextDelivery.customer,
                        pickupAddress: nextDelivery.address,
                        isPickedUp: ['IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'RETURNING', 'TAMPERED'].includes(nextDelivery.status),
                    });
                } else {
                    PremiumAlert.alert('Cancellation Failed', result.error || 'Unknown error');
                }
            } catch (err) {
                PremiumAlert.alert('Error', 'An unexpected error occurred');
            } finally {
                setCancelLoading(false);
            }
        } finally {
            cancelAuthLockRef.current = false;
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

    // ── Real-time address geocoding (Mapbox) ──
    // Haversine helper for distance-based throttling
    const haversineDistanceM = useCallback((lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const R = 6371000; // Earth radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }, []);

    const geocodeAddress = useCallback(async (lat: number, lng: number, force = false) => {
        if (!MAPBOX_TOKEN || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const now = Date.now();
        const timeSinceLast = now - lastGeocodeTimeRef.current;
        const lastCoords = lastGeocodedCoordsRef.current;

        if (!force && lastCoords) {
            // Check throttle
            if (timeSinceLast < GEOCODE_THROTTLE_MS) return;
            // Check distance
            const distMoved = haversineDistanceM(lastCoords.lat, lastCoords.lng, lat, lng);
            if (distMoved < GEOCODE_DISTANCE_THRESHOLD_M) return;
        }

        try {
            setIsGeocodingAddress(true);
            lastGeocodeTimeRef.current = now;
            lastGeocodedCoordsRef.current = { lat, lng };

            const res = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,place,locality,neighborhood&limit=1&language=en`
            );
            if (!res.ok) return;
            const data = await res.json();
            const placeName = data.features?.[0]?.place_name;
            if (placeName) {
                setLiveAddress(placeName);
                // Also update the header location name with a more concise version
                const shortName = data.features?.[0]?.text || placeName.split(',')[0];
                const context = data.features?.[0]?.context;
                const city = context?.find((c: any) => c.id?.startsWith('place'))?.text;
                const region = context?.find((c: any) => c.id?.startsWith('region'))?.text;
                setLocationName(city ? `${city}, ${region || ''}`.replace(/, $/, '') : shortName);
            }
        } catch (err) {
            console.warn('[RiderDashboard] Geocode failed:', err);
        } finally {
            setIsGeocodingAddress(false);
        }
    }, [MAPBOX_TOKEN, haversineDistanceM]);

    // Auto-geocode when rider moves
    useEffect(() => {
        if (!riderLocation) return;
        const { latitude, longitude } = riderLocation.coords;
        geocodeAddress(latitude, longitude);
    }, [riderLocation, geocodeAddress]);

    // Manual address refresh handler
    const handleRefreshAddress = useCallback(async () => {
        if (!riderLocation) return;
        await geocodeAddress(riderLocation.coords.latitude, riderLocation.coords.longitude, true);
    }, [riderLocation, geocodeAddress]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([
            fetchLocation(),
            checkActiveDeliveries()
        ]);
        setRefreshing(false);
    }, [fetchLocation, checkActiveDeliveries]);

    const handleZoomIn = useCallback(() => {
        setMapZoomLevel(prev => Math.min(prev + 1, 22)); // Max zoom
    }, []);

    const handleZoomOut = useCallback(() => {
        setMapZoomLevel(prev => Math.max(prev - 1, 2)); // Min zoom
    }, []);

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
        const encodedLabel = encodeURIComponent(label);

        const openWithFallback = async (primaryUrl: string, fallbackUrl: string) => {
            try {
                const supported = await Linking.canOpenURL(primaryUrl);
                if (supported) {
                    await Linking.openURL(primaryUrl);
                } else {
                    await Linking.openURL(fallbackUrl);
                }
            } catch (error) {
                console.error('[handleNavigate] Failed to open maps:', error);
                // Last-resort: browser Google Maps
                try {
                    const browserUrl = hasCoords
                        ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=&travelmode=driving`
                        : `https://www.google.com/maps/search/?api=1&query=${encodedLabel}`;
                    await Linking.openURL(browserUrl);
                } catch (browserError) {
                    console.error('[handleNavigate] Browser fallback also failed:', browserError);
                }
            }
        };

        if (hasCoords) {
            const latLng = `${lat},${lng}`;
            const primaryUrl = Platform.select({
                ios: `maps:?ll=${latLng}&q=${encodedLabel}`,
                android: `google.navigation:q=${latLng}&mode=d`,
            })!;
            const fallbackUrl = Platform.select({
                ios: `https://maps.apple.com/?ll=${latLng}&q=${encodedLabel}`,
                android: `geo:${latLng}?q=${latLng}(${encodedLabel})`,
            })!;
            openWithFallback(primaryUrl, fallbackUrl);
        } else if (label) {
            const primaryUrl = Platform.select({
                ios: `maps:0,0?q=${encodedLabel}`,
                android: `google.navigation:q=${encodedLabel}&mode=d`,
            })!;
            const fallbackUrl = Platform.select({
                ios: `https://maps.apple.com/?q=${encodedLabel}`,
                android: `geo:0,0?q=${encodedLabel}`,
            })!;
            openWithFallback(primaryUrl, fallbackUrl);
        }
    };

    const handleLockOnly = () => {
        if (!boxIdForMonitoring) {
            PremiumAlert.alert('No Box Connected', 'Pair and select a box first to send lock controls.');
            return;
        }

        if (isLocked) {
            // Locked — do nothing; unlock is via Quick Unlock button
            return;
        }

        PremiumAlert.alert(
            "Lock Box?",
            "Ensure the box is closed before locking.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Lock", onPress: async () => {
                        try {
                            await updateBoxState(boxIdForMonitoring, { command: 'LOCKED' });
                            PremiumAlert.alert('Command Sent', 'Lock command sent. Box should relock shortly.');
                        } catch (error) {
                            console.error('[handleLockOnly] Failed to send lock command:', error);
                            PremiumAlert.alert('Command Failed', 'Unable to send lock command. Check connection and try again.');
                        }
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

    const navigateToRootScreen = useCallback((screen: string, params?: Record<string, any>) => {
        try {
            const rootNavigator = navigation.getParent?.('RootStack') || navigation.getParent?.();
            if (rootNavigator?.navigate) {
                rootNavigator.navigate(screen, params);
                return;
            }
        } catch (error) {
            if (__DEV__) {
                console.warn('[RiderDashboard] Root navigation fallback engaged:', error);
            }
        }

        navigateWhenReady(screen, params);
    }, [navigation]);

    const navigateToRiderSettings = useCallback(() => {
        navigation.navigate('RiderSettings');
    }, [navigation]);

    const QuickAction = ({ icon, label, subtitle, onPress, color }: any) => {
        return (
            <TouchableOpacity
                style={[
                    styles.actionCard,
                    {
                        backgroundColor: c.card,
                        borderColor: c.border,
                    }
                ]}
                activeOpacity={0.82}
                hitSlop={8}
                delayPressIn={0}
                onStartShouldSetResponder={() => true}
                onPress={onPress}
            >
                <View style={styles.actionTopRow}>
                    <View style={[styles.actionIcon, { backgroundColor: color + '14', borderWidth: 1, borderColor: color + '30' }]}>
                        <MaterialCommunityIcons name={icon as any} size={20} color={color} />
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={18} color={c.textTer} />
                </View>
                <Text style={[styles.actionTitle, { color: c.text }]} numberOfLines={1}>{label}</Text>
                <Text style={[styles.actionSubtitle, { color: c.textSec }]} numberOfLines={2}>{subtitle}</Text>
            </TouchableOpacity>
        );
    };

    const statusToggleAnim = useEntryAnimation(0);
    const gpsCardAnim = useEntryAnimation(55);
    const pairingAnim = useEntryAnimation(100);
    const actionsAnim = useStaggerAnimation(4, 45, 145);
    const mapPreviewAnim = useEntryAnimation(170);
    const jobAnim = useEntryAnimation(215);

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar style={isDarkMode ? 'light' : 'dark'} />

            {riderSecurityLockRequired && (
                <View style={styles.incidentLockOverlay} pointerEvents="box-none">
                    <Card style={[styles.incidentLockCard, { backgroundColor: c.card, borderColor: c.redText }]}> 
                        <Card.Content>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                                <MaterialCommunityIcons name="shield-alert" size={28} color={c.redText} />
                                <Text style={{ marginLeft: 8, fontFamily: 'Inter_700Bold', fontSize: 18, color: c.redText }}>
                                    Security Incident Lock
                                </Text>
                            </View>
                            <Text style={{ color: c.textSec, marginBottom: 14 }}>
                                Map, jobs, and order queue are locked until rider evidence is submitted for this tamper incident.
                            </Text>
                            <Button
                                mode="contained"
                                onPress={() => navigateToRootScreen('BoxControls', { boxId: trackedBoxId, deliveryId: activeDelivery?.id })}
                                style={{ marginBottom: 8 }}
                            >
                                Open Incident Response
                            </Button>
                            <Button
                                mode="text"
                                onPress={loadActiveTamperIncident}
                                disabled={incidentLoading}
                            >
                                Refresh Incident Status
                            </Button>
                        </Card.Content>
                    </Card>
                </View>
            )}

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
                        <View style={styles.headerInfoBox}>
                            <View style={styles.locationContainer}>
                                <MaterialCommunityIcons name="map-marker" size={16} color="rgba(255,255,255,0.9)" style={styles.textShadow} />
                                <Text style={[styles.locationText, styles.textShadow]}>{locationName}</Text>
                            </View>
                            <Text style={[styles.dateText, styles.textShadow]}>{currentTime.format('dddd, MMMM D')}</Text>
                            <Text style={[styles.timeText, styles.textShadow]}>{currentTime.format('h:mm A')}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {weather && (
                                <View style={styles.weatherContainer}>
                                    <MaterialCommunityIcons name={weather.icon as any} size={30} color="white" style={styles.textShadow} />
                                    <Text style={[styles.weatherText, styles.textShadow]}>{weather.temp}</Text>
                                    <Text style={[styles.weatherCondition, styles.textShadow]}>{weather.condition}</Text>
                                </View>
                            )}
                            <View style={styles.iconBox}>
                                <NotificationBell color="#FFFFFF" size={24} />
                            </View>
                        </View>
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
                            <Text style={[styles.bannerText, { color: c.orangeText }]}>Key &apos;{keypadState.stuck_key}&apos; is stuck. Use App Unlock.</Text>
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
                                <Text style={[styles.bannerText, { color: c.redText, fontFamily: 'Inter_700Bold', marginTop: 4 }]}>
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

                <Animated.View style={statusToggleAnim.style}>
                    <View style={[styles.statusToggleContainer, { backgroundColor: c.card, borderColor: isOnline ? c.greenText + '40' : c.redText + '40', borderWidth: 1 }]}>
                        <View style={styles.statusContainer}>
                            <View style={[styles.statusDot, { backgroundColor: isOnline ? c.greenText : c.redText }]} />
                            <View>
                                <Text variant="titleMedium" style={[styles.statusText, { color: c.text }]}>
                                    {isOnline ? 'You are Online' : 'You are Offline'}
                                </Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {isOnline ? 'Receiving orders' : 'Browsing mode only'}
                                </Text>
                            </View>
                        </View>
                        <Switch value={isOnline} onValueChange={setIsOnline} trackColor={{ true: c.greenText, false: c.redBg }} thumbColor={isDarkMode ? c.text : c.bg} />
                    </View>
                </Animated.View>

                {/* Map Preview — Rider's Current Location (Real-time) */}
                <Animated.View style={mapPreviewAnim.style}>
                    <View style={[styles.mapPreviewCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
                        <View style={styles.mapPreviewHeader}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                <View style={[styles.mapPreviewIconWrap, { backgroundColor: c.greenBg }]}>
                                    <MaterialCommunityIcons name="map-marker-radius" size={20} color={c.greenText} />
                                </View>
                                <View style={{ marginLeft: 10, flex: 1 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text variant="titleSmall" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>Your Location</Text>
                                        {riderLocation && (
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.greenText, marginLeft: 6 }} />
                                        )}
                                    </View>
                                    {riderLocation && (
                                        <Text variant="bodySmall" style={{ color: c.textSec, fontSize: 10, marginTop: 1 }}>
                                            {riderLocation.coords.latitude.toFixed(5)}°, {riderLocation.coords.longitude.toFixed(5)}°
                                            {localPhoneHeading != null ? `  •  🧭 ${Math.round(localPhoneHeading)}°` : ''}
                                        </Text>
                                    )}
                                </View>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {gpsSource !== 'none' && (
                                    <Chip
                                        compact
                                        icon={gpsSource === 'box' ? 'access-point' : 'cellphone'}
                                        style={{ backgroundColor: c.greenBg }}
                                        textStyle={{ fontSize: 10, color: c.greenText }}
                                    >
                                        {gpsSource === 'box' ? 'Box GPS' : 'Phone GPS'}
                                    </Chip>
                                )}
                            </View>
                        </View>
                        <View style={styles.mapPreviewContainer}>
                            {(lastLocation || riderLocation) && MAPBOX_TOKEN ? (
                                <>
                                    <MapboxGL.MapView
                                        pointerEvents="none"
                                        style={styles.map}
                                        logoEnabled={false}
                                        attributionEnabled={false}
                                        scaleBarEnabled={false}
                                        compassEnabled={false}
                                        styleURL={isDarkMode ? MapboxGL.StyleURL.Dark : MapboxGL.StyleURL.Street}
                                        surfaceView={false}
                                        scrollEnabled={false}
                                        pitchEnabled={false}
                                        rotateEnabled={false}
                                        zoomEnabled={false}
                                    >
                                        <MapboxGL.Camera
                                            centerCoordinate={[
                                                lastLocation ? lastLocation.longitude : riderLocation!.coords.longitude,
                                                lastLocation ? lastLocation.latitude : riderLocation!.coords.latitude,
                                            ]}
                                            zoomLevel={mapZoomLevel}
                                            animationMode="flyTo"
                                            animationDuration={800}
                                        />
                                        <AnimatedRiderMarker
                                            latitude={lastLocation ? lastLocation.latitude : riderLocation!.coords.latitude}
                                            longitude={lastLocation ? lastLocation.longitude : riderLocation!.coords.longitude}
                                            rotation={headingSmoother.smooth(riderLocation?.coords.heading ?? -1, lastLocation?.speed ?? riderLocation?.coords.speed, localPhoneHeading)}
                                            speed={lastLocation?.speed ?? riderLocation?.coords.speed ?? undefined}
                                        />
                                    </MapboxGL.MapView>
                                    {/* Address Overlay with Refresh Button */}
                                    <View style={styles.mapPreviewOverlay}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={[styles.mapPreviewAddressPill, { flex: 1 }]}>
                                                <MaterialCommunityIcons name="map-marker" size={14} color="#FFFFFF" />
                                                <Text style={styles.mapPreviewAddressText} numberOfLines={2}>
                                                    {liveAddress || 'Locating...'}
                                                </Text>
                                            </View>
                                            <TouchableOpacity
                                                onPress={handleRefreshAddress}
                                                disabled={isGeocodingAddress}
                                                style={{
                                                    width: 36,
                                                    height: 36,
                                                    borderRadius: 18,
                                                    backgroundColor: 'rgba(0,0,0,0.6)',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}
                                                activeOpacity={0.7}
                                            >
                                                {isGeocodingAddress ? (
                                                    <ActivityIndicator size={14} color="#FFFFFF" />
                                                ) : (
                                                    <MaterialCommunityIcons name="refresh" size={18} color="#FFFFFF" />
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {/* Zoom Controls Overlay */}
                                    <View style={{
                                        position: 'absolute',
                                        right: 10,
                                        top: 10,
                                        gap: 8,
                                        alignItems: 'center'
                                    }}>
                                        <TouchableOpacity
                                            onPress={() => setShowMapControls(!showMapControls)}
                                            style={{
                                                width: 32, height: 32, borderRadius: 16,
                                                backgroundColor: 'rgba(0,0,0,0.6)',
                                                alignItems: 'center', justifyContent: 'center'
                                            }}
                                            activeOpacity={0.7}
                                        >
                                            <MaterialCommunityIcons name={showMapControls ? "chevron-up" : "chevron-down"} size={20} color="#FFFFFF" />
                                        </TouchableOpacity>

                                        {showMapControls && (
                                            <>
                                                <TouchableOpacity
                                                    onPress={handleZoomIn}
                                                    style={{
                                                        width: 36, height: 36, borderRadius: 18,
                                                        backgroundColor: 'rgba(0,0,0,0.6)',
                                                        alignItems: 'center', justifyContent: 'center'
                                                    }}
                                                    activeOpacity={0.7}
                                                >
                                                    <MaterialCommunityIcons name="plus" size={24} color="#FFFFFF" />
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    onPress={handleZoomOut}
                                                    style={{
                                                        width: 36, height: 36, borderRadius: 18,
                                                        backgroundColor: 'rgba(0,0,0,0.6)',
                                                        alignItems: 'center', justifyContent: 'center'
                                                    }}
                                                    activeOpacity={0.7}
                                                >
                                                    <MaterialCommunityIcons name="minus" size={24} color="#FFFFFF" />
                                                </TouchableOpacity>
                                            </>
                                        )}
                                    </View>
                                </>
                            ) : (
                                <View style={[styles.mapPreviewPlaceholder, { backgroundColor: c.search }]}>
                                    <ActivityIndicator size="small" color={c.textSec} />
                                    <Text style={{ color: c.textSec, marginTop: 8, fontSize: 12 }}>
                                        {MAPBOX_TOKEN ? 'Acquiring GPS...' : 'Map unavailable'}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                </Animated.View>

                {/* Earnings & Goal Tracker Widget */}
                {riderId && <EarningsWidget riderId={riderId} dailyGoal={1500} />}

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
                                <Text variant="titleSmall" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>GPS Tracking</Text>
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
                                <Text variant="titleSmall" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>
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
                                onPress={navigateToPairBox}
                            >
                                {isPaired ? 'Manage' : 'Pair Box'}
                            </Button>
                        </View>
                    </View>
                </Animated.View>

                {/* Quick Actions */}
                <View style={styles.actionsSection}>
                    <View style={styles.actionsGrid}>
                        <QuickAction
                            icon="cube-outline"
                            label="Box Status"
                            subtitle={isPaired && pairedBoxId ? `Manage box ${pairedBoxId}` : 'Pair your smart box first'}
                            onPress={() => {
                                if (!isPaired || !pairedBoxId) {
                                    PremiumAlert.alert('Pair Required', 'Scan your box QR to access controls.');
                                    navigateToPairBox();
                                    return;
                                }
                                openBoxControls(pairedBoxId);
                            }}
                            color={c.accent}
                        />
                        <QuickAction
                            icon="history"
                            label="History"
                            subtitle="View completed and cancelled deliveries"
                            onPress={() => navigateToRootScreen('DeliveryRecords')}
                            color={c.accent}
                        />
                        <QuickAction
                            icon="face-agent"
                            label="Support"
                            subtitle="Open rider help and live assistance"
                            onPress={() => navigateToRootScreen('RiderSupport')}
                            color={c.accent}
                        />
                        <QuickAction
                            icon="cog"
                            label="Settings"
                            subtitle="Update app, account, and preferences"
                            onPress={navigateToRiderSettings}
                            color={c.accent}
                        />
                    </View>
                </View>

                {availableOrdersCount > 0 && isOnline && !hasActiveDelivery && (
                    <Animated.View style={actionsAnim[0].style}>
                        <Button 
                            mode="contained" 
                            buttonColor={c.greenText}
                            icon="bell-ring"
                            onPress={() => setShowAvailableOrders(true)}
                            style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 12 }}
                        >
                            {availableOrdersCount} Available Order{availableOrdersCount > 1 ? 's' : ''} Nearby
                        </Button>
                    </Animated.View>
                )}

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
                                        styleURL={isDarkMode ? MapboxGL.StyleURL.Dark : MapboxGL.StyleURL.Street}
                                        surfaceView={false}
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
                                            rotation={headingSmoother.smooth(riderLocation?.coords.heading ?? -1, lastLocation?.speed ?? riderLocation?.coords.speed, localPhoneHeading)}
                                            speed={lastLocation?.speed ?? riderLocation?.coords.speed ?? undefined}
                                        />

                                        {/* Destination Marker */}
                                        <MapboxGL.PointAnnotation
                                            id="destination"
                                            coordinate={[destination.longitude, destination.latitude]}
                                            title={destination.title}
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
                                        <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>{nextDelivery.customer}</Text>
                                        <Text variant="bodySmall" style={{ color: c.textSec }}>{nextDelivery.id}</Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Chip icon="map-marker-distance" compact style={{ backgroundColor: c.search, marginBottom: 4 }} textStyle={{ color: c.text }}>{distance}</Chip>
                                        <Chip compact style={{ backgroundColor: c.greenBg }} textStyle={{ fontSize: 10, color: c.greenText, fontFamily: 'Inter_700Bold' }}>{activeDelivery.status.replace(/_/g, ' ')}</Chip>
                                    </View>
                                </View>

                                <View style={[styles.divider, { backgroundColor: c.divider }]} />

                                {/* Pickup Section */}
                                {!['RETURNING', 'TAMPERED'].includes(activeDelivery.status) && (
                                    <View style={{ marginBottom: 16 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                            <View style={[styles.badge, { backgroundColor: c.blueBg, width: 24, height: 24, borderRadius: 12, marginRight: 8 }]}>
                                                <MaterialCommunityIcons name="package-variant" size={14} color={c.blueText} />
                                            </View>
                                            <Text variant="labelSmall" style={{ color: c.blueText, fontFamily: 'Inter_700Bold' }}>PICKUP</Text>
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
                                )}

                                {/* Conditional Dropoff/Return Section */}
                                {['RETURNING', 'TAMPERED'].includes(activeDelivery.status) ? (
                                    <View style={{ marginBottom: 8 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                            <View style={[styles.badge, { backgroundColor: c.redBg, width: 24, height: 24, borderRadius: 12, marginRight: 8 }]}>
                                                <MaterialCommunityIcons name="keyboard-return" size={14} color={c.redText} />
                                            </View>
                                            <Text variant="labelSmall" style={{ color: c.redText, fontFamily: 'Inter_700Bold' }}>RETURN DESTINATION</Text>
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
                                            <Text variant="labelSmall" style={{ color: c.redText, fontFamily: 'Inter_700Bold' }}>DROPOFF</Text>
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
                                <TouchableWithoutFeedback onPressIn={startTripPress.onPressIn} onPressOut={startTripPress.onPressOut} onPress={() => {
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
                                }}>
                                    <Animated.View style={[{ width: '100%', marginBottom: 12 }, startTripPress.style]}>
                                        <Button
                                            mode="contained"
                                            style={{ borderRadius: 8 }}
                                            contentStyle={{ height: 56 }}
                                            labelStyle={{ fontSize: 18, fontFamily: 'Inter_700Bold' }}
                                            buttonColor={c.accent}
                                            textColor={c.accentText}
                                            icon="navigation"
                                        >
                                            {(() => {
                                                if (['RETURNING', 'TAMPERED'].includes(activeDelivery.status)) return 'Return to Sender';
                                                if (['PICKED_UP', 'IN_TRANSIT'].includes(activeDelivery.status)) return 'Head to Dropoff';
                                                if (activeDelivery.status === 'ARRIVED') return 'Scan Package';
                                                return 'Head to Pickup';
                                            })()}
                                        </Button>
                                    </Animated.View>
                                </TouchableWithoutFeedback>

                                <TouchableWithoutFeedback onPressIn={detailsPress.onPressIn} onPressOut={detailsPress.onPressOut} onPress={() => navigation.navigate('JobDetail', { job: nextDelivery })}>
                                    <Animated.View style={[{ width: '100%', marginBottom: 12 }, detailsPress.style]}>
                                        <Button
                                            mode="outlined"
                                            style={{ borderRadius: 8, borderColor: c.border }}
                                            textColor={c.text}
                                            icon="file-document-outline"
                                        >
                                            View Job Details
                                        </Button>
                                    </Animated.View>
                                </TouchableWithoutFeedback>

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
                            <Card.Content style={{ alignItems: 'center', paddingVertical: 40 }}>
                                <View style={[styles.emptyIconWrap, { backgroundColor: c.textTer + '20' }]}>
                                    <MaterialCommunityIcons name="truck-delivery-outline" size={40} color={c.textSec} />
                                </View>
                                <Text variant="titleMedium" style={{ color: c.text, fontFamily: 'Inter_700Bold', marginTop: 12 }}>No Active Job</Text>
                                <Text variant="bodySmall" style={{ color: c.textSec, marginTop: 4, textAlign: 'center', marginHorizontal: 20 }}>
                                    Waiting for nearby orders to be assigned.
                                </Text>
                            </Card.Content>
                        </Card>
                    )}
                </Animated.View>

                {/* Smart Box Status */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Box Status</Text>
                <View style={[styles.statusCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>

                    {/* Lock Status & Lock-Only Button */}
                    <View style={styles.unlockContainer}>
                        <View style={styles.unlockInfo}>
                            <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>Lock Mechanism</Text>
                            <Text variant="bodyMedium" style={{ color: !isPaired ? c.textTer : (isLocked ? c.greenText : c.redText) }}>
                                {!isPaired ? 'No Box Connected' : (isLocked ? 'Securely Locked' : 'Unlocked')}
                            </Text>
                        </View>
                        <TouchableWithoutFeedback
                            onPressIn={unlockPress.onPressIn}
                            onPressOut={unlockPress.onPressOut}
                            onPress={handleLockOnly}
                            disabled={!isPaired || isLocked}
                        >
                            <Animated.View style={[
                                styles.unlockButton,
                                {
                                    backgroundColor: !isPaired ? c.search : (isLocked ? c.greenBg : c.redBg),
                                    borderWidth: 1,
                                    borderColor: !isPaired ? c.border : (isLocked ? c.greenText : c.redText),
                                    opacity: isLocked ? 0.7 : 1,
                                    ...unlockPress.style
                                }
                            ]}>
                                <MaterialCommunityIcons
                                    name={!isPaired ? "shield-off-outline" : (isLocked ? "shield-lock" : "shield-lock-open")}
                                    size={40}
                                    color={!isPaired ? c.textTer : (isLocked ? c.greenText : c.redText)}
                                />
                            </Animated.View>
                        </TouchableWithoutFeedback>
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
                                <Text variant="labelSmall" style={{ marginLeft: 8, fontFamily: 'Inter_700Bold', color: isPaired ? getBatteryColor() : c.textSec }}>
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

                    {/* Quick Unlock Button */}
                    {isPaired && isLocked && (
                        <TouchableWithoutFeedback
                            onPressIn={quickUnlockPress.onPressIn}
                            onPressOut={quickUnlockPress.onPressOut}
                            onPress={handleQuickUnlock}
                            disabled={quickUnlockSubmitting}
                        >
                            <Animated.View style={[{ marginTop: 16, opacity: quickUnlockSubmitting ? 0.85 : 1 }, quickUnlockPress.style]}>
                                <Button
                                    mode="contained"
                                    style={{ borderRadius: 8 }}
                                    contentStyle={{ height: 48 }}
                                    labelStyle={{ fontSize: 15, fontFamily: 'Inter_700Bold' }}
                                    buttonColor={c.accent}
                                    textColor={c.accentText}
                                    icon="lock-open-variant-outline"
                                    loading={quickUnlockSubmitting}
                                    disabled={quickUnlockSubmitting}
                                >
                                    Quick Unlock Box
                                </Button>
                            </Animated.View>
                        </TouchableWithoutFeedback>
                    )}

                    {isPaired && isLocked && quickUnlockSubmitting && quickUnlockProgress > 0 && (
                        <View style={{ marginTop: 10 }}>
                            <Text style={{ fontSize: 12, color: c.textSec, marginBottom: 6 }}>
                                {quickUnlockProgressLabel || 'Processing unlock...'}
                            </Text>
                            <ProgressBar
                                progress={quickUnlockProgress}
                                color={c.accent}
                                style={{ height: 6, borderRadius: 6, backgroundColor: c.search }}
                            />
                        </View>
                    )}

                    <View style={{ flexDirection: 'row', marginTop: isPaired && isLocked ? 8 : 16, gap: 8 }}>
                        {!isPaired && (
                            <Button
                                mode="contained"
                                style={{ flex: 1 }}
                                buttonColor={c.accent}
                                textColor={c.accentText}
                                onPress={navigateToPairBox}
                            >
                                Pair Box
                            </Button>
                        )}
                        <Button
                            mode="outlined"
                            style={{ flex: 1, borderColor: c.border }}
                            textColor={c.text}
                            onPress={() => openBoxControls(pairedBoxId)}
                        >
                            Advanced Controls
                        </Button>
                    </View>

                    {isPaired && (
                        <Button
                            mode="contained"
                            style={{ marginTop: 8 }}
                            buttonColor={c.redBg}
                            textColor={c.redText}
                            icon="alert-octagon"
                            onPress={() => navigation.navigate('TheftAlert')}
                        >
                            Report Box as Stolen!
                        </Button>
                    )}
                </View>

                {/* Rider Resources Carousel */}
                <Animated.View style={actionsAnim[0].style}>
                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text, marginTop: 16 }]}>Rider Resources</Text>
                    <FlatList
                        ref={flatListRef}
                        data={PROMO_SLIDES}
                        keyExtractor={(item) => item.id}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        snapToInterval={CAROUSEL_CARD_WIDTH + 8}
                        decelerationRate="fast"
                        contentContainerStyle={{ paddingHorizontal: 0 }}
                        onMomentumScrollEnd={handleCarouselScrollEnd}
                        renderItem={({ item }) => (
                            <TouchableOpacity activeOpacity={0.8} onPress={() => {
                                if (item.id === '1') {
                                    PremiumAlert.alert('Surge Pricing Active', 'High demand in downtown areas. Head there to earn 1.5x on your next 3 deliveries.', [{ text: 'Go Online', style: 'default' }], undefined, 'lightning-bolt', c.accent);
                                } else if (item.id === '2') {
                                    PremiumAlert.alert('Safety First', 'Please ensure you are wearing your helmet and reflective gear while on duty.', [{ text: 'I Understand', style: 'default' }], undefined, 'shield-check', c.blueText);
                                } else if (item.id === '3') {
                                    PremiumAlert.alert('Deliver & Win', 'You have completed 12/20 deliveries this week. Keep going to earn your ₱500 bonus!', [{ text: 'View Progress', style: 'default' }], undefined, 'trophy', '#F59E0B');
                                } else if (item.id === '4') {
                                    PremiumAlert.alert('Refer a Rider', 'Your referral code is: RIDER2026. Share it with friends and earn ₱1000 when they complete 50 deliveries.', [{ text: 'Share Code', style: 'default' }], undefined, 'account-multiple-plus', c.accent);
                                }
                            }}>
                                <View style={[styles.promoCard, { backgroundColor: c.card, borderColor: c.border, width: CAROUSEL_CARD_WIDTH }]}>
                                    <View style={[styles.promoIconWrap, { backgroundColor: c.accent + '10' }]}>
                                        <MaterialCommunityIcons name={item.icon as any} size={28} color={c.accent} />
                                    </View>
                                    <View style={styles.promoText}>
                                        <Text style={[styles.promoHeadline, { color: c.text }]}>{item.headline}</Text>
                                        <Text style={[styles.promoSub, { color: c.textSec }]} numberOfLines={2}>{item.subtitle}</Text>
                                    </View>
                                    <View style={[styles.promoCta, { backgroundColor: c.accent + '0D' }]}>
                                        <Text style={[styles.promoCtaText, { color: c.accent }]}>{item.cta}</Text>
                                        <MaterialCommunityIcons name="arrow-right" size={14} color={c.accent} />
                                    </View>
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                    <View style={styles.dotsRow}>
                        {PROMO_SLIDES.map((_, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.dot,
                                    {
                                        backgroundColor: i === activeSlide ? c.accent : c.border,
                                        width: i === activeSlide ? 18 : 6,
                                    },
                                ]}
                            />
                        ))}
                    </View>
                </Animated.View>

            </ScrollView >

            {/* Quick Unlock PIN Modal */}
            <Modal
                visible={showQuickUnlockModal}
                transparent
                animationType="fade"
                onRequestClose={() => !quickUnlockSubmitting && setShowQuickUnlockModal(false)}
            >
                <View style={styles.quickUnlockOverlay}>
                    <View style={[styles.quickUnlockCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                            <View style={[styles.quickUnlockIconWrap, { backgroundColor: c.greenBg }]}> 
                                <MaterialCommunityIcons name="lock-open-variant-outline" size={24} color={c.greenText} />
                            </View>
                            <View style={{ marginLeft: 12, flex: 1 }}>
                                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: c.text }}>Quick Unlock</Text>
                                <Text style={{ color: c.textSec, fontSize: 13 }}>Enter your 6-digit Personal PIN</Text>
                            </View>
                            {!quickUnlockSubmitting && (
                                <IconButton icon="close" size={20} iconColor={c.textSec} onPress={() => setShowQuickUnlockModal(false)} />
                            )}
                        </View>

                        <View style={[styles.quickUnlockInputRow, { borderColor: c.border, backgroundColor: c.search }]}>
                            <MaterialCommunityIcons name="lock" size={20} color={c.textSec} style={{ marginRight: 10 }} />
                            <TextInput
                                style={[styles.quickUnlockInput, { color: c.text }]}
                                value={quickUnlockPin}
                                onChangeText={(v) => setQuickUnlockPin(sanitizeQuickPinInput(v))}
                                keyboardType="number-pad"
                                maxLength={6}
                                secureTextEntry={!showQuickUnlockPinText}
                                placeholder="••••••"
                                placeholderTextColor={c.textTer}
                                editable={!quickUnlockSubmitting}
                                autoFocus
                            />
                            <IconButton
                                icon={showQuickUnlockPinText ? 'eye-off' : 'eye'}
                                size={20}
                                iconColor={c.textSec}
                                onPress={() => setShowQuickUnlockPinText(!showQuickUnlockPinText)}
                                style={{ margin: 0 }}
                            />
                        </View>

                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                            <Button
                                mode="outlined"
                                style={{ flex: 1, borderColor: c.border }}
                                textColor={c.text}
                                onPress={() => setShowQuickUnlockModal(false)}
                                disabled={quickUnlockSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                style={{ flex: 1 }}
                                buttonColor={c.greenText}
                                textColor="#FFFFFF"
                                onPress={handleSubmitQuickUnlockPin}
                                loading={quickUnlockSubmitting}
                                disabled={quickUnlockSubmitting || quickUnlockPin.length < 6}
                                icon="lock-open-check"
                            >
                                Unlock
                            </Button>
                        </View>
                    </View>
                </View>
            </Modal>

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

            <AvailableOrdersModal
                visible={showAvailableOrders}
                riderLat={riderLocation?.coords.latitude || localPhoneLocation?.coords.latitude || null}
                riderLng={riderLocation?.coords.longitude || localPhoneLocation?.coords.longitude || null}
                onClose={() => setShowAvailableOrders(false)}
                onAccept={async (request) => {
                    setShowAvailableOrders(false);
                    try {
                        // We use a dummy requestId here since pool orders are organically fetched, 
                        // and acceptOrder can handle a dummy request ID for the backend cleanly.
                        await handleAcceptOrder({ requestId: `pool-${request.bookingId}`, data: request });
                    } catch (error) {
                        console.error('Failed to accept available order', error);
                    }
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    bannerTitle: {
        fontFamily: 'Inter_700Bold',
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
    headerInfoBox: {
        backgroundColor: 'rgba(0,0,0,0.15)',
        padding: 12,
        borderRadius: 16,
    },
    iconBox: {
        backgroundColor: 'rgba(0,0,0,0.15)',
        padding: 8,
        borderRadius: 12,
        marginLeft: 8,
    },
    textShadow: {
        textShadowColor: 'rgba(0, 0, 0, 0.6)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    locationContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    locationText: {
        color: 'rgba(255,255,255,0.95)',
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
        marginLeft: 4,
    },
    dateText: {
        color: 'rgba(255,255,255,0.95)',
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
    },
    timeText: {
        color: 'white',
        fontSize: 30,
        fontFamily: 'SpaceGrotesk_700Bold',
    },
    weatherContainer: {
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.15)',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 12,
    },
    weatherText: {
        color: 'white',
        fontSize: 16,
        fontFamily: 'SpaceGrotesk_700Bold',
    },
    weatherCondition: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 10,
        fontFamily: 'Inter_500Medium',
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
        fontFamily: 'Inter_700Bold',
    },
    sectionTitle: {
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
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
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    actionsSection: {
        marginBottom: 6,
        zIndex: 8,
        elevation: 8,
    },
    actionCard: {
        width: '48.5%',
        minHeight: 112,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 10,
    },
    actionTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    actionIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
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
    actionTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
        marginBottom: 4,
    },
    actionSubtitle: {
        fontSize: 11,
        lineHeight: 15,
        fontFamily: 'Inter_500Medium',
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_600SemiBold',
    },
    incidentLockOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 999,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    incidentLockCard: {
        width: '100%',
        borderRadius: 14,
        borderWidth: 1,
    },
    badge: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    promoCard: {
        borderRadius: 16, borderWidth: 1, padding: 18,
        marginRight: 8, overflow: 'hidden',
    },
    promoIconWrap: {
        width: 48, height: 48, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    promoText: { marginBottom: 14 },
    promoHeadline: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 4 },
    promoSub: { fontSize: 13, lineHeight: 18 },
    promoCta: {
        flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
        gap: 4, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    },
    promoCtaText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
    dotsRow: {
        flexDirection: 'row', justifyContent: 'center',
        alignItems: 'center', marginTop: 12, gap: 5, marginBottom: 10,
    },
    dot: { height: 6, borderRadius: 3 },
    mapPreviewCard: {
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 20,
    },
    mapPreviewHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    mapPreviewIconWrap: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    mapPreviewContainer: {
        height: 180,
        position: 'relative',
    },
    mapPreviewPlaceholder: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    mapPreviewOverlay: {
        position: 'absolute',
        bottom: 10,
        left: 10,
        right: 10,
    },
    mapPreviewAddressPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
        flexShrink: 1,
    },
    mapPreviewAddressText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        marginLeft: 6,
        flexShrink: 1,
        lineHeight: 15,
    },
    emptyIconWrap: {
        width: 56, height: 56, borderRadius: 28,
        alignItems: 'center', justifyContent: 'center', marginBottom: 6,
    },
    quickUnlockOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    quickUnlockCard: {
        width: '100%',
        borderRadius: 16,
        borderWidth: 1,
        padding: 20,
    },
    quickUnlockIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    quickUnlockInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        height: 52,
    },
    quickUnlockInput: {
        flex: 1,
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
        letterSpacing: 8,
    },
});
