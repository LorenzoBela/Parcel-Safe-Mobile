/**
 * EC-15: Background Location Service
 * 
 * Handles the scenario when Android/iOS kills the background app.
 * Features:
 * - Foreground service: Android notification keeps app alive
 * - Location background: iOS background location permission
 * - Failover: Box GPS continues independently
 *
 * Uses Expo TaskManager and Location APIs for cross-platform support.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import { Platform, AppState, AppStateStatus, Alert, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebaseDatabase, ref, set, serverTimestamp, onValue, off } from './firebaseClient';
import { update } from 'firebase/database';
import { offlineQueueService } from './offlineQueueService';
import { PremiumAlert } from '../services/PremiumAlertService';

// Native RTDB — preferred for lock-screen/background reliability on Android.
// Falls back to Firebase JS SDK when unavailable.
let nativeDatabase: any = null;
let nativeDatabaseFactory: any = null;
try {
    const nativeDbModule = require('@react-native-firebase/database');
    const factory = nativeDbModule?.default ?? nativeDbModule;
    if (typeof factory === 'function') {
        nativeDatabaseFactory = factory;
        nativeDatabase = factory();
    }
} catch (error) {
    if (__DEV__) console.log('[EC-15] Native RTDB not available, using Firebase JS SDK');
}

let Notifications: any = null;
try {
    Notifications = require('expo-notifications');
} catch (error) {
    if (__DEV__) console.log('[EC-15] expo-notifications not available during early runtime init');
}

let Battery: any = null;
try {
    Battery = require('expo-battery');
} catch (error) {
    if (__DEV__) console.log('[EC-15] expo-battery not available during early runtime init');
}

function normalizeFirebasePath(path: string): string {
    return path.replace(/^\/+/, '');
}

function getTimestampSentinel(): any {
    return nativeDatabaseFactory?.ServerValue?.TIMESTAMP ?? serverTimestamp();
}

async function writePathValue(path: string, value: any): Promise<void> {
    const normalizedPath = normalizeFirebasePath(path);

    const writePromise = (async () => {
        if (nativeDatabase) {
            await nativeDatabase.ref(normalizedPath).set(value);
            return;
        }

        const db = getFirebaseDatabase();
        await set(ref(db, normalizedPath), value);
    })();

    await Promise.race([
        writePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase write timeout')), 10000))
    ]);
}

async function writeMultiPathUpdates(updatesMap: Record<string, any>): Promise<void> {
    const writePromise = (async () => {
        // Flatten phone location objects so we don't overwrite compassHeading
        const flattenedUpdatesMap: Record<string, any> = {};
        for (const [path, value] of Object.entries(updatesMap)) {
            // Match locations/{boxId}/phone exactly (but also match if /phone happens to be at the end)
            // Allow optional leading slash since paths often don't have it
            if (path.match(/(?:^|\/)locations\/.+\/phone$/) && typeof value === 'object' && value !== null) {
                for (const [k, v] of Object.entries(value)) {
                    if (v !== undefined) {
                        flattenedUpdatesMap[`${path}/${k}`] = v;
                    }
                }
            } else {
                flattenedUpdatesMap[path] = value;
            }
        }

        if (nativeDatabase) {
            const normalizedUpdates: Record<string, any> = {};
            Object.entries(flattenedUpdatesMap).forEach(([path, value]) => {
                normalizedUpdates[normalizeFirebasePath(path)] = value;
            });
            await nativeDatabase.ref('/').update(normalizedUpdates);
            return;
        }

        const db = getFirebaseDatabase();
        await update(ref(db), flattenedUpdatesMap);
    })();

    await Promise.race([
        writePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase write timeout')), 10000))
    ]);
}

const BACKGROUND_STATUS_WARN_INTERVAL_MS = 60_000;
let lastBackgroundStatusWarnAt = 0;

function warnBackgroundStatusOncePerInterval(message: string, error?: unknown): void {
    const now = Date.now();
    if (now - lastBackgroundStatusWarnAt < BACKGROUND_STATUS_WARN_INTERVAL_MS) return;
    lastBackgroundStatusWarnAt = now;

    if (error !== undefined) {
        console.warn(message, error);
    } else {
        console.warn(message);
    }
}

async function writeBackgroundStatusBestEffort(boxId: string, status: Record<string, any>): Promise<void> {
    const boxesPath = `boxes/${boxId}/background_location_status`;

    try {
        await writePathValue(boxesPath, status);
    } catch (error) {
        const message = String((error as any)?.message ?? error ?? '');
        const isPermissionDenied = /permission-denied/i.test(message);

        if (isPermissionDenied) {
            warnBackgroundStatusOncePerInterval('[EC-15] /boxes background status denied; write skipped (no /hardware fallback)');
            return;
        }

        warnBackgroundStatusOncePerInterval('[EC-15] Background status write skipped (non-fatal):', error);
    }
}

// NetInfo — conditionally imported to prevent startup crashes
let NetInfo: any = null;
try {
    NetInfo = require('@react-native-community/netinfo').default;
} catch (error) {
    if (__DEV__) console.log('[EC-15] NetInfo not available for phone status');
}

// ==================== Phone Network Status ====================

export interface PhoneNetworkStatus {
    /** Connection type reported by the phone */
    connection: 'WiFi' | 'Cellular' | 'None';
    /** Cellular generation (null when on WiFi or unavailable) */
    cellular_generation: '2g' | '3g' | '4g' | '5g' | null;
    /** Whether the phone has an active internet connection */
    is_connected: boolean;
    /** Whether internet is reachable (DNS resolution works) */
    is_internet_reachable: boolean;
    /** GPS accuracy in meters from expo-location */
    gps_accuracy: number | null;
    /** GPS altitude in meters from expo-location */
    gps_altitude: number | null;
    /** Which phone source produced this update */
    source: 'phone_background' | 'phone_foreground';
    /** Timestamp of this status snapshot */
    timestamp: number;
    /** Cumulative data bytes sent from the mobile app */
    data_bytes?: number;
    /** Phone battery level as a percentage (0–100) */
    battery_level?: number;
    /** Whether the phone is currently charging */
    battery_charging?: boolean;
}

/** Rate-limit: minimum interval between phone status writes (ms) */
const PHONE_STATUS_WRITE_INTERVAL_MS = 30_000; // 30 seconds
let lastPhoneStatusWriteTime = 0;

/** Cumulative bytes sent from mobile app */
let cumulativeDataBytes = 0;
const MOBILE_DATA_BYTES_KEY = 'parcelSafe:mobileDataBytes';

/** Initialize data bytes from storage */
AsyncStorage.getItem(MOBILE_DATA_BYTES_KEY).then((val) => {
    if (val) cumulativeDataBytes = parseInt(val, 10) || 0;
}).catch(() => { });

/** Estimate the HTTP REST payload size (safe — never throws) */
function estimatePayloadSize(path: string, payload: any): number {
    try {
        return path.length + JSON.stringify(payload).length + 200; // 200 bytes for HTTP headers/overhead
    } catch {
        // serverTimestamp() sentinels or circular refs can break JSON.stringify
        return path.length + 300; // conservative fallback
    }
}

/**
 * Collect current phone network status from NetInfo + location data.
 * Returns null if NetInfo is unavailable.
 */
async function collectPhoneNetworkStatus(
    locationCoords: { accuracy: number | null; altitude: number | null },
    source: 'phone_background' | 'phone_foreground'
): Promise<PhoneNetworkStatus | null> {
    if (!NetInfo) return null;

    try {
        const netState = await NetInfo.fetch();

        let connection: PhoneNetworkStatus['connection'] = 'None';
        let cellularGeneration: PhoneNetworkStatus['cellular_generation'] = null;

        if (netState.type === 'wifi') {
            connection = 'WiFi';
        } else if (netState.type === 'cellular') {
            connection = 'Cellular';
            cellularGeneration = netState.details?.cellularGeneration ?? null;
        }

        // Collect phone battery info
        let batteryLevel: number | undefined;
        let batteryCharging: boolean | undefined;
        try {
            if (Battery) {
                const level = await Battery.getBatteryLevelAsync();
                const state = await Battery.getBatteryStateAsync();
                // level is 0–1 float, convert to percentage
                batteryLevel = level >= 0 ? Math.round(level * 100) : undefined;
                batteryCharging = state === Battery.BatteryState.CHARGING;
            }
        } catch (e) {
            if (__DEV__) console.warn('[EC-15] Failed to read battery:', e);
        }

        return {
            connection,
            cellular_generation: cellularGeneration,
            is_connected: netState.isConnected ?? false,
            is_internet_reachable: netState.isInternetReachable ?? false,
            gps_accuracy: locationCoords.accuracy,
            gps_altitude: locationCoords.altitude,
            source,
            timestamp: Date.now(),
            data_bytes: cumulativeDataBytes,
            battery_level: batteryLevel,
            battery_charging: batteryCharging,
        };
    } catch (e) {
        if (__DEV__) console.warn('[EC-15] Failed to collect phone network status:', e);
        return null;
    }
}

