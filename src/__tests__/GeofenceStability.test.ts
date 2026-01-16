/**
 * EC-92: Urban Canyon Flicker Tests
 * EC-93: Zombie Delivery (Warehouse Return) Tests
 * EC-94: Boundary Hopper (GPS Jitter) Tests
 * 
 * Tests for geofence stability service
 */

import {
    CONFIG,
    calculateDistanceM,
    isUrbanCanyonDetected,
    getRawStateFromDistance,
    getEffectiveRadius,
    isInsideWarehouse,
    getWarehouseReturnRemainingSec,
    createInitialState,
    updateGeofenceState,
    GeofenceStabilityState,
    WarehouseConfig,
} from '../services/geofenceStabilityService';

// Mock Firebase client
jest.mock('../services/firebaseClient', () => ({
    getFirebaseDatabase: jest.fn(() => ({})),
    ref: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    onValue: jest.fn(),
    off: jest.fn(),
    serverTimestamp: jest.fn(() => Date.now()),
}));

describe('EC-92: Urban Canyon Flicker', () => {
    describe('HDOP Detection', () => {
        test('should detect urban canyon when HDOP > 5.0', () => {
            expect(isUrbanCanyonDetected(5.1, 8)).toBe(true);
            expect(isUrbanCanyonDetected(8.0, 8)).toBe(true);
            expect(isUrbanCanyonDetected(10.0, 8)).toBe(true);
        });

        test('should NOT detect urban canyon when HDOP <= 5.0', () => {
            expect(isUrbanCanyonDetected(5.0, 8)).toBe(false);
            expect(isUrbanCanyonDetected(2.0, 8)).toBe(false);
            expect(isUrbanCanyonDetected(1.0, 8)).toBe(false);
        });
    });

    describe('Satellite Detection', () => {
        test('should detect urban canyon when satellites < 4', () => {
            expect(isUrbanCanyonDetected(2.0, 3)).toBe(true);
            expect(isUrbanCanyonDetected(2.0, 2)).toBe(true);
            expect(isUrbanCanyonDetected(2.0, 0)).toBe(true);
        });

        test('should NOT detect urban canyon when satellites >= 4', () => {
            expect(isUrbanCanyonDetected(2.0, 4)).toBe(false);
            expect(isUrbanCanyonDetected(2.0, 8)).toBe(false);
            expect(isUrbanCanyonDetected(2.0, 12)).toBe(false);
        });
    });

    describe('State Transition Blocking', () => {
        test('should block state transition when urban canyon detected', () => {
            const currentState = createInitialState();
            currentState.stableState = 'OUTSIDE';

            const newState = updateGeofenceState(
                currentState,
                { lat: 14.5995, lng: 120.9842 }, // Would be INSIDE
                { latitude: 14.5995, longitude: 120.9842 }, // Same location = 0m
                { hdop: 6.0, satellites: 8, timestamp: Date.now() }, // Urban canyon
                null,
                Date.now()
            );

            // State should NOT change
            expect(newState.urbanCanyonDetected).toBe(true);
            expect(newState.stableState).toBe('OUTSIDE');
        });
    });

    describe('Hysteresis', () => {
        test('should require 3 consecutive readings for state transition', () => {
            let state = createInitialState();
            const target = { latitude: 14.5995, longitude: 120.9842 };
            const goodGps = { hdop: 2.0, satellites: 8, timestamp: Date.now() };

            // Position clearly inside (distance = 0)
            const insidePosition = { lat: 14.5995, lng: 120.9842 };

            // First reading - not enough
            state = updateGeofenceState(state, insidePosition, target, goodGps, null, 1000);
            expect(state.hysteresisCount).toBe(1);
            expect(state.stableState).toBe('OUTSIDE'); // No change yet

            // Second reading - not enough
            state = updateGeofenceState(state, insidePosition, target, goodGps, null, 2000);
            expect(state.hysteresisCount).toBe(2);
            expect(state.stableState).toBe('OUTSIDE'); // Still no change

            // Third reading - NOW it transitions
            state = updateGeofenceState(state, insidePosition, target, goodGps, null, 3000);
            expect(state.hysteresisCount).toBe(3);
            expect(state.stableState).toBe('INSIDE'); // Changed!
        });
    });
});

