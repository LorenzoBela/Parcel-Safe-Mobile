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
 * 
 * EC-68: Residential vs Business Address Handling
 * - Address type field: RESIDENTIAL, BUSINESS, OTHER
 * - Dynamic geofence sizing based on address type
 * - Building name/unit prompt for business addresses
 */

import { getFirebaseDatabase, serverTimestamp, ref, set, onValue, off } from './firebaseClient';

// ==================== Configuration ====================

export const CONFIG = {
    /** Default geofence radius (meters) - used for RESIDENTIAL */
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
    
    // ==================== EC-68: Address Type Configuration ====================
    
    /** EC-68: Geofence radius for residential addresses (meters) */
    RESIDENTIAL_GEOFENCE_RADIUS_M: 50,
    
    /** EC-68: Geofence radius for business addresses (meters) */
    BUSINESS_GEOFENCE_RADIUS_M: 100,
    
    /** EC-68: Geofence radius for other/unspecified addresses (meters) */
    OTHER_GEOFENCE_RADIUS_M: 50,
    
    /** EC-68: Minimum building name length for business addresses */
    MIN_BUILDING_NAME_LENGTH: 2,
    
    /** EC-68: Minimum unit number length */
    MIN_UNIT_NUMBER_LENGTH: 1,
};

// ==================== Types ====================

export type AddressUpdateSource = 'RIDER' | 'CUSTOMER' | 'ADMIN';

// EC-68: Address type for residential vs business disambiguation
export type AddressType = 'RESIDENTIAL' | 'BUSINESS' | 'OTHER';

export interface AddressData {
    address: string;
    latitude: number;
    longitude: number;
    notes?: string;
    landmark?: string;
    // EC-68: Address type fields
    addressType?: AddressType;
    buildingName?: string;
    unitNumber?: string;
    floorNumber?: string;
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

// ==================== EC-68: Address Type Functions ====================

/**
 * EC-68: Get default geofence radius based on address type
 * 
 * - RESIDENTIAL: 50m (standard home delivery)
 * - BUSINESS: 100m (larger complexes, multiple entrances)
 * - OTHER: 50m (default fallback)
 */
export function getGeofenceRadiusForAddressType(addressType: AddressType): number {
    switch (addressType) {
        case 'RESIDENTIAL':
            return CONFIG.RESIDENTIAL_GEOFENCE_RADIUS_M;
        case 'BUSINESS':
            return CONFIG.BUSINESS_GEOFENCE_RADIUS_M;
        case 'OTHER':
        default:
            return CONFIG.OTHER_GEOFENCE_RADIUS_M;
    }
}

/**
 * EC-68: Create geofence with address type awareness
 */
export function createGeofenceForAddressType(
    lat: number, 
    lng: number, 
    addressType: AddressType
): GeofenceConfig {
    return {
        centerLat: lat,
        centerLng: lng,
        radiusMeters: getGeofenceRadiusForAddressType(addressType),
    };
}

/**
 * EC-68: Validate business address has required details
 * Business addresses require either building name OR unit number
 */
export function validateBusinessAddress(address: AddressData): {
    isValid: boolean;
    errors: string[];
} {
    const errors: string[] = [];
    
    if (address.addressType !== 'BUSINESS') {
        // Not a business address, no additional validation needed
        return { isValid: true, errors: [] };
    }
    
    // Business addresses require building name or unit number
    const hasBuildingName = address.buildingName && 
        address.buildingName.length >= CONFIG.MIN_BUILDING_NAME_LENGTH;
    const hasUnitNumber = address.unitNumber && 
        address.unitNumber.length >= CONFIG.MIN_UNIT_NUMBER_LENGTH;
    
    if (!hasBuildingName && !hasUnitNumber) {
        errors.push('Business addresses require a building name or unit number');
    }
    
    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * EC-68: Determine address type from address string (heuristic)
 * 
 * Uses common patterns to suggest address type:
 * - Contains "Building", "Tower", "Plaza", "Mall", "Office" -> BUSINESS
 * - Contains "Unit", "Suite", "Floor" -> BUSINESS
 * - Default -> RESIDENTIAL
 */
export function suggestAddressType(addressString: string): AddressType {
    const lowerAddress = addressString.toLowerCase();
    
    // Business indicators
    const businessKeywords = [
        'building', 'tower', 'plaza', 'mall', 'office',
        'center', 'centre', 'corporate', 'business',
        'industrial', 'commercial', 'warehouse',
        'unit', 'suite', 'floor', 'level',
        'company', 'corp', 'inc', 'ltd',
    ];
    
    for (const keyword of businessKeywords) {
        if (lowerAddress.includes(keyword)) {
            return 'BUSINESS';
        }
    }
    
    return 'RESIDENTIAL';
}

/**
 * EC-68: Get address type display label
 */
export function getAddressTypeLabel(addressType: AddressType): string {
    switch (addressType) {
        case 'RESIDENTIAL':
            return 'Residential Address';
        case 'BUSINESS':
            return 'Business/Commercial';
        case 'OTHER':
            return 'Other';
        default:
            return 'Unknown';
    }
}

/**
 * EC-68: Get address type description for UI
 */
export function getAddressTypeDescription(addressType: AddressType): string {
    switch (addressType) {
        case 'RESIDENTIAL':
            return 'Home or apartment delivery (50m geofence)';
        case 'BUSINESS':
            return 'Office, building, or commercial location (100m geofence)';
        case 'OTHER':
            return 'Other location type (50m geofence)';
        default:
            return '';
    }
}

/**
 * EC-68: Check if address needs business details prompt
 */
export function needsBusinessDetails(address: AddressData): boolean {
    if (address.addressType !== 'BUSINESS') {
        return false;
    }
    
    const hasBuildingName = address.buildingName && 
        address.buildingName.length >= CONFIG.MIN_BUILDING_NAME_LENGTH;
    const hasUnitNumber = address.unitNumber && 
        address.unitNumber.length >= CONFIG.MIN_UNIT_NUMBER_LENGTH;
    
    return !hasBuildingName && !hasUnitNumber;
}

/**
 * EC-68: Extended address validation including address type
 */
export function validateAddressWithType(
    request: AddressUpdateRequest
): { isValid: boolean; errors: string[] } {
    // First run standard validation
    const standardValidation = validateAddressUpdateRequest(request);
    if (!standardValidation.isValid) {
        return standardValidation;
    }
    
    // Then validate business-specific requirements
    const businessValidation = validateBusinessAddress(request.updatedAddress);
    if (!businessValidation.isValid) {
        return businessValidation;
    }
    
    return { isValid: true, errors: [] };
}

/**
 * EC-68: Format address with type and details
 */
export function formatAddressWithDetails(address: AddressData): string {
    let formatted = address.address;
    
    if (address.addressType === 'BUSINESS') {
        const details: string[] = [];
        
        if (address.buildingName) {
            details.push(address.buildingName);
        }
        if (address.floorNumber) {
            details.push(`Floor ${address.floorNumber}`);
        }
        if (address.unitNumber) {
            details.push(`Unit ${address.unitNumber}`);
        }
        
        if (details.length > 0) {
            formatted = `${details.join(', ')}, ${formatted}`;
        }
    }
    
    if (address.landmark) {
        formatted += ` (Near: ${address.landmark})`;
    }
    
    return formatted;
}
