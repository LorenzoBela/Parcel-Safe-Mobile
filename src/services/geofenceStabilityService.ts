/**
 * EC-92, EC-93, EC-94: Geofence Stability Service
 * 
 * Handles GPS signal anomalies for stable geofence detection:
 * - EC-92: Urban Canyon Flicker (HDOP gating, hysteresis)
 * - EC-93: Zombie Delivery (Warehouse return detection)
 * - EC-94: Boundary Hopper (Inner/outer radius hysteresis)
 */

import { getFirebaseDatabase, ref, set, onValue, off, serverTimestamp } from './firebaseClient';

// ==================== Configuration ====================

export const CONFIG = {
    /** Inner radius - must be INSIDE this to enter ARRIVED state (meters) */
    INNER_RADIUS_M: 40,

    /** Outer radius - must be OUTSIDE this to exit ARRIVED state (meters) */
    OUTER_RADIUS_M: 60,

    /** Default geofence radius (meters) */
    DEFAULT_RADIUS_M: 50,

    /** Expanded radius in urban canyon conditions (meters) */
    EXPANDED_RADIUS_M: 100,

    /** Consecutive readings required for state transition */
    HYSTERESIS_SAMPLES: 3,

    /** Minimum time for state persistence before transition (ms) */
    STABILITY_WINDOW_MS: 10000,

    /** HDOP threshold for urban canyon detection */
    HDOP_DEGRADED: 5.0,

    /** Minimum satellites for reliable GPS fix */
    MIN_SATELLITES: 4,

    /** Time in warehouse before auto-return status (ms) - 5 minutes */
    WAREHOUSE_RETURN_TIMEOUT_MS: 300000,
};

// ==================== Types ====================

export type GeofenceState =
    | 'OUTSIDE'
    | 'ENTERING'
    | 'INSIDE'
    | 'EXITING'
    | 'DEAD_ZONE';

export interface GeofenceLocation {
    latitude: number;
    longitude: number;
}

export interface GpsQuality {
    hdop: number;
    satellites: number;
    timestamp: number;
}

export interface GeofenceStabilityState {
    stableState: GeofenceState;
    rawState: GeofenceState;
    rawDistanceM: number;
    hdop: number;
    satellites: number;
    urbanCanyonDetected: boolean;
    warehouseReturnDetected: boolean;
    lastStableChangeMs: number;
    hysteresisCount: number;
    warehouseEntryMs: number | null;
}

export interface WarehouseConfig {
    latitude: number;
    longitude: number;
    name: string;
    id: string;
}

// ==================== Distance Calculation ====================

const EARTH_RADIUS_M = 6371000;

/**
 * Calculate Haversine distance between two GPS coordinates
 */
export function calculateDistanceM(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_M * c;
}

// ==================== Core Functions ====================

/**
 * EC-92: Check if GPS indicates urban canyon conditions
 */
export function isUrbanCanyonDetected(hdop: number, satellites: number): boolean {
    return hdop > CONFIG.HDOP_DEGRADED || satellites < CONFIG.MIN_SATELLITES;
}

/**
 * EC-94: Get raw state from distance using inner/outer hysteresis bands
 */
export function getRawStateFromDistance(distanceM: number): GeofenceState {
    if (distanceM < CONFIG.INNER_RADIUS_M) {
        return 'INSIDE';
    } else if (distanceM > CONFIG.OUTER_RADIUS_M) {
        return 'OUTSIDE';
    } else {
        // 40-60m dead zone - maintain previous state
        return 'DEAD_ZONE';
    }
}

/**
 * Get effective geofence radius based on conditions
 */
export function getEffectiveRadius(urbanCanyonDetected: boolean): number {
    return urbanCanyonDetected ? CONFIG.EXPANDED_RADIUS_M : CONFIG.DEFAULT_RADIUS_M;
}

/**
 * Check if position is inside warehouse geofence
 */
export function isInsideWarehouse(
    lat: number,
    lng: number,
    warehouse: WarehouseConfig | null
): boolean {
    if (!warehouse) return false;

    const distance = calculateDistanceM(lat, lng, warehouse.latitude, warehouse.longitude);
    return distance < CONFIG.DEFAULT_RADIUS_M;
}

/**
 * EC-93: Calculate remaining warehouse return timeout in seconds
 */
export function getWarehouseReturnRemainingSec(
    warehouseEntryMs: number | null,
    currentMs: number
): number {
    if (!warehouseEntryMs) return -1;

    const elapsed = currentMs - warehouseEntryMs;
    if (elapsed >= CONFIG.WAREHOUSE_RETURN_TIMEOUT_MS) return 0;

    return Math.floor((CONFIG.WAREHOUSE_RETURN_TIMEOUT_MS - elapsed) / 1000);
}

/**
 * Initialize a new geofence stability state
 */
export function createInitialState(): GeofenceStabilityState {
    return {
        stableState: 'OUTSIDE',
        rawState: 'OUTSIDE',
        rawDistanceM: 0,
        hdop: 1.0,
        satellites: 8,
        urbanCanyonDetected: false,
        warehouseReturnDetected: false,
        lastStableChangeMs: 0,
        hysteresisCount: 0,
        warehouseEntryMs: null,
    };
}

// ==================== State Machine ====================

/**
 * Update geofence stability state with new GPS reading
 */
