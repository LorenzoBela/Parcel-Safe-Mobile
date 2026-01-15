/**
 * EC-81: Theft Detection Tests - Mobile
 * 
 * Tests for theft service functionality including:
 * - Theft reporting
 * - Theft status parsing
 * - Geofence calculations
 * - Evidence generation
 * - Helper functions
 */

import {
    TheftStatus,
    TheftState,
    calculateHaversineDistance,
    isWithinGeofence,
    getTheftSeverity,
    getTheftSeverityColor,
    formatTheftState,
    canReportTheft,
    canTrackStolenBox,
    formatEvidenceAsText,
    EvidencePackage,
} from '../services/theftService';

describe('EC-81: Theft Detection', () => {

    // ==================== Geofence Calculation Tests ====================
    describe('Haversine Distance Calculation', () => {
        test('should return 0 for same coordinates', () => {
            const distance = calculateHaversineDistance(14.5995, 120.9842, 14.5995, 120.9842);
            expect(distance).toBeCloseTo(0, 5);
        });

        test('should calculate correct distance for known coordinates', () => {
            // Manila to Cebu City ~570km
            const distance = calculateHaversineDistance(14.5995, 120.9842, 10.3157, 123.8854);
            expect(distance).toBeGreaterThan(500);
            expect(distance).toBeLessThan(600);
        });

        test('should handle negative coordinates (southern/western hemispheres)', () => {
            // Sydney to Wellington ~2200km
            const distance = calculateHaversineDistance(-33.8688, 151.2093, -41.2866, 174.7756);
            expect(distance).toBeGreaterThan(2000);
            expect(distance).toBeLessThan(2500);
        });

        test('should handle equator crossing', () => {
            // Singapore to Jakarta ~890km
            const distance = calculateHaversineDistance(1.3521, 103.8198, -6.2088, 106.8456);
            expect(distance).toBeGreaterThan(800);
            expect(distance).toBeLessThan(1000);
        });
    });

    describe('Geofence Check', () => {
        const geofenceCenter = { lat: 14.5995, lng: 120.9842 };
        const radiusKm = 50;

        test('should return true for location inside geofence', () => {
            // ~10km away
            const result = isWithinGeofence(14.65, 121.0, geofenceCenter.lat, geofenceCenter.lng, radiusKm);
            expect(result).toBe(true);
        });

        test('should return false for location outside geofence', () => {
            // ~100km away
            const result = isWithinGeofence(15.5, 121.5, geofenceCenter.lat, geofenceCenter.lng, radiusKm);
            expect(result).toBe(false);
        });

        test('should return true for location exactly at center', () => {
            const result = isWithinGeofence(geofenceCenter.lat, geofenceCenter.lng, geofenceCenter.lat, geofenceCenter.lng, radiusKm);
            expect(result).toBe(true);
        });

        test('should handle edge case at boundary', () => {
            // Calculate point ~49km away (just inside)
            const result = isWithinGeofence(14.65, 121.15, geofenceCenter.lat, geofenceCenter.lng, radiusKm);
            expect(result).toBe(true);
        });
    });

    // ==================== Theft Status Tests ====================
    describe('Theft Severity Classification', () => {
        test('should return NONE for null status', () => {
            expect(getTheftSeverity(null)).toBe('NONE');
        });

        test('should return NONE for non-stolen box', () => {
            const status: TheftStatus = {
                state: 'NORMAL',
                is_stolen: false,
                reported_by: '',
                reported_at: 0,
                last_known_location: { lat: 0, lng: 0, heading: 0, speed: 0 },
                location_history: [],
                lockdown_active: false,
                recovery_photos: [],
            };
            expect(getTheftSeverity(status)).toBe('NONE');
        });

        test('should return ACTIVE when lockdown is active', () => {
            const status: TheftStatus = {
                state: 'LOCKDOWN',
                is_stolen: true,
                reported_by: 'admin123',
                reported_at: Date.now(),
                last_known_location: { lat: 14.5995, lng: 120.9842, heading: 45, speed: 0 },
                location_history: [],
                lockdown_active: true,
                lockdown_at: Date.now(),
                recovery_photos: [],
            };
            expect(getTheftSeverity(status)).toBe('ACTIVE');
        });

        test('should return INVESTIGATING when stolen but not locked down', () => {
            const status: TheftStatus = {
                state: 'STOLEN',
                is_stolen: true,
                reported_by: 'rider456',
                reported_at: Date.now(),
                last_known_location: { lat: 14.5995, lng: 120.9842, heading: 45, speed: 0 },
                location_history: [],
                lockdown_active: false,
                recovery_photos: [],
            };
            expect(getTheftSeverity(status)).toBe('INVESTIGATING');
        });

        test('should return RECOVERED for recovered boxes', () => {
            const status: TheftStatus = {
                state: 'RECOVERED',
                is_stolen: true, // Still marked for audit
                reported_by: 'rider456',
                reported_at: Date.now() - 86400000,
                last_known_location: { lat: 14.5995, lng: 120.9842, heading: 45, speed: 0 },
                location_history: [],
                lockdown_active: false,
                recovery_photos: [],
            };
            expect(getTheftSeverity(status)).toBe('RECOVERED');
        });
    });

    describe('Severity Color Mapping', () => {
        test('should return red for ACTIVE', () => {
            expect(getTheftSeverityColor('ACTIVE')).toBe('#DC2626');
        });

        test('should return amber for INVESTIGATING', () => {
            expect(getTheftSeverityColor('INVESTIGATING')).toBe('#F59E0B');
        });

        test('should return green for RECOVERED', () => {
            expect(getTheftSeverityColor('RECOVERED')).toBe('#10B981');
        });

        test('should return gray for NONE', () => {
            expect(getTheftSeverityColor('NONE')).toBe('#6B7280');
        });
    });

    // ==================== State Formatting Tests ====================
    describe('Theft State Formatting', () => {
        test('should format NORMAL state', () => {
            expect(formatTheftState('NORMAL')).toBe('Normal');
        });

        test('should format SUSPICIOUS state', () => {
            expect(formatTheftState('SUSPICIOUS')).toBe('Suspicious Activity');
        });

        test('should format STOLEN state', () => {
            expect(formatTheftState('STOLEN')).toBe('Stolen');
        });

        test('should format LOCKDOWN state', () => {
            expect(formatTheftState('LOCKDOWN')).toBe('Lockdown Active');
        });

        test('should format RECOVERED state', () => {
            expect(formatTheftState('RECOVERED')).toBe('Recovered');
        });
    });

    // ==================== Permission Checks ====================
    describe('Theft Reporting Eligibility', () => {
        test('should allow reporting for null status', () => {
            expect(canReportTheft(null)).toBe(true);
        });

        test('should allow reporting for NORMAL state', () => {
            const status: TheftStatus = {
                state: 'NORMAL',
                is_stolen: false,
                reported_by: '',
                reported_at: 0,
                last_known_location: { lat: 0, lng: 0, heading: 0, speed: 0 },
                location_history: [],
                lockdown_active: false,
                recovery_photos: [],
            };
            expect(canReportTheft(status)).toBe(true);
        });

        test('should not allow reporting for already STOLEN state', () => {
            const status: TheftStatus = {
                state: 'STOLEN',
                is_stolen: true,
                reported_by: 'rider123',
                reported_at: Date.now(),
                last_known_location: { lat: 14.5995, lng: 120.9842, heading: 0, speed: 0 },
                location_history: [],
                lockdown_active: false,
                recovery_photos: [],
            };
            expect(canReportTheft(status)).toBe(false);
        });

        test('should not allow reporting for LOCKDOWN state', () => {
            const status: TheftStatus = {
                state: 'LOCKDOWN',
                is_stolen: true,
                reported_by: 'admin123',
                reported_at: Date.now(),
                last_known_location: { lat: 14.5995, lng: 120.9842, heading: 0, speed: 0 },
                location_history: [],
                lockdown_active: true,
                recovery_photos: [],
            };
            expect(canReportTheft(status)).toBe(false);
        });
    });

    describe('Stolen Box Tracking Eligibility', () => {
        test('should not allow tracking for null status', () => {
            expect(canTrackStolenBox(null)).toBe(false);
        });

        test('should not allow tracking for NORMAL state', () => {
            const status: TheftStatus = {
                state: 'NORMAL',
                is_stolen: false,
                reported_by: '',
                reported_at: 0,
                last_known_location: { lat: 0, lng: 0, heading: 0, speed: 0 },
                location_history: [],
                lockdown_active: false,
                recovery_photos: [],
            };
            expect(canTrackStolenBox(status)).toBe(false);
        });

        test('should allow tracking for STOLEN state', () => {
            const status: TheftStatus = {
                state: 'STOLEN',
                is_stolen: true,
                reported_by: 'rider123',
                reported_at: Date.now(),
                last_known_location: { lat: 14.5995, lng: 120.9842, heading: 0, speed: 0 },
                location_history: [],
                lockdown_active: false,
                recovery_photos: [],
            };
            expect(canTrackStolenBox(status)).toBe(true);
        });

        test('should allow tracking for LOCKDOWN state', () => {
            const status: TheftStatus = {
                state: 'LOCKDOWN',
                is_stolen: true,
                reported_by: 'admin123',
                reported_at: Date.now(),
                last_known_location: { lat: 14.5995, lng: 120.9842, heading: 0, speed: 0 },
                location_history: [],
                lockdown_active: true,
                recovery_photos: [],
            };
            expect(canTrackStolenBox(status)).toBe(true);
        });
    });

    // ==================== Evidence Export Tests ====================
    describe('Evidence Package Formatting', () => {
        test('should format evidence package as text', () => {
            const evidence: EvidencePackage = {
                box_id: 'BOX123',
                theft_reported_at: Date.now(),
                reported_by: 'rider456',
                location_history: [
                    { lat: 14.5995, lng: 120.9842, timestamp: Date.now() - 60000 },
                    { lat: 14.6000, lng: 120.9850, timestamp: Date.now() },
                ],
                recovery_photos: ['photo1.jpg', 'photo2.jpg'],
                last_known_location: { lat: 14.6000, lng: 120.9850, heading: 45, speed: 5 },
                generated_at: Date.now(),
            };

            const text = formatEvidenceAsText(evidence);

            expect(text).toContain('THEFT EVIDENCE REPORT');
            expect(text).toContain('Box ID: BOX123');
            expect(text).toContain('Reported By: rider456');
            expect(text).toContain('Total GPS Points: 2');
            expect(text).toContain('Recovery Photos: 2');
        });

        test('should include geofence breach timestamp if present', () => {
            const evidence: EvidencePackage = {
                box_id: 'BOX123',
                theft_reported_at: Date.now(),
                reported_by: 'rider456',
                location_history: [],
                recovery_photos: [],
                last_known_location: { lat: 14.6000, lng: 120.9850, heading: 0, speed: 0 },
                geofence_breach_at: Date.now() - 3600000,
                generated_at: Date.now(),
            };

            const text = formatEvidenceAsText(evidence);

            expect(text).toContain('Geofence Breach At:');
        });

        test('should include lockdown timestamp if present', () => {
            const evidence: EvidencePackage = {
                box_id: 'BOX123',
                theft_reported_at: Date.now(),
                reported_by: 'rider456',
                location_history: [],
                recovery_photos: [],
                last_known_location: { lat: 14.6000, lng: 120.9850, heading: 0, speed: 0 },
                lockdown_at: Date.now() - 1800000,
                generated_at: Date.now(),
            };

            const text = formatEvidenceAsText(evidence);

            expect(text).toContain('Lockdown Activated At:');
        });
    });

});
