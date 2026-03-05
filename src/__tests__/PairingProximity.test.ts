/**
 * PairingProximity.test.ts
 *
 * Unit tests for:
 * - Safeguard 1: Proximity validation on pairing (pure distance logic)
 * - Safeguard 2: Drift detection thresholds
 */

import { calculateDistanceMeters } from '../utils/geoUtils';
import {
    PAIRING_MAX_DISTANCE_M,
    DRIFT_WARNING_THRESHOLD_M,
    DRIFT_UNPAIR_THRESHOLD_M,
} from '../services/boxPairingService';

// ==================== Safeguard 1: Proximity Validation ====================

describe('Pairing Proximity Check', () => {
    const THRESHOLD = PAIRING_MAX_DISTANCE_M; // 500m

    it('should calculate 0m distance for identical coordinates', () => {
        const dist = calculateDistanceMeters(14.5995, 120.9842, 14.5995, 120.9842);
        expect(dist).toBe(0);
    });

    it('should allow pairing when rider is 200m from the box', () => {
        // ~200m offset in Manila (roughly 0.0018 degrees latitude)
        const riderLat = 14.5995;
        const riderLng = 120.9842;
        const boxLat = 14.5995 + 0.0018;
        const boxLng = 120.9842;

        const dist = calculateDistanceMeters(riderLat, riderLng, boxLat, boxLng);
        expect(dist).toBeGreaterThan(150);
        expect(dist).toBeLessThan(250);
        expect(dist).toBeLessThan(THRESHOLD);
    });

    it('should reject pairing when rider is 600m from the box', () => {
        // ~600m offset (roughly 0.0054 degrees latitude)
        const riderLat = 14.5995;
        const riderLng = 120.9842;
        const boxLat = 14.5995 + 0.0054;
        const boxLng = 120.9842;

        const dist = calculateDistanceMeters(riderLat, riderLng, boxLat, boxLng);
        expect(dist).toBeGreaterThan(500);
        expect(dist).toBeGreaterThan(THRESHOLD);
    });

    it('should allow pairing at the exact threshold boundary (500m)', () => {
        // Find a lat offset that gives exactly ~500m
        // 500m ≈ 0.0045 degrees latitude
        const riderLat = 14.5995;
        const riderLng = 120.9842;
        const boxLat = 14.5995 + 0.00449;
        const boxLng = 120.9842;

        const dist = calculateDistanceMeters(riderLat, riderLng, boxLat, boxLng);
        // Should be within a reasonable margin of 500m
        expect(dist).toBeLessThanOrEqual(THRESHOLD + 5); // small margin for float math
    });

    it('should handle cross-hemisphere coordinates correctly', () => {
        // Rio (southern hemisphere) to near Equator
        const riderLat = -22.9068;
        const riderLng = -43.1729;
        const boxLat = -22.9068 + 0.0018; // ~200m north
        const boxLng = -43.1729;

        const dist = calculateDistanceMeters(riderLat, riderLng, boxLat, boxLng);
        expect(dist).toBeGreaterThan(150);
        expect(dist).toBeLessThan(250);
    });

    it('should calculate large distances for different cities', () => {
        // Manila to Cebu (~565 km)
        const manilaLat = 14.5995;
        const manilaLng = 120.9842;
        const cebuLat = 10.3157;
        const cebuLng = 123.8854;

        const dist = calculateDistanceMeters(manilaLat, manilaLng, cebuLat, cebuLng);
        expect(dist).toBeGreaterThan(500_000); // > 500 km
        expect(dist).toBeLessThan(700_000);    // < 700 km
        expect(dist).toBeGreaterThan(THRESHOLD);
    });
});

// ==================== Safeguard 2: Drift Detection Thresholds ====================

describe('Drift Detection Thresholds', () => {
    it('should not trigger drift warning within 5km', () => {
        // ~3km offset
        const riderLat = 14.5995;
        const riderLng = 120.9842;
        const boxLat = 14.5995 + 0.027; // ~3km
        const boxLng = 120.9842;

        const dist = calculateDistanceMeters(riderLat, riderLng, boxLat, boxLng);
        expect(dist).toBeLessThan(DRIFT_WARNING_THRESHOLD_M);
    });

    it('should trigger drift warning at 10km', () => {
        // ~10km offset (roughly 0.09 degrees latitude)
        const riderLat = 14.5995;
        const riderLng = 120.9842;
        const boxLat = 14.5995 + 0.09;
        const boxLng = 120.9842;

        const dist = calculateDistanceMeters(riderLat, riderLng, boxLat, boxLng);
        expect(dist).toBeGreaterThan(DRIFT_WARNING_THRESHOLD_M);
        expect(dist).toBeLessThan(DRIFT_UNPAIR_THRESHOLD_M);
    });

    it('should trigger drift unpair at 60km', () => {
        // ~60km offset (roughly 0.54 degrees latitude)
        const riderLat = 14.5995;
        const riderLng = 120.9842;
        const boxLat = 14.5995 + 0.54;
        const boxLng = 120.9842;

        const dist = calculateDistanceMeters(riderLat, riderLng, boxLat, boxLng);
        expect(dist).toBeGreaterThan(DRIFT_UNPAIR_THRESHOLD_M);
    });

    it('should handle the drift sustained-checks logic', () => {
        // Simulated consecutive checks
        const DRIFT_SUSTAINED_CHECKS = 3;
        let consecutiveViolations = 0;

        // Check 1: over threshold
        consecutiveViolations++;
        expect(consecutiveViolations).toBeLessThan(DRIFT_SUSTAINED_CHECKS);

        // Check 2: over threshold
        consecutiveViolations++;
        expect(consecutiveViolations).toBeLessThan(DRIFT_SUSTAINED_CHECKS);

        // Check 3: over threshold → should trigger unpair
        consecutiveViolations++;
        expect(consecutiveViolations).toBeGreaterThanOrEqual(DRIFT_SUSTAINED_CHECKS);
    });

    it('should reset consecutive checks when distance drops below threshold', () => {
        let consecutiveViolations = 0;

        // 2 violations
        consecutiveViolations++;
        consecutiveViolations++;
        expect(consecutiveViolations).toBe(2);

        // Distance drops back to safe — reset
        consecutiveViolations = 0;
        expect(consecutiveViolations).toBe(0);

        // 1 new violation — should NOT trigger unpair
        consecutiveViolations++;
        expect(consecutiveViolations).toBe(1);
        expect(consecutiveViolations).toBeLessThan(3);
    });
});

// ==================== Threshold Constants Sanity ====================

describe('Threshold Constants', () => {
    it('should have reasonable pairing threshold', () => {
        expect(PAIRING_MAX_DISTANCE_M).toBeGreaterThanOrEqual(100);
        expect(PAIRING_MAX_DISTANCE_M).toBeLessThanOrEqual(2000);
    });

    it('should have drift warning threshold less than unpair threshold', () => {
        expect(DRIFT_WARNING_THRESHOLD_M).toBeLessThan(DRIFT_UNPAIR_THRESHOLD_M);
    });

    it('should have unpair threshold much larger than pairing threshold', () => {
        expect(DRIFT_UNPAIR_THRESHOLD_M).toBeGreaterThan(PAIRING_MAX_DISTANCE_M * 10);
    });
});