/**
 * Write phone network status to Firebase if rate-limit allows.
 * Writes to `/hardware/{boxId}/phone_status` so the admin dashboard
 * can display phone diagnostics alongside box hardware data.
 */
async function writePhoneStatusIfDue(
    boxId: string,
    status: PhoneNetworkStatus | null
): Promise<void> {
    if (!status) return;

    const now = Date.now();
    if (now - lastPhoneStatusWriteTime < PHONE_STATUS_WRITE_INTERVAL_MS) return;

    try {
        await writePathValue(`hardware/${boxId}/phone_status`, status);
        lastPhoneStatusWriteTime = now;

        if (__DEV__) console.log('[EC-15] Phone status written:', status.connection, status.cellular_generation);
    } catch (e) {
        console.error('[EC-15] Failed to write phone status:', e);
    }
}

// ==================== Configuration ====================

/** Tracking phase type — kept for API compatibility but no longer varies behavior */
export type TrackingPhase = 'IDLE' | 'TRANSIT' | 'ARRIVAL';

export const CONFIG = {
    /** Background location task name */
    TASK_NAME: 'background-location-task-v2',

    /** Location update interval (ms) — aggressive for max accuracy */
    LOCATION_INTERVAL_MS: 3000, // 3 seconds

    /** Minimum distance before update (meters) — set to 0 so updates fire on timeInterval alone, even when stationary */
    DISTANCE_FILTER_M: 0,

    /** Foreground service notification title */
    NOTIFICATION_TITLE: 'Parcel-Safe Active Delivery',

    /** Foreground service notification body */
    NOTIFICATION_BODY: 'Tracking your location for delivery',

    /** Maximum accuracy — best the device can offer */
    ACCURACY: Location.Accuracy.BestForNavigation,

    /** Deferred updates disabled — we want real-time */
    DEFERRED_UPDATES_DISTANCE_M: 0,

    /** Deferred updates disabled */
    DEFERRED_UPDATES_INTERVAL_MS: 0,

    /** Health check interval (ms) — kept tight so the watchdog reacts quickly */
    HEALTH_CHECK_INTERVAL_MS: 30000,

    /** Maximum time without location update before alert (ms) */
    LOCATION_STALE_THRESHOLD_MS: 120000, // 2 minutes

    /** GPS accuracy threshold — readings above this are rejected (meters) */
    ACCURACY_REJECT_THRESHOLD_M: 500,

    /** Speed below which rider is considered stationary (m/s) */
    STATIONARY_SPEED_THRESHOLD: 0.5,

    /** Time rider must be below speed threshold to activate drift filter (ms) */
    STATIONARY_MIN_DURATION_MS: 30000,

    /** Distance within which stationary jitter is suppressed (meters) */
    STATIONARY_DRIFT_RADIUS_M: 15,

    /** Even when stationary & drift-filtered, force a write at least this often (ms).
     *  Prevents Firebase from going completely stale while the rider is waiting. */
    STATIONARY_HEARTBEAT_INTERVAL_MS: 30000, // 30 seconds

    /** Time without a valid GPS fix before declaring signal lost and firing a recovery probe (ms) */
    SIGNAL_LOST_THRESHOLD_MS: 45000, // 45 seconds — fast enough to catch indoor→outdoor transitions

    /** Minimum interval between active re-triangulation attempts when there is no fix (ms) */
    NO_FIX_RETRY_INTERVAL_MS: 15000, // try a fresh fix every 15 s while signal is absent

    /** Background task zombie threshold: restart the task if no update received for this long (ms) */
    ZOMBIE_STALE_THRESHOLD_MS: 180000, // 3 minutes
};

const ANDROID_FGS_RETRY_BACKOFF_MS = 30000; // 30 s — short enough to recover quickly after the OS reinitialises SharedPreferences
const ANDROID_FGS_SHARED_PREFS_NPE_REGEX = /SharedPreferences\.getAll\(\).*null object reference/i;

// ==================== Types ====================

export type ServiceStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR' | 'PERMISSION_DENIED';

export interface BackgroundLocationState {
    status: ServiceStatus;
    lastLocationTimestamp: number | null;
    lastError: string | null;
    permissionStatus: 'GRANTED' | 'DENIED' | 'UNDETERMINED';
    foregroundServiceActive: boolean;
    boxGpsAvailable: boolean;
    totalUpdatesCount: number;
}

export interface LocationUpdate {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    speed: number | null;
    heading: number | null;
    timestamp: number;
    source: 'phone_background' | 'phone_foreground';
}

export type StateChangeCallback = (state: BackgroundLocationState) => void;

// ==================== Task Definition (Must be at module level) ====================

// Store current box ID for the background task
let currentBoxId: string | null = null;

function sanitizeBoxId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined' || lowered === 'unknown_box') return null;
    return trimmed;
}

// AsyncStorage key for persisting the active box ID across JS runtime restarts.
// When the phone is locked, Android may kill the JS runtime while keeping the native
// foreground service alive. When a new GPS event arrives, the native service restarts
// the JS runtime — but currentBoxId would be null, causing the callback to silently
// drop the update. Persisting it to AsyncStorage solves this.
const ACTIVE_BOX_ID_KEY = 'parcelSafe:activeBackgroundBoxId';

/** Persist the active box ID so background task callbacks work after JS restart. */
async function persistBoxId(boxId: string | null): Promise<void> {
    try {
        const sanitized = sanitizeBoxId(boxId);
        if (sanitized) {
            await AsyncStorage.setItem(ACTIVE_BOX_ID_KEY, sanitized);
        } else {
            await AsyncStorage.removeItem(ACTIVE_BOX_ID_KEY);
        }
    } catch (e) {
        console.error('[EC-15] Failed to persist boxId:', e);
    }
}

/** Restore the active box ID from storage (called when the task fires but currentBoxId is null). */
async function restoreBoxId(): Promise<string | null> {
    try {
        const restored = await AsyncStorage.getItem(ACTIVE_BOX_ID_KEY);
        const sanitized = sanitizeBoxId(restored);
        if (!sanitized && restored) {
            await AsyncStorage.removeItem(ACTIVE_BOX_ID_KEY);
        }
        return sanitized;
    } catch (e) {
        console.error('[EC-15] Failed to restore boxId:', e);
        return null;
    }
}

/** AsyncStorage key for persisting the last known good GPS fix so heartbeats survive JS runtime restarts. */
const LAST_KNOWN_LOCATION_KEY = 'parcelSafe:lastKnownLocation';

/**
 * Restore last known location from AsyncStorage into the in-memory variable.
 * Call this when the JS runtime restarts and lastWrittenLocation is null.
 */
async function restoreLastKnownLocation(): Promise<void> {
    if (lastWrittenLocation) return; // already in memory — nothing to do
    try {
        const stored = await AsyncStorage.getItem(LAST_KNOWN_LOCATION_KEY);
        if (stored) {
            lastWrittenLocation = JSON.parse(stored);
            if (__DEV__) console.log('[EC-15] Last known location restored from AsyncStorage');
        }
    } catch (e) {
        console.error('[EC-15] Failed to restore last known location:', e);
    }
}

/** Persist last known location to AsyncStorage (fire-and-forget). */
function persistLastKnownLocation(loc: { lat: number; lng: number; timestamp: number }): void {
    AsyncStorage.setItem(LAST_KNOWN_LOCATION_KEY, JSON.stringify(loc)).catch(() => { });
}

// ---- Feature 3: Accuracy Filter state ----
let accuracyRejectCount = 0;

// ---- Feature 4: Stationary Drift Prevention state ----
let lastWrittenLocation: { lat: number; lng: number; timestamp: number } | null = null;
let stationaryStartTime: number | null = null;

/**
 * Detect if the current update is GPS drift while stationary.
 * Returns true if the update should be suppressed.
 */
function isStationaryDrift(location: Location.LocationObject): boolean {
    const speed = location.coords.speed ?? 0;
    const now = Date.now();

    if (speed < CONFIG.STATIONARY_SPEED_THRESHOLD) {
        if (!stationaryStartTime) stationaryStartTime = now;

        const stationaryDuration = now - stationaryStartTime;
        if (stationaryDuration > CONFIG.STATIONARY_MIN_DURATION_MS && lastWrittenLocation) {
            // Haversine-lite: rough meter distance from last written point
            const dlat = location.coords.latitude - lastWrittenLocation.lat;
            const dlng = location.coords.longitude - lastWrittenLocation.lng;
            const cosLat = Math.cos(location.coords.latitude * Math.PI / 180);
            const dist = Math.sqrt(dlat * dlat + (dlng * cosLat) * (dlng * cosLat)) * 111320;
            if (dist < CONFIG.STATIONARY_DRIFT_RADIUS_M) {
                // Within drift radius — but don't suppress forever.
                // Allow a heartbeat write so Firebase stays fresh.
                const timeSinceLastWrite = now - lastWrittenLocation.timestamp;
                if (timeSinceLastWrite < CONFIG.STATIONARY_HEARTBEAT_INTERVAL_MS) {
                    return true; // Suppress — recent write exists, it's just jitter
                }
                // Heartbeat due — let this write through
                return false;
            }
        }
    } else {
        stationaryStartTime = null; // Moving again, reset
    }
    return false;
}