describe('EC-93: Zombie Delivery (Warehouse Return)', () => {
    const warehouse: WarehouseConfig = {
        id: 'warehouse_001',
        name: 'Manila Depot',
        latitude: 14.5500,
        longitude: 120.9500,
    };

    describe('Warehouse Detection', () => {
        test('should detect position inside warehouse geofence', () => {
            // Same location as warehouse = inside
            expect(isInsideWarehouse(14.5500, 120.9500, warehouse)).toBe(true);

            // ~30m away = inside (< 50m)
            expect(isInsideWarehouse(14.5503, 120.9500, warehouse)).toBe(true);
        });

        test('should detect position outside warehouse geofence', () => {
            // ~1km away = outside
            expect(isInsideWarehouse(14.5600, 120.9500, warehouse)).toBe(false);
        });

        test('should return false when no warehouse configured', () => {
            expect(isInsideWarehouse(14.5500, 120.9500, null)).toBe(false);
        });
    });

    describe('Return Timer', () => {
        test('should start timer when entering warehouse', () => {
            let state = createInitialState();
            const target = { latitude: 14.6000, longitude: 121.0000 }; // Far from warehouse
            const goodGps = { hdop: 2.0, satellites: 8, timestamp: Date.now() };

            // Enter warehouse
            const warehousePosition = { lat: 14.5500, lng: 120.9500 };
            state = updateGeofenceState(state, warehousePosition, target, goodGps, warehouse, 10000);

            expect(state.warehouseEntryMs).toBe(10000);
            expect(state.warehouseReturnDetected).toBe(false);
        });

        test('should trigger return after 5 minutes', () => {
            let state = createInitialState();
            state.warehouseEntryMs = 10000;

            const target = { latitude: 14.6000, longitude: 121.0000 };
            const goodGps = { hdop: 2.0, satellites: 8, timestamp: Date.now() };
            const warehousePosition = { lat: 14.5500, lng: 120.9500 };

            // 5 minutes later
            const fiveMinutesLater = 10000 + 300000;
            state = updateGeofenceState(state, warehousePosition, target, goodGps, warehouse, fiveMinutesLater);

            expect(state.warehouseReturnDetected).toBe(true);
        });

        test('should NOT trigger return before 5 minutes', () => {
            let state = createInitialState();
            state.warehouseEntryMs = 10000;

            const target = { latitude: 14.6000, longitude: 121.0000 };
            const goodGps = { hdop: 2.0, satellites: 8, timestamp: Date.now() };
            const warehousePosition = { lat: 14.5500, lng: 120.9500 };

            // 4 minutes later
            const fourMinutesLater = 10000 + 240000;
            state = updateGeofenceState(state, warehousePosition, target, goodGps, warehouse, fourMinutesLater);

            expect(state.warehouseReturnDetected).toBe(false);
        });

        test('should reset timer when leaving warehouse', () => {
            let state = createInitialState();
            state.warehouseEntryMs = 10000;

            const target = { latitude: 14.6000, longitude: 121.0000 };
            const goodGps = { hdop: 2.0, satellites: 8, timestamp: Date.now() };

            // Leave warehouse (position far from warehouse)
            const outsidePosition = { lat: 14.6000, lng: 121.0000 };
            state = updateGeofenceState(state, outsidePosition, target, goodGps, warehouse, 20000);

            expect(state.warehouseEntryMs).toBeNull();
            expect(state.warehouseReturnDetected).toBe(false);
        });
    });

    describe('Remaining Time', () => {
        test('should calculate remaining time correctly', () => {
            // 3 minutes elapsed = 2 minutes remaining
            const remaining = getWarehouseReturnRemainingSec(10000, 10000 + 180000);
            expect(remaining).toBe(120);
        });

        test('should return 0 when timeout reached', () => {
            const remaining = getWarehouseReturnRemainingSec(10000, 10000 + 300000);
            expect(remaining).toBe(0);
        });

        test('should return -1 when not in warehouse', () => {
            const remaining = getWarehouseReturnRemainingSec(null, 10000);
            expect(remaining).toBe(-1);
        });
    });
});

