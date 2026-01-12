/**
 * Delivery State Machine Tests
 * 
 * Tests for delivery state transitions based on:
 * - STATE_CASES.md: SC-DEL-01 to SC-DEL-15
 * 
 * Validates that only legal state transitions are allowed.
 */

// Delivery statuses matching Supabase schema
type DeliveryStatus =
    | 'PENDING'
    | 'ASSIGNED'
    | 'IN_TRANSIT'
    | 'ARRIVED'
    | 'ATTEMPTED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'RETURNED'
    | 'EXPIRED'
    | 'TAMPERED';

// Valid state transitions
const VALID_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
    PENDING: ['ASSIGNED', 'CANCELLED', 'EXPIRED'],
    ASSIGNED: ['IN_TRANSIT', 'CANCELLED'],
    IN_TRANSIT: ['ARRIVED', 'CANCELLED', 'TAMPERED'],
    ARRIVED: ['COMPLETED', 'RETURNED', 'ATTEMPTED'],
    ATTEMPTED: ['ARRIVED', 'CANCELLED'], // Admin reset or customer gives up
    COMPLETED: [], // Terminal state
    CANCELLED: [], // Terminal state
    RETURNED: [], // Terminal state
    EXPIRED: [], // Terminal state
    TAMPERED: [], // Terminal state (requires investigation)
};

/**
 * Check if a state transition is valid
 */
function isValidTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
    return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Get all valid next states from current state
 */
function getNextStates(current: DeliveryStatus): DeliveryStatus[] {
    return VALID_TRANSITIONS[current];
}

/**
 * Check if state is terminal (no further transitions)
 */
function isTerminalState(status: DeliveryStatus): boolean {
    return VALID_TRANSITIONS[status].length === 0;
}

