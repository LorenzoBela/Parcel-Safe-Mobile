import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, ScrollView, Platform, Linking, Animated, ActivityIndicator, AppState, AppStateStatus } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Button, Card, TextInput, Portal, Modal, IconButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useAppTheme } from '../../context/ThemeContext';

import * as ImagePicker from 'expo-image-picker';
import { useHeadingSmoothing } from '../../hooks/useHeadingSmoothing';

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
    sendPickupArrivalNotification,
    WaitTimerState,
    CONFIG as WaitConfig,
} from '../../services/customerNotHomeService';

// Geofence utilities (extracted from removed addressUpdateService)
import {
    checkGeofence,
    calculateDistanceMeters,
    createDefaultGeofence,
    GeofenceConfig,
} from '../../utils/geoUtils';
import {
    createInitialState,
    updateGeofenceState,
    GeofenceStabilityState,
} from '../../services/geofenceStabilityService';
import {
    loadRiderSessionSnapshot,
    saveRiderSessionSnapshot,
    clearRiderSessionSnapshot,
} from '../../services/riderSessionSnapshotService';

// Grace Period & No-Show
import {
    isGracePeriodExpired,
    formatGracePeriodRemaining,
    markNoShow,
    writeGracePeriodToFirebase,
    GRACE_PERIOD_MS,
} from '../../services/pickupLockService';

import {
    startBackgroundLocation,
    stopBackgroundLocation,
    isBackgroundLocationRunning,
    subscribeToBackgroundLocationState,
    setTrackingPhase,
    BackgroundLocationState,
} from '../../services/backgroundLocationService';
import { startForegroundGpsWarmWindow } from '../../services/gpsWarmupService';

import {
    subscribeToLocation,
    subscribeToLockout,
    LockoutState,
    subscribeToBattery,
    DualBatteryState,
    subscribeToTamper,
    TamperState,
    // Lock Events (OTP + Face Detection from hardware)
    subscribeToLockEvents,
    LockEvent,
    // EC-97: Low-Light Detection
    subscribeToLowLight,
    LowLightState,
    isLowLightFallbackRequired,
    getLowLightMessage,
    requestBoxContextRefresh,
    writePhoneLocation,
} from '../../services/firebaseClient';

import { bleOtpService, BleBoxDevice } from '../../services/bleOtpService';
import { reportBatteryDeadIncident } from '../../services/batteryIncidentService';

// EC-32: Cancellation Service
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason, subscribeToCancellation, CancellationState } from '../../services/cancellationService';
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
import { showStatusNotification } from '../../services/pushNotificationService';
import useAuthStore from '../../store/authStore';
import PickupVerification from './components/PickupVerification';
import DropoffVerification from './components/DropoffVerification';

// Mapbox for geofence preview
import MapboxGL, { isMapboxNativeAvailable, StyleURL } from '../../components/map/MapboxWrapper';
import AnimatedRiderMarker from '../../components/map/AnimatedRiderMarker';

function buildGeofenceCircleGeoJSON(
    centerLng: number,
    centerLat: number,
    radiusM: number,
    segments: number = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
    const coords: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const dLat = (radiusM / 111320) * Math.cos(angle);
        const dLng = (radiusM / (111320 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(angle);
        coords.push([centerLng + dLng, centerLat + dLat]);
    }
    return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
    };
}


interface RouteParams {
    deliveryId: string;
    boxId: string;
    targetLat: number;
    targetLng: number;
    targetAddress: string;
    customerPhone?: string;
    riderName?: string;
    senderName?: string;
    senderPhone?: string;
    recipientName?: string;
    deliveryNotes?: string;
    // Separate pickup/dropoff coords for dynamic geofence switching
    pickupLat?: number;
    pickupLng?: number;
    pickupAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    dropoffAddress?: string;
    samePickupDropoff?: boolean;
    status?: string;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumAlert } from '../../services/PremiumAlertService';

const BATTERY_HANDOFF_TIMEOUT_MS = 15 * 60 * 1000;
const PHONE_DROPOFF_CLEAR_INSIDE_MAX_M = 40;
const PHONE_DROPOFF_CLEAR_INSIDE_RATIO = 0.8;
const DROPOFF_PHONE_DISTANCE_INTERVAL_M = 1;
const DEFAULT_PHONE_DISTANCE_INTERVAL_M = 5;
const MANUAL_REFRESH_PHONE_TIMEOUT_MS = 10000;
const MANUAL_REFRESH_CACHED_PHONE_MAX_AGE_MS = 30000;
const MANUAL_REFRESH_LAST_KNOWN_ACCURACY_M = 80;
const DROPOFF_ARRIVAL_RETRY_MS = 2500;
const DROPOFF_ARRIVAL_CONFIRMATION_RETRY_MS = 4000;
const DROPOFF_ARRIVAL_RETRYABLE_STATUSES = new Set(['IN_TRANSIT', 'PICKED_UP', 'ARRIVED']);
const DROPOFF_ARRIVAL_CONFIRMED_STATUSES = new Set(['ARRIVED', 'COMPLETED']);
const SAME_PICKUP_DROPOFF_RADIUS_M = 25;

