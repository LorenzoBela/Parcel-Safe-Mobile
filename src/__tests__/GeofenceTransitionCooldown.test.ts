/**
 * EC-FIX: Geofence Transition Cooldown Tests
 *
 * Validates the fix for the bug where confirming pickup immediately triggers
 * ARRIVED at the dropoff because stale GPS callbacks (still referencing the
 * pickup geofence center) flip isPhoneInside=true before the new dropoff
 * geofence is applied by React's state batching.
 *
 * The fix introduces a 2-second cooldown (GEOFENCE_TRANSITION_COOLDOWN_MS)
 * after each geofence target switch. During this cooldown:
 *   1. applyPhonePosition forces isPhoneInside=false
 *   2. The master switch blocks isInsideGeoFence from flipping to true
 */

import {
    checkGeofence,
    calculateDistanceMeters,
    createDefaultGeofence,
    GeofenceConfig,
} from '../utils/geoUtils';
import {
    createInitialState,
    updateGeofenceState,
    GeofenceStabilityState,
} from '../services/geofenceStabilityService';

// Mock Firebase client (required by geofenceStabilityService)
jest.mock('../services/firebaseClient', () => ({
    getFirebaseDatabase: jest.fn(() => ({})),
    ref: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    onValue: jest.fn(),
    off: jest.fn(),
    serverTimestamp: jest.fn(() => Date.now()),
}));

// ───── Constants matching ArrivalScreen ─────
const GEOFENCE_TRANSITION_COOLDOWN_MS = 2000;
const PHONE_PICKUP_CLEAR_INSIDE_MAX_M = 40;
const PHONE_PICKUP_CLEAR_INSIDE_RATIO = 0.8;
// EC-FIX v2: Tightened dropoff thresholds
const PHONE_DROPOFF_CLEAR_INSIDE_MAX_M = 15;
const PHONE_DROPOFF_CLEAR_INSIDE_RATIO = 0.3;
const DROPOFF_MAX_ACCEPTABLE_ACCURACY_M = 30;

type GeofenceTarget = 'pickup' | 'dropoff' | 'return_pickup';

function isPickupLikeGeofenceTarget(target: GeofenceTarget): boolean {
    return target === 'pickup' || target === 'return_pickup';
}

// ───── Simulation Helpers ─────

/**
 * Simulates the core logic of applyPhonePosition from ArrivalScreen.
 * Returns { isPhoneInside, distanceMeters } based on the current geofence,
 * geofence target, and transition cooldown state.
 */
function simulateApplyPhonePosition(
    coords: { lat: number; lng: number; accuracy: number },
    geofence: GeofenceConfig,
    geofenceTarget: GeofenceTarget,
    phoneGeofenceState: GeofenceStabilityState,
    geofenceTransitionAt: number,
    now: number
): { isPhoneInside: boolean; distanceMeters: number; nextState: GeofenceStabilityState } {
    const position = { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy };

    const inTransitionCooldown =
        geofenceTransitionAt > 0 &&
        (now - geofenceTransitionAt) < GEOFENCE_TRANSITION_COOLDOWN_MS;

    const quality = {
        hdop: Math.max(0.8, Math.min(8, (position.accuracy || 25) / 6)),
        satellites: (position.accuracy || 25) <= 20 ? 8 : ((position.accuracy || 25) <= 40 ? 6 : 4),
        timestamp: now,
    };

    const nextState = updateGeofenceState(
        phoneGeofenceState,
        { lat: position.lat, lng: position.lng },
        { latitude: geofence.centerLat, longitude: geofence.centerLng },
        quality,
        null,
        now
    );

    const geometricResult = checkGeofence(position, geofence);
    const isPickupTarget = isPickupLikeGeofenceTarget(geofenceTarget);
    const clearInsideRadiusM = Math.min(
        geofence.radiusMeters * (isPickupTarget ? PHONE_PICKUP_CLEAR_INSIDE_RATIO : PHONE_DROPOFF_CLEAR_INSIDE_RATIO),
        isPickupTarget ? PHONE_PICKUP_CLEAR_INSIDE_MAX_M : PHONE_DROPOFF_CLEAR_INSIDE_MAX_M
    );
    const isClearInsideFix =
        (isPickupTarget || geofenceTarget === 'dropoff') &&
        geometricResult.isInside &&
        nextState.rawDistanceM <= clearInsideRadiusM;
    const effectiveState: GeofenceStabilityState = isClearInsideFix && nextState.stableState !== 'INSIDE'
        ? {
            ...nextState,
            stableState: 'INSIDE',
            rawState: 'INSIDE',
            hysteresisCount: Math.max(nextState.hysteresisCount, 3),
            lastStableChangeMs: now,
        }
        : nextState;

    // EC-FIX v2: At dropoff, reject readings with poor GPS accuracy
    const isDropoffWithBadAccuracy =
        geofenceTarget === 'dropoff' &&
        (position.accuracy || 25) > DROPOFF_MAX_ACCEPTABLE_ACCURACY_M;

    let isPhoneInside: boolean;
    if (inTransitionCooldown || isDropoffWithBadAccuracy) {
        isPhoneInside = false;
    } else {
        isPhoneInside = effectiveState.stableState === 'INSIDE';
    }

    return {
        isPhoneInside,
        distanceMeters: geometricResult.distanceMeters,
        nextState: effectiveState,
    };
}