describe('EC-94: Boundary Hopper (GPS Jitter)', () => {
    describe('Inner Radius (Entry)', () => {
        test('should return INSIDE when distance < 40m', () => {
            expect(getRawStateFromDistance(35)).toBe('INSIDE');
            expect(getRawStateFromDistance(39.9)).toBe('INSIDE');
            expect(getRawStateFromDistance(0)).toBe('INSIDE');
        });
    });

    describe('Outer Radius (Exit)', () => {
        test('should return OUTSIDE when distance > 60m', () => {
            expect(getRawStateFromDistance(61)).toBe('OUTSIDE');
            expect(getRawStateFromDistance(100)).toBe('OUTSIDE');
            expect(getRawStateFromDistance(1000)).toBe('OUTSIDE');
        });
    });

    describe('Dead Zone (40-60m)', () => {
        test('should return DEAD_ZONE when distance is 40-60m', () => {
            expect(getRawStateFromDistance(40)).toBe('DEAD_ZONE');
            expect(getRawStateFromDistance(50)).toBe('DEAD_ZONE');
            expect(getRawStateFromDistance(60)).toBe('DEAD_ZONE');
        });
    });

    describe('Boundary Oscillation', () => {
        test('should maintain INSIDE state when oscillating in dead zone', () => {
            let state = createInitialState();
            state.stableState = 'INSIDE';

            const target = { latitude: 14.5995, longitude: 120.9842 };
            const goodGps = { hdop: 2.0, satellites: 8, timestamp: Date.now() };

            // Oscillating positions in dead zone (48m, 52m, 49m, 51m, 50m)
            // These should all be in dead zone and NOT change state
            const oscillatingDistances = [0.00043, 0.00047, 0.00044, 0.00046, 0.00045];

            for (let i = 0; i < oscillatingDistances.length; i++) {
                const position = {
                    lat: 14.5995 + oscillatingDistances[i],
                    lng: 120.9842,
                };
                state = updateGeofenceState(state, position, target, goodGps, null, i * 1000);
            }

            // State should remain INSIDE (no flip-flop)
            expect(state.stableState).toBe('INSIDE');
        });
    });

    describe('Effective Radius', () => {
        test('should return expanded radius in urban canyon', () => {
            expect(getEffectiveRadius(true)).toBe(CONFIG.EXPANDED_RADIUS_M);
        });

        test('should return default radius normally', () => {
            expect(getEffectiveRadius(false)).toBe(CONFIG.DEFAULT_RADIUS_M);
        });
    });
});

describe('Distance Calculation', () => {
    test('should return 0 for same coordinates', () => {
        const dist = calculateDistanceM(14.5995, 120.9842, 14.5995, 120.9842);
        expect(dist).toBeCloseTo(0, 1);
    });

    test('should calculate approximately correct distance', () => {
        // ~50m north (0.00045 degrees ~ 50m)
        const dist = calculateDistanceM(14.5995, 120.9842, 14.5995 + 0.00045, 120.9842);
        expect(dist).toBeGreaterThan(40);
        expect(dist).toBeLessThan(60);
    });
});

describe('Initial State', () => {
    test('should create correct initial state', () => {
        const state = createInitialState();

        expect(state.stableState).toBe('OUTSIDE');
        expect(state.rawState).toBe('OUTSIDE');
        expect(state.urbanCanyonDetected).toBe(false);
        expect(state.warehouseReturnDetected).toBe(false);
        expect(state.hysteresisCount).toBe(0);
        expect(state.warehouseEntryMs).toBeNull();
    });
});
