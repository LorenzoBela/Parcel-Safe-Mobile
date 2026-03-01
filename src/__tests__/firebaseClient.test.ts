/**
 * Unit tests for Firebase Realtime Database client
 * Tests location subscriptions, writes, and box state management
 */

// Mock firebase config first (prevents import errors)
jest.mock('../config/firebase', () => ({}), { virtual: true });

// Mock Firebase app
jest.mock('firebase/app', () => ({
    initializeApp: jest.fn(() => ({})),
    getApps: jest.fn(() => [{}]),
}));

// Mock Firebase Auth
jest.mock('firebase/auth', () => ({
    getAuth: jest.fn(),
    initializeAuth: jest.fn(() => ({})),
}));

// Mock @firebase/auth for React Native persistence
jest.mock('@firebase/auth', () => ({
    getReactNativePersistence: jest.fn(),
}));

// Shared mock references
let mockOnValueCallback: ((snapshot: { val: () => unknown }) => void) | null = null;
let lastSetCall: { ref: unknown; data: unknown } | null = null;

// Mock Firebase RTDB
jest.mock('firebase/database', () => ({
    getDatabase: jest.fn(() => ({})),
    ref: jest.fn((db, path) => ({ _path: path })),
    onValue: jest.fn((dbRef, callback) => {
        mockOnValueCallback = callback;
        return () => { }; // Unsubscribe
    }),
    off: jest.fn(),
    set: jest.fn((dbRef, data) => {
        lastSetCall = { ref: dbRef, data };
        return Promise.resolve();
    }),
    serverTimestamp: jest.fn(() => ({ '.sv': 'timestamp' })),
}));

import {
    subscribeToLocation,
    subscribeToBoxState,
    writePhoneLocation,
    updateBoxState,
    LocationData,
    BoxState,
} from '../services/firebaseClient';
import { ref, onValue, off, set } from 'firebase/database';

describe('firebaseClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOnValueCallback = null;
        lastSetCall = null;
    });

    describe('subscribeToLocation', () => {
        test('subscribes to box location updates', () => {
            const mockCallback = jest.fn();
            const unsubscribe = subscribeToLocation('BOX_001', mockCallback);

            expect(ref).toHaveBeenCalledWith(expect.anything(), 'locations/BOX_001');
            expect(typeof unsubscribe).toBe('function');
        });

        test('invokes callback when location data received', () => {
            const mockCallback = jest.fn();

            const mockLocationData: LocationData = {
                latitude: 14.5995,
                longitude: 120.9842,
                timestamp: Date.now(),
                source: 'box',
                server_timestamp: Date.now(),
            };

            subscribeToLocation('BOX_001', mockCallback);

            // Simulate receiving data through the callback
            if (mockOnValueCallback) {
                mockOnValueCallback({ val: () => mockLocationData });
            }

            expect(mockCallback).toHaveBeenCalledWith(mockLocationData);
        });

        test('handles null location data gracefully', () => {
            const mockCallback = jest.fn();

            subscribeToLocation('BOX_001', mockCallback);

            // Simulate receiving null data
            if (mockOnValueCallback) {
                mockOnValueCallback({ val: () => null });
            }

            // The service passes null to callback
            expect(mockCallback).toHaveBeenCalledWith(null);
        });

        test('unsubscribe function is returned', () => {
            const mockCallback = jest.fn();
            const unsubscribe = subscribeToLocation('BOX_001', mockCallback);

            expect(typeof unsubscribe).toBe('function');

            // Call unsubscribe - should call off
            unsubscribe();
            expect(off).toHaveBeenCalled();
        });
    });

    describe('subscribeToBoxState', () => {
        test('subscribes to box state updates', () => {
            const mockCallback = jest.fn();
            const unsubscribe = subscribeToBoxState('BOX_001', mockCallback);

            expect(ref).toHaveBeenCalledWith(expect.anything(), 'hardware/BOX_001');
            expect(typeof unsubscribe).toBe('function');
        });

        test('invokes callback with box state data', () => {
            const mockCallback = jest.fn();

            const mockBoxState: BoxState = {
                status: 'ACTIVE',
                delivery_id: 'DEL_001',
                last_heartbeat: Date.now(),
            };

            subscribeToBoxState('BOX_001', mockCallback);

            // Simulate receiving data
            if (mockOnValueCallback) {
                mockOnValueCallback({ val: () => mockBoxState });
            }

            expect(mockCallback).toHaveBeenCalledWith(mockBoxState);
        });

        test('handles null box state gracefully', () => {
            const mockCallback = jest.fn();

            subscribeToBoxState('BOX_001', mockCallback);

            // Simulate receiving null
            if (mockOnValueCallback) {
                mockOnValueCallback({ val: () => null });
            }

            expect(mockCallback).toHaveBeenCalledWith(null);
        });
    });

    describe('writePhoneLocation', () => {
        test('writes phone GPS location to Firebase', async () => {
            await writePhoneLocation('BOX_001', 14.6042, 121.0246, 5.5, 180);

            expect(ref).toHaveBeenCalledWith(expect.anything(), 'locations/BOX_001/phone');
            expect(set).toHaveBeenCalled();

            expect(lastSetCall).not.toBeNull();
            const data = lastSetCall!.data as Record<string, unknown>;
            expect(data.latitude).toBe(14.6042);
            expect(data.longitude).toBe(121.0246);
            expect(data.source).toBe('phone');
            expect(data.speed).toBe(5.5);
            expect(data.heading).toBe(180);
        });

        test('uses default values for optional parameters', async () => {
            await writePhoneLocation('BOX_001', 14.6042, 121.0246);

            expect(lastSetCall).not.toBeNull();
            const data = lastSetCall!.data as Record<string, unknown>;
            expect(data.speed).toBe(0);
            expect(data.heading).toBe(0);
        });

        test('throws error when write fails', async () => {
            (set as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            await expect(writePhoneLocation('BOX_001', 14.6042, 121.0246)).rejects.toThrow('Network error');
        });
    });

    describe('updateBoxState', () => {
        test('updates box state in Firebase', async () => {
            const boxState: Partial<BoxState> = {
                status: 'ARRIVED',
                delivery_id: 'DEL_001',
                otp_code: '123456',
            };

            await updateBoxState('BOX_001', boxState);

            expect(ref).toHaveBeenCalledWith(expect.anything(), 'hardware/BOX_001');
            expect(set).toHaveBeenCalled();

            expect(lastSetCall).not.toBeNull();
            const data = lastSetCall!.data as Record<string, unknown>;
            expect(data.status).toBe('ARRIVED');
            expect(data.delivery_id).toBe('DEL_001');
            expect(data.otp_code).toBe('123456');
        });

        test('handles partial state updates', async () => {
            const partialState: Partial<BoxState> = {
                status: 'STANDBY',
            };

            await updateBoxState('BOX_001', partialState);

            expect(lastSetCall).not.toBeNull();
            const data = lastSetCall!.data as Record<string, unknown>;
            expect(data.status).toBe('STANDBY');
        });
    });

    describe('data validation', () => {
        test('location data passed as-is to callback', () => {
            const mockCallback = jest.fn();

            const invalidLocation = {
                latitude: 14.5995,
                // Missing longitude, source, timestamp - but service doesn't validate
            };

            subscribeToLocation('BOX_001', mockCallback);

            if (mockOnValueCallback) {
                mockOnValueCallback({ val: () => invalidLocation });
            }

            // Service passes data as-is (validation is in business logic layer)
            expect(mockCallback).toHaveBeenCalledWith(invalidLocation);
        });
    });
});