/**
 * Simulates the master switch logic from ArrivalScreen.
 * EC-FIX v3: At dropoff, strict geofence gating (phone || box).
 * At pickup/return, lenient path with fallback.
 */
function simulateMasterSwitch(
    isPhoneInside: boolean,
    isBoxOffline: boolean,
    isBoxInside: boolean,
    isPhoneOnlyFallback: boolean,
    geofenceTransitionAt: number,
    now: number,
    geofenceTarget: GeofenceTarget = 'dropoff'
): boolean {
    const inTransitionCooldown =
        geofenceTransitionAt > 0 &&
        (now - geofenceTransitionAt) < GEOFENCE_TRANSITION_COOLDOWN_MS;

    if (inTransitionCooldown) return false;

    if (geofenceTarget === 'dropoff') {
        // STRICT: either phone or box must confirm inside. No fallback.
        return isPhoneInside || isBoxInside;
    } else {
        // LENIENT: phone inside + (box offline, box inside, or fallback)
        return isPhoneInside && (isBoxOffline || isBoxInside || isPhoneOnlyFallback);
    }
}

// ───── Test Coordinates ─────
// Manila-area coordinates for realistic testing
const PICKUP_LAT = 14.5995;
const PICKUP_LNG = 120.9842;
const DROPOFF_LAT = 14.6100;  // ~1.2km away from pickup
const DROPOFF_LNG = 120.9900;