function formatRemainingMinutesSeconds(remainingMs: number): string {
    const clamped = Math.max(0, remainingMs);
    const minutes = Math.floor(clamped / 60000);
    const seconds = Math.floor((clamped % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function ArrivalScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const params = route.params as RouteParams | undefined;
    const insets = useSafeAreaInsets();
    const { isDarkMode } = useAppTheme();
    const c = {
        background: isDarkMode ? '#121212' : '#f8f9fa',
        text: isDarkMode ? '#ffffff' : '#1a1a1a',
        modalBg: isDarkMode ? '#1e1e1e' : 'white',
        modalText: isDarkMode ? '#e4e4e7' : '#666',
        card: isDarkMode ? '#1e1e1e' : '#ffffff',
        border: isDarkMode ? '#27272a' : '#e5e7eb',
    };

    if (!params?.deliveryId || !params?.boxId) {
        return (
            <View style={[styles.container, { justifyContent: 'center', padding: 24, backgroundColor: c.background }]}>
                <Text variant="titleMedium" style={{ marginBottom: 12, color: c.text }}>
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
    const [isInsideGeoFence, setIsInsideGeoFence] = useState(false); // Master switch (Phone && (Box || Offline || Fallback))
    const [isPhoneInside, setIsPhoneInside] = useState(false);
    const [isBoxInside, setIsBoxInside] = useState(false);
    const [isBoxOffline, setIsBoxOffline] = useState(false);
    const [isPhoneOnlyFallback, setIsPhoneOnlyFallback] = useState(false); // EC-FIX: Phone-only fallback when box is stuck
    const [boxLocationLastSeen, setBoxLocationLastSeen] = useState<number>(0);
    const [phoneLocationLastSeen, setPhoneLocationLastSeen] = useState<number>(0);
    const [boxLocationSubscriptionEpoch, setBoxLocationSubscriptionEpoch] = useState(0);
    const phoneGeofenceStateRef = useRef<GeofenceStabilityState>(createInitialState());
    const boxGeofenceStateRef = useRef<GeofenceStabilityState>(createInitialState());
    const masterSwitchDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const masterDecisionRef = useRef<boolean>(false);
    const boxOfflineRef = useRef<boolean>(false);
    const boxOfflineTransitionStartRef = useRef<number>(0);
    const boxFirstLoadReceivedRef = useRef<boolean>(false); // Tracks whether we've received first box location callback
    const phoneInsideSinceRef = useRef<number>(0); // Tracks when phone first entered geofence

    const [currentPosition, setCurrentPosition] = useState({ lat: 0, lng: 0, accuracy: 25, heading: 0, speed: 0 });
    const [localPhoneHeading, setLocalPhoneHeading] = useState<number | null>(null);
    const headingSmoother = useHeadingSmoothing();

    // EC-FIX: GPS Acquisition Gate — show a loading screen until phone GPS is acquired
    const [gpsAcquired, setGpsAcquired] = useState(false);
    const gpsAcquireTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [geofence, setGeofence] = useState<GeofenceConfig>(
        createDefaultGeofence(params.targetLat, params.targetLng)
    );
    const [geofenceTarget, setGeofenceTarget] = useState<'pickup' | 'dropoff' | 'return_pickup'>('pickup');
    const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
    const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
    const [dropoffArrivalRetryTick, setDropoffArrivalRetryTick] = useState(0);

    const applyPhonePosition = useCallback((coords: { latitude: number; longitude: number; accuracy: number | null; heading: number | null; speed: number | null }, fallbackAccuracy: number) => {
        const position = {
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy ?? fallbackAccuracy,
            heading: coords.heading ?? 0,
            speed: coords.speed ?? 0,
        };
        setCurrentPosition(position);

        const now = Date.now();
        const quality = {
            hdop: Math.max(0.8, Math.min(8, (position.accuracy || fallbackAccuracy) / 6)),
            satellites: (position.accuracy || fallbackAccuracy) <= 20 ? 8 : ((position.accuracy || fallbackAccuracy) <= 40 ? 6 : 4),
            timestamp: now,
        };
        const nextState = updateGeofenceState(
            phoneGeofenceStateRef.current,
            { lat: position.lat, lng: position.lng },
            { latitude: geofence.centerLat, longitude: geofence.centerLng },
            quality,
            null,
            now
        );
        const geometricResult = checkGeofence(position, geofence);
        const clearInsideRadiusM = Math.min(
            geofence.radiusMeters * PHONE_DROPOFF_CLEAR_INSIDE_RATIO,
            PHONE_DROPOFF_CLEAR_INSIDE_MAX_M
        );
        const isClearDropoffFix =
            geofenceTarget === 'dropoff' &&
            geometricResult.isInside &&
            nextState.rawDistanceM <= clearInsideRadiusM;
        const effectiveState: GeofenceStabilityState = isClearDropoffFix && nextState.stableState !== 'INSIDE'
            ? {
                ...nextState,
                stableState: 'INSIDE',
                rawState: 'INSIDE',
                hysteresisCount: Math.max(nextState.hysteresisCount, 3),
                lastStableChangeMs: now,
            }
            : nextState;

        phoneGeofenceStateRef.current = effectiveState;
        setIsPhoneInside(effectiveState.stableState === 'INSIDE');
        setDistanceMeters(geometricResult.distanceMeters);
        setPhoneLocationLastSeen(now);
    }, [geofence, geofenceTarget]);

    // EC-FIX: Derive gpsAcquired — phone GPS is required, box is best-effort (4s timeout)
    useEffect(() => {
        if (gpsAcquired) return; // Once acquired, never revert

        const hasPhoneGps = currentPosition.lat !== 0 || currentPosition.lng !== 0;
        const hasBoxData = boxFirstLoadReceivedRef.current;

        if (hasPhoneGps && (hasBoxData || isBoxOffline)) {
            setGpsAcquired(true);
            return;
        }

        // If phone GPS arrived but box is still pending, wait up to 4s then proceed
        if (hasPhoneGps && !hasBoxData && !isBoxOffline) {
            if (!gpsAcquireTimerRef.current) {
                gpsAcquireTimerRef.current = setTimeout(() => {
                    setGpsAcquired(true);
                }, 4000);
            }
        }

        // 8s hard timeout — proceed with whatever we have
        const hardTimeout = setTimeout(() => {
            setGpsAcquired(true);
        }, 8000);

        return () => {
            clearTimeout(hardTimeout);
            if (gpsAcquireTimerRef.current) {
                clearTimeout(gpsAcquireTimerRef.current);
                gpsAcquireTimerRef.current = null;
            }
        };
    }, [currentPosition.lat, currentPosition.lng, isBoxOffline, gpsAcquired]);

    // EC-11: Customer Not Home State
    const [waitTimerState, setWaitTimerState] = useState<WaitTimerState>(
        initWaitTimerState(params.deliveryId, params.boxId)
    );
    const [timerNowMs, setTimerNowMs] = useState(() => Date.now());
    const [displayTime, setDisplayTime] = useState('5:00');
    const [arrivalPhotoUri, setArrivalPhotoUri] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const timerTickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    // Grace Period & No-Show State
    const [arrivedAt, setArrivedAt] = useState<number | null>(null);
    const [gracePeriodDisplay, setGracePeriodDisplay] = useState<string>('10:00');
    const [gracePeriodExpired, setGracePeriodExpired] = useState(false);
    const [noShowLoading, setNoShowLoading] = useState(false);
    const [batteryIncidentReportedAt, setBatteryIncidentReportedAt] = useState<number | null>(null);
    const [batteryTimeoutDisplay, setBatteryTimeoutDisplay] = useState('15:00');
    const [reportingBatteryIncident, setReportingBatteryIncident] = useState(false);

    // EC-04: OTP Lockout State
    const [lockoutState, setLockoutState] = useState<LockoutState | null>(null);
    const [lockoutCountdown, setLockoutCountdown] = useState('');

    // EC-03: Battery State
    const [batteryState, setBatteryState] = useState<DualBatteryState | null>(null);
    const batteryMainPct = batteryState?.main?.percentage;
    const batteryLockPct = batteryState?.secondary?.percentage;
    const mainLow = Boolean(batteryState?.main?.lowBatteryWarning);
    const lockLow = Boolean(batteryState?.secondary?.lowBatteryWarning);
    const mainCritical = Boolean(batteryState?.main?.criticalBatteryWarning);
    const lockCritical = Boolean(batteryState?.secondary?.criticalBatteryWarning);
    const hasBatteryLow = mainLow || lockLow;
    const hasBatteryCritical = mainCritical || lockCritical;
    const batterySummary = [
        batteryMainPct != null ? `MCU ${Math.round(batteryMainPct)}%` : null,
        batteryLockPct != null ? `Lock ${Math.round(batteryLockPct)}%` : null,
    ].filter(Boolean).join(' / ');
    const batteryAlertSummary = [
        (mainCritical || mainLow) && batteryMainPct != null ? `MCU ${Math.round(batteryMainPct)}%` : null,
        (lockCritical || lockLow) && batteryLockPct != null ? `Lock ${Math.round(batteryLockPct)}%` : null,
    ].filter(Boolean).join(' / ') || batterySummary;

    // EC-18: Tamper State
    const [tamperState, setTamperState] = useState<TamperState | null>(null);

    // EC-15: Background Location State
    const [bgLocationState, setBgLocationState] = useState<BackgroundLocationState | null>(null);

    // EC-97: Low-Light State
    const [lowLightState, setLowLightState] = useState<LowLightState | null>(null);
    const tamperDeliveryFlaggedRef = useRef(false);
    const tamperAlertShownRef = useRef(false);
    const pickupArrivalNotifSentRef = useRef(false);
    const dropoffArrivalSyncInFlightRef = useRef(false);
    const dropoffArrivalPersistedRef = useRef(false);
    const dropoffArrivalRetryTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Lock Events (OTP + Face Detection from hardware)
    const [lockEvent, setLockEvent] = useState<LockEvent | null>(null);
    const lockEventNotifiedRef = useRef(false);

    // EC-02: BLE Transfer State
    const [showBleModal, setShowBleModal] = useState(false);
    const [bleStatus, setBleStatus] = useState<'idle' | 'scanning' | 'connecting' | 'transferring' | 'success' | 'error'>('idle');
    const [bleMessage, setBleMessage] = useState('');

    // EC-32: Cancellation State
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [returnCancellationState, setReturnCancellationState] = useState<CancellationState | null>(null);

    // EC-78: Delivery Reassignment State
    const [reassignmentState, setReassignmentState] = useState<ReassignmentState | null>(null);
    const [showReassignmentModal, setShowReassignmentModal] = useState(false);
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const riderId = authedUserId;
    const [deliveryStatus, setDeliveryStatus] = useState<string>('ASSIGNED');

    const clearDropoffArrivalRetry = useCallback(() => {
        if (dropoffArrivalRetryTimerRef.current) {
            clearTimeout(dropoffArrivalRetryTimerRef.current);
            dropoffArrivalRetryTimerRef.current = null;
        }
    }, []);

    const scheduleDropoffArrivalRetry = useCallback((delayMs = DROPOFF_ARRIVAL_RETRY_MS) => {
        if (dropoffArrivalPersistedRef.current) return;
        clearDropoffArrivalRetry();
        dropoffArrivalRetryTimerRef.current = setTimeout(() => {
            dropoffArrivalRetryTimerRef.current = null;
            dropoffArrivalSyncInFlightRef.current = false;
            setDropoffArrivalRetryTick((prev) => prev + 1);
        }, delayMs);
    }, [clearDropoffArrivalRetry]);

    useEffect(() => clearDropoffArrivalRetry, [clearDropoffArrivalRetry]);

    const scheduleNextTimerTick = useCallback(() => {
        if (timerTickTimeoutRef.current) {
            clearTimeout(timerTickTimeoutRef.current);
            timerTickTimeoutRef.current = null;
        }

        const now = Date.now();
        const delay = Math.max(250, 1000 - (now % 1000) + 10);

        timerTickTimeoutRef.current = setTimeout(() => {
            setTimerNowMs(Date.now());
            if (appStateRef.current === 'active') {
                scheduleNextTimerTick();
            }
        }, delay);
    }, []);

    // Single app-aware ticker for all countdowns; avoids multiple long-lived intervals.
    useEffect(() => {
        setTimerNowMs(Date.now());
        scheduleNextTimerTick();

        const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            appStateRef.current = nextState;
            if (nextState === 'active') {
                setTimerNowMs(Date.now());
                scheduleNextTimerTick();
            } else if (timerTickTimeoutRef.current) {
                clearTimeout(timerTickTimeoutRef.current);
                timerTickTimeoutRef.current = null;
            }
        });

        return () => {
            appStateSub.remove();
            if (timerTickTimeoutRef.current) {
                clearTimeout(timerTickTimeoutRef.current);
                timerTickTimeoutRef.current = null;
            }
        };
    }, [scheduleNextTimerTick]);

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
                PremiumAlert.alert(
                    '🔒 OTP Lockout Active',
                    `Too many failed OTP attempts. Box is locked for ${Math.ceil((state.expires_at - Date.now()) / 60000)} minutes.`,
                    [{ text: 'OK' }]
                );
            }
        });

        // EC-03: Subscribe to battery state
        const unsubscribeBattery = subscribeToBattery(params.boxId, (state) => {
            setBatteryState(state);
            const isCritical = Boolean(
                state?.main?.criticalBatteryWarning || state?.secondary?.criticalBatteryWarning
            );
            if (isCritical) {
                const summary = [
                    state?.main?.percentage != null ? `MCU ${Math.round(state.main.percentage)}%` : null,
                    state?.secondary?.percentage != null ? `Lock ${Math.round(state.secondary.percentage)}%` : null,
                ].filter(Boolean).join(' / ');
                PremiumAlert.alert(
                    '⚠️ Critical Battery',
                    `Box battery is critically low${summary ? ` (${summary})` : ''}. Complete delivery quickly!`,
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
                if (!tamperAlertShownRef.current) {
                    tamperAlertShownRef.current = true;
                    PremiumAlert.alert(
                        'Security Hold',
                        'A security incident was detected and controls are temporarily paused. Please contact support and follow incident workflow.',
                        [{ text: 'Contact Support', style: 'destructive' }]
                    );
                }
            } else {
                tamperAlertShownRef.current = false;
            }
        });

        // EC-97: Subscribe to low-light state
        const unsubscribeLowLight = subscribeToLowLight(params.boxId, (state) => {
            setLowLightState(state);
            if (state && isLowLightFallbackRequired(state)) {
                PremiumAlert.alert(
                    '📷 Low Light Condition',
                    'Camera cannot detect face due to poor lighting. Alternative verification will be required.',
                    [{ text: 'OK' }]
                );
            }
        });

        // Lock Events: Subscribe to OTP + Face Detection results from hardware
        const unsubscribeLockEvent = subscribeToLockEvents(params.boxId, (event) => {
            setLockEvent(event);
            if (event && !lockEventNotifiedRef.current) {
                lockEventNotifiedRef.current = true;
                if (event.unlocked) {
                    // OTP valid + face detected → box unlocked
                    showStatusNotification(
                        '🔓 Box Unlocked',
                        'OTP verified & face detected — box has been unlocked successfully.',
                        { deliveryId: params.deliveryId, type: 'LOCK_EVENT' }
                    );
                    PremiumAlert.alert(
                        '🔓 Box Unlocked',
                        'The recipient has verified the OTP and their face was captured. The box is now open.',
                        [{ text: 'OK' }]
                    );
                } else if (event.otp_valid && !event.face_detected) {
                    // OTP correct but no face
                    showStatusNotification(
                        '👤 Face Not Detected',
                        'OTP was correct but no face detected. Box remains locked.',
                        { deliveryId: params.deliveryId, type: 'LOCK_EVENT' }
                    );
                } else if (!event.otp_valid) {
                    // Wrong OTP entered
                    showStatusNotification(
                        '🔒 Invalid OTP',
                        'An incorrect OTP was entered on the box keypad.',
                        { deliveryId: params.deliveryId, type: 'LOCK_EVENT' }
                    );
                }
                // Reset after a brief delay to allow re-notification on next event
                setTimeout(() => { lockEventNotifiedRef.current = false; }, 5000);
            }
        });

        return () => {
            unsubscribeBgLocation();
            unsubscribeLockout();
            unsubscribeBattery();
            unsubscribeTamper();
            unsubscribeLowLight();
            unsubscribeLockEvent();
        };
    }, [params.boxId, params.deliveryId]);

    const [deliveryOtp, setDeliveryOtp] = useState<string | null>(null);

    // Subscribe to cancellation state so we can resume return process if rider comes back
    useEffect(() => {
        const unsubscribe = subscribeToCancellation(params.deliveryId, (state) => {
            setReturnCancellationState(state);
        });
        return () => unsubscribe();
    }, [params.deliveryId]);

    useEffect(() => {
        const unsubscribe = subscribeToDelivery(params.deliveryId, (delivery) => {
            if (!delivery?.status) {
                return;
            }
            setDeliveryStatus(delivery.status);

            if (DROPOFF_ARRIVAL_CONFIRMED_STATUSES.has(delivery.status)) {
                dropoffArrivalPersistedRef.current = true;
                dropoffArrivalSyncInFlightRef.current = false;
                clearDropoffArrivalRetry();
            } else if (DROPOFF_ARRIVAL_RETRYABLE_STATUSES.has(delivery.status)) {
                dropoffArrivalPersistedRef.current = false;
            }

            // Track arrived_at timestamp for grace period
            if (delivery.status === 'ARRIVED') {
                const rawArrivedAt = delivery.arrived_at ?? delivery.updated_at;
                if (rawArrivedAt) {
                    const ts = typeof rawArrivedAt === 'number'
                        ? rawArrivedAt
                        : new Date(rawArrivedAt).getTime();
                    if (Number.isFinite(ts)) {
                        setArrivedAt((prev) => prev ?? ts);
                    }
                }
            }

            // EC-Fix: sync OTP code from Firebase (now stored in delivery node)
            if (delivery.otp_code) {
                setDeliveryOtp(delivery.otp_code);
            }
        });

        // Fetch OTP from Supabase (fallback and initial load)
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
    }, [params.deliveryId, clearDropoffArrivalRetry]);

    const isReturning = ['RETURNING', 'TAMPERED'].includes(deliveryStatus);
    const isPickupConfirmed = ['IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'RETURNING', 'TAMPERED'].includes(deliveryStatus);
    const isDropoffPhase = geofenceTarget !== 'pickup';
    const hasPickupCoords = Number.isFinite(params.pickupLat) && Number.isFinite(params.pickupLng);
    const hasDropoffCoords = Number.isFinite(params.dropoffLat) && Number.isFinite(params.dropoffLng);
    const isSamePickupDropoff = Boolean(params.samePickupDropoff) || (
        hasPickupCoords &&
        hasDropoffCoords &&
        calculateDistanceMeters(
            params.pickupLat as number,
            params.pickupLng as number,
            params.dropoffLat as number,
            params.dropoffLng as number
        ) <= SAME_PICKUP_DROPOFF_RADIUS_M
    );

    useEffect(() => {
        let mounted = true;

        const hydrateSnapshot = async () => {
            const snapshot = await loadRiderSessionSnapshot();
            if (!mounted || !snapshot) return;
            if (snapshot.deliveryId !== params.deliveryId || snapshot.boxId !== params.boxId) return;

            if (snapshot.geofenceTarget === 'dropoff' && hasDropoffCoords) {
                setGeofence(createDefaultGeofence(params.dropoffLat as number, params.dropoffLng as number));
                setGeofenceTarget('dropoff');
            } else if (hasPickupCoords) {
                setGeofence(createDefaultGeofence(params.pickupLat as number, params.pickupLng as number));
                setGeofenceTarget(snapshot.geofenceTarget === 'return_pickup' ? 'return_pickup' : 'pickup');
            }

            setBoxLocationLastSeen(snapshot.lastBoxHeartbeatAt || 0);
            setPhoneLocationLastSeen(snapshot.lastPhoneGpsAt || 0);
            if (typeof snapshot.lastDistanceMeters === 'number') {
                setDistanceMeters(snapshot.lastDistanceMeters);
            }
        };

        hydrateSnapshot();

        return () => {
            mounted = false;
        };
    }, [
        params.deliveryId,
        params.boxId,
        params.pickupLat,
        params.pickupLng,
        params.dropoffLat,
        params.dropoffLng,
        hasPickupCoords,
        hasDropoffCoords,
    ]);

    useEffect(() => {
        const uiPhase = !isPickupConfirmed
            ? 'pickup'
            : isReturning
                ? 'return_pickup'
                : (waitTimerState.status === 'WAITING' || waitTimerState.status === 'EXPIRED')
                    ? 'customer_wait'
                    : deliveryStatus === 'ARRIVED'
                        ? 'dropoff_arrived'
                        : deliveryStatus === 'COMPLETED'
                            ? 'completed'
                            : 'dropoff';

        saveRiderSessionSnapshot({
            lastActiveDeliveryId: params.deliveryId,
            deliveryId: params.deliveryId,
            boxId: params.boxId,
            geofenceTarget,
            uiPhase,
            lastDistanceMeters: distanceMeters,
            lastBoxHeartbeatAt: boxLocationLastSeen,
            lastPhoneGpsAt: phoneLocationLastSeen,
        });

        if (deliveryStatus === 'COMPLETED' || deliveryStatus === 'CANCELLED') {
            clearRiderSessionSnapshot();
        }
    }, [
        params.deliveryId,
        params.boxId,
        geofenceTarget,
        deliveryStatus,
        distanceMeters,
        boxLocationLastSeen,
        phoneLocationLastSeen,
        isPickupConfirmed,
        isReturning,
        waitTimerState.status,
    ]);

    // ━━━ Grace Period Timer Effect ━━━
    // Only starts when rider is physically inside the DROPOFF geofence.
    // isInsideGeoFence at this point references the dropoff zone (geofenceTarget === 'dropoff')
    // so the timer never ticks while the rider is still at the pickup location.
    useEffect(() => {
        if (!isDropoffPhase || !isInsideGeoFence || deliveryStatus !== 'ARRIVED' || !arrivedAt) return;

        // Write grace period to Firebase once for admin visibility
        import('../../services/firebaseClient').then(({ getFirebaseDatabase }) => {
            writeGracePeriodToFirebase(getFirebaseDatabase(), params.deliveryId, arrivedAt).catch(() => { });
        });
    }, [isDropoffPhase, isInsideGeoFence, deliveryStatus, arrivedAt, params.deliveryId]);

    useEffect(() => {
        if (!isDropoffPhase || !isInsideGeoFence || deliveryStatus !== 'ARRIVED' || !arrivedAt) return;

        setGracePeriodDisplay(formatGracePeriodRemaining(arrivedAt));
        setGracePeriodExpired(isGracePeriodExpired(arrivedAt));
    }, [isDropoffPhase, isInsideGeoFence, deliveryStatus, arrivedAt, timerNowMs]);

    useEffect(() => {
        if (!isDropoffPhase) {
            setArrivedAt(null);
            setGracePeriodDisplay('10:00');
            setGracePeriodExpired(false);
            setBatteryIncidentReportedAt(null);
            setBatteryTimeoutDisplay('15:00');
        }
    }, [isDropoffPhase]);

    useEffect(() => {
        if (!isDropoffPhase || deliveryStatus !== 'ARRIVED' || !batteryIncidentReportedAt) return;

        const remaining = BATTERY_HANDOFF_TIMEOUT_MS - (timerNowMs - batteryIncidentReportedAt);
        setBatteryTimeoutDisplay(formatRemainingMinutesSeconds(remaining));
    }, [isDropoffPhase, deliveryStatus, batteryIncidentReportedAt, timerNowMs]);

    // ━━━ No-Show Handler ━━━
    const handleMarkNoShow = async () => {
        if (!arrivedAt || !riderId) return;

        if (!isGracePeriodExpired(arrivedAt)) {
            PremiumAlert.alert('Grace Period Active', 'You must wait for the full grace period before marking a no-show.');
            return;
        }

        PremiumAlert.alert(
            'Confirm No-Show',
            'This will cancel the delivery and apply a penalty to the customer. This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Confirm No-Show',
                    style: 'destructive',
                    onPress: async () => {
                        setNoShowLoading(true);
                        const result = await markNoShow(params.deliveryId, riderId);
                        setNoShowLoading(false);

                        if (result.success) {
                            PremiumAlert.alert(
                                '✅ No-Show Confirmed',
                                'The delivery has been cancelled. You are now available for new orders.',
                                [{ text: 'OK', onPress: () => navigation.goBack() }]
                            );
                        } else {
                            PremiumAlert.alert('Error', result.error || 'Failed to mark no-show. Please try again.');
                        }
                    },
                },
            ]
        );
    };

    const handleReportBatteryIncident = async () => {
        if (!params.boxId || !params.deliveryId || reportingBatteryIncident) return;

        setReportingBatteryIncident(true);
        const ok = await reportBatteryDeadIncident({
            boxId: params.boxId,
            deliveryId: params.deliveryId,
            stage: 'DROPOFF',
            note: `Rider reported battery handoff risk while ARRIVED at ${new Date().toISOString()}`,
        });
        setReportingBatteryIncident(false);

        if (ok) {
            if (!batteryIncidentReportedAt) {
                setBatteryIncidentReportedAt(Date.now());
            }
            PremiumAlert.alert(
                'Battery Incident Reported',
                'Customer, rider, and admin have been notified. Continue manual handoff and complete within the timeout window.'
            );
        } else {
            PremiumAlert.alert(
                'Report Failed',
                'Could not report battery incident right now. Check network and try again.'
            );
        }
    };

    // Dynamically switch geofence target when transitioning from pickup to dropoff
    useEffect(() => {
        // Reset geofence stabilizers when destination target changes.
        phoneGeofenceStateRef.current = createInitialState();
        boxGeofenceStateRef.current = createInitialState();
        masterDecisionRef.current = false;
        boxOfflineRef.current = false;
        boxOfflineTransitionStartRef.current = 0;
        // EC-FIX: Also reset the new fallback tracking refs
        boxFirstLoadReceivedRef.current = false;
        phoneInsideSinceRef.current = 0;
        setIsPhoneOnlyFallback(false);
        // EC-FIX: Clear stale distance so the old geofence's distance
        // doesn't bleed into the new target (e.g. pickup distance showing in dropoff phase)
        setDistanceMeters(null);

        if (isPickupConfirmed && isReturning && hasPickupCoords) {
            setGeofence(createDefaultGeofence(params.pickupLat as number, params.pickupLng as number));
            setGeofenceTarget('return_pickup');
            // Reset stale inside-state so the old pickup check doesn't bleed into the new geofence
            setIsInsideGeoFence(false);
            setIsPhoneInside(false);
            setIsBoxInside(false);
            return;
        }

        if (isPickupConfirmed && !isReturning && hasDropoffCoords) {
            setGeofence(createDefaultGeofence(params.dropoffLat as number, params.dropoffLng as number));
            setGeofenceTarget('dropoff');
            // Reset stale inside-state — rider is still at pickup, not dropoff yet.
            // Without this reset, DropoffVerification's auto-arrive fires immediately
            // because isInsideGeoFence is still true from the last pickup-geofence check.
            setIsInsideGeoFence(false);
            setIsPhoneInside(false);
            setIsBoxInside(false);
            return;
        }

        if (!isPickupConfirmed && hasPickupCoords) {
            setGeofence(createDefaultGeofence(params.pickupLat as number, params.pickupLng as number));
            setGeofenceTarget('pickup');
            return;
        }

        // If target coords are invalid/missing, fail safe to avoid accidental ARRIVED at wrong location.
        setGeofenceTarget('pickup');
        setIsInsideGeoFence(false);
        setIsPhoneInside(false);
        setIsBoxInside(false);
    }, [isPickupConfirmed, isReturning, hasPickupCoords, hasDropoffCoords, params.pickupLat, params.pickupLng, params.dropoffLat, params.dropoffLng]);

    // 1. Track PHONE Location (The "Golden Rule")
    useEffect(() => {
        let subscription: Location.LocationSubscription | null = null;

        const startPhoneTracking = async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                PremiumAlert.alert('Permission Denied', 'Phone location is required to verify arrival.');
                return;
            }

            // Fast relock after resume/lockscreen: keep high-accuracy warm briefly.
            startForegroundGpsWarmWindow(25000).catch(() => { });

            // Now that we have a loading gate, we no longer need to seed with fast/inaccurate 
            // cached locations (which caused the 'bouncing' effect the user noticed).
            // We directly wait for the continuous high-accuracy watch to yield its first accurate fix.

            // Stage 3: High-accuracy continuous GPS watch for precise ongoing checks.
            subscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 2000,
                    distanceInterval: geofenceTarget === 'dropoff'
                        ? DROPOFF_PHONE_DISTANCE_INTERVAL_M
                        : DEFAULT_PHONE_DISTANCE_INTERVAL_M,
                },
                (location) => {
                    applyPhonePosition(location.coords, 25);
                }
            );
        };

        startPhoneTracking();

        return () => {
            if (subscription) {
                subscription.remove();
            }
        };
    }, [geofence, geofenceTarget, applyPhonePosition]);

    // Device Compass Heading (Foreground)
    useEffect(() => {
        let headingSub: Location.LocationSubscription | null = null;
        const startHeadingWatcher = async () => {
            try {
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status === 'granted') {
                    headingSub = await Location.watchHeadingAsync((data) => {
                        setLocalPhoneHeading(data.trueHeading !== -1 ? data.trueHeading : data.magHeading);
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
    }, []);

    // 2. Track BOX Location (The "Secondary Check")
    // EC-FIX: Improved offline detection — null data = immediate offline (no debounce),
    // stale data = debounced offline transition.
    useEffect(() => {
        const OFFLINE_SWITCH_DEBOUNCE_MS = 5000;

        /** Mark box as immediately offline (skip debounce) — used when data is null/missing */
        const markOfflineImmediate = () => {
            if (!boxOfflineRef.current) {
                boxOfflineRef.current = true;
                setIsBoxOffline(true);
                boxOfflineTransitionStartRef.current = 0;
            }
        };

        /** Debounced offline state transition — used for stale data */
        const updateOfflineState = (desiredOffline: boolean, now: number) => {
            if (desiredOffline === boxOfflineRef.current) {
                boxOfflineTransitionStartRef.current = 0;
                return;
            }

            if (boxOfflineTransitionStartRef.current === 0) {
                boxOfflineTransitionStartRef.current = now;
                return;
            }

            if (now - boxOfflineTransitionStartRef.current >= OFFLINE_SWITCH_DEBOUNCE_MS) {
                boxOfflineRef.current = desiredOffline;
                setIsBoxOffline(desiredOffline);
                boxOfflineTransitionStartRef.current = 0;
            }
        };

        const unsubscribeLocation = subscribeToLocation(params.boxId, (location) => {
            const now = Date.now();
            boxFirstLoadReceivedRef.current = true;

            // EC-FIX: No location data at all → box has never reported GPS → immediate offline.
            // Previously this went through the 5s debounce, which blocked pickup for 5+ seconds
            // even when the box was clearly powered off.
            if (!location) {
                markOfflineImmediate();
                return;
            }

            const dataTimestamp = location.server_timestamp || location.timestamp || 0;
            const isStale = (now - dataTimestamp) > 120000; // 2 minutes

            setBoxLocationLastSeen(dataTimestamp);

            // EC-FIX: If data is extremely stale (> 5 min), also skip debounce.
            // This handles the case where box was online hours ago but is clearly down now.
            if ((now - dataTimestamp) > 300000) {
                markOfflineImmediate();
                return;
            }

            updateOfflineState(isStale, now);

            if (!isStale) {
                const position = {
                    lat: location.latitude,
                    lng: location.longitude,
                    accuracy: 15, // Assume acceptable accuracy for Box GPS
                };

                const nextState = updateGeofenceState(
                    boxGeofenceStateRef.current,
                    { lat: position.lat, lng: position.lng },
                    { latitude: geofence.centerLat, longitude: geofence.centerLng },
                    { hdop: 1.5, satellites: 8, timestamp: now },
                    null,
                    now
                );
                boxGeofenceStateRef.current = nextState;
                setIsBoxInside(nextState.stableState === 'INSIDE');
            }
        });

        // EC-FIX: If the Firebase listener fires with no data on mount (box node doesn't exist),
        // that callback already marks offline immediately. But if the subscription itself is slow
        // to fire, set a safety timeout to mark offline after 3s if no callback received.
        const safetyTimeout = setTimeout(() => {
            if (!boxFirstLoadReceivedRef.current) {
                markOfflineImmediate();
            }
        }, 3000);

        return () => {
            clearTimeout(safetyTimeout);
            unsubscribeLocation();
        };
    }, [geofence, params.boxId, boxLocationSubscriptionEpoch]);

    // Listener watchdog: if box stream goes stale while marked online, resubscribe.
    useEffect(() => {
        const interval = setInterval(() => {
            if (!boxLocationLastSeen || isBoxOffline) return;
            const ageMs = Date.now() - boxLocationLastSeen;
            if (ageMs > 45000) {
                setBoxLocationSubscriptionEpoch((prev) => prev + 1);
            }
        }, 12000);

        return () => clearInterval(interval);
    }, [boxLocationLastSeen, isBoxOffline]);

    // 3. The "Master Switch" (Dual Check Logic)
    // EC-FIX: Now includes phone-only fallback path
    useEffect(() => {
        if (masterSwitchDebounceRef.current) {
            clearTimeout(masterSwitchDebounceRef.current);
        }

        const debounceMs = geofenceTarget === 'dropoff' ? 250 : 500;
        masterSwitchDebounceRef.current = setTimeout(() => {
            const nextInside = isPhoneInside && (isBoxOffline || isBoxInside || isPhoneOnlyFallback);
            if (nextInside !== masterDecisionRef.current) {
                masterDecisionRef.current = nextInside;
                setIsInsideGeoFence(nextInside);
            }
        }, debounceMs);

        return () => {
            if (masterSwitchDebounceRef.current) {
                clearTimeout(masterSwitchDebounceRef.current);
                masterSwitchDebounceRef.current = null;
            }
        };
    }, [geofenceTarget, isPhoneInside, isBoxInside, isBoxOffline, isPhoneOnlyFallback]);

    // 3b. EC-FIX: Phone-Only Fallback Timer
    // If phone has been stably inside the geofence for 15 seconds but box status
    // is stuck (neither offline nor inside), activate phone-only fallback.
    // This safeguards against the debounce/hysteresis gap that blocks pickup indefinitely.
    useEffect(() => {
        const PHONE_ONLY_FALLBACK_MS = geofenceTarget === 'dropoff' ? 7000 : 15000;

        if (isPhoneInside && !isBoxOffline && !isBoxInside && !isPhoneOnlyFallback) {
            // Phone is inside but box status is stuck — start fallback countdown
            if (phoneInsideSinceRef.current === 0) {
                phoneInsideSinceRef.current = Date.now();
            }

            const timer = setTimeout(() => {
                // Double-check conditions still hold after timeout
                if (phoneInsideSinceRef.current > 0 && !boxOfflineRef.current) {
                    console.log(`[ArrivalScreen] EC-FIX: Phone-only fallback activated - box status stuck for ${PHONE_ONLY_FALLBACK_MS}ms`);
                    setIsPhoneOnlyFallback(true);
                }
            }, PHONE_ONLY_FALLBACK_MS);

            return () => clearTimeout(timer);
        }

        // Reset fallback timer if phone leaves geofence or box comes online
        if (!isPhoneInside) {
            phoneInsideSinceRef.current = 0;
            if (isPhoneOnlyFallback) setIsPhoneOnlyFallback(false);
        }
        if (isBoxOffline || isBoxInside) {
            phoneInsideSinceRef.current = 0;
            // Don't clear fallback here — it's no longer needed but clearing could cause flicker.
            // The master switch will use the correct path (isBoxOffline or isBoxInside) instead.
        }
    }, [geofenceTarget, isPhoneInside, isBoxOffline, isBoxInside, isPhoneOnlyFallback]);

    // 3c. Dropoff arrival sync
    // Push ARRIVED and refresh the box as soon as the dropoff geofence is confirmed.
    useEffect(() => {
        const shouldSyncDropoffArrival =
            geofenceTarget === 'dropoff' &&
            isInsideGeoFence &&
            !dropoffArrivalPersistedRef.current &&
            DROPOFF_ARRIVAL_RETRYABLE_STATUSES.has(deliveryStatus);

        if (!shouldSyncDropoffArrival) {
            if (geofenceTarget !== 'dropoff' || !isInsideGeoFence || dropoffArrivalPersistedRef.current) {
                dropoffArrivalSyncInFlightRef.current = false;
                clearDropoffArrivalRetry();
            }
            return;
        }

        if (dropoffArrivalSyncInFlightRef.current) return;
        dropoffArrivalSyncInFlightRef.current = true;
        clearDropoffArrivalRetry();

        const arrivedAtNow = Date.now();
        const hasPhoneFix = currentPosition.lat !== 0 || currentPosition.lng !== 0;

        const statusUpdate = updateDeliveryStatus(params.deliveryId, 'ARRIVED', {
            arrived_at: arrivedAtNow,
            arrival_source: 'rider_app_dropoff_geofence',
            boxId: params.boxId,
        }).then((ok) => {
            if (!ok) throw new Error('ARRIVED transition failed');
            return ok;
        });
        const syncTasks: Promise<unknown>[] = [
            statusUpdate,
            statusUpdate.then(() => requestBoxContextRefresh(params.boxId, 'dropoff_arrived')),
        ];

        if (hasPhoneFix) {
            syncTasks.push(writePhoneLocation(
                params.boxId,
                currentPosition.lat,
                currentPosition.lng,
                currentPosition.speed,
                currentPosition.heading,
                localPhoneHeading
            ));
        }

        Promise.allSettled(syncTasks).then((results) => {
            if (results[0]?.status === 'rejected') {
                console.warn('[ArrivalScreen] Dropoff ARRIVED sync failed', results[0].reason);
                dropoffArrivalSyncInFlightRef.current = false;
                scheduleDropoffArrivalRetry();
                setBoxLocationSubscriptionEpoch((prev) => prev + 1);
                return;
            }

            setDeliveryStatus('ARRIVED');
            setArrivedAt((prev) => prev ?? arrivedAtNow);

            if (!dropoffArrivalPersistedRef.current) {
                scheduleDropoffArrivalRetry(DROPOFF_ARRIVAL_CONFIRMATION_RETRY_MS);
            }

            if (results[1]?.status === 'rejected') {
                console.warn('[ArrivalScreen] Dropoff box context refresh failed', results[1].reason);
            }
            setBoxLocationSubscriptionEpoch((prev) => prev + 1);
        });
    }, [
        geofenceTarget,
        isInsideGeoFence,
        deliveryStatus,
        params.deliveryId,
        params.boxId,
        currentPosition.lat,
        currentPosition.lng,
        currentPosition.speed,
        currentPosition.heading,
        localPhoneHeading,
        clearDropoffArrivalRetry,
        scheduleDropoffArrivalRetry,
        dropoffArrivalRetryTick,
    ]);

    // 4. Pickup Arrival Notification — fires once when rider first enters pickup geofence
    useEffect(() => {
        if (
            geofenceTarget === 'pickup' &&
            isInsideGeoFence &&
            !pickupArrivalNotifSentRef.current &&
            params.customerPhone &&
            params.riderName
        ) {
            pickupArrivalNotifSentRef.current = true;
            sendPickupArrivalNotification(
                params.deliveryId,
                params.customerPhone,
                params.riderName
            ).catch(() => { /* non-blocking */ });
        }
        // Reset if rider leaves before confirming pickup (allows re-fire on re-entry)
        if (geofenceTarget === 'pickup' && !isInsideGeoFence) {
            pickupArrivalNotifSentRef.current = false;
        }
    }, [geofenceTarget, isInsideGeoFence, params.customerPhone, params.riderName, params.deliveryId]);

    // EC-04: Lockout countdown timer
    useEffect(() => {
        if (!lockoutState?.active) {
            setLockoutCountdown('');
            return;
        }

        const remaining = lockoutState.expires_at - timerNowMs;
        setLockoutCountdown(remaining <= 0 ? 'Expired' : formatRemainingMinutesSeconds(remaining));
    }, [lockoutState, timerNowMs]);

    // Timer update effect
    useEffect(() => {
        if (waitTimerState.status !== 'WAITING') return;

        setDisplayTime(getFormattedRemainingTime(waitTimerState, timerNowMs));

        if (isWaitTimerExpired(waitTimerState, timerNowMs)) {
            setWaitTimerState(prev => ({ ...prev, status: 'EXPIRED' }));
        }
    }, [waitTimerState, timerNowMs]);

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
        if (!isPickupConfirmed) {
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
        if (!isPickupConfirmed) {
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
            PremiumAlert.alert('Please Wait', 'You must wait the full 5 minutes before returning.');
            return;
        }

        PremiumAlert.alert(
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
                        navigation.navigate('RiderApp');
                    }
                }
            ]
        );
    };

    // EC-02: BLE OTP Transfer
    const handleBleTransfer = async () => {
        if (!deliveryOtp) {
            PremiumAlert.alert('OTP Unavailable', 'Could not retrieve the delivery OTP. Please try again.');
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
                currentStatus: params.status || 'ARRIVED',
            });

            if (result.success) {
                setShowCancelModal(false);
                navigation.navigate('CancellationConfirmation', {
                    deliveryId: params.deliveryId,
                    returnOtp: result.returnOtp,
                    reason: reason,
                    reasonDetails: details,
                    senderName: 'Customer', // Would come from delivery data
                    pickupAddress: params.pickupAddress || params.targetAddress,
                    pickupLat: params.pickupLat,
                    pickupLng: params.pickupLng,
                    isPickedUp: ['IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'RETURNING', 'TAMPERED'].includes(params.status || 'PENDING'),
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
            const type = getReassignmentType(reassignmentState, riderId || '');
            if (type) {
                setShowReassignmentModal(true);
                // Start auto-ack timer associated with this screen's context
                const cleanup = startAutoAckTimer(params.boxId || 'BOX_001', riderId || '', reassignmentState, () => {
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
            await acknowledgeReassignment(params.boxId || 'BOX_001', riderId || '');
            const type = getReassignmentType(reassignmentState, riderId || '');
            handlePostAcknowledge(type);
        }
    };

    const handlePostAcknowledge = (type: 'outgoing' | 'incoming' | null) => {
        setShowReassignmentModal(false);
        if (type === 'outgoing') {
            // Delivery reassigned AWAY from this rider
            PremiumAlert.alert(
                'Delivery Reassigned',
                'This delivery has been assigned to another rider. Returning to dashboard.',
                [{ text: 'OK', onPress: () => navigation.navigate('RiderApp') }]
            );
        }
    };

    // Render different UI based on wait timer state
    const renderWaitingUI = () => (
        <Card style={[styles.waitCard, isDarkMode && { backgroundColor: '#451a03', borderColor: '#b45309' }]}>
            <Card.Content>
                <View style={styles.timerContainer}>
                    <Text style={[styles.timerLabel, isDarkMode && { color: '#fbbf24' }]}>WAITING FOR CUSTOMER</Text>
                    <Text style={[styles.timerDisplay, isDarkMode && { color: '#f59e0b' }]}>{displayTime}</Text>
                    <Text style={[styles.timerSubtext, isDarkMode && { color: '#fcd34d' }]}>
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
        // Resolve target coords based on the current geofence phase
        let navLat: number | undefined;
        let navLng: number | undefined;
        let navAddress: string | undefined;

        if (geofenceTarget === 'dropoff') {
            navLat = params?.dropoffLat;
            navLng = params?.dropoffLng;
            navAddress = params?.dropoffAddress || params?.targetAddress;
        } else if (geofenceTarget === 'return_pickup') {
            navLat = params?.pickupLat;
            navLng = params?.pickupLng;
            navAddress = params?.pickupAddress || params?.targetAddress;
        } else {
            // pickup phase — use pickupLat/Lng if available, fall back to targetLat/Lng
            navLat = params?.pickupLat || params?.targetLat;
            navLng = params?.pickupLng || params?.targetLng;
            navAddress = params?.pickupAddress || params?.targetAddress;
        }

        const hasCoords = navLat && navLng && (navLat !== 0 || navLng !== 0);
        const label = navAddress || 'Destination';
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
                console.error('[ArrivalScreen handleNavigate] Failed to open maps:', error);
                try {
                    const browserUrl = hasCoords
                        ? `https://www.google.com/maps/dir/?api=1&destination=${navLat},${navLng}&travelmode=driving`
                        : `https://www.google.com/maps/search/?api=1&query=${encodedLabel}`;
                    await Linking.openURL(browserUrl);
                } catch (browserError) {
                    console.error('[ArrivalScreen handleNavigate] Browser fallback also failed:', browserError);
                }
            }
        };

        if (hasCoords) {
            const latLng = `${navLat},${navLng}`;
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

    const handleManualRefresh = useCallback(async () => {
        if (manualRefreshBusy) return;
        setManualRefreshBusy(true);

        try {
            phoneGeofenceStateRef.current = createInitialState();
            boxGeofenceStateRef.current = createInitialState();
            masterDecisionRef.current = false;
            phoneInsideSinceRef.current = 0;
            setIsPhoneOnlyFallback(false);

            if (!isBackgroundLocationRunning()) {
                startBackgroundLocation(params.boxId).catch((err) => {
                    console.warn('[ArrivalScreen] Background location restart failed', err);
                });
            }
            setTrackingPhase('ARRIVAL');
            startForegroundGpsWarmWindow(15000).catch(() => { });

            const phoneRefresh = (async () => {
                const permission = await Location.getForegroundPermissionsAsync();
                let hasPermission = permission.status === 'granted';

                if (!hasPermission) {
                    const requested = await Location.requestForegroundPermissionsAsync();
                    hasPermission = requested.status === 'granted';
                }

                if (!hasPermission) {
                    throw new Error('Phone location permission not granted');
                }

                const hasRecentCurrentPosition =
                    (currentPosition.lat !== 0 || currentPosition.lng !== 0) &&
                    Date.now() - phoneLocationLastSeen <= MANUAL_REFRESH_CACHED_PHONE_MAX_AGE_MS;

                if (hasRecentCurrentPosition) {
                    applyPhonePosition({
                        latitude: currentPosition.lat,
                        longitude: currentPosition.lng,
                        accuracy: currentPosition.accuracy,
                        heading: currentPosition.heading,
                        speed: currentPosition.speed,
                    }, 25);
                }

                let loc: Location.LocationObject;
                try {
                    loc = await Promise.race([
                        Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.High,
                        }),
                        new Promise<never>((_, reject) => {
                            setTimeout(() => reject(new Error('Phone GPS refresh timed out')), MANUAL_REFRESH_PHONE_TIMEOUT_MS);
                        }),
                    ]) as Location.LocationObject;
                } catch (error) {
                    const lastKnown = await Location.getLastKnownPositionAsync({
                        maxAge: MANUAL_REFRESH_CACHED_PHONE_MAX_AGE_MS,
                        requiredAccuracy: MANUAL_REFRESH_LAST_KNOWN_ACCURACY_M,
                    });

                    if (!lastKnown) {
                        throw error;
                    }

                    loc = lastKnown;
                }

                applyPhonePosition(loc.coords, 25);
                await writePhoneLocation(
                    params.boxId,
                    loc.coords.latitude,
                    loc.coords.longitude,
                    loc.coords.speed ?? 0,
                    loc.coords.heading ?? 0,
                    localPhoneHeading
                );
            })();

            const [boxResult, phoneResult] = await Promise.allSettled([
                requestBoxContextRefresh(params.boxId, 'arrival_refresh'),
                phoneRefresh,
            ]);

            setBoxLocationSubscriptionEpoch((prev) => prev + 1);

            if (boxResult.status === 'rejected') {
                console.warn('[ArrivalScreen] Manual refresh box GPS request failed', boxResult.reason);
            }

            if (phoneResult.status === 'rejected') {
                console.warn('[ArrivalScreen] Manual refresh phone GPS failed', phoneResult.reason);
            }

            if (geofenceTarget === 'dropoff' && isInsideGeoFence && !dropoffArrivalPersistedRef.current) {
                dropoffArrivalSyncInFlightRef.current = false;
                clearDropoffArrivalRetry();
                setDropoffArrivalRetryTick((prev) => prev + 1);
            }
        } finally {
            setManualRefreshBusy(false);
        }
    }, [
        manualRefreshBusy,
        params.boxId,
        applyPhonePosition,
        currentPosition,
        phoneLocationLastSeen,
        localPhoneHeading,
        geofenceTarget,
        isInsideGeoFence,
        clearDropoffArrivalRetry,
    ]);

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
        if (hasBatteryLow) {
            const isCritical = hasBatteryCritical;
            statuses.push(
                <Card key="battery" style={[styles.statusPill, isCritical ? styles.statusPillError : styles.statusPillWarning]}>
                    <View style={styles.pillContent}>
                        <Text style={styles.pillIcon}>{isCritical ? '🔴' : '🟡'}</Text>
                        <View>
                            <Text style={[styles.pillTitle, isCritical ? styles.textError : styles.textWarning]}>
                                {isCritical ? 'CRITICAL' : 'LOW POWER'}
                            </Text>
                            <Text style={[styles.pillText, isCritical ? styles.textError : styles.textWarning]}>
                                {batteryAlertSummary || '--'}
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

    const screenAnim = useEntryAnimation(0);

    // ──── GPS Acquisition Loading Gate ────
    if (!gpsAcquired) {
        const hasPhoneGps = currentPosition.lat !== 0 || currentPosition.lng !== 0;
        const hasBoxData = boxFirstLoadReceivedRef.current;
        return (
            <View style={[styles.container, { backgroundColor: c.background, justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={{ alignItems: 'center', marginBottom: 32 }}>
                    <ActivityIndicator size="large" color={isDarkMode ? '#60a5fa' : '#2563eb'} style={{ marginBottom: 20 }} />
                    <Text variant="headlineSmall" style={{ color: c.text, fontFamily: 'Inter_700Bold', marginBottom: 8 }}>
                        Acquiring GPS Signal
                    </Text>
                    <Text variant="bodyMedium" style={{ color: isDarkMode ? '#a1a1aa' : '#6b7280', textAlign: 'center' }}>
                        Locking onto your position for accurate geofence detection...
                    </Text>
                </View>

                <View style={[styles.gpsGateCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <View style={styles.gpsGateRow}>
                        <Text style={{ fontSize: 18 }}>{hasPhoneGps ? '✅' : '📡'}</Text>
                        <Text variant="bodyMedium" style={{ color: c.text, flex: 1, marginLeft: 12 }}>
                            Phone GPS
                        </Text>
                        <Text variant="bodySmall" style={{ color: hasPhoneGps ? '#22c55e' : (isDarkMode ? '#a1a1aa' : '#9ca3af') }}>
                            {hasPhoneGps ? 'Locked' : 'Acquiring...'}
                        </Text>
                    </View>

                    <View style={[styles.gpsGateDivider, { backgroundColor: c.border }]} />

                    <View style={styles.gpsGateRow}>
                        <Text style={{ fontSize: 18 }}>{hasBoxData ? '✅' : (isBoxOffline ? '⚠️' : '📦')}</Text>
                        <Text variant="bodyMedium" style={{ color: c.text, flex: 1, marginLeft: 12 }}>
                            Smart Box
                        </Text>
                        <Text variant="bodySmall" style={{ color: hasBoxData ? '#22c55e' : (isBoxOffline ? '#f59e0b' : (isDarkMode ? '#a1a1aa' : '#9ca3af')) }}>
                            {hasBoxData ? 'Connected' : (isBoxOffline ? 'Offline' : 'Connecting...')}
                        </Text>
                    </View>
                </View>
            </View>
        );
    }

    return (
        <ScrollView style={[styles.container, { backgroundColor: c.background }]} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>
            <Animated.View style={screenAnim.style}>
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

                <Text variant="headlineMedium" style={[styles.pageTitle, { color: c.text }]}>
                    Arrival & Verification
                </Text>

                <View style={styles.refreshRow}>
                    <Button
                        mode="contained"
                        icon="refresh"
                        onPress={handleManualRefresh}
                        loading={manualRefreshBusy}
                        disabled={manualRefreshBusy}
                        buttonColor={isDarkMode ? '#0f172a' : '#111827'}
                        textColor="#f8fafc"
                        style={styles.refreshButton}
                    >
                        Refresh Status
                    </Button>
                </View>

                {/* Status Modals & Top Alerts */}
                {lockoutState?.active && (
                    <View style={[styles.statusMessageContainer, styles.bgSubtleError, { marginTop: 16 }]}>
                        <Text style={[styles.statusMessageText, styles.textError]}>
                            🔒 Smart Box is locked out. Wait {Math.max(0, Math.ceil((lockoutState.expires_at - timerNowMs) / 60000))} minutes.
                        </Text>
                    </View>
                )}
                {hasBatteryCritical && (
                    <View style={[styles.statusMessageContainer, styles.bgSubtleError, { marginTop: 16 }]}>
                        <Text style={[styles.statusMessageText, styles.textError]}>
                            ⚠️ Smart Box Battery Critical ({batteryAlertSummary || '--'})
                        </Text>
                    </View>
                )}
                {tamperState?.detected && (
                    <View style={[styles.statusMessageContainer, styles.bgSubtleError, { marginTop: 16 }]}>
                        <Text style={[styles.statusMessageText, styles.textError]}>
                            🚨 TAMPER DETECTED! Box is in lockdown. Contact support.
                        </Text>
                    </View>
                )}

                {/* Grace Period Countdown Card */}
                {isDropoffPhase && deliveryStatus === 'ARRIVED' && arrivedAt && (
                    <Card style={[
                        styles.gracePeriodCard,
                        { backgroundColor: c.card, borderColor: c.border },
                        gracePeriodExpired ? styles.gracePeriodExpired : styles.gracePeriodActive
                    ]}>
                        <Card.Content>
                            <View style={styles.gracePeriodHeader}>
                                <Text style={styles.gracePeriodIcon}>
                                    {gracePeriodExpired ? '⏰' : '⏳'}
                                </Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.gracePeriodTitle, { color: c.text }]}>
                                        {gracePeriodExpired ? 'Grace Period Expired' : 'Grace Period Active'}
                                    </Text>
                                    <Text style={[styles.gracePeriodSubtext, { color: isDarkMode ? '#a1a1aa' : '#6b7280' }]}>
                                        {gracePeriodExpired
                                            ? 'Customer did not appear. You may mark as No-Show.'
                                            : 'Waiting for customer to arrive at location...'}
                                    </Text>
                                </View>
                                <View style={[styles.gracePeriodTimerBox, { backgroundColor: c.card, borderColor: c.border }]}>
                                    <Text style={[
                                        styles.gracePeriodTimer,
                                        gracePeriodExpired && { color: '#dc2626' }
                                    ]}>
                                        {gracePeriodDisplay}
                                    </Text>
                                    <Text style={styles.gracePeriodTimerLabel}>
                                        {gracePeriodExpired ? 'EXPIRED' : 'remaining'}
                                    </Text>
                                </View>
                            </View>

                            {gracePeriodExpired && (
                                <Button
                                    mode="contained"
                                    onPress={handleMarkNoShow}
                                    loading={noShowLoading}
                                    disabled={noShowLoading}
                                    buttonColor="#dc2626"
                                    textColor="white"
                                    style={{ marginTop: 12, borderRadius: 8 }}
                                    icon="account-cancel"
                                >
                                    Mark as Customer No-Show
                                </Button>
                            )}
                        </Card.Content>
                    </Card>
                )}

                {isDropoffPhase && deliveryStatus === 'ARRIVED' && hasBatteryCritical && (
                    <Card style={[styles.batteryIncidentCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Card.Content>
                            <View style={styles.batteryIncidentHeader}>
                                <Text style={styles.batteryIncidentIcon}>🔋</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.batteryIncidentTitle, { color: c.text }]}>Battery Handoff Incident</Text>
                                    <Text style={[styles.batteryIncidentSubtext, { color: isDarkMode ? '#a1a1aa' : '#6b7280' }]}>
                                        Report once if handoff is blocked by power loss. Auto-cancel SLA is 15 minutes.
                                    </Text>
                                </View>
                                <View style={[styles.batteryIncidentTimerBox, { backgroundColor: c.card, borderColor: c.border }]}>
                                    <Text style={styles.batteryIncidentTimer}>{batteryIncidentReportedAt ? batteryTimeoutDisplay : '15:00'}</Text>
                                    <Text style={styles.batteryIncidentTimerLabel}>{batteryIncidentReportedAt ? 'remaining' : 'window'}</Text>
                                </View>
                            </View>

                            <Button
                                mode={batteryIncidentReportedAt ? 'outlined' : 'contained'}
                                onPress={handleReportBatteryIncident}
                                loading={reportingBatteryIncident}
                                disabled={reportingBatteryIncident}
                                buttonColor={batteryIncidentReportedAt ? undefined : '#dc2626'}
                                textColor={batteryIncidentReportedAt ? undefined : 'white'}
                                style={{ marginTop: 12, borderRadius: 8 }}
                                icon={batteryIncidentReportedAt ? 'check-circle' : 'alert-circle'}
                            >
                                {batteryIncidentReportedAt ? 'Incident Reported (Tap to Re-send)' : 'Report Battery Incident'}
                            </Button>
                        </Card.Content>
                    </Card>
                )}

                {(waitTimerState.status === 'WAITING' || waitTimerState.status === 'EXPIRED') ? (
                    renderWaitingUI()
                ) : (
                    isPickupConfirmed ? (
                        isReturning ? (
                            // ── EC-32: Return Journey Card ──────────────────────────────────────────
                            <Card style={{ margin: 16, borderRadius: 0, borderWidth: 3, borderColor: '#000', backgroundColor: '#fff', overflow: 'hidden' }} elevation={0}>
                                {/* Map Preview */}
                                <View style={{ height: 160, width: '100%', backgroundColor: '#000', position: 'relative' }}>
                                    {isMapboxNativeAvailable() && currentPosition.lat !== 0 && params.pickupLng && params.pickupLat ? (
                                        <MapboxGL.MapView
                                            style={{ flex: 1 }}
                                            logoEnabled={false}
                                            compassEnabled={false}
                                            scaleBarEnabled={false}
                                            attributionEnabled={false}
                                            scrollEnabled={false}
                                            pitchEnabled={false}
                                            rotateEnabled={false}
                                            zoomEnabled={false}
                                            styleURL={isDarkMode ? StyleURL.Dark : StyleURL.Street}
                                        >
                                            <MapboxGL.Camera
                                                zoomLevel={16}
                                                centerCoordinate={[params.pickupLng, params.pickupLat]}
                                                animationMode="flyTo"
                                            />

                                            {/* 1. The Geofence Zone Circle */}
                                            <MapboxGL.ShapeSource id="return-geofence" shape={buildGeofenceCircleGeoJSON(params.pickupLng, params.pickupLat, 50)}>
                                                <MapboxGL.FillLayer
                                                    id="return-geofence-fill"
                                                    style={{
                                                        fillColor: isInsideGeoFence ? '#4CAF50' : '#2196F3',
                                                        fillOpacity: 0.2,
                                                    }}
                                                />
                                                <MapboxGL.LineLayer
                                                    id="return-geofence-line"
                                                    style={{
                                                        lineColor: isInsideGeoFence ? '#4CAF50' : '#2196F3',
                                                        lineWidth: 2,
                                                    }}
                                                />
                                            </MapboxGL.ShapeSource>

                                            {/* 2. The Return Target Point Marker */}
                                            <MapboxGL.PointAnnotation id="return-target" coordinate={[params.pickupLng, params.pickupLat]}>
                                                <View style={{
                                                    width: 28, height: 28, borderRadius: 14,
                                                    alignItems: 'center', justifyContent: 'center',
                                                    borderWidth: 2, borderColor: 'white',
                                                    backgroundColor: isInsideGeoFence ? '#4CAF50' : '#2196F3',
                                                    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4
                                                }}>
                                                    <Text style={{ color: 'white', fontSize: 16 }}>↩️</Text>
                                                </View>
                                            </MapboxGL.PointAnnotation>

                                            {/* 3. Rider Current Position */}
                                            {currentPosition.lat != null && currentPosition.lng != null && (
                                                <AnimatedRiderMarker
                                                    latitude={currentPosition.lat}
                                                    longitude={currentPosition.lng}
                                                    rotation={headingSmoother.smooth(currentPosition.heading, currentPosition.speed, localPhoneHeading)}
                                                    speed={currentPosition.speed}
                                                />
                                            )}
                                        </MapboxGL.MapView>
                                    ) : (
                                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: isDarkMode ? '#27272a' : '#f4f4f5' }}>
                                            {currentPosition.lat === 0 ? (
                                                <>
                                                    <ActivityIndicator size="small" color="#4CAF50" />
                                                    <Text style={{ marginTop: 8, color: isDarkMode ? '#a1a1aa' : '#71717a' }}>Acquiring GPS...</Text>
                                                </>
                                            ) : (
                                                <Text style={{ fontSize: 32 }}>📍</Text>
                                            )}
                                        </View>
                                    )}

                                    {distanceMeters !== null && (
                                        <View style={{
                                            position: 'absolute', top: 12, right: 12,
                                            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16,
                                            alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                                            backgroundColor: c.card, borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7',
                                            shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3
                                        }}>
                                            <Text variant="labelMedium" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>
                                                {distanceMeters < 1000 ? `${Math.round(distanceMeters)}m` : `${(distanceMeters / 1000).toFixed(1)}km`}
                                            </Text>
                                            <Text variant="labelSmall" style={{ color: isDarkMode ? '#a1a1aa' : '#71717a' }}>away</Text>
                                        </View>
                                    )}
                                </View>

                                {/* Destination Info & Buttons below map */}
                                <Card.Content style={{ paddingTop: 16 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                                        <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', flex: 1, color: c.text }}>Return Journey</Text>
                                        <View style={{ backgroundColor: '#2196F3', width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}>
                                            <Text style={{ color: 'white', fontSize: 16 }}>↩️</Text>
                                        </View>
                                    </View>
                                    <Text variant="bodySmall" style={{ color: isDarkMode ? '#a1a1aa' : '#666', marginBottom: 4 }}>Return destination</Text>
                                    <Text variant="bodyMedium" style={{ fontFamily: 'Inter_600SemiBold', marginBottom: 16, color: c.text }}>
                                        {params.pickupAddress || params.targetAddress}
                                    </Text>

                                    <Button
                                        mode="outlined"
                                        icon="navigation"
                                        onPress={handleNavigate}
                                        style={{ marginBottom: 12, borderRadius: 8 }}
                                    >
                                        Navigate to Pickup
                                    </Button>
                                    <Button
                                        mode="contained"
                                        icon="package-variant-closed"
                                        onPress={() => {
                                            if (returnCancellationState?.returnOtp) {
                                                navigation.navigate('ReturnPackage', {
                                                    deliveryId: params.deliveryId,
                                                    returnOtp: returnCancellationState.returnOtp,
                                                    pickupAddress: params.pickupAddress || params.targetAddress,
                                                    senderName: params.senderName || 'Sender',
                                                    pickupLat: params.pickupLat,
                                                    pickupLng: params.pickupLng,
                                                    boxId: params.boxId,
                                                });
                                            } else {
                                                navigation.navigate('CancellationConfirmation', {
                                                    deliveryId: params.deliveryId,
                                                    returnOtp: '------',
                                                    reason: CancellationReason.OTHER,
                                                    senderName: params.senderName || 'Sender',
                                                    pickupAddress: params.pickupAddress || params.targetAddress,
                                                    pickupLat: params.pickupLat,
                                                    pickupLng: params.pickupLng,
                                                    isPickedUp: ['IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'RETURNING', 'TAMPERED'].includes(params.status || 'PENDING'),
                                                });
                                            }
                                        }}
                                        style={{ borderRadius: 8 }}
                                    >
                                        Continue Return Process
                                    </Button>
                                </Card.Content>
                            </Card>
                        ) : (
                            <DropoffVerification
                                deliveryId={params.deliveryId}
                                boxId={params.boxId}
                                targetAddress={params.dropoffAddress || params.targetAddress}
                                targetLat={params.dropoffLat || params.targetLat}
                                targetLng={params.dropoffLng || params.targetLng}
                                recipientName={params.recipientName}
                                customerPhone={params.customerPhone}
                                deliveryNotes={params.deliveryNotes}
                                deliveryStatus={deliveryStatus}
                                isInsideGeoFence={isInsideGeoFence}
                                distanceMeters={distanceMeters}
                                isPhoneInside={isPhoneInside}
                                isBoxInside={isBoxInside}
                                isBoxOffline={isBoxOffline}
                                lastBoxHeartbeatAt={boxLocationLastSeen}
                                lastPhoneGpsAt={phoneLocationLastSeen}
                                currentLat={currentPosition.lat}
                                currentLng={currentPosition.lng}
                                currentHeading={headingSmoother.smooth(currentPosition.heading, currentPosition.speed, localPhoneHeading)}
                                geofenceRadiusM={geofence.radiusMeters}
                                onDeliveryCompleted={() => navigation.goBack()}

                                onNavigate={handleNavigate}
                                onShowBleModal={handleBleTransfer}
                                onShowCancelModal={() => setShowCancelModal(true)}
                                onShowCustomerNotHome={handleCustomerNotHome}
                                isWaitTimerActive={false}
                                canAutoArrive={geofenceTarget !== 'pickup'}
                            />
                        )
                    ) : (
                        <PickupVerification
                            deliveryId={params.deliveryId}
                            boxId={params.boxId}
                            targetAddress={params.pickupAddress || params.targetAddress}
                            targetLat={params.pickupLat || params.targetLat}
                            targetLng={params.pickupLng || params.targetLng}
                            senderName={params.senderName}
                            senderPhone={params.senderPhone}
                            deliveryNotes={params.deliveryNotes}
                            isInsideGeoFence={isInsideGeoFence}
                            distanceMeters={distanceMeters}
                            isPhoneInside={isPhoneInside}
                            isBoxInside={isBoxInside}
                            isBoxOffline={isBoxOffline}
                            isPhoneOnlyFallback={isPhoneOnlyFallback}
                            currentLat={currentPosition.lat}
                            currentLng={currentPosition.lng}
                            currentHeading={headingSmoother.smooth(currentPosition.heading, currentPosition.speed, localPhoneHeading)}
                            geofenceRadiusM={geofence.radiusMeters}
                            onPickupConfirmed={() => {
                                if (!isSamePickupDropoff) {
                                    return;
                                }

                                const arrivedAtNow = Date.now();
                                updateDeliveryStatus(params.deliveryId, 'ARRIVED', {
                                    arrived_at: arrivedAtNow,
                                    arrival_source: 'same_pickup_dropoff_fast_path',
                                    boxId: params.boxId,
                                }).then((ok) => {
                                    if (!ok) return;
                                    setDeliveryStatus('ARRIVED');
                                    setArrivedAt((prev) => prev ?? arrivedAtNow);
                                    dropoffArrivalPersistedRef.current = true;
                                    requestBoxContextRefresh(params.boxId, 'same_pickup_dropoff_arrived').catch(() => { });

                                    if (currentPosition.lat !== 0 || currentPosition.lng !== 0) {
                                        writePhoneLocation(
                                            params.boxId,
                                            currentPosition.lat,
                                            currentPosition.lng,
                                            currentPosition.speed,
                                            currentPosition.heading,
                                            localPhoneHeading
                                        ).catch(() => { });
                                    }
                                });
                            }}

                            onNavigate={handleNavigate}
                        />
                    )
                )}


                {/* Modals ... */}
                {/* ... keeping existing modals ... */}
                <Portal>

                    <Modal
                        visible={showBleModal}
                        onDismiss={closeBleModal}
                        contentContainerStyle={[styles.modal, { backgroundColor: c.modalBg }]}
                    >
                        <Text variant="titleLarge" style={{ marginBottom: 16, fontFamily: 'Inter_700Bold', color: c.text }}>
                            BLE OTP Transfer
                        </Text>

                        <View style={styles.bleStatusContainer}>
                            {(bleStatus === 'scanning' || bleStatus === 'connecting' || bleStatus === 'transferring') && (
                                <Text style={styles.bleStatusIcon}>⏳</Text>
                            )}
                            {bleStatus === 'success' && <Text style={styles.bleStatusIcon}>✅</Text>}
                            {bleStatus === 'error' && <Text style={styles.bleStatusIcon}>❌</Text>}
                        </View>

                        <Text style={[styles.bleStatusText, { color: c.text }]}>
                            {bleStatus === 'scanning' ? 'Scanning...' :
                                bleStatus === 'connecting' ? 'Connecting...' :
                                    bleStatus === 'transferring' ? 'Transferring...' :
                                        bleStatus === 'success' ? 'Success!' :
                                            bleStatus === 'error' ? 'Failed' : 'Ready'}
                        </Text>
                        <Text style={[styles.bleMessageText, { color: c.modalText }]}>{bleMessage}</Text>

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
                    type={getReassignmentType(reassignmentState, riderId || '')}
                    onAcknowledge={handleReassignmentAcknowledge}
                />
            </Animated.View>
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
        fontFamily: 'Inter_700Bold',
        color: '#1a1a1a',
    },
    refreshRow: {
        alignItems: 'center',
        marginBottom: 16,
    },
    refreshButton: {
        borderRadius: 10,
        paddingHorizontal: 12,
        borderWidth: 2,
        borderColor: '#111827',
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
        fontFamily: 'Inter_700Bold',
        textTransform: 'uppercase',
    },
    pillText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
    },
    bgSuccess: { backgroundColor: '#22c55e' },
    bgError: { backgroundColor: '#ef4444' },
    bgWarning: { backgroundColor: '#F59E0B' },
    checkLabel: {
        fontSize: 12,
        color: '#555',
        fontFamily: 'Inter_600SemiBold',
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
        fontFamily: 'Inter_600SemiBold',
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
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
        fontFamily: 'Inter_700Bold',
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
    timerLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#b45309', letterSpacing: 1.5 },
    timerDisplay: { fontSize: 64, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: '#d97706' },
    timerSubtext: { fontSize: 14, color: '#78350f' },
    photoPreview: { backgroundColor: '#ecfccb', padding: 12, borderRadius: 8, marginBottom: 16 },
    photoLabel: { color: '#365314', textAlign: 'center', fontFamily: 'Inter_700Bold' },
    waitActions: { gap: 12 },

    // Retained for critical banner compatibility if needed
    bannerContent: { flexDirection: 'row', alignItems: 'center' },
    bannerIcon: { fontSize: 24, marginRight: 12 },
    tamperBanner: { backgroundColor: '#DC2626', marginBottom: 12, borderRadius: 12 },
    tamperTitle: { color: 'white', fontFamily: 'Inter_700Bold', fontSize: 14 },
    tamperText: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },

    // Grace Period Card
    gracePeriodCard: {
        marginBottom: 16,
        borderRadius: 0,
        borderWidth: 3,
        elevation: 0,
    },
    gracePeriodActive: {
        borderColor: '#000',
        backgroundColor: '#fff',
    },
    gracePeriodExpired: {
        borderColor: '#000',
        backgroundColor: '#000',
    },
    gracePeriodHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    gracePeriodIcon: {
        fontSize: 32,
    },
    gracePeriodTitle: {
        fontSize: 16,
        fontFamily: 'Inter_900Black',
        color: '#1a1a1a',
        marginBottom: 2,
        textTransform: 'uppercase',
    },
    gracePeriodSubtext: {
        fontSize: 12,
        color: '#6b7280',
        fontWeight: 'bold',
    },
    gracePeriodTimerBox: {
        alignItems: 'center',
        backgroundColor: 'black',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 0,
        borderWidth: 2,
        borderColor: '#000',
        minWidth: 80,
    },
    gracePeriodTimer: {
        fontSize: 22,
        fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
        color: '#fff',
        fontWeight: '900',
    },
    gracePeriodTimerLabel: {
        fontSize: 9,
        fontFamily: 'Inter_700Bold',
        color: '#9ca3af',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    batteryIncidentCard: {
        marginBottom: 16,
        borderRadius: 0,
        borderWidth: 3,
        borderColor: '#000',
        backgroundColor: '#fff',
        elevation: 0,
    },
    batteryIncidentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    batteryIncidentIcon: {
        fontSize: 32,
    },
    batteryIncidentTitle: {
        fontSize: 16,
        fontFamily: 'Inter_900Black',
        marginBottom: 2,
        textTransform: 'uppercase',
    },
    batteryIncidentSubtext: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#000',
    },
    batteryIncidentTimerBox: {
        alignItems: 'center',
        backgroundColor: '#000',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 0,
        borderWidth: 2,
        borderColor: '#000',
        minWidth: 80,
    },
    batteryIncidentTimer: {
        fontSize: 22,
        fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
        color: '#fff',
        fontWeight: '900',
    },
    batteryIncidentTimerLabel: {
        fontSize: 9,
        fontFamily: 'Inter_700Bold',
        color: '#9ca3af',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    // EC-FIX: GPS Acquisition Loading Gate styles
    gpsGateCard: {
        width: '100%',
        borderWidth: 2,
        padding: 16,
        elevation: 0,
        borderRadius: 0,
        backgroundColor: '#fff',
    },
    gpsGateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
    },
    gpsGateDivider: {
        height: 2,
        marginVertical: 2,
        backgroundColor: '#000',
    },
});
