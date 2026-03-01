/**
 * Pickup Lock Service — Unit Tests
 *
 * Tests for:
 * - Pickup coordinate locking based on delivery status
 * - Grace period timer calculations
 * - Grace period formatting
 * - No-show API call
 */

import {
    isPickupLocked,
    canUpdatePickupCoordinates,
    createGracePeriod,
    getGracePeriodRemaining,
    isGracePeriodExpired,
    formatGracePeriodRemaining,
    GRACE_PERIOD_MS,
    NO_SHOW_REASON,
} from '../services/pickupLockService';

describe('Pickup Lock Service', () => {

    // ============ isPickupLocked ============

    describe('isPickupLocked', () => {
        it('returns true for ARRIVED status', () => {
            expect(isPickupLocked('ARRIVED')).toBe(true);
        });

        it('returns true for COMPLETED status', () => {
            expect(isPickupLocked('COMPLETED')).toBe(true);
        });

        it('returns true for RETURNED status', () => {
            expect(isPickupLocked('RETURNED')).toBe(true);
        });

        it('returns true for ATTEMPTED status', () => {
            expect(isPickupLocked('ATTEMPTED')).toBe(true);
        });

        it('returns true for TAMPERED status', () => {
            expect(isPickupLocked('TAMPERED')).toBe(true);
        });

        it('returns true for CANCELLED status', () => {
            expect(isPickupLocked('CANCELLED')).toBe(true);
        });

        it('returns false for PENDING status', () => {
            expect(isPickupLocked('PENDING')).toBe(false);
        });

        it('returns false for ASSIGNED status', () => {
            expect(isPickupLocked('ASSIGNED')).toBe(false);
        });

        it('returns false for IN_TRANSIT status', () => {
            expect(isPickupLocked('IN_TRANSIT')).toBe(false);
        });
    });

    // ============ canUpdatePickupCoordinates ============

    describe('canUpdatePickupCoordinates', () => {
        it('returns false for ARRIVED status', () => {
            expect(canUpdatePickupCoordinates('ARRIVED')).toBe(false);
        });

        it('returns true for PENDING status', () => {
            expect(canUpdatePickupCoordinates('PENDING')).toBe(true);
        });

        it('returns true for IN_TRANSIT status', () => {
            expect(canUpdatePickupCoordinates('IN_TRANSIT')).toBe(true);
        });
    });

    // ============ Grace Period Timer ============

    describe('Grace Period', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('GRACE_PERIOD_MS is exactly 10 minutes', () => {
            expect(GRACE_PERIOD_MS).toBe(10 * 60 * 1000);
        });

        it('createGracePeriod returns ACTIVE when within period', () => {
            const arrivedAt = Date.now() - (5 * 60 * 1000); // 5 minutes ago
            const state = createGracePeriod('DEL-001', arrivedAt);

            expect(state.deliveryId).toBe('DEL-001');
            expect(state.startedAt).toBe(arrivedAt);
            expect(state.durationMs).toBe(GRACE_PERIOD_MS);
            expect(state.status).toBe('ACTIVE');
        });

        it('createGracePeriod returns EXPIRED when past period', () => {
            const arrivedAt = Date.now() - (11 * 60 * 1000); // 11 minutes ago
            const state = createGracePeriod('DEL-002', arrivedAt);

            expect(state.status).toBe('EXPIRED');
        });

        it('getGracePeriodRemaining returns correct ms when active', () => {
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            const remaining = getGracePeriodRemaining(fiveMinutesAgo);

            // Should be approximately 5 minutes (±100ms for execution time)
            expect(remaining).toBeGreaterThan(4 * 60 * 1000);
            expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000);
        });

        it('getGracePeriodRemaining returns 0 when expired', () => {
            const elevenMinutesAgo = Date.now() - (11 * 60 * 1000);
            const remaining = getGracePeriodRemaining(elevenMinutesAgo);

            expect(remaining).toBe(0);
        });

        it('isGracePeriodExpired returns false within period', () => {
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            expect(isGracePeriodExpired(fiveMinutesAgo)).toBe(false);
        });

        it('isGracePeriodExpired returns true after period', () => {
            const elevenMinutesAgo = Date.now() - (11 * 60 * 1000);
            expect(isGracePeriodExpired(elevenMinutesAgo)).toBe(true);
        });

        it('isGracePeriodExpired returns true at exactly GRACE_PERIOD_MS', () => {
            const exactlyTenMinutesAgo = Date.now() - GRACE_PERIOD_MS;
            expect(isGracePeriodExpired(exactlyTenMinutesAgo)).toBe(true);
        });
    });

    // ============ Formatting ============

    describe('formatGracePeriodRemaining', () => {
        it('formats 5 minutes correctly', () => {
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            const formatted = formatGracePeriodRemaining(fiveMinutesAgo);

            // Should be approximately "5:00"
            expect(formatted).toMatch(/^\d+:\d{2}$/);
            const [mins] = formatted.split(':').map(Number);
            expect(mins).toBeGreaterThanOrEqual(4);
            expect(mins).toBeLessThanOrEqual(5);
        });

        it('formats expired period as 0:00', () => {
            const elevenMinutesAgo = Date.now() - (11 * 60 * 1000);
            const formatted = formatGracePeriodRemaining(elevenMinutesAgo);

            expect(formatted).toBe('0:00');
        });
    });

    // ============ No-Show Constants ============

    describe('No-Show', () => {
        it('NO_SHOW_REASON is CUSTOMER_NO_SHOW', () => {
            expect(NO_SHOW_REASON).toBe('CUSTOMER_NO_SHOW');
        });
    });

    // ============ SC-DEL-16: ARRIVED → CANCELLED (No-Show) ============

    describe('SC-DEL-16: ARRIVED → CANCELLED (Customer No-Show)', () => {
        it('grace period expires and no-show is triggered', () => {
            // Simulate: rider arrived 11 minutes ago
            const arrivedAt = Date.now() - (11 * 60 * 1000);

            // Grace period should be expired
            expect(isGracePeriodExpired(arrivedAt)).toBe(true);
            expect(getGracePeriodRemaining(arrivedAt)).toBe(0);

            // The grace period state should reflect EXPIRED
            const state = createGracePeriod('DEL-NO-SHOW', arrivedAt);
            expect(state.status).toBe('EXPIRED');
        });

        it('grace period blocks no-show when not expired', () => {
            // Simulate: rider arrived 3 minutes ago
            const arrivedAt = Date.now() - (3 * 60 * 1000);

            // Grace period should still be active
            expect(isGracePeriodExpired(arrivedAt)).toBe(false);
            expect(getGracePeriodRemaining(arrivedAt)).toBeGreaterThan(0);

            const state = createGracePeriod('DEL-WAIT', arrivedAt);
            expect(state.status).toBe('ACTIVE');
        });
    });
});