// ---- Feature 7: Signal Loss Recovery state ----
let lastValidFixTime = Date.now();
let lastBackgroundTaskUpdateTimestamp: number | null = null;
/** Tracks the last time we actively attempted a one-shot GPS fix during a no-fix interval */
let lastNoFixRetryAttemptTime = 0;

// Define the background task (expo-task-manager)
TaskManager.defineTask(CONFIG.TASK_NAME, async ({ data, error }) => {
    if (error) {
        console.error('[EC-15] Background task error:', error);
        return;
    }

    if (!data) {
        return;
    }

    // Restore currentBoxId from AsyncStorage if it was lost (JS runtime restarted
    // while phone was locked — the native foreground service kept running but the
    // in-memory variable was wiped)
    if (!sanitizeBoxId(currentBoxId)) {
        currentBoxId = await restoreBoxId();
        if (!currentBoxId) {
            console.warn('[EC-15] Task fired but no boxId in memory or AsyncStorage — dropping update');
            return; // No active delivery — nothing to write
        }
        console.log('[EC-15] boxId restored from AsyncStorage:', currentBoxId);
        // Also restore last known location so the no-fix heartbeat can work immediately
        await restoreLastKnownLocation();
    }

    const { locations } = data as { locations: Location.LocationObject[] };

    if (locations && locations.length > 0) {
        const location = locations[locations.length - 1]; // Get most recent

        // ---- Feature 3: Accuracy Filter ----
        const accuracy = location.coords.accuracy ?? 999;
        console.log(`[EC-15] Task fired | box=${currentBoxId} | acc=${accuracy.toFixed(0)}m | lat=${location.coords.latitude.toFixed(5)} lng=${location.coords.longitude.toFixed(5)}`);
        const isLowAccuracy = accuracy > CONFIG.ACCURACY_REJECT_THRESHOLD_M;
        if (isLowAccuracy) {
            accuracyRejectCount++;
            console.warn(`[EC-15] GPS LOW ACCURACY: ${accuracy.toFixed(0)}m > ${CONFIG.ACCURACY_REJECT_THRESHOLD_M}m (${accuracyRejectCount} total) — writing anyway to avoid stale tracking`);
        } else {
            accuracyRejectCount = 0; // Reset on good reading
        }

        // Feature 4 (Stationary Drift Prevention) — DISABLED.
        // All GPS readings are written to Firebase in real-time,
        // regardless of whether the rider is moving or stationary.

        try {
            // CRITICAL: Write directly to Firebase, NOT through offlineQueueService.
            // offlineQueueService calls NetInfo.fetch() which returns isConnected=false
            // in Android Doze mode (screen off), even though the device actually has
            // network. This causes ALL background updates to be queued instead of sent,
            // and the queue only flushes when the app comes to foreground — which is
            // exactly the symptom: "location only updates when the app is open."
            const updates: Record<string, any> = {};
            const timestampSentinel = getTimestampSentinel();

            // Pre-increment data bytes for this exact write (~500 bytes payload)
            cumulativeDataBytes += 500;

            // Write current location
            updates[`/locations/${currentBoxId}/phone`] = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                accuracy: location.coords.accuracy ?? null,
                altitude: location.coords.altitude ?? null,
                speed: location.coords.speed ?? 0,
                heading: location.coords.heading ?? 0,
                timestamp: Date.now(),
                verified_at: timestampSentinel,
                source: 'phone_background',
                gps_degraded: isLowAccuracy,
            };

            // Track data bandwidth in real-time alongside location
            updates[`/hardware/${currentBoxId}/phone_status/data_bytes`] = cumulativeDataBytes;

            await writeMultiPathUpdates(updates);
            await writeBackgroundStatusBestEffort(currentBoxId, {
                lastUpdate: timestampSentinel,
                source: 'phone_background',
                accuracy: location.coords.accuracy,
                signal_lost: false,
                gps_degraded: isLowAccuracy,
            });
            console.log(`[EC-15] ✓ Firebase write OK | box=${currentBoxId} | lat=${location.coords.latitude.toFixed(5)} lng=${location.coords.longitude.toFixed(5)} | acc=${accuracy.toFixed(0)}m`);

            // Track last written location for drift prevention
            lastWrittenLocation = {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
                timestamp: Date.now(),
            };
            persistLastKnownLocation(lastWrittenLocation);

            // Record valid fix time for signal loss detection
            lastValidFixTime = Date.now();
            persistValidFixTime();
            lastBackgroundTaskUpdateTimestamp = Date.now();

            // Write phone network status (rate-limited)
            const phoneStatus = await collectPhoneNetworkStatus(
                { accuracy: location.coords.accuracy, altitude: location.coords.altitude },
                'phone_background'
            );

            // Stamp latest cumulative bytes before writing
            if (phoneStatus) {
                phoneStatus.data_bytes = cumulativeDataBytes;
            }

            await writePhoneStatusIfDue(currentBoxId, phoneStatus);

            // Persist data bytes to survive app restarts (every ~10 writes)
            if (Math.random() < 0.1) {
                AsyncStorage.setItem(MOBILE_DATA_BYTES_KEY, cumulativeDataBytes.toString()).catch(() => { });
            }
        } catch (e) {
            // Actual network failure — fall back to offline queue
            console.error('[EC-15] ✗ Firebase write FAILED (will queue):', e);
            try {
                await offlineQueueService.enqueueLocationUpdate(
                    currentBoxId,
                    location.coords.latitude,
                    location.coords.longitude,
                    location.coords.speed ?? 0,
                    location.coords.heading ?? 0
                );
                console.warn('[EC-15] Location queued for later — will send when app reopens');
            } catch (queueError) {
                console.error('[EC-15] Failed to queue background location:', queueError);
            }
        }
    } else {
        // GPS task fired but provided no locations — device can't get a fix
        // (indoors, tunnel, dense urban canyon, standstill with no satellites locked).
        // Restore last known position from storage if needed, then re-send it as a
        // heartbeat so Firebase never goes fully stale while the rider can't triangulate.
        await restoreLastKnownLocation();

        const msSinceLastWrite = lastWrittenLocation
            ? Date.now() - lastWrittenLocation.timestamp
            : Infinity;

        if (lastWrittenLocation && msSinceLastWrite >= CONFIG.STATIONARY_HEARTBEAT_INTERVAL_MS) {
            try {
                const updates: Record<string, any> = {};
                const timestampSentinel = getTimestampSentinel();
                cumulativeDataBytes += 200;

                updates[`/locations/${currentBoxId}/phone`] = {
                    latitude: lastWrittenLocation.lat,
                    longitude: lastWrittenLocation.lng,
                    accuracy: null,
                    altitude: null,
                    speed: 0,
                    heading: 0,
                    timestamp: Date.now(),
                    verified_at: timestampSentinel,
                    source: 'phone_background',
                    gps_degraded: true,
                    no_fix: true,
                };
                updates[`/hardware/${currentBoxId}/phone_status/data_bytes`] = cumulativeDataBytes;

                await writeMultiPathUpdates(updates);
                await writeBackgroundStatusBestEffort(currentBoxId, {
                    lastUpdate: timestampSentinel,
                    source: 'phone_background',
                    signal_lost: false,
                    gps_degraded: true,
                    no_fix: true,
                });

                lastWrittenLocation = { ...lastWrittenLocation, timestamp: Date.now() };
                persistLastKnownLocation(lastWrittenLocation);
                lastBackgroundTaskUpdateTimestamp = Date.now();
                console.log(`[EC-15] ↺ No-fix heartbeat | box=${currentBoxId} | last known: ${lastWrittenLocation.lat.toFixed(5)},${lastWrittenLocation.lng.toFixed(5)}`);
            } catch (e) {
                console.warn('[EC-15] No-fix heartbeat write failed (non-fatal):', e);
            }
        } else if (!lastWrittenLocation) {
            console.warn('[EC-15] Task fired with no locations and no last known position — cannot heartbeat yet');
        }

        // ── Active re-triangulation while there is no fix ───────────────────
        // Try a fast one-shot fix using cell/WiFi first (Accuracy.Low is near-instant
        // indoors), then fall back to Balanced. Both have a hard 8-second timeout so
        // they never stall the background task.
        // Rate-limited to NO_FIX_RETRY_INTERVAL_MS so we don't spam the GPS chip.
        const now = Date.now();
        const timeSinceRetry = now - lastNoFixRetryAttemptTime;
        if (timeSinceRetry >= CONFIG.NO_FIX_RETRY_INTERVAL_MS) {
            lastNoFixRetryAttemptTime = now;

            // Helper: attempt a one-shot fix with a hard 8-second timeout.
            // The timeout is applied INSIDE the helper so that a hung
            // getCurrentPositionAsync is rejected internally and never becomes
            // an orphaned promise that could write stale data after we've moved on.
            const attemptFix = async (accuracy: Location.LocationAccuracy): Promise<boolean> => {
                try {
                    const freshFix = await Promise.race([
                        Location.getCurrentPositionAsync({ accuracy }),
                        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
                    ]) as Location.LocationObject;
                    const freshAcc = freshFix.coords.accuracy ?? 999;
                    const isLowAccuracy = freshAcc > CONFIG.ACCURACY_REJECT_THRESHOLD_M;
                    const updates: Record<string, any> = {};
                    const ts = getTimestampSentinel();
                    cumulativeDataBytes += 500;
                    updates[`/locations/${currentBoxId}/phone`] = {
                        latitude: freshFix.coords.latitude,
                        longitude: freshFix.coords.longitude,
                        accuracy: freshFix.coords.accuracy ?? null,
                        altitude: freshFix.coords.altitude ?? null,
                        speed: freshFix.coords.speed ?? 0,
                        heading: freshFix.coords.heading ?? 0,
                        timestamp: Date.now(),
                        verified_at: ts,
                        source: 'phone_background',
                        gps_degraded: isLowAccuracy,
                        recovered: true,
                    };
                    updates[`/hardware/${currentBoxId}/phone_status/data_bytes`] = cumulativeDataBytes;
                    await writeMultiPathUpdates(updates);
                    await writeBackgroundStatusBestEffort(currentBoxId, {
                        lastUpdate: ts,
                        source: 'phone_background',
                        signal_lost: false,
                        gps_degraded: isLowAccuracy,
                        recovered: true,
                    });
                    lastWrittenLocation = { lat: freshFix.coords.latitude, lng: freshFix.coords.longitude, timestamp: Date.now() };
                    persistLastKnownLocation(lastWrittenLocation);
                    lastValidFixTime = Date.now();
                    persistValidFixTime();
                    lastBackgroundTaskUpdateTimestamp = Date.now();
                    console.log(`[EC-15] ✓ Re-triangulated! acc=${freshAcc.toFixed(0)}m accuracy=${accuracy} | ${freshFix.coords.latitude.toFixed(5)},${freshFix.coords.longitude.toFixed(5)}`);
                    return true;
                } catch {
                    return false;
                }
            };

            // Stage 1: cell/WiFi only — near-instant even indoors
            const fixedLow = await attemptFix(Location.Accuracy.Low);

            if (!fixedLow) {
                // Stage 2: balanced (GPS + cell + WiFi) — better outdoors
                const fixedBalanced = await attemptFix(Location.Accuracy.Balanced);
                if (!fixedBalanced) {
                    console.log(`[EC-15] ✗ Re-triangulation failed both stages — will retry in ${CONFIG.NO_FIX_RETRY_INTERVAL_MS / 1000}s`);
                }
            }
        }
    }
});

