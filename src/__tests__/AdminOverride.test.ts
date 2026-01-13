/**
 * Admin Override Tests (EC-77)
 * 
 * Tests for admin remote unlock during OTP entry.
 * 
 * Run with: npm test -- AdminOverride
 */

import {
    AdminOverrideState,
    ADMIN_OVERRIDE_TIMEOUT_MS,
    shouldProcessOverride,
    isOverrideTimedOut,
    getOverrideNotificationMessage,
    formatAdminId,
} from '../services/adminOverrideService';

describe('EC-77: Admin Override During OTP Entry', () => {
    describe('shouldProcessOverride', () => {
        it('should return false when state is null', () => {
            expect(shouldProcessOverride(null)).toBe(false);
        });

        it('should return false when override is not active', () => {
            const state: AdminOverrideState = {
                active: false,
                triggered_by: 'admin_123',
                triggered_at: Date.now(),
            };
            expect(shouldProcessOverride(state)).toBe(false);
        });

        it('should return false when already processed', () => {
            const state: AdminOverrideState = {
                active: true,
                triggered_by: 'admin_123',
                triggered_at: Date.now(),
                processed: true,
            };
            expect(shouldProcessOverride(state)).toBe(false);
        });

        it('should return true when active and not processed', () => {
            const state: AdminOverrideState = {
                active: true,
                triggered_by: 'admin_123',
                triggered_at: Date.now(),
                processed: false,
            };
            expect(shouldProcessOverride(state)).toBe(true);
        });
    });

    describe('isOverrideTimedOut', () => {
        it('should return false when state is null', () => {
            expect(isOverrideTimedOut(null)).toBe(false);
        });

        it('should return false before timeout', () => {
            const triggeredAt = Date.now();
            const state: AdminOverrideState = {
                active: true,
                triggered_by: 'admin_123',
                triggered_at: triggeredAt,
            };

            const currentTime = triggeredAt + ADMIN_OVERRIDE_TIMEOUT_MS - 1000; // 1 second before timeout
            expect(isOverrideTimedOut(state, currentTime)).toBe(false);
        });

        it('should return true after timeout', () => {
            const triggeredAt = Date.now();
            const state: AdminOverrideState = {
                active: true,
                triggered_by: 'admin_123',
                triggered_at: triggeredAt,
            };

            const currentTime = triggeredAt + ADMIN_OVERRIDE_TIMEOUT_MS + 1000; // 1 second after timeout
            expect(isOverrideTimedOut(state, currentTime)).toBe(true);
        });
    });

    describe('getOverrideNotificationMessage', () => {
        it('should include reason when provided', () => {
            const state: AdminOverrideState = {
                active: true,
                triggered_by: 'admin_123',
                triggered_at: Date.now(),
                reason: 'Customer emergency',
            };

            const message = getOverrideNotificationMessage(state);
            expect(message).toContain('Customer emergency');
        });

        it('should use default message when no reason', () => {
            const state: AdminOverrideState = {
                active: true,
                triggered_by: 'admin_123',
                triggered_at: Date.now(),
            };

            const message = getOverrideNotificationMessage(state);
            expect(message).toContain('remotely unlocked by an administrator');
        });
    });

    describe('formatAdminId', () => {
        it('should return short IDs unchanged', () => {
            expect(formatAdminId('admin123')).toBe('admin123');
        });

        it('should truncate long IDs', () => {
            const longId = 'admin_user_with_very_long_identifier_123456';
            const formatted = formatAdminId(longId);
            expect(formatted.length).toBeLessThan(longId.length);
            expect(formatted).toContain('...');
        });
    });
});
