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
import { Platform, AppState, AppStateStatus } from 'react-native';
import { getFirebaseDatabase, ref, set, serverTimestamp, onValue, off } from './firebaseClient';
import { offlineQueueService } from './offlineQueueService';

let BackgroundService: any = null;
try {
    BackgroundService = require('react-native-background-actions').default;
} catch (error) {
    if (__DEV__) console.log('[EC-15] BackgroundService not available');
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
}

/** Rate-limit: minimum interval between phone status writes (ms) */
const PHONE_STATUS_WRITE_INTERVAL_MS = 30_000; // 30 seconds
let lastPhoneStatusWriteTime = 0;

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

        return {
            connection,
            cellular_generation: cellularGeneration,
            is_connected: netState.isConnected ?? false,
            is_internet_reachable: netState.isInternetReachable ?? false,
            gps_accuracy: locationCoords.accuracy,
            gps_altitude: locationCoords.altitude,
            source,
            timestamp: Date.now(),
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
        const db = getFirebaseDatabase();
        const phoneStatusRef = ref(db, `hardware/${boxId}/phone_status`);
        await set(phoneStatusRef, status);
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
    TASK_NAME: 'background-location-task',

    /** Location update interval (ms) — aggressive for max accuracy */
    LOCATION_INTERVAL_MS: 3000, // 3 seconds

    /** Minimum distance before update (meters) */
    DISTANCE_FILTER_M: 5, // 5 meters

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

    /** Health check interval (ms) */
    HEALTH_CHECK_INTERVAL_MS: 60000,

    /** Maximum time without location update before alert (ms) */
    LOCATION_STALE_THRESHOLD_MS: 120000, // 2 minutes

    /** GPS accuracy threshold — readings above this are rejected (meters) */
    ACCURACY_REJECT_THRESHOLD_M: 100,

    /** Speed below which rider is considered stationary (m/s) */
    STATIONARY_SPEED_THRESHOLD: 0.5,

    /** Time rider must be below speed threshold to activate drift filter (ms) */
    STATIONARY_MIN_DURATION_MS: 30000,

    /** Distance within which stationary jitter is suppressed (meters) */
    STATIONARY_DRIFT_RADIUS_M: 15,

    /** Time without a valid GPS fix before declaring signal lost (ms) */
    SIGNAL_LOST_THRESHOLD_MS: 120000, // 2 minutes
};

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
                return true; // Suppress — it's jitter
            }
        }
    } else {
        stationaryStartTime = null; // Moving again, reset
    }
    return false;
}

// ---- Feature 7: Signal Loss Recovery state ----
let lastValidFixTime = Date.now();

// Define the foreground task for Location Updates (react-native-background-actions)
const sleep = (time: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), time));

const foregroundLocationTask = async (taskDataArguments: any) => {
    const { delay } = taskDataArguments;

    // We run an infinite loop as long as the service is running
    while (BackgroundService.isRunning()) {
        try {
            if (currentBoxId) {
                const location = await Location.getCurrentPositionAsync({
                    accuracy: CONFIG.ACCURACY,
                });

                // Run identical logic to TaskManager callback
                const accuracy = location.coords.accuracy ?? 999;
                if (accuracy > CONFIG.ACCURACY_REJECT_THRESHOLD_M) {
                    accuracyRejectCount++;
                    if (__DEV__ || accuracyRejectCount % 5 === 0) {
                        console.log(`[EC-15] GPS rejected: accuracy ${accuracy.toFixed(0)}m > ${CONFIG.ACCURACY_REJECT_THRESHOLD_M}m (${accuracyRejectCount} total)`);
                    }
                } else if (!isStationaryDrift(location)) {
                    accuracyRejectCount = 0; // Reset on good reading

                    await offlineQueueService.enqueueLocationUpdate(
                        currentBoxId,
                        location.coords.latitude,
                        location.coords.longitude,
                        location.coords.speed ?? 0,
                        location.coords.heading ?? 0
                    );

                    lastWrittenLocation = {
                        lat: location.coords.latitude,
                        lng: location.coords.longitude,
                        timestamp: Date.now(),
                    };
                    lastValidFixTime = Date.now();

                    const db = getFirebaseDatabase();
                    const statusRef = ref(db, `boxes/${currentBoxId}/background_location_status`);
                    await set(statusRef, {
                        lastUpdate: serverTimestamp(),
                        source: 'phone_background_fg',
                        accuracy: location.coords.accuracy,
                        signal_lost: false,
                    });

                    const phoneStatus = await collectPhoneNetworkStatus(
                        { accuracy: location.coords.accuracy, altitude: location.coords.altitude },
                        'phone_background'
                    );
                    await writePhoneStatusIfDue(currentBoxId, phoneStatus);
                }
            }
        } catch (error) {
            console.error('[EC-15] Foreground task iteration error:', error);
        }

        // Wait for the defined interval before polling again
        await sleep(delay);
    }
};