describe('Delivery State Machine', () => {

    // ============ VALID TRANSITIONS (SC-DEL-01 to SC-DEL-08) ============
    describe('SC-DEL: Valid Transitions', () => {
        // SC-DEL-01: PENDING → IN_TRANSIT
        test('SC-DEL-01: PENDING → ASSIGNED → IN_TRANSIT is valid', () => {
            expect(isValidTransition('PENDING', 'ASSIGNED')).toBe(true);
            expect(isValidTransition('ASSIGNED', 'IN_TRANSIT')).toBe(true);
        });

        // SC-DEL-02: IN_TRANSIT → ARRIVED
        test('SC-DEL-02: IN_TRANSIT → ARRIVED is valid', () => {
            expect(isValidTransition('IN_TRANSIT', 'ARRIVED')).toBe(true);
        });

        // SC-DEL-03: ARRIVED → COMPLETED
        test('SC-DEL-03: ARRIVED → COMPLETED is valid', () => {
            expect(isValidTransition('ARRIVED', 'COMPLETED')).toBe(true);
        });

        // SC-DEL-04: PENDING → CANCELLED (By Customer)
        test('SC-DEL-04: PENDING → CANCELLED is valid', () => {
            expect(isValidTransition('PENDING', 'CANCELLED')).toBe(true);
        });

        // SC-DEL-05: IN_TRANSIT → CANCELLED (By Rider)
        test('SC-DEL-05: IN_TRANSIT → CANCELLED is valid', () => {
            expect(isValidTransition('IN_TRANSIT', 'CANCELLED')).toBe(true);
        });

        // SC-DEL-06: ARRIVED → RETURNED
        test('SC-DEL-06: ARRIVED → RETURNED is valid', () => {
            expect(isValidTransition('ARRIVED', 'RETURNED')).toBe(true);
        });

        // SC-DEL-07: IN_TRANSIT → TAMPERED
        test('SC-DEL-07: IN_TRANSIT → TAMPERED is valid', () => {
            expect(isValidTransition('IN_TRANSIT', 'TAMPERED')).toBe(true);
        });

        // SC-DEL-08: PENDING → EXPIRED
        test('SC-DEL-08: PENDING → EXPIRED is valid', () => {
            expect(isValidTransition('PENDING', 'EXPIRED')).toBe(true);
        });

        // SC-DEL-12: ARRIVED → ATTEMPTED (5 wrong OTPs)
        test('SC-DEL-12: ARRIVED → ATTEMPTED is valid', () => {
            expect(isValidTransition('ARRIVED', 'ATTEMPTED')).toBe(true);
        });

        // SC-DEL-13: ATTEMPTED → ARRIVED (Admin reset)
        test('SC-DEL-13: ATTEMPTED → ARRIVED is valid', () => {
            expect(isValidTransition('ATTEMPTED', 'ARRIVED')).toBe(true);
        });
    });

    // ============ INVALID TRANSITIONS (SC-DEL-09 to SC-DEL-11) ============
    describe('SC-DEL: Invalid Transitions', () => {
        // SC-DEL-09: PENDING → COMPLETED (skip steps)
        test('SC-DEL-09: PENDING → COMPLETED is invalid', () => {
            expect(isValidTransition('PENDING', 'COMPLETED')).toBe(false);
        });

        // SC-DEL-10: COMPLETED → IN_TRANSIT (revert)
        test('SC-DEL-10: COMPLETED → IN_TRANSIT is invalid', () => {
            expect(isValidTransition('COMPLETED', 'IN_TRANSIT')).toBe(false);
        });

        // SC-DEL-11: CANCELLED → ARRIVED
        test('SC-DEL-11: CANCELLED → ARRIVED is invalid', () => {
            expect(isValidTransition('CANCELLED', 'ARRIVED')).toBe(false);
        });

        // Cannot skip IN_TRANSIT
        test('PENDING → ARRIVED is invalid (skips IN_TRANSIT)', () => {
            expect(isValidTransition('PENDING', 'ARRIVED')).toBe(false);
        });

        // Cannot skip ARRIVED
        test('IN_TRANSIT → COMPLETED is invalid (skips ARRIVED)', () => {
            expect(isValidTransition('IN_TRANSIT', 'COMPLETED')).toBe(false);
        });

        // Cannot resurrect from terminal states
        test('EXPIRED → PENDING is invalid', () => {
            expect(isValidTransition('EXPIRED', 'PENDING')).toBe(false);
        });

        test('RETURNED → IN_TRANSIT is invalid', () => {
            expect(isValidTransition('RETURNED', 'IN_TRANSIT')).toBe(false);
        });

        test('TAMPERED → IN_TRANSIT is invalid', () => {
            expect(isValidTransition('TAMPERED', 'IN_TRANSIT')).toBe(false);
        });
    });

    // ============ TERMINAL STATES ============
    describe('Terminal States', () => {
        test('COMPLETED is terminal', () => {
            expect(isTerminalState('COMPLETED')).toBe(true);
            expect(getNextStates('COMPLETED')).toHaveLength(0);
        });

        test('CANCELLED is terminal', () => {
            expect(isTerminalState('CANCELLED')).toBe(true);
            expect(getNextStates('CANCELLED')).toHaveLength(0);
        });

        test('RETURNED is terminal', () => {
            expect(isTerminalState('RETURNED')).toBe(true);
        });

        test('EXPIRED is terminal', () => {
            expect(isTerminalState('EXPIRED')).toBe(true);
        });

        test('TAMPERED is terminal', () => {
            expect(isTerminalState('TAMPERED')).toBe(true);
        });

        test('PENDING is NOT terminal', () => {
            expect(isTerminalState('PENDING')).toBe(false);
        });

        test('IN_TRANSIT is NOT terminal', () => {
            expect(isTerminalState('IN_TRANSIT')).toBe(false);
        });

        test('ARRIVED is NOT terminal', () => {
            expect(isTerminalState('ARRIVED')).toBe(false);
        });
    });

    // ============ FULL PATH VALIDATION ============
    describe('Full Delivery Paths', () => {
        test('Happy path: PENDING → ASSIGNED → IN_TRANSIT → ARRIVED → COMPLETED', () => {
            expect(isValidTransition('PENDING', 'ASSIGNED')).toBe(true);
            expect(isValidTransition('ASSIGNED', 'IN_TRANSIT')).toBe(true);
            expect(isValidTransition('IN_TRANSIT', 'ARRIVED')).toBe(true);
            expect(isValidTransition('ARRIVED', 'COMPLETED')).toBe(true);
        });

        test('Cancellation path: PENDING → CANCELLED', () => {
            expect(isValidTransition('PENDING', 'CANCELLED')).toBe(true);
        });

        test('Customer unavailable: ARRIVED → RETURNED', () => {
            expect(isValidTransition('ARRIVED', 'RETURNED')).toBe(true);
        });

        test('Wrong OTP recovery: ARRIVED → ATTEMPTED → ARRIVED → COMPLETED', () => {
            expect(isValidTransition('ARRIVED', 'ATTEMPTED')).toBe(true);
            expect(isValidTransition('ATTEMPTED', 'ARRIVED')).toBe(true);
            expect(isValidTransition('ARRIVED', 'COMPLETED')).toBe(true);
        });

        test('Tamper incident: IN_TRANSIT → TAMPERED', () => {
            expect(isValidTransition('IN_TRANSIT', 'TAMPERED')).toBe(true);
            expect(isTerminalState('TAMPERED')).toBe(true);
        });
    });

    // ============ NEXT STATES QUERIES ============
    describe('Next States Queries', () => {
        test('PENDING has 3 next states', () => {
            const next = getNextStates('PENDING');
            expect(next).toContain('ASSIGNED');
            expect(next).toContain('CANCELLED');
            expect(next).toContain('EXPIRED');
            expect(next).toHaveLength(3);
        });

        test('IN_TRANSIT has 3 next states', () => {
            const next = getNextStates('IN_TRANSIT');
            expect(next).toContain('ARRIVED');
            expect(next).toContain('CANCELLED');
            expect(next).toContain('TAMPERED');
            expect(next).toHaveLength(3);
        });

        test('ARRIVED has 3 next states', () => {
            const next = getNextStates('ARRIVED');
            expect(next).toContain('COMPLETED');
            expect(next).toContain('RETURNED');
            expect(next).toContain('ATTEMPTED');
            expect(next).toHaveLength(3);
        });
    });
});

