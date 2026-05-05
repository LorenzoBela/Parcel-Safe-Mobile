import { locationRedundancy } from "../services/locationRedundancy";

// We mock the modules used by the redundancy manager so tests run in Node.
let mockBoxLocationCallback: ((location: any) => void) | null = null;
let mockBoxStateCallback: ((state: any) => void) | null = null;
let mockGpsHealthCallback: ((state: any) => void) | null = null;
let mockPhoneWatchCallback: ((location: any) => void) | null = null;

const mockRemovePhoneWatch = jest.fn();

jest.mock("expo-location", () => {
    return {
        requestForegroundPermissionsAsync: jest
            .fn()
            .mockResolvedValue({ status: "granted" }),
        getForegroundPermissionsAsync: jest
            .fn()
            .mockResolvedValue({ status: "granted" }),
        Accuracy: { Balanced: 3, BestForNavigation: 6 },
        watchPositionAsync: jest.fn(async (_options: any, callback: any) => {
            mockPhoneWatchCallback = callback;
            return { remove: mockRemovePhoneWatch };
        }),
    };
});

jest.mock("../services/backgroundLocationService", () => ({
    backgroundLocationService: {
        start: jest.fn().mockResolvedValue(false),
        stop: jest.fn().mockResolvedValue(undefined),
    },
}));

jest.mock("../services/firebaseClient", () => {
    return {
        subscribeToLocation: jest.fn((_boxId: string, cb: any) => {
            mockBoxLocationCallback = cb;
            return () => {
                mockBoxLocationCallback = null;
            };
        }),
        subscribeToBoxState: jest.fn((_boxId: string, cb: any) => {
            mockBoxStateCallback = cb;
            return () => {
                mockBoxStateCallback = null;
            };
        }),
        writePhoneLocation: jest.fn().mockResolvedValue(undefined),
        subscribeToGpsHealth: jest.fn((_boxId: string, cb: any) => {
            mockGpsHealthCallback = cb;
            return () => {
                mockGpsHealthCallback = null;
            };
        }),
    };
});

const flushPromises = async () => {
    // Enough to flush microtasks created by async/await chains in this code.
    for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
    }
};

describe("locationRedundancy", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(1_000_000));
        mockRemovePhoneWatch.mockClear();
        mockBoxLocationCallback = null;
        mockBoxStateCallback = null;
        mockGpsHealthCallback = null;
        mockPhoneWatchCallback = null;

        // Ensure singleton starts clean each test.
        locationRedundancy.stop();
    });

    afterEach(() => {
        locationRedundancy.stop();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("activates phone GPS fallback when no heartbeat received in ACTIVE", async () => {
        locationRedundancy.start("BOX_001");
        locationRedundancy.activate();

        // Heartbeat monitor runs every 2s.
        jest.advanceTimersByTime(2000);
        await flushPromises();

        const state = locationRedundancy.getState();
        expect(state.powerState).toBe("ACTIVE");
        expect(state.phoneGpsActive).toBe(true);
        expect(state.source).toBe("phone");
    });

    test("writes phone location to Firebase while in fallback", async () => {
        locationRedundancy.start("BOX_001");
        locationRedundancy.activate();

        jest.advanceTimersByTime(2000);
        await flushPromises();

        expect(typeof mockPhoneWatchCallback).toBe("function");

        // Simulate Expo location callback
        await mockPhoneWatchCallback?.({
            coords: {
                latitude: 14.5995,
                longitude: 120.9842,
                speed: 1.2,
                heading: 90,
            },
        });

        const { writePhoneLocation } = require("../services/firebaseClient");
        expect(writePhoneLocation).toHaveBeenCalledWith(
            "BOX_001",
            14.5995,
            120.9842,
            1.2,
            90
        );

        const state = locationRedundancy.getState();
        expect(state.lastLocation?.source).toBe("phone");
    });

    test("does not stop phone fallback if box returns before debounce window", async () => {
        // Arrange: make fallback start via the STALE heartbeat path so debounce is meaningful.
        locationRedundancy.start("BOX_001");
        locationRedundancy.activate();

        // Provide a box location with an old server timestamp so it is immediately considered stale.
        expect(typeof mockBoxLocationCallback).toBe("function");
        mockBoxLocationCallback?.({
            latitude: 1,
            longitude: 1,
            source: "box",
            server_timestamp: Date.now() - 40_000,
        });

        // Heartbeat monitor will detect staleness and start fallback.
        jest.advanceTimersByTime(2000);
        await flushPromises();
        expect(locationRedundancy.getState().phoneGpsActive).toBe(true);

        // Box returns quickly (1s later) -> should NOT stop phone GPS yet.
        jest.setSystemTime(new Date(1_001_000));
        mockBoxLocationCallback?.({
            latitude: 2,
            longitude: 2,
            source: "box",
            server_timestamp: Date.now(),
        });

        expect(mockRemovePhoneWatch).not.toHaveBeenCalled();
        expect(locationRedundancy.getState().phoneGpsActive).toBe(true);
    });

    test("stops phone fallback when box GPS resumes", async () => {
        locationRedundancy.start("BOX_001");
        locationRedundancy.activate();

        // Start fallback deterministically (no heartbeat received).
        jest.advanceTimersByTime(2000);
        await flushPromises();
        expect(locationRedundancy.getState().phoneGpsActive).toBe(true);

        // Advance time past the debounce window (5000ms RECONNECT_DEBOUNCE).
        jest.advanceTimersByTime(6000);

        // Box resumes sending valid GPS -> fallback should stop.
        mockBoxLocationCallback?.({
            latitude: 3,
            longitude: 3,
            source: "box",
            server_timestamp: Date.now(),
        });

        // stopPhoneGps may cancel an in-flight start; give it a tick to tear down.
        await flushPromises();

        expect(locationRedundancy.getState().phoneGpsActive).toBe(false);
        expect(locationRedundancy.getState().source).toBe("box");
    });

    test("normalizes string GPS health telemetry from Firebase", () => {
        locationRedundancy.start("BOX_001");

        expect(typeof mockGpsHealthCallback).toBe("function");
        mockGpsHealthCallback?.({
            box_hdop: "6.7",
            satellites_visible: "3",
            obstruction_detected: "false",
        });

        const state = locationRedundancy.getState();
        expect(state.gpsHealth).toMatchObject({
            hdop: 6.7,
            satellites: 3,
            obstructionDetected: false,
            isDegraded: true,
        });
        expect(typeof state.gpsHealth?.hdop).toBe("number");
    });
});
