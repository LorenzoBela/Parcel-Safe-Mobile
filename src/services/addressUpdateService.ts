/**
 * EC-12: Address Update Service
 * 
 * Handles address correction scenarios when GPS shows rider at location
 * but it's the incorrect address.
 * 
 * Features:
 * - Rider correction: App allows address update
 * - Customer correction: Tracking page has "Update Address"
 * - Geofence flexibility: 50m radius accommodates GPS errors
 */

import { getFirebaseDatabase, serverTimestamp, ref, set, onValue, off } from './firebaseClient';

// ==================== Configuration ====================

export const CONFIG = {
    /** Default geofence radius (meters) */
    DEFAULT_GEOFENCE_RADIUS_M: 50,

    /** Maximum geofence radius for special cases (meters) */
    MAX_GEOFENCE_RADIUS_M: 200,

    /** Minimum geofence radius (meters) */
    MIN_GEOFENCE_RADIUS_M: 20,

    /** GPS accuracy threshold for address validation (meters) */
    GPS_ACCURACY_THRESHOLD_M: 25,

    /** Maximum distance for address update (meters) */
    MAX_ADDRESS_UPDATE_DISTANCE_M: 1000, // 1km max correction

    /** Cooldown between address updates (ms) */
    ADDRESS_UPDATE_COOLDOWN_MS: 60000, // 1 minute
};

// ==================== Types ====================

export type AddressUpdateSource = 'RIDER' | 'CUSTOMER' | 'ADMIN';

export interface AddressData {
    address: string;
    latitude: number;
    longitude: number;
    notes?: string;
    landmark?: string;
}

export interface AddressUpdateRequest {
    deliveryId: string;
    source: AddressUpdateSource;
    originalAddress: AddressData;
    updatedAddress: AddressData;
    reason: string;
    requestedAt: number;
    approvedAt?: number;
    approvedBy?: string;
}

export interface GeofenceConfig {
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
}

export interface GeofenceCheckResult {
    isInside: boolean;
    distanceMeters: number;
    gpsAccuracy: number;
    needsExpansion: boolean;
    suggestedRadiusMeters: number;
}

// ==================== Geofence Functions ====================

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 */
export function calculateDistanceMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Check if a position is inside the geofence
 */
export function checkGeofence(
    position: { lat: number; lng: number; accuracy?: number },
    geofence: GeofenceConfig
): GeofenceCheckResult {
    const distance = calculateDistanceMeters(
        position.lat,
        position.lng,
        geofence.centerLat,
        geofence.centerLng
    );
    
    const accuracy = position.accuracy || CONFIG.GPS_ACCURACY_THRESHOLD_M;
    const effectiveRadius = geofence.radiusMeters + accuracy; // Account for GPS error
    
    const isInside = distance <= effectiveRadius;
    
    // Suggest radius expansion if close but outside
    let needsExpansion = false;
    let suggestedRadius = geofence.radiusMeters;
    
    if (!isInside && distance <= CONFIG.MAX_GEOFENCE_RADIUS_M) {
        needsExpansion = true;
        suggestedRadius = Math.min(
            Math.ceil(distance / 10) * 10 + 10, // Round up to nearest 10m + buffer
            CONFIG.MAX_GEOFENCE_RADIUS_M
        );
    }
    
    return {
        isInside,
        distanceMeters: Math.round(distance),
        gpsAccuracy: accuracy,
        needsExpansion,
        suggestedRadiusMeters: suggestedRadius,
    };
}

/**
 * Create default geofence from delivery location
 */
export function createDefaultGeofence(lat: number, lng: number): GeofenceConfig {
    return {
        centerLat: lat,
        centerLng: lng,
        radiusMeters: CONFIG.DEFAULT_GEOFENCE_RADIUS_M,
    };
}

/**
 * Expand geofence radius (within limits)
 */
export function expandGeofence(
    geofence: GeofenceConfig,
    newRadiusMeters: number
): GeofenceConfig {
    const clampedRadius = Math.max(
        CONFIG.MIN_GEOFENCE_RADIUS_M,
        Math.min(newRadiusMeters, CONFIG.MAX_GEOFENCE_RADIUS_M)
    );
    
    return {
        ...geofence,
        radiusMeters: clampedRadius,
    };
}

// ==================== Address Update Functions ====================

/**
 * Initialize address update request
 */
export function createAddressUpdateRequest(
    deliveryId: string,
    source: AddressUpdateSource,
    originalAddress: AddressData,
    updatedAddress: AddressData,
    reason: string
): AddressUpdateRequest {
    return {
        deliveryId,
        source,
        originalAddress,
        updatedAddress,
        reason,
        requestedAt: Date.now(),
    };
}

/**
 * Validate address update request
 */