/** AsyncStorage key for persisting lastValidFixTime across JS runtime restarts */
const LAST_VALID_FIX_KEY = 'parcelSafe:lastValidFixTime';

/** Persist lastValidFixTime so the recovery watchdog starts immediately after a JS kill/restart */
function persistValidFixTime(): void {
    AsyncStorage.setItem(LAST_VALID_FIX_KEY, lastValidFixTime.toString()).catch(() => { });
}

/** Restore lastValidFixTime from AsyncStorage (called at service start) */
async function restoreValidFixTime(): Promise<void> {
    try {
        const stored = await AsyncStorage.getItem(LAST_VALID_FIX_KEY);
        if (stored) {
            const parsed = parseInt(stored, 10);
            if (!isNaN(parsed) && parsed > 0) {
                lastValidFixTime = parsed;
                if (__DEV__) console.log('[EC-15] lastValidFixTime restored:', new Date(parsed).toISOString());
            }
        }
    } catch (e) {
        console.error('[EC-15] Failed to restore lastValidFixTime:', e);
    }
}

// ==================== Background Location Manager Class ====================

class BackgroundLocationManager {
    private state: BackgroundLocationState = {
        status: 'STOPPED',
        lastLocationTimestamp: null,
        lastError: null,
        permissionStatus: 'UNDETERMINED',
        foregroundServiceActive: false,
        boxGpsAvailable: true,
        totalUpdatesCount: 0,
    };

    private listeners: Set<StateChangeCallback> = new Set();
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private signalRecoveryInterval: NodeJS.Timeout | null = null;
    private isSignalRecoveryInFlight = false;
    private appStateSubscription: any = null;
    private unsubscribeBoxGps: (() => void) | null = null;
    private foregroundWatchSubscription: Location.LocationSubscription | null = null;
    private foregroundHeartbeatInterval: NodeJS.Timeout | null = null;
    private isForegroundHeartbeatInFlight = false;
    private currentPhase: TrackingPhase = 'TRANSIT';
    private nativeStartBlockedUntil = 0;
    private nativeStartBlockReason: string | null = null;

    // ==================== Public API ====================

