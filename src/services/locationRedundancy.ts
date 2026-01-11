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
    BoxState
} from './firebaseClient';

// ==================== Configuration ====================

const CONFIG = {
    /** Time before box heartbeat is considered stale (ms) */
    HEARTBEAT_STALE_THRESHOLD: 15000,

    /** Phone GPS update interval when in fallback mode (ms) */
    PHONE_GPS_INTERVAL: 8000,

    /** Debounce time for source switching to prevent rapid toggling (ms) */
    RECONNECT_DEBOUNCE: 5000,

    /** How often to check for new delivery when in SLEEP state (ms) */
    DEEP_SLEEP_WAKE_INTERVAL: 60000,
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
    };

    private listeners: Set<StateChangeCallback> = new Set();
    private unsubscribeLocation: (() => void) | null = null;
    private unsubscribeBoxState: (() => void) | null = null;
    private phoneGpsWatchId: Location.LocationSubscription | null = null;
    private heartbeatCheckInterval: NodeJS.Timeout | null = null;
    private lastSourceSwitchTime: number = 0;

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

        if (this.unsubscribeLocation) {
            this.unsubscribeLocation();
            this.unsubscribeLocation = null;
        }

        if (this.unsubscribeBoxState) {
            this.unsubscribeBoxState();
            this.unsubscribeBoxState = null;
        }

        this.boxId = null;
        this.updateState({
            powerState: 'SLEEP',
            source: 'none',
            isBoxOnline: false,
            phoneGpsActive: false,
            lastLocation: null,
            lastBoxHeartbeat: null,
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
            if (location && location.source === 'box') {
                this.handleBoxLocationUpdate(location);
            }
        });

        // Subscribe to box state
        this.unsubscribeBoxState = subscribeToBoxState(this.boxId, (boxState) => {
            // Box state updates can inform power state decisions
            if (boxState?.status === 'ACTIVE' || boxState?.status === 'ARRIVED') {
                if (this.state.powerState === 'STANDBY') {
                    this.activate();
                }
            }
        });
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
        if (this.phoneGpsWatchId) return; // Already running

        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                console.error('[Redundancy] Location permission denied');
                this.updateState({ source: 'none' });
                return;
            }

            this.updateState({
                phoneGpsActive: true,
                source: 'phone',
            });

            // Start watching location with power-efficient settings
            this.phoneGpsWatchId = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.Balanced, // Balance accuracy vs power
                    timeInterval: CONFIG.PHONE_GPS_INTERVAL,
                    distanceInterval: 10, // Only update if moved 10+ meters
                },
                (location) => this.handlePhoneLocationUpdate(location)
            );

            console.log('[Redundancy] Phone GPS fallback activated');
        } catch (error) {
            console.error('[Redundancy] Failed to start phone GPS:', error);
            this.updateState({ source: 'none', phoneGpsActive: false });
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
