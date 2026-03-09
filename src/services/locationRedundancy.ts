/**
 * GPS Location Redundancy Service
 * 
 * Implements smart failover between Box GPS (primary) and Phone GPS (fallback).
 * Power-optimized: GPS only active during deliveries, adaptive intervals.
 * 
 * Per Parcel-Safe Constitution Article 1.1: "The Nervous System (Firebase RTDB)"
 */

import * as Location from 'expo-location';
import {
    subscribeToLocation,
    writePhoneLocation,
    subscribeToBoxState,
    LocationData,
    BoxState,
    subscribeToGpsHealth,
    GpsHealthState
} from './firebaseClient';
import { backgroundLocationService } from './backgroundLocationService';
// Firebase native database import removed - using JS SDK via firebaseClient


// ==================== Configuration ====================

const CONFIG = {
    /** Time before box heartbeat is considered stale (ms) */
    HEARTBEAT_STALE_THRESHOLD: 30000,

    /** Phone GPS update interval when in fallback mode (ms) */
    PHONE_GPS_INTERVAL: 3000,

    /** Debounce time for source switching to prevent rapid toggling (ms) */
    RECONNECT_DEBOUNCE: 5000,

    /** How often to check for new delivery when in SLEEP state (ms) */
    DEEP_SLEEP_WAKE_INTERVAL: 60000,

    /** How long HDOP must remain healthy before phone GPS is deactivated (ms).
     *  Prevents rapid on/off cycling in marginal signal areas. */
    GPS_HEALTH_RECOVERY_DEBOUNCE: 15000,

    /** Backoff window before retrying failed background service startup (ms). */
    PHONE_GPS_START_RETRY_BACKOFF_MS: 30000,
};

// ==================== Types ====================

export type PowerState = 'SLEEP' | 'STANDBY' | 'ACTIVE';
export type LocationSource = 'box' | 'phone' | 'none';

export interface RedundancyState {
    powerState: PowerState;
    source: LocationSource;
    isBoxOnline: boolean;
    phoneGpsActive: boolean;
    lastLocation: LocationData | null;
    lastBoxHeartbeat: number | null;
    // EC-84: GPS Health
    gpsHealth: {
        hdop: number;
        satellites: number;
        obstructionDetected: boolean;
        isDegraded: boolean;
    } | null;
}

export type StateChangeCallback = (state: RedundancyState) => void;

// ==================== Redundancy Manager Class ====================

class LocationRedundancyManager {
    private boxId: string | null = null;
    private state: RedundancyState = {
        powerState: 'SLEEP',
        source: 'none',
        isBoxOnline: false,
        phoneGpsActive: false,
        lastLocation: null,
        lastBoxHeartbeat: null,
        gpsHealth: null,
    };

    private listeners: Set<StateChangeCallback> = new Set();
    private unsubscribeLocation: (() => void) | null = null;
    private unsubscribeBoxState: (() => void) | null = null;
    private unsubscribeGpsHealth: (() => void) | null = null; // EC-84 Listener
    private phoneGpsWatchId: Location.LocationSubscription | null = null;
    private heartbeatCheckInterval: NodeJS.Timeout | null = null;
    private lastSourceSwitchTime: number = 0;
    private phoneGpsSessionToken: number = 0;
    private gpsHealthRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
    private phoneGpsStartRetryBlockedUntil: number = 0;
    private phoneGpsStartInFlight = false;
    private foregroundFallbackActive = false;

    // ==================== Public API ====================

    /**
     * Start monitoring for a specific box. Call when rider starts a delivery.
     */
    start(boxId: string): void {
        if (this.boxId === boxId) return;

        this.stop(); // Clean up any existing monitoring
        this.boxId = boxId;

        this.updateState({ powerState: 'STANDBY' });
        this.subscribeToBoxUpdates();
        this.startHeartbeatMonitor();
    }

