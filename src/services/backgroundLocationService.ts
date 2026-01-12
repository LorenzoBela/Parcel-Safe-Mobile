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
import { writePhoneLocation, getFirebaseDatabase, ref, set, serverTimestamp, onValue, off } from './firebaseClient';

// ==================== Configuration ====================

export const CONFIG = {
    /** Background location task name */
    TASK_NAME: 'background-location-task',

    /** Location update interval (ms) */
    LOCATION_INTERVAL_MS: 10000, // 10 seconds

    /** Minimum distance before update (meters) */
    DISTANCE_FILTER_M: 10,

    /** Foreground service notification title */
    NOTIFICATION_TITLE: 'Parcel-Safe Active Delivery',

    /** Foreground service notification body */
    NOTIFICATION_BODY: 'Tracking your location for delivery',

    /** Maximum accuracy for power saving (expo-location accuracy level) */
    ACCURACY: Location.Accuracy.Balanced,

    /** Defer updates until significant movement */
    DEFERRED_UPDATES_DISTANCE_M: 50,

    /** Defer updates time interval (ms) */
    DEFERRED_UPDATES_INTERVAL_MS: 30000,

    /** Health check interval (ms) */
    HEALTH_CHECK_INTERVAL_MS: 60000,

    /** Maximum time without location update before alert (ms) */
    LOCATION_STALE_THRESHOLD_MS: 120000, // 2 minutes
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

// Define the background task
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
        
        try {
            await writePhoneLocation(
                currentBoxId,
                location.coords.latitude,
                location.coords.longitude,
                location.coords.speed ?? 0,
                location.coords.heading ?? 0
            );
            
            // Update last location timestamp in Firebase
            const db = getFirebaseDatabase();
            const statusRef = ref(db, `boxes/${currentBoxId}/background_location_status`);
            await set(statusRef, {
                lastUpdate: serverTimestamp(),
                source: 'phone_background',
                accuracy: location.coords.accuracy,
            });
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
                // Start background location updates
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

    /**
     * Force location update (when app comes to foreground)
     */
    async forceUpdate(): Promise<void> {
        if (!currentBoxId || this.state.status !== 'RUNNING') return;
        
        try {
            const location = await Location.getCurrentPositionAsync({
                accuracy: CONFIG.ACCURACY,
            });
            
            await writePhoneLocation(
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
            
            // Check if task is still running
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
            await this.forceUpdate();
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