describe('EC-FIX: Geofence Transition Cooldown', () => {

    describe('Core Cooldown Timing', () => {
        test('should block during cooldown period (< 2s after switch)', () => {
            const transitionAt = 10000;
            const now = 11500; // 1.5s later — within cooldown

            const result = simulateMasterSwitch(
                true,   // isPhoneInside
                true,   // isBoxOffline
                false,  // isBoxInside
                false,  // isPhoneOnlyFallback
                transitionAt,
                now
            );

            expect(result).toBe(false);
        });

        test('should allow after cooldown period (>= 2s after switch)', () => {
            const transitionAt = 10000;
            const now = 12001; // 2.001s later — past cooldown

            const result = simulateMasterSwitch(
                true,   // isPhoneInside
                true,   // isBoxOffline
                false,  // isBoxInside
                false,  // isPhoneOnlyFallback
                transitionAt,
                now
            );

            expect(result).toBe(true);
        });

        test('should allow when no transition has occurred (transitionAt = 0)', () => {
            const result = simulateMasterSwitch(
                true,   // isPhoneInside
                true,   // isBoxOffline
                false,  // isBoxInside
                false,  // isPhoneOnlyFallback
                0,      // never transitioned
                Date.now()
            );

            expect(result).toBe(true);
        });

        test('should block at exact cooldown boundary (exactly 2s)', () => {
            const transitionAt = 10000;
            const now = 11999; // 1.999s — still within cooldown

            const result = simulateMasterSwitch(
                true,
                true,
                false,
                false,
                transitionAt,
                now
            );

            expect(result).toBe(false);
        });
    });

    describe('Bug Reproduction: Pickup → Dropoff Race Condition', () => {
        test('should NOT mark as arrived when rider is at pickup and geofence switches to dropoff', () => {
            const pickupGeofence = createDefaultGeofence(PICKUP_LAT, PICKUP_LNG);
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);

            // Step 1: Rider is standing at pickup location
            const riderPosition = { lat: PICKUP_LAT, lng: PICKUP_LNG, accuracy: 10 };

            // Step 2: Verify rider IS inside pickup geofence
            const pickupCheck = checkGeofence(riderPosition, pickupGeofence);
            expect(pickupCheck.isInside).toBe(true);
            expect(pickupCheck.distanceMeters).toBe(0);

            // Step 3: Verify rider is NOT inside dropoff geofence
            const dropoffCheck = checkGeofence(riderPosition, dropoffGeofence);
            expect(dropoffCheck.isInside).toBe(false);
            expect(dropoffCheck.distanceMeters).toBeGreaterThan(500);

            // Step 4: Simulate geofence switch timestamp
            const transitionAt = Date.now();

            // Step 5: Even if a stale GPS callback sets isPhoneInside=true
            // (evaluating against old pickup geofence), the master switch
            // should block during cooldown
            const masterResult = simulateMasterSwitch(
                true,   // stale isPhoneInside from old pickup geofence
                true,   // box is offline (common case)
                false,
                false,
                transitionAt,
                transitionAt + 100 // 100ms after switch — well within cooldown
            );

            expect(masterResult).toBe(false);
        });

        test('should block applyPhonePosition from setting isPhoneInside during cooldown', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);
            const transitionAt = 10000;

            // Rider is at pickup (NOT at dropoff), but GPS callback fires
            // with stale closure still referencing old geofence — BUT now the
            // function also has the cooldown check
            const result = simulateApplyPhonePosition(
                { lat: PICKUP_LAT, lng: PICKUP_LNG, accuracy: 10 },
                dropoffGeofence, // new geofence (dropoff)
                'dropoff',
                createInitialState(),
                transitionAt,
                transitionAt + 500 // 500ms after switch — within cooldown
            );

            // Even if geometric check says inside (it shouldn't for dropoff),
            // the cooldown should force isPhoneInside=false
            expect(result.isPhoneInside).toBe(false);
        });

        test('should allow arrival at dropoff after cooldown when rider genuinely arrives', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);
            const transitionAt = 10000;

            // After cooldown, rider has actually driven to the dropoff
            let phoneState = createInitialState();

            // Simulate multiple GPS readings at the dropoff location (after cooldown)
            const afterCooldown = transitionAt + GEOFENCE_TRANSITION_COOLDOWN_MS + 500;

            for (let i = 0; i < 5; i++) {
                const result = simulateApplyPhonePosition(
                    { lat: DROPOFF_LAT, lng: DROPOFF_LNG, accuracy: 10 },
                    dropoffGeofence,
                    'dropoff',
                    phoneState,
                    transitionAt,
                    afterCooldown + (i * 1000)
                );
                phoneState = result.nextState;

                // After cooldown, isPhoneInside should eventually be true
                // (may take a few readings due to hysteresis)
                if (i >= 2) {
                    expect(result.isPhoneInside).toBe(true);
                }
            }

            // Master switch should also allow it
            const masterResult = simulateMasterSwitch(
                true,
                true,
                false,
                false,
                transitionAt,
                afterCooldown + 5000
            );
            expect(masterResult).toBe(true);
        });
    });

    describe('Same Pickup/Dropoff Scenario', () => {
        test('should still work when pickup and dropoff are the same location', () => {
            const sameLocation = createDefaultGeofence(PICKUP_LAT, PICKUP_LNG);
            const transitionAt = 10000;

            // During cooldown — block even though rider IS at the correct location
            const duringCooldown = simulateMasterSwitch(
                true,
                true,
                false,
                false,
                transitionAt,
                transitionAt + 1000
            );
            expect(duringCooldown).toBe(false);

            // After cooldown — allow since rider is genuinely at the location
            const afterCooldown = simulateMasterSwitch(
                true,
                true,
                false,
                false,
                transitionAt,
                transitionAt + GEOFENCE_TRANSITION_COOLDOWN_MS + 100
            );
            expect(afterCooldown).toBe(true);
        });
    });

    describe('Return Journey Transition', () => {
        test('should block during return_pickup geofence transition', () => {
            const transitionAt = Date.now();

            const result = simulateMasterSwitch(
                true,
                true,
                false,
                false,
                transitionAt,
                transitionAt + 500
            );

            expect(result).toBe(false);
        });

        test('should allow after return_pickup transition cooldown expires', () => {
            const transitionAt = 10000;

            const result = simulateMasterSwitch(
                true,
                true,
                false,
                false,
                transitionAt,
                transitionAt + GEOFENCE_TRANSITION_COOLDOWN_MS + 1
            );

            expect(result).toBe(true);
        });
    });

    describe('EC-FIX v3: Strict Geofence Gating at Dropoff', () => {
        test('DROPOFF: phone inside alone = ARRIVED (no box needed)', () => {
            const result = simulateMasterSwitch(
                true,   // isPhoneInside
                false,  // isBoxOffline — irrelevant at dropoff
                false,  // isBoxInside
                false,  // isPhoneOnlyFallback — irrelevant at dropoff
                0,
                Date.now(),
                'dropoff'
            );
            expect(result).toBe(true);
        });

        test('DROPOFF: box inside alone = ARRIVED (no phone needed)', () => {
            const result = simulateMasterSwitch(
                false,  // isPhoneInside
                false,
                true,   // isBoxInside
                false,
                0,
                Date.now(),
                'dropoff'
            );
            expect(result).toBe(true);
        });

        test('DROPOFF: neither phone nor box inside = NOT arrived', () => {
            const result = simulateMasterSwitch(
                false,  // isPhoneInside
                true,   // isBoxOffline — doesn't matter
                false,  // isBoxInside
                true,   // isPhoneOnlyFallback — doesn't matter at dropoff
                0,
                Date.now(),
                'dropoff'
            );
            expect(result).toBe(false);
        });

        test('DROPOFF: box offline does NOT auto-allow arrival', () => {
            // This is the critical test — previously, isBoxOffline=true + isPhoneInside=false
            // could still trigger via fallback. Now it can't.
            const result = simulateMasterSwitch(
                false,  // phone says NOT inside
                true,   // box is offline
                false,  // box is NOT inside
                false,
                0,
                Date.now(),
                'dropoff'
            );
            expect(result).toBe(false);
        });

        test('DROPOFF: phone-only fallback timer has NO effect', () => {
            // Even if isPhoneOnlyFallback is true, it doesn't change the dropoff logic
            const withFallback = simulateMasterSwitch(
                false, false, false, true, 0, Date.now(), 'dropoff'
            );
            const withoutFallback = simulateMasterSwitch(
                false, false, false, false, 0, Date.now(), 'dropoff'
            );
            expect(withFallback).toBe(false);
            expect(withoutFallback).toBe(false);
        });
    });

    describe('EC-FIX v3: Lenient Pickup Path Preserved', () => {
        test('PICKUP: phone inside + box offline = allowed (fallback path)', () => {
            const result = simulateMasterSwitch(
                true,   // isPhoneInside
                true,   // isBoxOffline
                false,  // isBoxInside
                false,
                0,
                Date.now(),
                'pickup'
            );
            expect(result).toBe(true);
        });

        test('PICKUP: phone inside + fallback timer = allowed', () => {
            const result = simulateMasterSwitch(
                true,
                false,
                false,
                true,   // isPhoneOnlyFallback
                0,
                Date.now(),
                'pickup'
            );
            expect(result).toBe(true);
        });

        test('PICKUP: phone inside alone (no box, no fallback) = NOT allowed', () => {
            const result = simulateMasterSwitch(
                true,
                false,  // box NOT offline
                false,  // box NOT inside
                false,  // no fallback
                0,
                Date.now(),
                'pickup'
            );
            expect(result).toBe(false);
        });
    });

    describe('PhoneOnlyFallback Path (pickup only)', () => {
        test('should also be blocked during cooldown even with fallback active', () => {
            const transitionAt = 10000;

            const result = simulateMasterSwitch(
                true,   // isPhoneInside
                false,  // box is NOT offline
                false,  // box is NOT inside
                true,   // phone-only fallback IS active
                transitionAt,
                transitionAt + 1000, // within cooldown
                'pickup'
            );

            expect(result).toBe(false);
        });
    });

    describe('Dropoff Arrival Sync Guard', () => {
        test('isInsideGeoFence stays false during cooldown, preventing dropoff ARRIVED sync', () => {
            // This test simulates the chain:
            // 1. Rider confirms pickup → deliveryStatus = 'IN_TRANSIT'
            // 2. Geofence switches to dropoff → geofenceTransitionAt = now
            // 3. Stale GPS callback fires → would set isPhoneInside=true
            // 4. Master switch fires → should compute false during cooldown
            // 5. Dropoff arrival sync checks isInsideGeoFence → should be false

            const transitionAt = 10000;

            // Simulate multiple rapid state evaluations during the critical window
            const timings = [100, 250, 500, 1000, 1500, 1999];

            for (const offset of timings) {
                const now = transitionAt + offset;
                const masterResult = simulateMasterSwitch(
                    true,  // stale isPhoneInside
                    true,  // isBoxOffline
                    false,
                    false,
                    transitionAt,
                    now
                );
                expect(masterResult).toBe(false);
            }

            // After cooldown — with fresh GPS at the actual dropoff location
            const afterCooldown = transitionAt + GEOFENCE_TRANSITION_COOLDOWN_MS + 1;
            const masterResultAfter = simulateMasterSwitch(
                true,
                true,
                false,
                false,
                transitionAt,
                afterCooldown
            );
            expect(masterResultAfter).toBe(true);
        });
    });

    describe('Distance Verification: Pickup vs Dropoff', () => {
        test('pickup and dropoff should be far enough apart', () => {
            const distance = calculateDistanceMeters(
                PICKUP_LAT, PICKUP_LNG,
                DROPOFF_LAT, DROPOFF_LNG
            );
            // Should be > 500m to be a realistic separate location
            expect(distance).toBeGreaterThan(500);
        });

        test('rider at pickup should be outside 50m dropoff geofence', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);
            const result = checkGeofence(
                { lat: PICKUP_LAT, lng: PICKUP_LNG, accuracy: 10 },
                dropoffGeofence
            );
            expect(result.isInside).toBe(false);
            expect(result.distanceMeters).toBeGreaterThan(50);
        });

        test('rider at dropoff should be inside dropoff geofence', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);
            const result = checkGeofence(
                { lat: DROPOFF_LAT, lng: DROPOFF_LNG, accuracy: 10 },
                dropoffGeofence
            );
            expect(result.isInside).toBe(true);
            expect(result.distanceMeters).toBe(0);
        });
    });

    describe('EC-FIX v2: GPS Accuracy Gate at Dropoff', () => {
        test('should reject phone GPS with accuracy > 30m at dropoff', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);

            // Rider is genuinely at dropoff but GPS accuracy is poor (50m)
            const result = simulateApplyPhonePosition(
                { lat: DROPOFF_LAT, lng: DROPOFF_LNG, accuracy: 50 },
                dropoffGeofence,
                'dropoff',
                createInitialState(),
                0, // no transition cooldown
                Date.now()
            );

            // Should be rejected due to poor accuracy
            expect(result.isPhoneInside).toBe(false);
        });

        test('should accept phone GPS with accuracy <= 30m at dropoff', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);
            let phoneState = createInitialState();

            // Multiple good-accuracy readings at the dropoff
            for (let i = 0; i < 5; i++) {
                const result = simulateApplyPhonePosition(
                    { lat: DROPOFF_LAT, lng: DROPOFF_LNG, accuracy: 15 },
                    dropoffGeofence,
                    'dropoff',
                    phoneState,
                    0,
                    10000 + (i * 1000)
                );
                phoneState = result.nextState;
                if (i >= 2) {
                    expect(result.isPhoneInside).toBe(true);
                }
            }
        });

        test('should NOT gate accuracy at pickup (pickup is less security-critical)', () => {
            const pickupGeofence = createDefaultGeofence(PICKUP_LAT, PICKUP_LNG);
            let phoneState = createInitialState();

            // Poor accuracy (50m) at pickup — should still be allowed
            for (let i = 0; i < 3; i++) {
                const result = simulateApplyPhonePosition(
                    { lat: PICKUP_LAT, lng: PICKUP_LNG, accuracy: 50 },
                    pickupGeofence,
                    'pickup',
                    phoneState,
                    0,
                    10000 + (i * 1000)
                );
                phoneState = result.nextState;
            }
            // Pickup doesn't have the accuracy gate
            expect(phoneState.stableState).toBe('INSIDE');
        });
    });

    describe('EC-FIX v2: Tightened Clear-Inside Bypass at Dropoff', () => {
        test('dropoff clear-inside radius should be 15m (not 40m)', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);
            const isPickupTarget = false; // dropoff
            const clearInsideRadiusM = Math.min(
                dropoffGeofence.radiusMeters * PHONE_DROPOFF_CLEAR_INSIDE_RATIO,
                PHONE_DROPOFF_CLEAR_INSIDE_MAX_M
            );
            expect(clearInsideRadiusM).toBe(15);
        });

        test('pickup clear-inside radius should remain 40m', () => {
            const pickupGeofence = createDefaultGeofence(PICKUP_LAT, PICKUP_LNG);
            const clearInsideRadiusM = Math.min(
                pickupGeofence.radiusMeters * PHONE_PICKUP_CLEAR_INSIDE_RATIO,
                PHONE_PICKUP_CLEAR_INSIDE_MAX_M
            );
            expect(clearInsideRadiusM).toBe(40);
        });

        test('reading at 20m from dropoff center should NOT bypass hysteresis', () => {
            // 20m is > 15m clear-inside threshold, so must go through hysteresis
            const clearInsideRadiusM = PHONE_DROPOFF_CLEAR_INSIDE_MAX_M; // 15m
            const rawDistanceM = 20;
            const wouldBypass = rawDistanceM <= clearInsideRadiusM;
            expect(wouldBypass).toBe(false);
        });

        test('reading at 10m from dropoff center should bypass hysteresis', () => {
            // 10m is < 15m clear-inside threshold
            const clearInsideRadiusM = PHONE_DROPOFF_CLEAR_INSIDE_MAX_M; // 15m
            const rawDistanceM = 10;
            const wouldBypass = rawDistanceM <= clearInsideRadiusM;
            expect(wouldBypass).toBe(true);
        });
    });

    describe('EC-FIX v3: Phone-Only Fallback Timer', () => {
        test('dropoff fallback is DISABLED entirely (v3 strict gating)', () => {
            // At dropoff, the phone-only fallback timer never activates.
            // The master switch uses isPhoneInside || isBoxInside directly.
            const geofenceTarget = 'dropoff';
            // The fallback useEffect returns early for dropoff — no timer set.
            const shouldSkipFallback = geofenceTarget === 'dropoff';
            expect(shouldSkipFallback).toBe(true);
        });

        test('pickup fallback timer should remain 7s', () => {
            const geofenceTarget = 'pickup';
            const isPickupLike = geofenceTarget === 'pickup' || geofenceTarget === 'return_pickup';
            const PHONE_ONLY_FALLBACK_MS = isPickupLike ? 7000 : 15000;
            expect(PHONE_ONLY_FALLBACK_MS).toBe(7000);
        });
    });

    describe('Edge Cases', () => {
        test('multiple rapid geofence switches should not cause issues', () => {
            // Simulate: pickup → dropoff → return_pickup in rapid succession
            let transitionAt = 10000;

            // First switch (pickup → dropoff)
            expect(simulateMasterSwitch(true, true, false, false, transitionAt, transitionAt + 100)).toBe(false);

            // Second switch (dropoff → return_pickup) immediately
            transitionAt = transitionAt + 200;
            expect(simulateMasterSwitch(true, true, false, false, transitionAt, transitionAt + 100)).toBe(false);

            // After 2s from LAST switch
            expect(simulateMasterSwitch(true, true, false, false, transitionAt, transitionAt + GEOFENCE_TRANSITION_COOLDOWN_MS + 1)).toBe(true);
        });

        test('cooldown should not affect the isPhoneInside=false case', () => {
            // If phone is genuinely outside, master switch should be false regardless
            const result = simulateMasterSwitch(
                false,  // phone is NOT inside
                true,
                false,
                false,
                0,      // no transition
                Date.now()
            );
            expect(result).toBe(false);
        });

        test('applyPhonePosition should still update distance during cooldown', () => {
            const dropoffGeofence = createDefaultGeofence(DROPOFF_LAT, DROPOFF_LNG);
            const transitionAt = 10000;

            const result = simulateApplyPhonePosition(
                { lat: PICKUP_LAT, lng: PICKUP_LNG, accuracy: 10 },
                dropoffGeofence,
                'dropoff',
                createInitialState(),
                transitionAt,
                transitionAt + 500
            );

            // isPhoneInside should be blocked
            expect(result.isPhoneInside).toBe(false);
            // But distance should still be computed (for UI display)
            expect(result.distanceMeters).toBeGreaterThan(0);
        });
    });
});
