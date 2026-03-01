/**
 * Geofence & Distance Utilities
 *
 * Extracted from the removed addressUpdateService.
 * Provides core geofence check and Haversine distance calculation
 * used by ArrivalScreen for arrival verification.
 */

// ==================== Types ====================

export interface GeofenceConfig {
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
}

export interface GeofenceResult {
    isInside: boolean;
    distanceMeters: number;
}

// ==================== Configuration ====================

/** Default geofence radius (meters) */
const DEFAULT_GEOFENCE_RADIUS_M = 50;

// ==================== Helpers ====================

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Calculate distance between two coordinates (Haversine formula)
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

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Create a default geofence centered on the given coordinates
 */
export function createDefaultGeofence(
    lat: number,
    lng: number,
    radiusMeters: number = DEFAULT_GEOFENCE_RADIUS_M
): GeofenceConfig {
    return {
        centerLat: lat,
        centerLng: lng,
        radiusMeters,
    };
}

/**
 * Check if a position is within the geofence
 */
export function checkGeofence(
    position: { lat: number; lng: number; accuracy?: number },
    geofence: GeofenceConfig
): GeofenceResult {
    const distance = calculateDistanceMeters(
        position.lat,
        position.lng,
        geofence.centerLat,
        geofence.centerLng
    );

    // Account for GPS accuracy — if the reported accuracy circle
    // overlaps the geofence, treat as inside.
    const effectiveDistance = Math.max(0, distance - (position.accuracy || 0));

    return {
        isInside: effectiveDistance <= geofence.radiusMeters,
        distanceMeters: Math.round(distance),
    };
}