    /**
     * Request all necessary permissions
     */
    async requestPermissions(): Promise<boolean> {
        try {
            // Request foreground permission first
            const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();

            if (foregroundStatus !== 'granted') {
                this.updateState({
                    permissionStatus: 'DENIED',
                    lastError: 'Foreground location permission denied',
                });
                return false;
            }

            // Request background permission
            const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();

            if (backgroundStatus !== 'granted') {
                this.updateState({
                    permissionStatus: 'DENIED',
                    lastError: 'Background location permission denied',
                });
                return false;
            }

            // Android 13+ Notification Permission
            if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
                );
                if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                    PremiumAlert.alert(
                        'Notification Required',
                        'Parcel-Safe requires notification permissions to securely track your location in the background. Without it, tracking may fail.',
                        [{ text: 'OK' }]
                    );
                }
            }

            this.updateState({ permissionStatus: 'GRANTED' });
            return true;
        } catch (error) {
            this.updateState({
                permissionStatus: 'DENIED',
                lastError: `Permission request failed: ${error}`,
            });
            return false;
        }
    }

    /**
     * Check if permissions are granted
     */
    async checkPermissions(): Promise<boolean> {
        try {
            const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
            const { status: backgroundStatus } = await Location.getBackgroundPermissionsAsync();

            const granted = foregroundStatus === 'granted' && backgroundStatus === 'granted';
            this.updateState({
                permissionStatus: granted ? 'GRANTED' : 'DENIED',
            });

            return granted;
        } catch (error) {
            return false;
        }
    }

    /**
     * Feature: Defeat aggressive Chinese OEM task killers (Xiaomi, Huawei, Oppo)
     * Prompts the user to ignore battery optimizations if they haven't already.
     */
    private async requestBatteryOptimizationExemption(): Promise<void> {
        try {
            if (!Battery?.isBatteryOptimizationEnabledAsync) return;
            const isOptimized = await Battery.isBatteryOptimizationEnabledAsync();
            if (isOptimized) {
                // We use a Promise to pause execution until the user responds to the alert
                await new Promise<void>((resolve) => {
                    PremiumAlert.alert(
                        'Background Location Tracking',
                        'To ensure your location is tracked even when your phone is locked, please disable Battery Optimization for Parcel-Safe.',
                        [
                            {
                                text: 'Later',
                                style: 'cancel',
                                onPress: () => resolve(),
                            },
                            {
                                text: 'Open Settings',
                                onPress: async () => {
                                    try {
                                        await IntentLauncher.startActivityAsync(
                                            IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                            { data: `package:${Application.applicationId}` }
                                        );
                                    } catch (e) {
                                        console.warn('[EC-15] Failed to open battery settings:', e);
                                    }
                                    resolve();
                                },
                            },
                        ]
                    );
                });
            }
        } catch (error) {
            if (__DEV__) console.warn('[EC-15] Battery optimization check failed:', error);
        }
    }

    /**
     * Start background location tracking
     */
    async start(boxId: string): Promise<boolean> {
        const now = Date.now();
        const sanitizedBoxId = sanitizeBoxId(boxId);
        console.log(`[EC-15] start() called | boxId=${boxId} | status=${this.state.status} | currentBoxId=${currentBoxId}`);

        // ── GUARD 1: already running/starting for the SAME box ────────────────
        // Must come before the backoff check so that redundancy re-calls during
        // the backoff window are told "already running" and don't stack extra
        // foreground GPS watchers on top.
        if (sanitizedBoxId && currentBoxId === sanitizedBoxId &&
            (this.state.status === 'RUNNING' || this.state.status === 'STARTING')) {
            console.log('[EC-15] start() early-return: already RUNNING/STARTING with same boxId');
            return true;
        }

        // ── GUARD 2: backoff window (native Android BGS crashed recently) ─────
        if (Platform.OS === 'android' && this.nativeStartBlockedUntil > now) {
            const retryInMs = this.nativeStartBlockedUntil - now;
            const retryInSec = Math.ceil(retryInMs / 1000);
            const blockReason = this.nativeStartBlockReason ?? 'Native Android foreground-service crash backoff active';
            console.warn(`[EC-15] Start blocked for ${retryInSec}s after native crash. Skipping restart attempt.`);
            // Do NOT flip status to ERROR if we are already in foreground-only mode.
            if (this.state.status !== 'RUNNING') {
                this.updateState({
                    status: 'ERROR',
                    lastError: `${blockReason} (retry in ${retryInSec}s)`,
                });
            }
            return false;
        }

        if (!sanitizedBoxId) {
            console.warn('[EC-15] Refusing to start background tracking with invalid boxId:', boxId);
            this.updateState({
                status: 'ERROR',
                lastError: 'Invalid boxId for background tracking',
            });
            return false;
        }

        if (this.state.status === 'RUNNING' || this.state.status === 'STARTING') {
            // Different boxId — stop the current session first.
            console.log('[EC-15] start() different boxId — stopping existing service first');
            await this.stop();
        }

        this.updateState({ status: 'STARTING' });
        currentBoxId = sanitizedBoxId;
        await persistBoxId(sanitizedBoxId);
        await restoreValidFixTime();
        await restoreLastKnownLocation();

        // Check permissions
        console.log('[EC-15] Checking location permissions...');
        const hasPermissions = await this.checkPermissions();
        if (!hasPermissions) {
            console.warn('[EC-15] Permissions not granted, requesting...');
            const granted = await this.requestPermissions();
            if (!granted) {
                console.error('[EC-15] Location permissions DENIED — cannot start service');
                this.updateState({
                    status: 'PERMISSION_DENIED',
                    lastError: 'Location permissions not granted',
                });
                return false;
            }
        }
        console.log('[EC-15] Permissions OK');

        // NEW RULE: Defeat aggressive Chinese OEM task killers
        if (Platform.OS === 'android') {
            await this.requestBatteryOptimizationExemption();
        }

        try {
            // Check if task is already running
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);

            // ALWAYS ensure the notification channel exists with correct settings,
            // even if the task is already registered (channel settings may have been
            // reset by a system update or OEM battery manager).
            if (Platform.OS === 'android') {
                try {
                    if (Notifications?.setNotificationChannelAsync) {
                        const expoLocationChannelId = `${Application.applicationId}:${CONFIG.TASK_NAME}`;
                        await Notifications.setNotificationChannelAsync(expoLocationChannelId, {
                            name: 'Live Delivery Tracking',
                            importance: Notifications.AndroidImportance.MAX,
                            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
                            bypassDnd: true,
                            sound: null,
                            enableVibrate: false,
                        });
                    }
                } catch (e) {
                    // Non-fatal: the notification may still work with default channel settings
                    console.warn('[EC-15] Failed to set location notification channel:', e);
                }
            }

            // Aggressively attempt to tear down any corrupted native state
            // ALWAYS execute this, even if `isTaskRegistered` returns false.
            // The JS bridge can falsely report `false` while Native Android holds corrupted state.
            console.log('[EC-15] Aggressively clearing native tracking states before start...');
            try {
                // Ignore any internal "Task not found" exceptions.
                await Location.stopLocationUpdatesAsync(CONFIG.TASK_NAME).catch(() => {});
                await TaskManager.unregisterTaskAsync(CONFIG.TASK_NAME).catch(() => {});
                
                if (Platform.OS === 'android') {
                    // Critical wait for Native Android Foreground Service to fully self-destruct.
                    // A larger delay (1500ms) guarantees the system completely flushes
                    // SharedPreferences for the notification before restarting.
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            } catch (cleanupErr) {
                console.warn('[EC-15] Cleanup threw (ignoring):', cleanupErr);
            }

            // Start background location updates (Expo Task Manager)
            // Android 14 has a race condition where SharedPreferences may not be
            // initialised yet when startLocationUpdatesAsync is first called.
            // Retry up to 3 times with increasing delays to beat the race.
            const startOptions = {
                accuracy: CONFIG.ACCURACY,
                timeInterval: CONFIG.LOCATION_INTERVAL_MS,
                distanceInterval: CONFIG.DISTANCE_FILTER_M,
                deferredUpdatesInterval: CONFIG.DEFERRED_UPDATES_INTERVAL_MS,
                deferredUpdatesDistance: CONFIG.DEFERRED_UPDATES_DISTANCE_M,
                foregroundService: {
                    notificationTitle: CONFIG.NOTIFICATION_TITLE,
                    notificationBody: CONFIG.NOTIFICATION_BODY,
                    notificationColor: '#0066FF',
                },
                // iOS specific
                activityType: Location.ActivityType.AutomotiveNavigation,
                showsBackgroundLocationIndicator: true,
                pausesUpdatesAutomatically: false,
            };

            // Delay before first attempt on Android to let SharedPreferences initialise.
            if (Platform.OS === 'android') {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const MAX_NATIVE_ATTEMPTS = Platform.OS === 'android' ? 3 : 1;
            const RETRY_DELAYS_MS = [0, 1500, 3000]; // delay BEFORE attempt #2, #3
            let lastLocationError: any = null;

            for (let attempt = 1; attempt <= MAX_NATIVE_ATTEMPTS; attempt++) {
                if (attempt > 1) {
                    const delay = RETRY_DELAYS_MS[attempt - 1] ?? 2000;
                    console.warn(`[EC-15] Retrying startLocationUpdatesAsync (attempt ${attempt}/${MAX_NATIVE_ATTEMPTS}) in ${delay}ms…`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                try {
                    await Location.startLocationUpdatesAsync(CONFIG.TASK_NAME, startOptions);
                    lastLocationError = null;
                    console.log(`[EC-15] startLocationUpdatesAsync succeeded (attempt ${attempt}) for boxId:`, sanitizedBoxId);
                    this.nativeStartBlockedUntil = 0;
                    this.nativeStartBlockReason = null;
                    break; // success — exit retry loop
                } catch (err) {
                    lastLocationError = err;
                    const msg = String((err as any)?.message ?? err ?? '');
                    const isNpe = ANDROID_FGS_SHARED_PREFS_NPE_REGEX.test(msg);
                    console.warn(`[EC-15] startLocationUpdatesAsync attempt ${attempt}/${MAX_NATIVE_ATTEMPTS} failed${isNpe ? ' (SharedPreferences NPE)' : ''}:`, err);
                    // If it's not the NPE (i.e. a hard permission or policy error), don't retry
                    if (!isNpe) break;
                }
            }

            if (lastLocationError !== null) {
                const errorMessage = String((lastLocationError as any)?.message ?? lastLocationError ?? 'Unknown native start error');
                const isNpe = ANDROID_FGS_SHARED_PREFS_NPE_REGEX.test(errorMessage);

                // All attempts exhausted — enter foreground-only mode so Firebase
                // keeps receiving data while we wait for the OS to recover.
                if (isNpe) {
                    this.nativeStartBlockedUntil = Date.now() + ANDROID_FGS_RETRY_BACKOFF_MS;
                    this.nativeStartBlockReason = 'Android 14 FGS native crash (SharedPreferences NPE)';
                }

                console.error('[EC-15] All native BGS start attempts failed:', lastLocationError);
                console.warn(`[EC-15] Entering foreground-only mode. Will retry native BGS in ${Math.round(ANDROID_FGS_RETRY_BACKOFF_MS / 1000)}s.`);

                this.updateState({
                    status: 'RUNNING',
                    foregroundServiceActive: false,
                    lastError: isNpe
                        ? `${this.nativeStartBlockReason}. Foreground-only fallback active; retrying in ${Math.round(ANDROID_FGS_RETRY_BACKOFF_MS / 1000)}s.`
                        : `Native BGS blocked: ${lastLocationError}. Foreground-only fallback active.`,
                });

                // Start supporting machinery — the health-check will retry native BGS once
                // the backoff window expires.
                this.startHealthCheck();
                this.startSignalRecoveryWatchdog();
                this.subscribeToAppState();
                this.subscribeToBoxGpsStatus(sanitizedBoxId);
                if (AppState.currentState === 'active') {
                    await this.startForegroundWatcher();
                    this.startForegroundHeartbeat();
                }

                await this.logServiceEvent(sanitizedBoxId, 'SERVICE_STARTED_FOREGROUND_ONLY');
                return true; // Return true so Redundancy sees us as running and does NOT stack its own fallback
            }

            this.updateState({
                status: 'RUNNING',
                foregroundServiceActive: Platform.OS === 'android',
                lastError: null,
            });

            // Start monitoring
            this.startHealthCheck();
            this.startSignalRecoveryWatchdog();
            this.subscribeToAppState();
            this.subscribeToBoxGpsStatus(sanitizedBoxId);
            if (AppState.currentState === 'active') {
                await this.startForegroundWatcher();
                this.startForegroundHeartbeat();
            }

            // Log to Firebase
            await this.logServiceEvent(sanitizedBoxId, 'SERVICE_STARTED');

            return true;
        } catch (error) {
            this.updateState({
                status: 'ERROR',
                lastError: `Failed to start background location: ${error}`,
            });
            return false;
        }
    }

    /**
     * Stop background location tracking
     */
    async stop(): Promise<void> {
        const boxIdToStop = currentBoxId;

        // Clear synchronously to deeply prevent race conditions if start() is called immediately after
        currentBoxId = null;

        this.updateState({
            status: 'STOPPED',
            foregroundServiceActive: false,
        });

        try {
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);

            if (isTaskRegistered) {
                await Location.stopLocationUpdatesAsync(CONFIG.TASK_NAME);
                await TaskManager.unregisterTaskAsync(CONFIG.TASK_NAME).catch(() => {});
            }
        } catch (error) {
            console.error('[EC-15] Error stopping location updates:', error);
        }

        // Clean up
        this.stopHealthCheck();
        this.stopSignalRecoveryWatchdog();
        this.unsubscribeFromAppState();
        this.stopForegroundWatcher();
        this.stopForegroundHeartbeat();

        if (this.unsubscribeBoxGps) {
            this.unsubscribeBoxGps();
            this.unsubscribeBoxGps = null;
        }

        if (boxIdToStop) {
            await this.logServiceEvent(boxIdToStop, 'SERVICE_STOPPED');
        }

        await persistBoxId(null);
    }

    /**
     * Subscribe to state changes
     */
    subscribe(callback: StateChangeCallback): () => void {
        this.listeners.add(callback);
        callback(this.state);
        return () => this.listeners.delete(callback);
    }

    /**
     * Get current state
     */
    getState(): BackgroundLocationState {
        return { ...this.state };
    }

    /**
     * Check if service is running
     */
    isRunning(): boolean {
        return this.state.status === 'RUNNING';
    }

    // ==================== Phase API (no-op — max accuracy always) ====================

    /**
     * Set tracking phase. Currently a no-op — GPS always runs at
     * BestForNavigation / 3s / 5m for maximum accuracy regardless of phase.
     * Kept for API compatibility with callers.
     */
    async setPhase(phase: TrackingPhase): Promise<void> {
        this.currentPhase = phase;
        // No-op: GPS config is always max accuracy. No restart needed.
    }

    /** Get the current tracking phase */
    getPhase(): TrackingPhase {
        return this.currentPhase;
    }

    // ==================== Feature 5: Heartbeat Watchdog ====================

    /**
     * Check if the background task is still running and auto-recover if killed.
     * Call this from AppState 'active' handler when user reopens the app.
     */
    async checkAndRecover(boxId: string): Promise<void> {
        const sanitizedBoxId = sanitizeBoxId(boxId);
        if (!sanitizedBoxId) {
            console.warn('[EC-15] checkAndRecover skipped due to invalid boxId:', boxId);
            return;
        }

        try {
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);

            if (!isTaskRegistered) {
                console.warn('[EC-15] Background task was killed by OS! Restarting...');
                await this.start(sanitizedBoxId);
                return;
            }

            // Check if task is registered but not producing output (zombie state)
            const effectiveLastUpdate = lastBackgroundTaskUpdateTimestamp ?? this.state.lastLocationTimestamp;
            const timeSinceUpdate = effectiveLastUpdate ? Date.now() - effectiveLastUpdate : Number.MAX_SAFE_INTEGER;
            if (timeSinceUpdate > CONFIG.ZOMBIE_STALE_THRESHOLD_MS) {
                console.warn(`[EC-15] Background task stale (${Math.round(timeSinceUpdate / 1000)}s). Restarting...`);
                await this.stop();
                await this.start(sanitizedBoxId);
            }
        } catch (error) {
            console.error('[EC-15] checkAndRecover failed:', error);
        }
    }

    /**
     * Force location update (when app comes to foreground)
     */
    async forceUpdate(): Promise<void> {
        const sanitizedCurrentBoxId = sanitizeBoxId(currentBoxId);
        if (!sanitizedCurrentBoxId || this.state.status !== 'RUNNING') return;

        try {
            // Two-stage strategy: try fast cell/WiFi fix first (works indoors),
            // then attempt a higher-accuracy GPS fix. Both have hard timeouts
            // so this method never blocks longer than ~12 seconds total.
            const tryFix = async (
                accuracy: Location.LocationAccuracy,
                timeoutMs: number
            ): Promise<Location.LocationObject | null> => {
                try {
                    return await Promise.race([
                        Location.getCurrentPositionAsync({ accuracy }),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error('timeout')), timeoutMs)),
                    ]) as Location.LocationObject;
                } catch {
                    return null;
                }
            };

            // Stage 1: Fast fix (cell/WiFi) — 4s timeout, works indoors
            let location = await tryFix(Location.Accuracy.Balanced, 4000);

            // Stage 2: High accuracy (GPS) — 8s timeout, for outdoor upgrades
            if (!location) {
                location = await tryFix(Location.Accuracy.High, 8000);
            }

            if (!location) {
                // Both stages failed — silently back off; the foreground watcher
                // or signal recovery watchdog will catch up.
                return;
            }

            // Write directly to Firebase — NOT through offlineQueueService.
            // offlineQueueService breaks in Android Doze mode (same fix as background task).
            const updates: Record<string, any> = {};
            const timestampSentinel = getTimestampSentinel();
            const isLowAccuracy = (location.coords.accuracy ?? 999) > CONFIG.ACCURACY_REJECT_THRESHOLD_M;

            cumulativeDataBytes += 500;

            updates[`/locations/${sanitizedCurrentBoxId}/phone`] = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                accuracy: location.coords.accuracy ?? null,
                altitude: location.coords.altitude ?? null,
                speed: location.coords.speed ?? 0,
                heading: location.coords.heading ?? 0,
                timestamp: Date.now(),
                verified_at: timestampSentinel,
                source: 'phone_foreground',
                gps_degraded: isLowAccuracy,
            };
            updates[`/hardware/${sanitizedCurrentBoxId}/phone_status/data_bytes`] = cumulativeDataBytes;

            await writeMultiPathUpdates(updates);
            await writeBackgroundStatusBestEffort(sanitizedCurrentBoxId, {
                lastUpdate: timestampSentinel,
                source: 'phone_foreground',
                accuracy: location.coords.accuracy,
                signal_lost: false,
                gps_degraded: isLowAccuracy,
            });
            const now = Date.now();
            lastBackgroundTaskUpdateTimestamp = now;
            lastWrittenLocation = {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
                timestamp: now,
            };
            lastValidFixTime = now;
            persistLastKnownLocation(lastWrittenLocation);
            persistValidFixTime();

            this.updateState({
                lastLocationTimestamp: now,
                totalUpdatesCount: this.state.totalUpdatesCount + 1,
            });

            // Write phone network status on foreground updates (rate-limited)
            const phoneStatus = await collectPhoneNetworkStatus(
                { accuracy: location.coords.accuracy, altitude: location.coords.altitude },
                'phone_foreground'
            );
            await writePhoneStatusIfDue(sanitizedCurrentBoxId, phoneStatus);
        } catch (error) {
            // Non-fatal: the foreground watcher and signal recovery watchdog
            // provide redundant coverage. Only log once per minute.
            warnBackgroundStatusOncePerInterval('[EC-15] Force update attempt failed (non-fatal)', error);
        }
    }

    // ==================== Private Methods ====================

    private updateState(partial: Partial<BackgroundLocationState>): void {
        this.state = { ...this.state, ...partial };
        this.listeners.forEach(cb => cb(this.state));
    }

    private startHealthCheck(): void {
        this.healthCheckInterval = setInterval(async () => {
            const now = Date.now();
            const lastUpdate = lastBackgroundTaskUpdateTimestamp ?? this.state.lastLocationTimestamp;

            if (lastUpdate && (now - lastUpdate) > CONFIG.LOCATION_STALE_THRESHOLD_MS) {
                // Location is stale - check if box GPS is available as fallback
                if (!this.state.boxGpsAvailable) {
                    console.warn('[EC-15] Both phone and box GPS appear to be down');
                    const staleBoxId = sanitizeBoxId(currentBoxId);
                    if (staleBoxId) await this.logServiceEvent(staleBoxId, 'GPS_BOTH_DOWN');
                }
            }

            // ---- Feature 7: Signal Loss Detection ----
            const timeSinceValidFix = now - lastValidFixTime;
            const sanitizedCurrentBoxId = sanitizeBoxId(currentBoxId);
            if (timeSinceValidFix > CONFIG.SIGNAL_LOST_THRESHOLD_MS && sanitizedCurrentBoxId) {
                try {
                    await writePathValue(`boxes/${sanitizedCurrentBoxId}/background_location_status`, {
                        lastUpdate: getTimestampSentinel(),
                        source: 'phone_background',
                        signal_lost: true,
                        last_valid_fix: lastValidFixTime,
                        signal_lost_duration_ms: timeSinceValidFix,
                    });
                } catch (e) {
                    console.warn('[EC-15] Failed to write signal_lost status (non-fatal):', e);
                }

                // Attempt a one-shot fix — will succeed the moment the device
                // regains satellites (e.g. rider steps outside after being indoors).
                // Two-stage: cell/WiFi first (fast, works indoors), then GPS+cell.
                // Both stages have 8-second hard timeouts to prevent hanging the health-check.
                const tryRecoveryFix = async (accuracy: Location.LocationAccuracy): Promise<Location.LocationObject | null> => {
                    try {
                        return await Promise.race([
                            Location.getCurrentPositionAsync({ accuracy }),
                            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
                        ]) as Location.LocationObject;
                    } catch {
                        return null;
                    }
                };
                let recoveryFix = await tryRecoveryFix(Location.Accuracy.Low);
                if (!recoveryFix) recoveryFix = await tryRecoveryFix(Location.Accuracy.Balanced);
                if (recoveryFix) {
                    const acc = recoveryFix.coords.accuracy ?? 999;
                    const isLowAccuracy = acc > CONFIG.ACCURACY_REJECT_THRESHOLD_M;
                    const recoveryUpdates: Record<string, any> = {};
                    const ts = getTimestampSentinel();
                    cumulativeDataBytes += 500;
                    recoveryUpdates[`/locations/${sanitizedCurrentBoxId}/phone`] = {
                        latitude: recoveryFix.coords.latitude,
                        longitude: recoveryFix.coords.longitude,
                        accuracy: recoveryFix.coords.accuracy ?? null,
                        altitude: recoveryFix.coords.altitude ?? null,
                        speed: recoveryFix.coords.speed ?? 0,
                        heading: recoveryFix.coords.heading ?? 0,
                        timestamp: Date.now(),
                        verified_at: ts,
                        source: 'phone_background',
                        gps_degraded: isLowAccuracy,
                        recovery: true,
                    };
                    recoveryUpdates[`/hardware/${sanitizedCurrentBoxId}/phone_status/data_bytes`] = cumulativeDataBytes;
                    await writeMultiPathUpdates(recoveryUpdates);
                    await writeBackgroundStatusBestEffort(sanitizedCurrentBoxId, {
                        lastUpdate: ts,
                        source: 'phone_background',
                        signal_lost: false,
                        gps_degraded: isLowAccuracy,
                        recovery: true,
                    });
                    lastWrittenLocation = { lat: recoveryFix.coords.latitude, lng: recoveryFix.coords.longitude, timestamp: Date.now() };
                    persistLastKnownLocation(lastWrittenLocation);
                    lastValidFixTime = Date.now();
                    persistValidFixTime();
                    lastBackgroundTaskUpdateTimestamp = Date.now();
                    console.log(`[EC-15] ✓ Signal recovered! Fix written | acc=${acc.toFixed(0)}m`);
                } else {
                    console.warn('[EC-15] Signal still lost — recovery fix attempt failed (will retry next health check)');
                }
            }

            // Check if task is still running (heartbeat watchdog)
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);
            if (this.state.status === 'RUNNING' && !isTaskRegistered) {
                const sanitizedCurrentBoxId = sanitizeBoxId(currentBoxId);
                if (!sanitizedCurrentBoxId) return;

                const nativeBlocked = this.nativeStartBlockedUntil > Date.now();

                if (nativeBlocked) {
                    // Still in backoff window — foreground-only mode is already active.
                    // Make sure the foreground watcher is running so data keeps flowing.
                    if (AppState.currentState === 'active' && !this.foregroundWatchSubscription) {
                        console.warn('[EC-15] Health-check: re-starting foreground watcher during native backoff');
                        await this.startForegroundWatcher();
                        this.startForegroundHeartbeat();
                    }
                } else {
                    // Backoff has expired — try to promote to full native BGS.
                    // Use stop() for a clean teardown (clears all listeners / watchers)
                    // before restart, to avoid stacking duplicate subscriptions.
                    console.warn('[EC-15] Backoff cleared. Attempting full native BGS restart...');
                    await this.stop();
                    await this.start(sanitizedCurrentBoxId);
                }
            }
        }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
    }

    private stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Signal Recovery Watchdog — the last line of defence.
     * Runs every CONFIG.NO_FIX_RETRY_INTERVAL_MS (15s) entirely on the JS side,
     * independent of the OS background task. If the background task stops firing
     * (Doze mode, OEM killer, indoor dead zone), this loop keeps trying to get a
     * fresh GPS/cell/WiFi fix and write it to Firebase. It NEVER stops while the
     * service is RUNNING — there is no threshold that gates it off.
     *
     * Strategy per cycle:
     *   1. If a real fix came in recently (from the bg task), skip — no double-work.
     *   2. Try Accuracy.Low (cell towers / WiFi — near-instant, works indoors).
     *   3. If Low fails, try Accuracy.Balanced (GPS + cell + WiFi).
     *   4. Both have hard 8s timeouts so they can never stall the interval.
     *   5. On success: write to Firebase, update lastValidFixTime, persist it.
     *   6. On fail: log and wait for the next cycle — never gives up.
     */
    private startSignalRecoveryWatchdog(): void {
        if (this.signalRecoveryInterval) return; // already running

        const tryFix = async (accuracy: Location.LocationAccuracy): Promise<Location.LocationObject | null> => {
            try {
                return await Promise.race([
                    Location.getCurrentPositionAsync({ accuracy }),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
                ]) as Location.LocationObject;
            } catch {
                return null;
            }
        };

        this.signalRecoveryInterval = setInterval(async () => {
            if (this.isSignalRecoveryInFlight) return;
            if (this.state.status !== 'RUNNING') return;

            const boxId = sanitizeBoxId(currentBoxId);
            if (!boxId) return;

            // Back off if the background task is already delivering fresh fixes.
            // "Fresh" = a real fix written within the last NO_FIX_RETRY_INTERVAL_MS.
            const msSinceLastFix = Date.now() - lastValidFixTime;
            if (msSinceLastFix < CONFIG.NO_FIX_RETRY_INTERVAL_MS) return;

            this.isSignalRecoveryInFlight = true;
            try {
                // Stage 1: cell/WiFi only — near-instant even indoors
                let fix = await tryFix(Location.Accuracy.Low);

                // Stage 2: GPS + cell + WiFi — better outdoors, fallback
                if (!fix) {
                    fix = await tryFix(Location.Accuracy.Balanced);
                }

                if (!fix) {
                    console.log(`[EC-15][watchdog] No fix yet — will retry in ${CONFIG.NO_FIX_RETRY_INTERVAL_MS / 1000}s`);
                    return;
                }

                const acc = fix.coords.accuracy ?? 999;
                const isLowAccuracy = acc > CONFIG.ACCURACY_REJECT_THRESHOLD_M;
                const ts = getTimestampSentinel();
                cumulativeDataBytes += 500;

                const updates: Record<string, any> = {};
                updates[`/locations/${boxId}/phone`] = {
                    latitude: fix.coords.latitude,
                    longitude: fix.coords.longitude,
                    accuracy: fix.coords.accuracy ?? null,
                    altitude: fix.coords.altitude ?? null,
                    speed: fix.coords.speed ?? 0,
                    heading: fix.coords.heading ?? 0,
                    timestamp: Date.now(),
                    verified_at: ts,
                    source: 'phone_background',
                    gps_degraded: isLowAccuracy,
                    watchdog: true,
                };
                updates[`/hardware/${boxId}/phone_status/data_bytes`] = cumulativeDataBytes;

                await writeMultiPathUpdates(updates);
                await writeBackgroundStatusBestEffort(boxId, {
                    lastUpdate: ts,
                    source: 'phone_background',
                    signal_lost: false,
                    gps_degraded: isLowAccuracy,
                    watchdog: true,
                });

                lastWrittenLocation = { lat: fix.coords.latitude, lng: fix.coords.longitude, timestamp: Date.now() };
                persistLastKnownLocation(lastWrittenLocation);
                lastValidFixTime = Date.now();
                persistValidFixTime();
                lastBackgroundTaskUpdateTimestamp = Date.now();
                lastNoFixRetryAttemptTime = Date.now(); // avoid double-attempt from bg task's else block

                console.log(`[EC-15][watchdog] ✓ Fix written | acc=${acc.toFixed(0)}m | ${fix.coords.latitude.toFixed(5)},${fix.coords.longitude.toFixed(5)}`);
            } catch (e) {
                console.warn('[EC-15][watchdog] Write failed (non-fatal):', e);
            } finally {
                this.isSignalRecoveryInFlight = false;
            }
        }, CONFIG.NO_FIX_RETRY_INTERVAL_MS);

        console.log('[EC-15] Signal recovery watchdog started');
    }

    private stopSignalRecoveryWatchdog(): void {
        if (this.signalRecoveryInterval) {
            clearInterval(this.signalRecoveryInterval);
            this.signalRecoveryInterval = null;
        }
        this.isSignalRecoveryInFlight = false;
    }

    private subscribeToAppState(): void {
        this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    }

    private unsubscribeFromAppState(): void {
        if (this.appStateSubscription) {
            this.appStateSubscription.remove();
            this.appStateSubscription = null;
        }
    }

    private handleAppStateChange = async (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active' && this.state.status === 'RUNNING') {
            await this.startForegroundWatcher();
            this.startForegroundHeartbeat();
        }

        if (nextAppState !== 'active') {
            this.stopForegroundWatcher();
            this.stopForegroundHeartbeat();
        }

        if (nextAppState === 'active' && this.state.status === 'RUNNING') {
            // App came to foreground — verify the background task is still alive,
            // force an immediate update, and recover if the OS killed the task.
            setTimeout(async () => {
                // Double check if we are still active (user didn't just quickly switch away)
                if (AppState.currentState !== 'active') return;

                // Re-verify permissions (user might have revoked them in settings)
                const hasPermissions = await this.checkPermissions();
                if (!hasPermissions) {
                    this.updateState({
                        status: 'PERMISSION_DENIED',
                        lastError: 'Location permissions revoked while in background',
                    });
                    return;
                }

                // CRITICAL: Check if the background task was killed while the phone
                // was locked and recover it. forceUpdate alone is not enough because
                // the TaskManager task may no longer be registered.
                if (currentBoxId) {
                    await this.checkAndRecover(currentBoxId);
                }

                await this.forceUpdate();
            }, 1500);
        }
    };

    private async startForegroundWatcher(): Promise<void> {
        const sanitizedCurrentBoxId = sanitizeBoxId(currentBoxId);
        if (this.foregroundWatchSubscription || !sanitizedCurrentBoxId || this.state.status !== 'RUNNING') return;

        try {
            this.foregroundWatchSubscription = await Location.watchPositionAsync(
                {
                    accuracy: CONFIG.ACCURACY,
                    timeInterval: CONFIG.LOCATION_INTERVAL_MS,
                    distanceInterval: CONFIG.DISTANCE_FILTER_M,
                },
                async (location) => {
                    const sanitizedCurrentBoxId = sanitizeBoxId(currentBoxId);
                    if (!sanitizedCurrentBoxId || this.state.status !== 'RUNNING') return;

                    const accuracy = location.coords.accuracy ?? 999;
                    const isLowAccuracy = accuracy > CONFIG.ACCURACY_REJECT_THRESHOLD_M;

                    try {
                        const updates: Record<string, any> = {};
                        const timestampSentinel = getTimestampSentinel();

                        cumulativeDataBytes += 500;

                        updates[`/locations/${sanitizedCurrentBoxId}/phone`] = {
                            latitude: location.coords.latitude,
                            longitude: location.coords.longitude,
                            accuracy: location.coords.accuracy ?? null,
                            altitude: location.coords.altitude ?? null,
                            speed: location.coords.speed ?? 0,
                            heading: location.coords.heading ?? 0,
                            timestamp: Date.now(),
                            verified_at: timestampSentinel,
                            source: 'phone_foreground',
                            gps_degraded: isLowAccuracy,
                        };

                        updates[`/hardware/${sanitizedCurrentBoxId}/phone_status/data_bytes`] = cumulativeDataBytes;

                        await writeMultiPathUpdates(updates);
                        await writeBackgroundStatusBestEffort(sanitizedCurrentBoxId, {
                            lastUpdate: timestampSentinel,
                            source: 'phone_foreground',
                            accuracy: location.coords.accuracy,
                            signal_lost: false,
                            gps_degraded: isLowAccuracy,
                        });

                        const now = Date.now();
                        lastBackgroundTaskUpdateTimestamp = now;
                        this.updateState({
                            lastLocationTimestamp: now,
                            totalUpdatesCount: this.state.totalUpdatesCount + 1,
                        });

                        lastWrittenLocation = {
                            lat: location.coords.latitude,
                            lng: location.coords.longitude,
                            timestamp: now,
                        };
                        lastValidFixTime = now;
                        persistLastKnownLocation(lastWrittenLocation);
                        persistValidFixTime();

                        const phoneStatus = await collectPhoneNetworkStatus(
                            { accuracy: location.coords.accuracy, altitude: location.coords.altitude },
                            'phone_foreground'
                        );
                        if (phoneStatus) {
                            phoneStatus.data_bytes = cumulativeDataBytes;
                        }
                        await writePhoneStatusIfDue(sanitizedCurrentBoxId, phoneStatus);
                    } catch (error) {
                        console.error('[EC-15] Foreground watcher write failed:', error);
                    }
                }
            );
        } catch (error) {
            console.error('[EC-15] Failed to start foreground location watcher:', error);
        }
    }

    private stopForegroundWatcher(): void {
        if (this.foregroundWatchSubscription) {
            this.foregroundWatchSubscription.remove();
            this.foregroundWatchSubscription = null;
        }
    }

    private startForegroundHeartbeat(): void {
        if (this.foregroundHeartbeatInterval || this.state.status !== 'RUNNING') return;

        // The heartbeat acts as a gap-filler: it only calls forceUpdate when
        // the foreground watcher (watchPositionAsync) hasn't delivered a fix
        // recently. This eliminates redundant one-shot GPS requests that
        // timeout indoors while the persistent watcher session is fine.
        this.foregroundHeartbeatInterval = setInterval(async () => {
            if (this.isForegroundHeartbeatInFlight) return;
            if (AppState.currentState !== 'active') return;
            if (!currentBoxId || this.state.status !== 'RUNNING') return;

            // Skip if the foreground watcher already delivered a fix recently.
            // The watcher writes on a persistent GPS session and is far more
            // reliable than a one-shot getCurrentPositionAsync call.
            const msSinceLastFix = Date.now() - (lastBackgroundTaskUpdateTimestamp ?? 0);
            if (msSinceLastFix < CONFIG.LOCATION_INTERVAL_MS * 2) return;

            this.isForegroundHeartbeatInFlight = true;
            try {
                await this.forceUpdate();
            } catch (error) {
                console.warn('[EC-15] Foreground heartbeat gap-fill failed (non-fatal):', error);
            } finally {
                this.isForegroundHeartbeatInFlight = false;
            }
        }, CONFIG.LOCATION_INTERVAL_MS * 3);
    }

    private stopForegroundHeartbeat(): void {
        if (this.foregroundHeartbeatInterval) {
            clearInterval(this.foregroundHeartbeatInterval);
            this.foregroundHeartbeatInterval = null;
        }
        this.isForegroundHeartbeatInFlight = false;
    }

    private subscribeToBoxGpsStatus(boxId: string): void {
        const db = getFirebaseDatabase();
        const boxGpsRef = ref(db, `locations/${boxId}`);

        this.unsubscribeBoxGps = () => off(boxGpsRef);

        onValue(boxGpsRef, (snapshot) => {
            const data = snapshot.val();
            // Handle split-path structure { box, phone } or legacy flat object
            const boxData = data?.box ?? (data?.source === 'box' ? data : null);
            if (boxData) {
                const timestamp = boxData.server_timestamp || boxData.timestamp;
                const isRecent = timestamp && (Date.now() - timestamp) < CONFIG.LOCATION_STALE_THRESHOLD_MS;

                this.updateState({ boxGpsAvailable: isRecent });
            } else {
                this.updateState({ boxGpsAvailable: false });
            }
        });
    }

    private async logServiceEvent(boxId: string, event: string): Promise<void> {
        try {
            await writePathValue(`boxes/${boxId}/background_service_events/${Date.now()}`, {
                event,
                platform: Platform.OS,
                timestamp: getTimestampSentinel(),
            });
        } catch (error) {
            try {
                await writePathValue(`hardware/${boxId}/background_service_events/${Date.now()}`, {
                    event,
                    platform: Platform.OS,
                    timestamp: getTimestampSentinel(),
                });
            } catch (fallbackError) {
                console.error('[EC-15] Failed to log service event:', fallbackError);
            }
        }
    }
}