// ============ LOCK STATE MACHINE ============
describe('Lock State Machine', () => {
    type LockState = 'LOCKED' | 'UNLOCKING' | 'UNLOCKED' | 'FORCE_OPENED' | 'MAINTENANCE' | 'ERROR';

    const LOCK_TRANSITIONS: Record<LockState, LockState[]> = {
        LOCKED: ['UNLOCKING', 'FORCE_OPENED', 'MAINTENANCE', 'ERROR'],
        UNLOCKING: ['UNLOCKED'],
        UNLOCKED: ['LOCKED'],
        FORCE_OPENED: ['LOCKED'], // Admin reset only
        MAINTENANCE: ['LOCKED'],
        ERROR: ['LOCKED'], // After repair
    };

    function isValidLockTransition(from: LockState, to: LockState): boolean {
        return LOCK_TRANSITIONS[from].includes(to);
    }

    describe('SC-LOCK: Lock State Transitions', () => {
        // SC-LOCK-01: LOCKED → UNLOCKING
        test('SC-LOCK-01: LOCKED → UNLOCKING is valid', () => {
            expect(isValidLockTransition('LOCKED', 'UNLOCKING')).toBe(true);
        });

        // SC-LOCK-02: UNLOCKING → UNLOCKED
        test('SC-LOCK-02: UNLOCKING → UNLOCKED is valid', () => {
            expect(isValidLockTransition('UNLOCKING', 'UNLOCKED')).toBe(true);
        });

        // SC-LOCK-03: UNLOCKED → LOCKED
        test('SC-LOCK-03: UNLOCKED → LOCKED is valid', () => {
            expect(isValidLockTransition('UNLOCKED', 'LOCKED')).toBe(true);
        });

        // SC-LOCK-04: LOCKED → FORCE_OPENED (Tamper)
        test('SC-LOCK-04: LOCKED → FORCE_OPENED is valid', () => {
            expect(isValidLockTransition('LOCKED', 'FORCE_OPENED')).toBe(true);
        });

        // SC-LOCK-05: FORCE_OPENED → LOCKED (Admin reset)
        test('SC-LOCK-05: FORCE_OPENED → LOCKED is valid', () => {
            expect(isValidLockTransition('FORCE_OPENED', 'LOCKED')).toBe(true);
        });

        // SC-LOCK-07: LOCKED → MAINTENANCE
        test('SC-LOCK-07: LOCKED → MAINTENANCE is valid', () => {
            expect(isValidLockTransition('LOCKED', 'MAINTENANCE')).toBe(true);
        });

        // SC-LOCK-08: MAINTENANCE → LOCKED
        test('SC-LOCK-08: MAINTENANCE → LOCKED is valid', () => {
            expect(isValidLockTransition('MAINTENANCE', 'LOCKED')).toBe(true);
        });

        // SC-LOCK-10: LOCKED → ERROR
        test('SC-LOCK-10: LOCKED → ERROR is valid', () => {
            expect(isValidLockTransition('LOCKED', 'ERROR')).toBe(true);
        });
    });

    describe('SC-LOCK: Invalid Lock Transitions', () => {
        // SC-LOCK-09: UNLOCKED → FORCE_OPENED (not tamper during valid unlock)
        test('SC-LOCK-09: UNLOCKED → FORCE_OPENED is invalid', () => {
            expect(isValidLockTransition('UNLOCKED', 'FORCE_OPENED')).toBe(false);
        });

        test('UNLOCKING → LOCKED is invalid (skip UNLOCKED)', () => {
            expect(isValidLockTransition('UNLOCKING', 'LOCKED')).toBe(false);
        });

        test('ERROR → UNLOCKING is invalid', () => {
            expect(isValidLockTransition('ERROR', 'UNLOCKING')).toBe(false);
        });
    });
});