export function updateGeofenceState(
    currentState: GeofenceStabilityState,
    position: { lat: number; lng: number },
    target: GeofenceLocation,
    gpsQuality: GpsQuality,
    warehouse: WarehouseConfig | null,
    currentMs: number
): GeofenceStabilityState {
    const newState = { ...currentState };

    // Calculate distance to target
    const distanceM = calculateDistanceM(
        position.lat, position.lng,
        target.latitude, target.longitude
    );
    newState.rawDistanceM = distanceM;
    newState.hdop = gpsQuality.hdop;
    newState.satellites = gpsQuality.satellites;

    // EC-92: Detect urban canyon
    newState.urbanCanyonDetected = isUrbanCanyonDetected(gpsQuality.hdop, gpsQuality.satellites);

    // EC-92: If urban canyon detected, don't allow state transitions
    if (newState.urbanCanyonDetected) {
        return newState;
    }

    // Get raw state from distance using hysteresis bands
    const rawState = getRawStateFromDistance(distanceM);
    newState.rawState = rawState;

    // EC-94: Handle dead zone - maintain previous confirmed state
    if (rawState === 'DEAD_ZONE') {
        newState.hysteresisCount = 0;
        return newState;
    }

    // EC-92/94: Apply hysteresis - require consecutive readings
    // Note: rawState cannot be DEAD_ZONE here due to early return above
    if (rawState === currentState.rawState) {
        newState.hysteresisCount = currentState.hysteresisCount + 1;
    } else {
        newState.hysteresisCount = 1;
    }

    // Only transition if we have enough consecutive readings
    if (newState.hysteresisCount >= CONFIG.HYSTERESIS_SAMPLES) {
        if (newState.stableState !== rawState) {
            newState.stableState = rawState;
            newState.lastStableChangeMs = currentMs;
        }
    }

    // EC-93: Check warehouse return
    if (warehouse && isInsideWarehouse(position.lat, position.lng, warehouse)) {
        if (!newState.warehouseEntryMs) {
            newState.warehouseEntryMs = currentMs;
        }

        // Check if in warehouse for timeout duration
        if ((currentMs - newState.warehouseEntryMs) >= CONFIG.WAREHOUSE_RETURN_TIMEOUT_MS) {
            newState.warehouseReturnDetected = true;
        }
    } else {
        // Reset warehouse timer if not in warehouse
        newState.warehouseEntryMs = null;
        newState.warehouseReturnDetected = false;
    }

    return newState;
}

// ==================== Firebase Functions ====================

/**
 * Publish geofence stability state to Firebase
 */
export async function publishGeofenceStability(
    boxId: string,
    state: GeofenceStabilityState
): Promise<void> {
    const db = getFirebaseDatabase();
    const stabilityRef = ref(db, `hardware/${boxId}/geofence_stability`);

    await set(stabilityRef, {
        stable_state: state.stableState,
        raw_distance_m: state.rawDistanceM,
        hdop: state.hdop,
        satellites: state.satellites,
        urban_canyon_detected: state.urbanCanyonDetected,
        warehouse_return_detected: state.warehouseReturnDetected,
        last_stable_change: state.lastStableChangeMs,
        hysteresis_count: state.hysteresisCount,
        timestamp: serverTimestamp(),
    });
}

/**
 * Subscribe to geofence stability updates from Firebase
 */
export function subscribeToGeofenceStability(
    boxId: string,
    callback: (state: GeofenceStabilityState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const stabilityRef = ref(db, `hardware/${boxId}/geofence_stability`);

    const handleValue = (snapshot: any) => {
        const data = snapshot.val();
        if (!data) {
            callback(null);
            return;
        }

        callback({
            stableState: data.stable_state || 'OUTSIDE',
            rawState: data.raw_state || 'OUTSIDE',
            rawDistanceM: data.raw_distance_m || 0,
            hdop: data.hdop || 1.0,
            satellites: data.satellites || 0,
            urbanCanyonDetected: data.urban_canyon_detected || false,
            warehouseReturnDetected: data.warehouse_return_detected || false,
            lastStableChangeMs: data.last_stable_change || 0,
            hysteresisCount: data.hysteresis_count || 0,
            warehouseEntryMs: data.warehouse_entry_ms || null,
        });
    };

    onValue(stabilityRef, handleValue);

    return () => {
        off(stabilityRef);
    };
}

/**
 * Publish warehouse return event to Firebase
 */
export async function publishWarehouseReturn(
    boxId: string,
    deliveryId: string,
    warehouse: WarehouseConfig,
    enteredAt: number
): Promise<void> {
    const db = getFirebaseDatabase();
    const returnRef = ref(db, `hardware/${boxId}/warehouse_return`);

    await set(returnRef, {
        detected: true,
        depot_id: warehouse.id,
        depot_name: warehouse.name,
        delivery_id: deliveryId,
        entered_at: enteredAt,
        auto_return_triggered: true,
        timestamp: serverTimestamp(),
    });
}

// ==================== Helper Exports ====================

export const geofenceStabilityService = {
    calculateDistanceM,
    isUrbanCanyonDetected,
    getRawStateFromDistance,
    getEffectiveRadius,
    isInsideWarehouse,
    getWarehouseReturnRemainingSec,
    createInitialState,
    updateGeofenceState,
    publishGeofenceStability,
    subscribeToGeofenceStability,
    publishWarehouseReturn,
    CONFIG,
};
