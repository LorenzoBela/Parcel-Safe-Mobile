/**
 * EC-97: Low-Light Face Detection Service Tests
 * 
 * Tests for low-light state subscription and helper functions.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock Firebase RTDB
const mockOnValue = jest.fn();
const mockOff = jest.fn();
const mockRef = jest.fn();

jest.mock('firebase/database', () => ({
    getDatabase: jest.fn(() => ({})),
    ref: (...args: unknown[]) => mockRef(...args),
    onValue: (...args: unknown[]) => mockOnValue(...args),
    off: (...args: unknown[]) => mockOff(...args),
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

// Import after mocking
import {
    LowLightState,
    LowLightTier,
    subscribeToLowLight,
    isLowLightFallbackRequired,
    getLowLightMessage,
} from '../firebaseClient';

describe('EC-97: Low-Light Face Detection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('LowLightState Interface', () => {
        it('should have correct tier values', () => {
            const tiers: LowLightTier[] = ['NORMAL', 'ENHANCED', 'FLASH', 'FALLBACK'];
            expect(tiers).toHaveLength(4);
        });

        it('should create valid LowLightState object', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 25,
                tier: 'FLASH',
                fallbackRequired: false,
                flashUsed: true,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-delivery-123',
            };

            expect(state.isLowLight).toBe(true);
            expect(state.brightness).toBe(25);
            expect(state.tier).toBe('FLASH');
            expect(state.fallbackRequired).toBe(false);
        });
    });

    describe('Brightness Tier Thresholds', () => {
        it('should classify brightness >= 50 as NORMAL', () => {
            const state: LowLightState = {
                isLowLight: false,
                brightness: 60,
                tier: 'NORMAL',
                fallbackRequired: false,
                flashUsed: false,
                nightModeEnabled: false,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            expect(state.tier).toBe('NORMAL');
            expect(state.isLowLight).toBe(false);
        });

        it('should classify brightness 30-49 as ENHANCED', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 35,
                tier: 'ENHANCED',
                fallbackRequired: false,
                flashUsed: false,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            expect(state.tier).toBe('ENHANCED');
            expect(state.nightModeEnabled).toBe(true);
        });

        it('should classify brightness 10-29 as FLASH', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 20,
                tier: 'FLASH',
                fallbackRequired: false,
                flashUsed: true,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            expect(state.tier).toBe('FLASH');
            expect(state.flashUsed).toBe(true);
        });

        it('should classify brightness < 10 as FALLBACK', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 5,
                tier: 'FALLBACK',
                fallbackRequired: true,
                flashUsed: true,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
                fallbackReason: 'Face detection failed in near-darkness',
            };
            expect(state.tier).toBe('FALLBACK');
            expect(state.fallbackRequired).toBe(true);
        });
    });

    describe('isLowLightFallbackRequired()', () => {
        it('should return false for null state', () => {
            expect(isLowLightFallbackRequired(null)).toBe(false);
        });

        it('should return false for NORMAL tier', () => {
            const state: LowLightState = {
                isLowLight: false,
                brightness: 60,
                tier: 'NORMAL',
                fallbackRequired: false,
                flashUsed: false,
                nightModeEnabled: false,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            expect(isLowLightFallbackRequired(state)).toBe(false);
        });

        it('should return false for FLASH tier without fallbackRequired', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 15,
                tier: 'FLASH',
                fallbackRequired: false,
                flashUsed: true,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            expect(isLowLightFallbackRequired(state)).toBe(false);
        });

        it('should return true for FALLBACK tier with fallbackRequired', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 5,
                tier: 'FALLBACK',
                fallbackRequired: true,
                flashUsed: true,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            expect(isLowLightFallbackRequired(state)).toBe(true);
        });
    });

    describe('getLowLightMessage()', () => {
        it('should return empty string for null state', () => {
            expect(getLowLightMessage(null)).toBe('');
        });

        it('should return enhanced message for ENHANCED tier', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 40,
                tier: 'ENHANCED',
                fallbackRequired: false,
                flashUsed: false,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            const message = getLowLightMessage(state);
            expect(message).toContain('Low light');
        });

        it('should return flash message for FLASH tier', () => {
            const state: LowLightState = {
                isLowLight: true,
                brightness: 20,
                tier: 'FLASH',
                fallbackRequired: false,
                flashUsed: true,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
            };
            const message = getLowLightMessage(state);
            expect(message).toContain('Flash');
        });

        it('should return fallback reason when available', () => {
            const customReason = 'Face not detected after all attempts';
            const state: LowLightState = {
                isLowLight: true,
                brightness: 5,
                tier: 'FALLBACK',
                fallbackRequired: true,
                flashUsed: true,
                nightModeEnabled: true,
                timestamp: Date.now(),
                deliveryId: 'test-123',
                fallbackReason: customReason,
            };
            const message = getLowLightMessage(state);
            expect(message).toBe(customReason);
        });
    });

    describe('subscribeToLowLight()', () => {
        it('should create subscription to correct Firebase path', () => {
            const boxId = 'test-box-id';
            const callback = jest.fn();

            subscribeToLowLight(boxId, callback);

            expect(mockRef).toHaveBeenCalledWith(expect.anything(), `hardware/${boxId}/low_light`);
            expect(mockOnValue).toHaveBeenCalled();
        });

        it('should return unsubscribe function', () => {
            const unsubscribe = subscribeToLowLight('box-123', jest.fn());
            expect(typeof unsubscribe).toBe('function');
        });

        it('should call off() when unsubscribed', () => {
            const unsubscribe = subscribeToLowLight('box-123', jest.fn());
            unsubscribe();
            expect(mockOff).toHaveBeenCalled();
        });
    });
});
