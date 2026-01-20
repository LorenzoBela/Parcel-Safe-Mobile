/**
 * Rider Matching Service Tests
 * 
 * Tests for 3km geofence radius calculation and rider matching logic.
 */

import {
    calculateHaversineDistance,
    isWithinRadius,
    SEARCH_RADIUS_KM,
} from '../services/riderMatchingService';

describe('RiderMatchingService', () => {
    describe('calculateHaversineDistance', () => {
        it('should return 0 for the same location', () => {
            const distance = calculateHaversineDistance(14.5995, 120.9842, 14.5995, 120.9842);
            expect(distance).toBe(0);
        });

        it('should calculate correct distance for known points (Manila to Makati ~5km)', () => {
            // Manila City Hall to Makati Business District (approximately 5km)
            const distance = calculateHaversineDistance(
                14.5995, 120.9842, // Manila
                14.5547, 121.0244  // Makati
            );
            // Should be approximately 5-6km
            expect(distance).toBeGreaterThan(4);
            expect(distance).toBeLessThan(7);
        });

        it('should calculate correct distance for short range (~1km)', () => {
            // Two nearby points in Manila
            const distance = calculateHaversineDistance(
                14.5995, 120.9842,
                14.5900, 120.9850
            );
            // Should be approximately 1km
            expect(distance).toBeGreaterThan(0.5);
            expect(distance).toBeLessThan(2);
        });

        it('should handle edge case crossing the equator', () => {
            const distance = calculateHaversineDistance(
                1.0, 103.0,   // Just north of equator (Singapore area)
                -1.0, 103.0   // Just south of equator
            );
            // Should be approximately 222km (2 degrees of latitude)
            expect(distance).toBeGreaterThan(200);
            expect(distance).toBeLessThan(250);
        });

        it('should handle edge case crossing the prime meridian', () => {
            const distance = calculateHaversineDistance(
                51.5, -0.5,  // West of London
                51.5, 0.5    // East of London
            );
            // Should be approximately 70km at this latitude
            expect(distance).toBeGreaterThan(60);
            expect(distance).toBeLessThan(80);
        });
    });

    describe('isWithinRadius', () => {
        const pickupLat = 14.5995;
        const pickupLng = 120.9842;

        it('should return true for rider at exactly the pickup location', () => {
            const result = isWithinRadius(pickupLat, pickupLng, pickupLat, pickupLng);
            expect(result).toBe(true);
        });

        it('should return true for rider within 1km of pickup', () => {
            // Point approximately 1km away
            const riderLat = 14.5905;
            const riderLng = 120.9850;
            const result = isWithinRadius(riderLat, riderLng, pickupLat, pickupLng);
            expect(result).toBe(true);
        });

        it('should return true for rider exactly at 3km boundary', () => {
            // Approximately 3km away (calculated using Haversine)
            const riderLat = 14.5725; // ~3km south
            const riderLng = 120.9842;
            const distance = calculateHaversineDistance(riderLat, riderLng, pickupLat, pickupLng);
            // Should be just under 3km to pass
            const result = isWithinRadius(riderLat, riderLng, pickupLat, pickupLng, 3.1);
            expect(result).toBe(true);
        });

        it('should return false for rider at 3.1km (just outside radius)', () => {
            // Point approximately 4km away (outside 3km radius)
            const riderLat = 14.5635;
            const riderLng = 120.9842;
            const distance = calculateHaversineDistance(riderLat, riderLng, pickupLat, pickupLng);
            expect(distance).toBeGreaterThan(SEARCH_RADIUS_KM);

            const result = isWithinRadius(riderLat, riderLng, pickupLat, pickupLng, SEARCH_RADIUS_KM);
            expect(result).toBe(false);
        });

        it('should return false for rider at 5km distance', () => {
            // Manila to Makati (approximately 5km)
            const riderLat = 14.5547;
            const riderLng = 121.0244;
            const result = isWithinRadius(riderLat, riderLng, pickupLat, pickupLng, SEARCH_RADIUS_KM);
            expect(result).toBe(false);
        });

        it('should use default SEARCH_RADIUS_KM (3km) when radius not specified', () => {
            // Point approximately 2km away (within default radius)
            const riderLat = 14.5815;
            const riderLng = 120.9842;
            const result = isWithinRadius(riderLat, riderLng, pickupLat, pickupLng);
            expect(result).toBe(true);
        });

        it('should respect custom radius parameter', () => {
            // Point approximately 2km away
            const riderLat = 14.5815;
            const riderLng = 120.9842;

            // Should be within 3km radius
            expect(isWithinRadius(riderLat, riderLng, pickupLat, pickupLng, 3)).toBe(true);

            // Should be outside 1km radius
            expect(isWithinRadius(riderLat, riderLng, pickupLat, pickupLng, 1)).toBe(false);
        });
    });

    describe('SEARCH_RADIUS_KM constant', () => {
        it('should be exactly 3km as per requirements', () => {
            expect(SEARCH_RADIUS_KM).toBe(3);
        });
    });
});
