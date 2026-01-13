/**
 * EC-68: Address Type & Geofence Tests (Mobile)
 * 
 * Tests for residential vs business address type selection,
 * geofence sizing, and business address validation.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import {
    CONFIG,
    AddressType,
    AddressData,
    AddressUpdateRequest,
    getGeofenceRadiusForAddressType,
    createGeofenceForAddressType,
    validateBusinessAddress,
    suggestAddressType,
    getAddressTypeLabel,
    getAddressTypeDescription,
    needsBusinessDetails,
    validateAddressWithType,
    formatAddressWithDetails,
} from '../services/addressUpdateService';

// ============ Test Data Factories ============

function createAddressData(overrides: Partial<AddressData> = {}): AddressData {
    return {
        address: '123 Test Street, Manila',
        latitude: 14.5995,
        longitude: 120.9842,
        ...overrides,
    };
}

function createAddressUpdateRequest(overrides: Partial<AddressUpdateRequest> = {}): AddressUpdateRequest {
    return {
        deliveryId: 'delivery-123',
        source: 'CUSTOMER',
        originalAddress: createAddressData(),
        updatedAddress: createAddressData({ address: '456 New Street, Manila' }),
        reason: 'Wrong address entered',
        requestedAt: Date.now(),
        ...overrides,
    };
}

// ============ EC-68: Geofence Radius Tests ============

describe('EC-68: getGeofenceRadiusForAddressType (Mobile)', () => {
    it('should return 50m for RESIDENTIAL addresses', () => {
        expect(getGeofenceRadiusForAddressType('RESIDENTIAL')).toBe(CONFIG.RESIDENTIAL_GEOFENCE_RADIUS_M);
        expect(getGeofenceRadiusForAddressType('RESIDENTIAL')).toBe(50);
    });

    it('should return 100m for BUSINESS addresses', () => {
        expect(getGeofenceRadiusForAddressType('BUSINESS')).toBe(CONFIG.BUSINESS_GEOFENCE_RADIUS_M);
        expect(getGeofenceRadiusForAddressType('BUSINESS')).toBe(100);
    });

    it('should return 50m for OTHER addresses', () => {
        expect(getGeofenceRadiusForAddressType('OTHER')).toBe(CONFIG.OTHER_GEOFENCE_RADIUS_M);
        expect(getGeofenceRadiusForAddressType('OTHER')).toBe(50);
    });

    it('should return default (50m) for unknown type', () => {
        expect(getGeofenceRadiusForAddressType('UNKNOWN' as AddressType)).toBe(50);
    });

    it('should have BUSINESS radius larger than RESIDENTIAL', () => {
        expect(getGeofenceRadiusForAddressType('BUSINESS')).toBeGreaterThan(
            getGeofenceRadiusForAddressType('RESIDENTIAL')
        );
    });
});

// ============ EC-68: Create Geofence Tests ============

describe('EC-68: createGeofenceForAddressType (Mobile)', () => {
    const testLat = 14.5995;
    const testLng = 120.9842;

    it('should create geofence with RESIDENTIAL radius', () => {
        const geofence = createGeofenceForAddressType(testLat, testLng, 'RESIDENTIAL');
        
        expect(geofence.centerLat).toBe(testLat);
        expect(geofence.centerLng).toBe(testLng);
        expect(geofence.radiusMeters).toBe(CONFIG.RESIDENTIAL_GEOFENCE_RADIUS_M);
    });

    it('should create geofence with BUSINESS radius', () => {
        const geofence = createGeofenceForAddressType(testLat, testLng, 'BUSINESS');
        
        expect(geofence.radiusMeters).toBe(CONFIG.BUSINESS_GEOFENCE_RADIUS_M);
    });

    it('should create geofence with OTHER radius', () => {
        const geofence = createGeofenceForAddressType(testLat, testLng, 'OTHER');
        
        expect(geofence.radiusMeters).toBe(CONFIG.OTHER_GEOFENCE_RADIUS_M);
    });

    it('should preserve exact coordinates', () => {
        const preciseCoords = { lat: 14.599512345, lng: 120.984298765 };
        const geofence = createGeofenceForAddressType(preciseCoords.lat, preciseCoords.lng, 'RESIDENTIAL');
        
        expect(geofence.centerLat).toBe(preciseCoords.lat);
        expect(geofence.centerLng).toBe(preciseCoords.lng);
    });
});

// ============ EC-68: Business Address Validation Tests ============

describe('EC-68: validateBusinessAddress (Mobile)', () => {
    it('should pass for RESIDENTIAL addresses without additional details', () => {
        const address = createAddressData({ addressType: 'RESIDENTIAL' });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should pass for OTHER addresses without additional details', () => {
        const address = createAddressData({ addressType: 'OTHER' });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(true);
    });

    it('should pass for BUSINESS with valid building name', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'RCBC Plaza',
        });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(true);
    });

    it('should pass for BUSINESS with valid unit number', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            unitNumber: '1205',
        });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(true);
    });

    it('should pass for BUSINESS with both building name and unit', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'GT Tower',
            unitNumber: '25F',
        });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(true);
    });

    it('should fail for BUSINESS without building name or unit number', () => {
        const address = createAddressData({ addressType: 'BUSINESS' });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('building name or unit number');
    });

    it('should fail for BUSINESS with empty strings', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: '',
            unitNumber: '',
        });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(false);
    });

    it('should fail for BUSINESS with building name below minimum length', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'A', // 1 char, minimum is 2
        });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(false);
    });

    it('should pass for BUSINESS with building name at minimum length', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'GT', // Exactly 2 chars
        });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(true);
    });

    it('should pass for BUSINESS with unit number at minimum length', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            unitNumber: '1', // Exactly 1 char
        });
        const result = validateBusinessAddress(address);
        
        expect(result.isValid).toBe(true);
    });
});

// ============ EC-68: Suggest Address Type Tests ============

describe('EC-68: suggestAddressType (Mobile)', () => {
    it('should suggest RESIDENTIAL for typical home addresses', () => {
        expect(suggestAddressType('123 Main Street, Makati')).toBe('RESIDENTIAL');
        expect(suggestAddressType('456 Sunset Boulevard, QC')).toBe('RESIDENTIAL');
        expect(suggestAddressType('Lot 5 Block 3, Subdivision')).toBe('RESIDENTIAL');
    });

    it('should suggest BUSINESS for addresses with "Building"', () => {
        expect(suggestAddressType('RCBC Building, Makati')).toBe('BUSINESS');
        expect(suggestAddressType('building 123 Ayala')).toBe('BUSINESS');
    });

    it('should suggest BUSINESS for addresses with "Tower"', () => {
        expect(suggestAddressType('GT Tower, Ayala Avenue')).toBe('BUSINESS');
        expect(suggestAddressType('twin tower manila')).toBe('BUSINESS');
    });

    it('should suggest BUSINESS for addresses with "Office"', () => {
        expect(suggestAddressType('Head Office, Ortigas')).toBe('BUSINESS');
    });

    it('should suggest BUSINESS for addresses with "Center" or "Centre"', () => {
        expect(suggestAddressType('SM City Center, Pasig')).toBe('BUSINESS');
        expect(suggestAddressType('Business Centre, BGC')).toBe('BUSINESS');
    });

    it('should suggest BUSINESS for addresses with "Unit" or "Suite"', () => {
        expect(suggestAddressType('Unit 1205, Some Address')).toBe('BUSINESS');
        expect(suggestAddressType('Suite 500, Building X')).toBe('BUSINESS');
    });

    it('should suggest BUSINESS for addresses with "Floor" or "Level"', () => {
        expect(suggestAddressType('5th Floor, Makati Building')).toBe('BUSINESS');
        expect(suggestAddressType('Level 10, Tower 1')).toBe('BUSINESS');
    });

    it('should be case-insensitive', () => {
        expect(suggestAddressType('ABC BUILDING')).toBe('BUSINESS');
        expect(suggestAddressType('abc building')).toBe('BUSINESS');
        expect(suggestAddressType('Abc Building')).toBe('BUSINESS');
    });
});

// ============ EC-68: Address Type Labels Tests ============

describe('EC-68: getAddressTypeLabel (Mobile)', () => {
    it('should return correct display labels', () => {
        expect(getAddressTypeLabel('RESIDENTIAL')).toBe('Residential Address');
        expect(getAddressTypeLabel('BUSINESS')).toBe('Business/Commercial');
        expect(getAddressTypeLabel('OTHER')).toBe('Other');
    });

    it('should return Unknown for invalid type', () => {
        expect(getAddressTypeLabel('INVALID' as AddressType)).toBe('Unknown');
    });
});

describe('EC-68: getAddressTypeDescription (Mobile)', () => {
    it('should include geofence size for RESIDENTIAL', () => {
        const description = getAddressTypeDescription('RESIDENTIAL');
        expect(description).toContain('50m');
    });

    it('should include geofence size for BUSINESS', () => {
        const description = getAddressTypeDescription('BUSINESS');
        expect(description).toContain('100m');
    });

    it('should include geofence size for OTHER', () => {
        const description = getAddressTypeDescription('OTHER');
        expect(description).toContain('50m');
    });
});

// ============ EC-68: Needs Business Details Tests ============

describe('EC-68: needsBusinessDetails (Mobile)', () => {
    it('should return false for RESIDENTIAL', () => {
        const address = createAddressData({ addressType: 'RESIDENTIAL' });
        expect(needsBusinessDetails(address)).toBe(false);
    });

    it('should return false for OTHER', () => {
        const address = createAddressData({ addressType: 'OTHER' });
        expect(needsBusinessDetails(address)).toBe(false);
    });

    it('should return true for BUSINESS without any details', () => {
        const address = createAddressData({ addressType: 'BUSINESS' });
        expect(needsBusinessDetails(address)).toBe(true);
    });

    it('should return false for BUSINESS with building name', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'Test Tower',
        });
        expect(needsBusinessDetails(address)).toBe(false);
    });

    it('should return false for BUSINESS with unit number', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            unitNumber: '101',
        });
        expect(needsBusinessDetails(address)).toBe(false);
    });

    it('should return true for BUSINESS with short building name', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'A', // Too short
        });
        expect(needsBusinessDetails(address)).toBe(true);
    });

    it('should return false for BUSINESS with empty building but valid unit', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: '',
            unitNumber: '205',
        });
        expect(needsBusinessDetails(address)).toBe(false);
    });
});

// ============ EC-68: Format Address Tests ============

describe('EC-68: formatAddressWithDetails (Mobile)', () => {
    it('should return base address for RESIDENTIAL', () => {
        const address = createAddressData({ addressType: 'RESIDENTIAL' });
        expect(formatAddressWithDetails(address)).toBe('123 Test Street, Manila');
    });

    it('should prepend building name for BUSINESS', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'Pacific Star Building',
        });
        const formatted = formatAddressWithDetails(address);
        expect(formatted.startsWith('Pacific Star Building')).toBe(true);
    });

    it('should include floor for BUSINESS', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            floorNumber: '15',
        });
        const formatted = formatAddressWithDetails(address);
        expect(formatted).toContain('Floor 15');
    });

    it('should include unit for BUSINESS', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            unitNumber: '1502',
        });
        const formatted = formatAddressWithDetails(address);
        expect(formatted).toContain('Unit 1502');
    });

    it('should append landmark for any address type', () => {
        const address = createAddressData({
            addressType: 'RESIDENTIAL',
            landmark: 'Near Jollibee',
        });
        const formatted = formatAddressWithDetails(address);
        expect(formatted).toContain('(Near: Near Jollibee)');
    });

    it('should format complete business address', () => {
        const address = createAddressData({
            addressType: 'BUSINESS',
            buildingName: 'Makati Tower',
            floorNumber: '20',
            unitNumber: '2005',
            landmark: 'Across McDonald\'s',
        });
        const formatted = formatAddressWithDetails(address);
        
        expect(formatted).toContain('Makati Tower');
        expect(formatted).toContain('Floor 20');
        expect(formatted).toContain('Unit 2005');
        expect(formatted).toContain('Near: Across McDonald\'s');
    });
});

// ============ EC-68: Configuration Tests ============

describe('EC-68: Configuration (Mobile)', () => {
    it('should have RESIDENTIAL geofence at 50m', () => {
        expect(CONFIG.RESIDENTIAL_GEOFENCE_RADIUS_M).toBe(50);
    });

    it('should have BUSINESS geofence at 100m', () => {
        expect(CONFIG.BUSINESS_GEOFENCE_RADIUS_M).toBe(100);
    });

    it('should have OTHER geofence at 50m', () => {
        expect(CONFIG.OTHER_GEOFENCE_RADIUS_M).toBe(50);
    });

    it('should have MAX geofence at 200m', () => {
        expect(CONFIG.MAX_GEOFENCE_RADIUS_M).toBe(200);
    });

    it('should have minimum building name length of 2', () => {
        expect(CONFIG.MIN_BUILDING_NAME_LENGTH).toBe(2);
    });

    it('should have minimum unit number length of 1', () => {
        expect(CONFIG.MIN_UNIT_NUMBER_LENGTH).toBe(1);
    });

    it('should ensure BUSINESS radius does not exceed MAX', () => {
        expect(CONFIG.BUSINESS_GEOFENCE_RADIUS_M).toBeLessThanOrEqual(CONFIG.MAX_GEOFENCE_RADIUS_M);
    });
});

// ============ EC-68: Integration Tests ============

describe('EC-68: Address Type Integration', () => {
    it('should handle full business address workflow', () => {
        // 1. Suggest type based on address string
        const addressString = 'RCBC Plaza, Ayala Avenue, Makati';
        const suggestedType = suggestAddressType(addressString);
        expect(suggestedType).toBe('BUSINESS');
        
        // 2. Create address with type
        const address = createAddressData({
            address: addressString,
            addressType: suggestedType,
        });
        
        // 3. Check if needs details
        expect(needsBusinessDetails(address)).toBe(true);
        
        // 4. Add required details
        address.buildingName = 'RCBC Plaza';
        address.floorNumber = '25';
        address.unitNumber = '2501';
        
        // 5. Validate
        const validation = validateBusinessAddress(address);
        expect(validation.isValid).toBe(true);
        
        // 6. Create appropriate geofence
        const geofence = createGeofenceForAddressType(
            address.latitude, address.longitude, suggestedType
        );
        expect(geofence.radiusMeters).toBe(100);
        
        // 7. Format for display
        const formatted = formatAddressWithDetails(address);
        expect(formatted).toContain('RCBC Plaza');
        expect(formatted).toContain('Floor 25');
        expect(formatted).toContain('Unit 2501');
    });

    it('should handle residential address workflow', () => {
        // 1. Suggest type based on address string
        const addressString = '123 Marikina Heights, QC';
        const suggestedType = suggestAddressType(addressString);
        expect(suggestedType).toBe('RESIDENTIAL');
        
        // 2. Create address with type
        const address = createAddressData({
            address: addressString,
            addressType: suggestedType,
            landmark: 'Near barangay hall',
        });
        
        // 3. No business details needed
        expect(needsBusinessDetails(address)).toBe(false);
        
        // 4. Validate (should pass)
        const validation = validateBusinessAddress(address);
        expect(validation.isValid).toBe(true);
        
        // 5. Create appropriate geofence
        const geofence = createGeofenceForAddressType(
            address.latitude, address.longitude, suggestedType
        );
        expect(geofence.radiusMeters).toBe(50);
        
        // 6. Format for display
        const formatted = formatAddressWithDetails(address);
        expect(formatted).toContain('123 Marikina Heights');
        expect(formatted).toContain('Near: Near barangay hall');
    });
});