// ==================== Singleton Export ====================

export const backgroundLocationService = new BackgroundLocationManager();

// ==================== Convenience Functions ====================

export const requestLocationPermissions = () => backgroundLocationService.requestPermissions();
export const checkLocationPermissions = () => backgroundLocationService.checkPermissions();
export const startBackgroundLocation = (boxId: string) => backgroundLocationService.start(boxId);
export const stopBackgroundLocation = () => backgroundLocationService.stop();
export const subscribeToBackgroundLocationState = (cb: StateChangeCallback) => backgroundLocationService.subscribe(cb);
export const getBackgroundLocationState = () => backgroundLocationService.getState();
export const isBackgroundLocationRunning = () => backgroundLocationService.isRunning();
export const forceLocationUpdate = () => backgroundLocationService.forceUpdate();
export const setTrackingPhase = (phase: TrackingPhase) => backgroundLocationService.setPhase(phase);
export const checkAndRecoverBackgroundLocation = (boxId: string) => backgroundLocationService.checkAndRecover(boxId);

// ==================== Helper Functions for Testing ====================

/**
 * Check if background location is supported on this device
 */
export async function isBackgroundLocationSupported(): Promise<boolean> {
    try {
        const isAvailable = await Location.hasServicesEnabledAsync();
        return isAvailable;
    } catch {
        return false;
    }
}

/**
 * Get current device location permissions status
 */
export async function getPermissionStatus(): Promise<{
    foreground: boolean;
    background: boolean;
}> {
    const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
    const { status: backgroundStatus } = await Location.getBackgroundPermissionsAsync();

    return {
        foreground: foregroundStatus === 'granted',
        background: backgroundStatus === 'granted',
    };
}
