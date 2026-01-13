/**
 * Delivery Reassignment Tests (EC-78)
 * 
 * Tests for delivery reassignment during navigation.
 * Per user approval: Auto-acknowledge after 30-second timeout.
 * 
 * Run with: npm test -- DeliveryReassignment
 */

import {
    ReassignmentState,
    REASSIGNMENT_AUTO_ACK_TIMEOUT_MS,
    isReassignmentPending,
    getReassignmentType,
    getRemainingAutoAckSeconds,
    shouldAutoAcknowledge,
    getReassignmentAlertMessage,
    formatRemainingTime,
} from '../services/deliveryReassignmentService';

describe('EC-78: Delivery Reassignment During Navigation', () => {
    describe('isReassignmentPending', () => {
        it('should return false when state is null', () => {
            expect(isReassignmentPending(null)).toBe(false);
        });

        it('should return false when not pending', () => {
            const state: ReassignmentState = {
                pending: false,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: Date.now(),
            };
            expect(isReassignmentPending(state)).toBe(false);
        });

        it('should return false when already acknowledged', () => {
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: true,
                triggered_at: Date.now(),
            };
            expect(isReassignmentPending(state)).toBe(false);
        });

        it('should return true when pending and not acknowledged', () => {
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: Date.now(),
            };
            expect(isReassignmentPending(state)).toBe(true);
        });
    });

    describe('getReassignmentType', () => {
        const baseState: ReassignmentState = {
            pending: true,
            old_rider_id: 'rider_old',
            new_rider_id: 'rider_new',
            delivery_id: 'del_123',
            acknowledged: false,
            triggered_at: Date.now(),
        };

        it('should return null when state is null', () => {
            expect(getReassignmentType(null, 'rider_old')).toBe(null);
        });

        it('should return outgoing for old rider', () => {
            expect(getReassignmentType(baseState, 'rider_old')).toBe('outgoing');
        });

        it('should return incoming for new rider', () => {
            expect(getReassignmentType(baseState, 'rider_new')).toBe('incoming');
        });

        it('should return null for unrelated rider', () => {
            expect(getReassignmentType(baseState, 'rider_other')).toBe(null);
        });
    });

    describe('getRemainingAutoAckSeconds', () => {
        it('should return 0 when state is null', () => {
            expect(getRemainingAutoAckSeconds(null)).toBe(0);
        });

        it('should return correct remaining time', () => {
            const triggeredAt = Date.now();
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: triggeredAt,
            };

            // 10 seconds elapsed
            const currentTime = triggeredAt + 10000;
            const remaining = getRemainingAutoAckSeconds(state, currentTime);

            expect(remaining).toBe(20); // 30 - 10 = 20 seconds
        });

        it('should return 0 when timeout exceeded', () => {
            const triggeredAt = Date.now();
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: triggeredAt,
            };

            const currentTime = triggeredAt + REASSIGNMENT_AUTO_ACK_TIMEOUT_MS + 5000;
            expect(getRemainingAutoAckSeconds(state, currentTime)).toBe(0);
        });
    });

    describe('shouldAutoAcknowledge', () => {
        it('should return false before timeout', () => {
            const triggeredAt = Date.now();
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: triggeredAt,
            };

            const currentTime = triggeredAt + 25000; // 25 seconds
            expect(shouldAutoAcknowledge(state, currentTime)).toBe(false);
        });

        it('should return true after timeout', () => {
            const triggeredAt = Date.now();
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: triggeredAt,
            };

            const currentTime = triggeredAt + 35000; // 35 seconds
            expect(shouldAutoAcknowledge(state, currentTime)).toBe(true);
        });
    });

    describe('formatRemainingTime', () => {
        it('should format seconds correctly', () => {
            expect(formatRemainingTime(0)).toBe('0:00');
            expect(formatRemainingTime(5)).toBe('0:05');
            expect(formatRemainingTime(30)).toBe('0:30');
            expect(formatRemainingTime(65)).toBe('1:05');
            expect(formatRemainingTime(125)).toBe('2:05');
        });
    });

    describe('getReassignmentAlertMessage', () => {
        it('should show countdown for outgoing rider', () => {
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: Date.now(),
            };

            const message = getReassignmentAlertMessage(state, 'outgoing');
            expect(message).toContain('reassigned to another rider');
        });

        it('should show review message for incoming rider', () => {
            const state: ReassignmentState = {
                pending: true,
                old_rider_id: 'rider_old',
                new_rider_id: 'rider_new',
                delivery_id: 'del_123',
                acknowledged: false,
                triggered_at: Date.now(),
            };

            const message = getReassignmentAlertMessage(state, 'incoming');
            expect(message).toContain('reassigned to you');
        });
    });
});