    /**
     * Seed the initial location from the GPS warmup service.
     * Called before start() so the map immediately centers on the rider's
     * real position instead of waiting for the first Firebase read.
     */
    seedInitialLocation(coords: { latitude: number; longitude: number; accuracy?: number }): void {
        if (this.state.lastLocation) return; // Don't overwrite a real location

        this.updateState({
            lastLocation: {
                latitude: coords.latitude,
                longitude: coords.longitude,
                speed: 0,
                heading: 0,
                timestamp: Date.now(),
                source: 'phone',
            },
        });
        console.log(`[Redundancy] Seeded initial location: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
    }

    /**
     * Activate GPS tracking. Call when rider actually starts the trip.
     */
    activate(): void {
        if (this.state.powerState === 'SLEEP') {
            console.warn('[Redundancy] Cannot activate from SLEEP state. Call start() first.');
            return;
        }
        this.updateState({ powerState: 'ACTIVE' });
    }

    /**
     * Deactivate GPS tracking. Call when delivery is completed.
     */
    deactivate(): void {
        this.stopPhoneGps();
        this.updateState({
            powerState: 'STANDBY',
            phoneGpsActive: false,
            source: this.state.isBoxOnline ? 'box' : 'none',
        });
    }

    /**
     * Stop all monitoring. Call when all deliveries are done.
     */
    stop(): void {
        this.stopPhoneGps();
        this.stopHeartbeatMonitor();

        if (this.gpsHealthRecoveryTimer) {
            clearTimeout(this.gpsHealthRecoveryTimer);
            this.gpsHealthRecoveryTimer = null;
        }

        if (this.unsubscribeLocation) {
            this.unsubscribeLocation();
            this.unsubscribeLocation = null;
        }

        if (this.unsubscribeBoxState) {
            this.unsubscribeBoxState();
            this.unsubscribeBoxState = null;
        }

        if (this.unsubscribeGpsHealth) {
            this.unsubscribeGpsHealth();
            this.unsubscribeGpsHealth = null;
        }

        this.boxId = null;
        this.updateState({
            powerState: 'SLEEP',
            source: 'none',
            isBoxOnline: false,
            phoneGpsActive: false,
            lastLocation: null,
            lastBoxHeartbeat: null,
            gpsHealth: null,
        });
    }

    /**
     * Subscribe to state changes
     */
    subscribe(callback: StateChangeCallback): () => void {
        this.listeners.add(callback);
        callback(this.state); // Immediately emit current state
        return () => this.listeners.delete(callback);
    }

    /**
     * Get current state snapshot
     */
    getState(): RedundancyState {
        return { ...this.state };
    }

    // ==================== Private Methods ====================

    private updateState(partial: Partial<RedundancyState>): void {
        this.state = { ...this.state, ...partial };
        this.listeners.forEach(cb => cb(this.state));
    }

    private subscribeToBoxUpdates(): void {
        if (!this.boxId) return;

        // Subscribe to location updates
        this.unsubscribeLocation = subscribeToLocation(this.boxId, (location) => {
            if (!location) return;

            const src = location.source as string;
            if (src === 'box' || src === 'consolidated') {
                // 'consolidated' = both box + phone are fresh; box GPS is working
                this.handleBoxLocationUpdate(location);
            } else if (this.state.source === 'phone' || !this.state.isBoxOnline) {
                // EC-FIX: Loopback - Update UI with phone location from Firebase
                // This ensures the rider sees exactly what the customer sees
                if (src === 'phone' || src === 'phone_background') {
                    this.updateState({
                        lastLocation: location,
                        source: 'phone'
                    });
                }
            }
        });

        // Subscribe to box state
        this.unsubscribeBoxState = subscribeToBoxState(this.boxId, (boxState) => {
            // Box state is monitored for informational purposes only.
            // Tracking activation is handled explicitly via activate() from RiderDashboard.
        });

        // EC-84: Subscribe to GPS Health
        this.unsubscribeGpsHealth = subscribeToGpsHealth(this.boxId, (data) => {
            if (data) {
                this.handleGpsHealthUpdate(data);
            }
        });
    }

    // EC-84: Handle GPS health updates
    private handleGpsHealthUpdate(data: GpsHealthState): void {
        const hdop = data.box_hdop || 100;
        const satellites = data.satellites_visible || 0;
        const obstructionDetected = data.obstruction_detected || false;

        // Determine if signal is degraded
        // HDOP > 5 is generally considered poor
        const isDegraded = hdop > 5.0 || obstructionDetected;

        this.updateState({
            gpsHealth: {
                hdop,
                satellites,
                obstructionDetected,
                isDegraded
            }
        });

        // Trigger fallback if degraded and box is "online" but blindly trusted
        // Ideally we only switch if we are MOVING, but for now safety first.
        if (isDegraded && this.state.powerState === 'ACTIVE' && !this.state.phoneGpsActive) {
            console.log(`[Redundancy] GPS Degraded (HDOP: ${hdop}, Obstruction: ${obstructionDetected}). Activating Phone GPS.`);
            // Cancel any pending recovery timer — health is bad again
            if (this.gpsHealthRecoveryTimer) {
                clearTimeout(this.gpsHealthRecoveryTimer);
                this.gpsHealthRecoveryTimer = null;
            }
            this.startPhoneGpsFallback();
        } else if (!isDegraded && this.state.phoneGpsActive && !this.gpsHealthRecoveryTimer) {
            // GPS health has recovered. Wait GPS_HEALTH_RECOVERY_DEBOUNCE before deactivating phone
            // GPS to prevent rapid cycling in marginal signal areas (e.g. in/out of building).
            console.log(`[Redundancy] GPS Health recovering (HDOP: ${hdop}). Scheduling phone GPS shutdown in ${CONFIG.GPS_HEALTH_RECOVERY_DEBOUNCE}ms.`);
            this.gpsHealthRecoveryTimer = setTimeout(() => {
                this.gpsHealthRecoveryTimer = null;
                // Double-check health is still good before deactivating
                const currentHealth = this.state.gpsHealth;
                if (currentHealth && !currentHealth.isDegraded && this.state.phoneGpsActive) {
                    console.log('[Redundancy] GPS Health confirmed recovered. Deactivating phone GPS to save battery.');
                    this.stopPhoneGps();
                    this.lastSourceSwitchTime = Date.now();
                    this.updateState({
                        source: this.state.isBoxOnline ? 'box' : 'none',
                        phoneGpsActive: false,
                    });
                }
            }, CONFIG.GPS_HEALTH_RECOVERY_DEBOUNCE);
        } else if (isDegraded && this.gpsHealthRecoveryTimer) {
            // Health degraded again before the recovery timer fired — cancel recovery
            clearTimeout(this.gpsHealthRecoveryTimer);
            this.gpsHealthRecoveryTimer = null;
        }
    }

    private handleBoxLocationUpdate(location: LocationData): void {
        const now = Date.now();
        const serverTime = location.server_timestamp || location.timestamp;

        this.updateState({
            lastLocation: location,
            lastBoxHeartbeat: serverTime,
            isBoxOnline: true,
            source: 'box',
        });

        // If box came back online and we're in fallback mode, stop phone GPS
        if (this.state.phoneGpsActive) {
            const timeSinceSwitch = now - this.lastSourceSwitchTime;
            if (timeSinceSwitch >= CONFIG.RECONNECT_DEBOUNCE) {
                console.log('[Redundancy] Box back online, stopping phone GPS fallback');
                this.stopPhoneGps();
                this.lastSourceSwitchTime = now;
            }
        }
    }

    private startHeartbeatMonitor(): void {
        this.heartbeatCheckInterval = setInterval(() => {
            this.checkBoxHeartbeat();
        }, 2000); // Check every 2 seconds
    }

    private stopHeartbeatMonitor(): void {
        if (this.heartbeatCheckInterval) {
            clearInterval(this.heartbeatCheckInterval);
            this.heartbeatCheckInterval = null;
        }
    }

    private checkBoxHeartbeat(): void {
        const now = Date.now();
        const lastHeartbeat = this.state.lastBoxHeartbeat;

        // If we're running foreground-only fallback, periodically retry upgrading
        // to background service after backoff expires.
        if (
            this.state.powerState === 'ACTIVE'
            && this.foregroundFallbackActive
            && !this.phoneGpsStartInFlight
            && now >= this.phoneGpsStartRetryBlockedUntil
        ) {
            this.startPhoneGpsFallback();
        }

        if (!lastHeartbeat) {
            // No heartbeat received yet
            if (this.state.powerState === 'ACTIVE' && !this.state.phoneGpsActive) {
                this.startPhoneGpsFallback();
            }
            return;
        }

        const heartbeatAge = now - lastHeartbeat;
        const isStale = heartbeatAge > CONFIG.HEARTBEAT_STALE_THRESHOLD;

        if (isStale && !this.state.phoneGpsActive && this.state.powerState === 'ACTIVE') {
            // Box went offline, activate phone GPS fallback
            const timeSinceSwitch = now - this.lastSourceSwitchTime;
            if (timeSinceSwitch >= CONFIG.RECONNECT_DEBOUNCE) {
                console.log(`[Redundancy] Box heartbeat stale (${heartbeatAge}ms), activating phone GPS`);
                this.updateState({ isBoxOnline: false });
                this.startPhoneGpsFallback();
                this.lastSourceSwitchTime = now;
            }
        }
    }

    private async startPhoneGpsFallback(): Promise<void> {
        if (this.state.phoneGpsActive && !this.foregroundFallbackActive) return; // Already active with background service

        if (this.phoneGpsStartInFlight) return;

        const now = Date.now();
        if (this.phoneGpsStartRetryBlockedUntil > now) {
            return;
        }

        if (!this.boxId) {
            console.warn('[Redundancy] Cannot start phone GPS without boxId');
            return;
        }

        console.log('[Redundancy] activating phone GPS fallback (Background Service)');

        // EC-15: Use BackgroundLocationService for robust tracking
        this.phoneGpsStartInFlight = true;
        let success = false;
        try {
            success = await backgroundLocationService.start(this.boxId);
        } finally {
            this.phoneGpsStartInFlight = false;
        }

        if (success) {
            this.phoneGpsStartRetryBlockedUntil = 0;
            this.foregroundFallbackActive = false;
            if (this.phoneGpsWatchId) {
                this.phoneGpsWatchId.remove();
                this.phoneGpsWatchId = null;
            }
            this.updateState({
                phoneGpsActive: true,
                source: 'phone',
            });
        } else {
            this.phoneGpsStartRetryBlockedUntil = Date.now() + CONFIG.PHONE_GPS_START_RETRY_BACKOFF_MS;
            console.warn('[Redundancy] Background service unavailable. Falling back to foreground GPS watch.');

            const watcherStarted = await this.startForegroundPhoneGpsWatch();
            if (watcherStarted) {
                this.foregroundFallbackActive = true;
                this.updateState({
                    phoneGpsActive: true,
                    source: 'phone',
                });
            } else {
                console.error('[Redundancy] Failed to start any phone GPS fallback');
                this.updateState({ source: 'none' });
            }
        }
    }

    private async startForegroundPhoneGpsWatch(): Promise<boolean> {
        if (this.phoneGpsWatchId) {
            return true;
        }

        try {
            const { status } = await Location.getForegroundPermissionsAsync();
            if (status !== 'granted') {
                const requested = await Location.requestForegroundPermissionsAsync();
                if (requested.status !== 'granted') {
                    return false;
                }
            }

            const sessionToken = ++this.phoneGpsSessionToken;
            this.phoneGpsWatchId = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.BestForNavigation,
                    timeInterval: CONFIG.PHONE_GPS_INTERVAL,
                    distanceInterval: 0,
                },
                async (location) => {
                    if (sessionToken !== this.phoneGpsSessionToken) return;
                    await this.handlePhoneLocationUpdate(location);
                }
            );

            return true;
        } catch (error) {
            console.error('[Redundancy] Failed to start foreground GPS watch:', error);
            return false;
        }
    }

    private async handlePhoneLocationUpdate(location: Location.LocationObject): Promise<void> {
        if (!this.boxId) return;

        const { latitude, longitude } = location.coords;
        const speed = location.coords.speed ?? 0;
        const heading = location.coords.heading ?? 0;

        try {
            await writePhoneLocation(this.boxId, latitude, longitude, speed, heading);

            this.updateState({
                lastLocation: {
                    latitude,
                    longitude,
                    timestamp: Date.now(),
                    speed,
                    heading,
                    source: 'phone',
                },
            });
        } catch (error) {
            console.error('[Redundancy] Failed to write phone location:', error);
        }
    }

    private stopPhoneGps(): void {
        // Cancel any pending startPhoneGpsFallback() run.
        this.phoneGpsSessionToken++;
        this.foregroundFallbackActive = false;

        if (this.phoneGpsWatchId) {
            this.phoneGpsWatchId.remove();
            this.phoneGpsWatchId = null;
        }
        this.updateState({ phoneGpsActive: false });
    }
}

// ==================== Singleton Export ====================

export const locationRedundancy = new LocationRedundancyManager();

// Convenience functions
export const startRedundancyMonitor = (boxId: string) => locationRedundancy.start(boxId);
export const activateGpsTracking = () => locationRedundancy.activate();
export const deactivateGpsTracking = () => locationRedundancy.deactivate();
export const stopRedundancyMonitor = () => locationRedundancy.stop();
export const subscribeToRedundancyState = (cb: StateChangeCallback) => locationRedundancy.subscribe(cb);
export const getRedundancyState = () => locationRedundancy.getState();