export function validateAddressUpdateRequest(
    request: AddressUpdateRequest
): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check required fields
    if (!request.deliveryId) {
        errors.push('Delivery ID is required');
    }
    
    if (!request.updatedAddress.address) {
        errors.push('New address is required');
    }
    
    // Validate coordinates
    if (!isValidCoordinate(request.updatedAddress.latitude, 'lat')) {
        errors.push('Invalid latitude');
    }
    
    if (!isValidCoordinate(request.updatedAddress.longitude, 'lng')) {
        errors.push('Invalid longitude');
    }
    
    // Check distance limit
    const distance = calculateDistanceMeters(
        request.originalAddress.latitude,
        request.originalAddress.longitude,
        request.updatedAddress.latitude,
        request.updatedAddress.longitude
    );
    
    if (distance > CONFIG.MAX_ADDRESS_UPDATE_DISTANCE_M) {
        errors.push(`Address update too far (${Math.round(distance)}m > ${CONFIG.MAX_ADDRESS_UPDATE_DISTANCE_M}m limit)`);
    }
    
    // Reason required
    if (!request.reason || request.reason.length < 5) {
        errors.push('Please provide a reason for the address update');
    }
    
    return {
        isValid: errors.length === 0,
        errors,
    };
}

function isValidCoordinate(value: number, type: 'lat' | 'lng'): boolean {
    if (typeof value !== 'number' || isNaN(value)) return false;
    if (type === 'lat') return value >= -90 && value <= 90;
    return value >= -180 && value <= 180;
}

/**
 * Check if address can be updated (cooldown check)
 */
export function canUpdateAddress(lastUpdateTime: number | null, currentTime: number): boolean {
    if (!lastUpdateTime) return true;
    return (currentTime - lastUpdateTime) >= CONFIG.ADDRESS_UPDATE_COOLDOWN_MS;
}

/**
 * Get time until next address update is allowed
 */
export function getAddressUpdateCooldownRemaining(
    lastUpdateTime: number | null,
    currentTime: number
): number {
    if (!lastUpdateTime) return 0;
    const elapsed = currentTime - lastUpdateTime;
    if (elapsed >= CONFIG.ADDRESS_UPDATE_COOLDOWN_MS) return 0;
    return CONFIG.ADDRESS_UPDATE_COOLDOWN_MS - elapsed;
}

// ==================== Firebase Functions ====================

/**
 * Submit address update request to Firebase
 */
export async function submitAddressUpdate(request: AddressUpdateRequest): Promise<boolean> {
    const db = getFirebaseDatabase();
    const updateRef = ref(db, `deliveries/${request.deliveryId}/address_update`);
    
    try {
        await set(updateRef, {
            ...request,
            status: request.source === 'RIDER' ? 'PENDING_APPROVAL' : 'PENDING',
            submittedAt: serverTimestamp(),
        });
        return true;
    } catch (error) {
        console.error('[EC-12] Failed to submit address update:', error);
        return false;
    }
}

/**
 * Approve address update (admin action)
 */
export async function approveAddressUpdate(
    deliveryId: string,
    approvedBy: string
): Promise<boolean> {
    const db = getFirebaseDatabase();
    const updateRef = ref(db, `deliveries/${deliveryId}/address_update`);
    
    try {
        await set(updateRef, {
            status: 'APPROVED',
            approvedAt: serverTimestamp(),
            approvedBy,
        });
        return true;
    } catch (error) {
        console.error('[EC-12] Failed to approve address update:', error);
        return false;
    }
}

/**
 * Update delivery geofence in Firebase
 */
export async function updateDeliveryGeofence(
    deliveryId: string,
    geofence: GeofenceConfig,
    reason: string
): Promise<boolean> {
    const db = getFirebaseDatabase();
    const geofenceRef = ref(db, `deliveries/${deliveryId}/geofence`);
    
    try {
        await set(geofenceRef, {
            ...geofence,
            reason,
            updatedAt: serverTimestamp(),
        });
        return true;
    } catch (error) {
        console.error('[EC-12] Failed to update geofence:', error);
        return false;
    }
}

/**
 * Subscribe to address update status
 */
export function subscribeToAddressUpdate(
    deliveryId: string,
    callback: (update: AddressUpdateRequest | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const updateRef = ref(db, `deliveries/${deliveryId}/address_update`);
    
    onValue(updateRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as AddressUpdateRequest | null);
    });
    
    return () => off(updateRef);
}

/**
 * Subscribe to geofence config
 */
export function subscribeToGeofence(
    deliveryId: string,
    callback: (geofence: GeofenceConfig | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const geofenceRef = ref(db, `deliveries/${deliveryId}/geofence`);
    
    onValue(geofenceRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as GeofenceConfig | null);
    });
    
    return () => off(geofenceRef);
}