// Define the background task (expo-task-manager)
TaskManager.defineTask(CONFIG.TASK_NAME, async ({ data, error }) => {
    if (error) {
        console.error('[EC-15] Background task error:', error);
        return;
    }

    if (!data || !currentBoxId) {
        return;
    }

    const { locations } = data as { locations: Location.LocationObject[] };

    if (locations && locations.length > 0) {
        const location = locations[locations.length - 1]; // Get most recent

        // ---- Feature 3: Accuracy Filter ----
        const accuracy = location.coords.accuracy ?? 999;
        if (accuracy > CONFIG.ACCURACY_REJECT_THRESHOLD_M) {
            accuracyRejectCount++;
            if (__DEV__ || accuracyRejectCount % 5 === 0) {
                console.log(`[EC-15] GPS rejected: accuracy ${accuracy.toFixed(0)}m > ${CONFIG.ACCURACY_REJECT_THRESHOLD_M}m (${accuracyRejectCount} total)`);
            }
            return; // Don't write noisy data to Firebase
        }
        accuracyRejectCount = 0; // Reset on good reading

        // ---- Feature 4: Stationary Drift Prevention ----
        if (isStationaryDrift(location)) {
            return; // Suppress phantom movement while rider is waiting
        }

        try {
            await offlineQueueService.enqueueLocationUpdate(
                currentBoxId,
                location.coords.latitude,
                location.coords.longitude,
                location.coords.speed ?? 0,
                location.coords.heading ?? 0
            );

            // Track last written location for drift prevention
            lastWrittenLocation = {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
                timestamp: Date.now(),
            };

            // Record valid fix time for signal loss detection
            lastValidFixTime = Date.now();

            // Update last location timestamp in Firebase (heartbeat, bypass queue for status)
            const db = getFirebaseDatabase();
            const statusRef = ref(db, `boxes/${currentBoxId}/background_location_status`);
            await set(statusRef, {
                lastUpdate: serverTimestamp(),
                source: 'phone_background',
                accuracy: location.coords.accuracy,
                signal_lost: false,
            });

            // Write phone network status (rate-limited)
            const phoneStatus = await collectPhoneNetworkStatus(
                { accuracy: location.coords.accuracy, altitude: location.coords.altitude },
                'phone_background'
            );
            await writePhoneStatusIfDue(currentBoxId, phoneStatus);
        } catch (e) {
            console.error('[EC-15] Failed to write background location:', e);
        }
    }
});

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
    private appStateSubscription: any = null;
    private unsubscribeBoxGps: (() => void) | null = null;
    private currentPhase: TrackingPhase = 'TRANSIT';

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
     * Start background location tracking
     */
    async start(boxId: string): Promise<boolean> {
        if (this.state.status === 'RUNNING') {
            if (currentBoxId === boxId) return true;
            await this.stop();
        }

        this.updateState({ status: 'STARTING' });
        currentBoxId = boxId;

        // Check permissions
        const hasPermissions = await this.checkPermissions();
        if (!hasPermissions) {
            const granted = await this.requestPermissions();
            if (!granted) {
                this.updateState({
                    status: 'PERMISSION_DENIED',
                    lastError: 'Location permissions not granted',
                });
                return false;
            }
        }

        try {
            // Check if task is already running
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);

            if (!isTaskRegistered) {
                // Start background location updates (Expo Task Manager)
                await Location.startLocationUpdatesAsync(CONFIG.TASK_NAME, {
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
                });
            }

            // Start indestructible Foreground Service (Android specific)
            if (Platform.OS === 'android' && BackgroundService) {
                if (!BackgroundService.isRunning()) {
                    const options = {
                        taskName: 'parcel_safe_location',
                        taskTitle: CONFIG.NOTIFICATION_TITLE,
                        taskDesc: CONFIG.NOTIFICATION_BODY,
                        taskIcon: {
                            name: 'ic_launcher',
                            type: 'mipmap',
                        },
                        color: '#0066FF',
                        linkingURI: 'parcelsafe://home', // Replace with your deep link
                        parameters: {
                            delay: CONFIG.LOCATION_INTERVAL_MS,
                        },
                        notification: {
                            channelId: 'location-tracking-channel', // Custom channel name
                            channelName: 'Live Delivery Tracking',
                            channelDescription: 'Tracks rider location for customer view',
                            android: {
                                foregroundServiceTypes: ['location'], // CRITICAL FOR LOCATION TRACKING
                            },
                        },
                    };
                    await BackgroundService.start(foregroundLocationTask, options);
                }
            }

            this.updateState({
                status: 'RUNNING',
                foregroundServiceActive: Platform.OS === 'android',
                lastError: null,
            });

            // Start monitoring
            this.startHealthCheck();
            this.subscribeToAppState();
            this.subscribeToBoxGpsStatus(boxId);

            // Log to Firebase
            await this.logServiceEvent(boxId, 'SERVICE_STARTED');

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
        try {
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);

            if (isTaskRegistered) {
                await Location.stopLocationUpdatesAsync(CONFIG.TASK_NAME);
            }

            if (Platform.OS === 'android' && BackgroundService && BackgroundService.isRunning()) {
                await BackgroundService.stop();
            }
        } catch (error) {
            console.error('[EC-15] Error stopping location updates:', error);
        }

        // Clean up
        this.stopHealthCheck();
        this.unsubscribeFromAppState();

        if (this.unsubscribeBoxGps) {
            this.unsubscribeBoxGps();
            this.unsubscribeBoxGps = null;
        }

        if (currentBoxId) {
            await this.logServiceEvent(currentBoxId, 'SERVICE_STOPPED');
        }

        currentBoxId = null;

        this.updateState({
            status: 'STOPPED',
            foregroundServiceActive: false,
        });
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
        try {
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);

            if (!isTaskRegistered) {
                console.warn('[EC-15] Background task was killed by OS! Restarting...');
                await this.start(boxId);
                return;
            }

            // Check if task is registered but not producing output (zombie state)
            const timeSinceUpdate = Date.now() - (this.state.lastLocationTimestamp ?? 0);
            if (timeSinceUpdate > 180000) { // 3 minutes — stale zombie
                console.warn(`[EC-15] Background task stale (${Math.round(timeSinceUpdate / 1000)}s). Restarting...`);
                await this.stop();
                await this.start(boxId);
            }
        } catch (error) {
            console.error('[EC-15] checkAndRecover failed:', error);
        }
    }

    /**
     * Force location update (when app comes to foreground)
     */
    async forceUpdate(): Promise<void> {
        if (!currentBoxId || this.state.status !== 'RUNNING') return;

        try {
            const location = await Location.getCurrentPositionAsync({
                accuracy: CONFIG.ACCURACY,
            });

            await offlineQueueService.enqueueLocationUpdate(
                currentBoxId,
                location.coords.latitude,
                location.coords.longitude,
                location.coords.speed ?? 0,
                location.coords.heading ?? 0
            );

            this.updateState({
                lastLocationTimestamp: Date.now(),
                totalUpdatesCount: this.state.totalUpdatesCount + 1,
            });

            // Write phone network status on foreground updates (rate-limited)
            const phoneStatus = await collectPhoneNetworkStatus(
                { accuracy: location.coords.accuracy, altitude: location.coords.altitude },
                'phone_foreground'
            );
            await writePhoneStatusIfDue(currentBoxId, phoneStatus);
        } catch (error) {
            console.error('[EC-15] Force update failed:', error);
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
            const lastUpdate = this.state.lastLocationTimestamp;

            if (lastUpdate && (now - lastUpdate) > CONFIG.LOCATION_STALE_THRESHOLD_MS) {
                // Location is stale - check if box GPS is available as fallback
                if (!this.state.boxGpsAvailable) {
                    console.warn('[EC-15] Both phone and box GPS appear to be down');
                    await this.logServiceEvent(currentBoxId!, 'GPS_BOTH_DOWN');
                }
            }

            // ---- Feature 7: Signal Loss Detection ----
            const timeSinceValidFix = now - lastValidFixTime;
            if (timeSinceValidFix > CONFIG.SIGNAL_LOST_THRESHOLD_MS && currentBoxId) {
                try {
                    const db = getFirebaseDatabase();
                    const statusRef = ref(db, `boxes/${currentBoxId}/background_location_status`);
                    await set(statusRef, {
                        lastUpdate: serverTimestamp(),
                        source: 'phone_background',
                        signal_lost: true,
                        last_valid_fix: lastValidFixTime,
                        signal_lost_duration_ms: timeSinceValidFix,
                    });
                } catch (e) {
                    console.error('[EC-15] Failed to write signal_lost status:', e);
                }
            }

            // Check if task is still running (heartbeat watchdog)
            const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG.TASK_NAME);
            if (this.state.status === 'RUNNING' && !isTaskRegistered) {
                console.warn('[EC-15] Task was killed, restarting...');
                if (currentBoxId) {
                    await this.start(currentBoxId);
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
            // App came to foreground - force an immediate update
            // Wait for a moment to let the OS stabilize and permissions to be re-verified
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
                    // Gracefully stop or alert user
                    return;
                }

                await this.forceUpdate();
            }, 1500);
        }
    };

    private subscribeToBoxGpsStatus(boxId: string): void {
        const db = getFirebaseDatabase();
        const boxGpsRef = ref(db, `locations/${boxId}`);

        this.unsubscribeBoxGps = () => off(boxGpsRef);

        onValue(boxGpsRef, (snapshot) => {
            const data = snapshot.val();
            if (data && data.source === 'box') {
                const timestamp = data.server_timestamp || data.timestamp;
                const isRecent = timestamp && (Date.now() - timestamp) < CONFIG.LOCATION_STALE_THRESHOLD_MS;

                this.updateState({ boxGpsAvailable: isRecent });
            } else {
                this.updateState({ boxGpsAvailable: false });
            }
        });
    }

    private async logServiceEvent(boxId: string, event: string): Promise<void> {
        try {
            const db = getFirebaseDatabase();
            const eventRef = ref(db, `boxes/${boxId}/background_service_events/${Date.now()}`);
            await set(eventRef, {
                event,
                platform: Platform.OS,
                timestamp: serverTimestamp(),
            });
        } catch (error) {
            console.error('[EC-15] Failed to log service event:', error);
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
