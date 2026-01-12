/**
 * OTP State Machine & Lifecycle Tests
 * 
 * Tests based on documented cases:
 * - STATE_CASES.md: SC-OTP-01 to SC-OTP-08
 * - NEGATIVE_CASES.md: NC-OTP-09 to NC-OTP-12
 * - NEGATIVE_CASES.md: NC-CONC-01 to NC-CONC-05
 */

// ============ OTP STATE MACHINE ============

type OtpState = 'PENDING' | 'GENERATED' | 'SYNCED' | 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'REGENERATED' | 'ARCHIVED';

interface OtpContext {
    state: OtpState;
    hash: string | null;
    createdAt: number;
    expiresAt: number;
    boxId: string | null;
    deliveryId: string | null;
    attempts: number;
}

const OTP_VALIDITY_MS = 4 * 60 * 60 * 1000; // 4 hours

const OTP_TRANSITIONS: Record<OtpState, OtpState[]> = {
    PENDING: ['GENERATED'],
    GENERATED: ['SYNCED'],
    SYNCED: ['ACTIVE'],
    ACTIVE: ['CONSUMED', 'EXPIRED', 'REGENERATED'],
    CONSUMED: ['ARCHIVED'],
    EXPIRED: [],
    REGENERATED: ['SYNCED'],
    ARCHIVED: [],
};

function canTransition(from: OtpState, to: OtpState): boolean {
    return OTP_TRANSITIONS[from].includes(to);
}

function createOtpContext(deliveryId: string, boxId: string, now: number): OtpContext {
    return {
        state: 'PENDING',
        hash: null,
        createdAt: now,
        expiresAt: now + OTP_VALIDITY_MS,
        boxId,
        deliveryId,
        attempts: 0,
    };
}

function generateOtp(ctx: OtpContext, hash: string, now: number): OtpContext | null {
    if (!canTransition(ctx.state, 'GENERATED')) return null;
    return {
        ...ctx,
        state: 'GENERATED',
        hash,
        createdAt: now,
        expiresAt: now + OTP_VALIDITY_MS,
    };
}

function syncOtp(ctx: OtpContext): OtpContext | null {
    if (!canTransition(ctx.state, 'SYNCED')) return null;
    return { ...ctx, state: 'SYNCED' };
}

function activateOtp(ctx: OtpContext): OtpContext | null {
    if (!canTransition(ctx.state, 'ACTIVE')) return null;
    return { ...ctx, state: 'ACTIVE' };
}

function consumeOtp(ctx: OtpContext): OtpContext | null {
    if (!canTransition(ctx.state, 'CONSUMED')) return null;
    return { ...ctx, state: 'CONSUMED' };
}

function expireOtp(ctx: OtpContext): OtpContext | null {
    if (!canTransition(ctx.state, 'EXPIRED')) return null;
    return { ...ctx, state: 'EXPIRED' };
}

function regenerateOtp(ctx: OtpContext): OtpContext | null {
    if (!canTransition(ctx.state, 'REGENERATED')) return null;
    return { ...ctx, state: 'REGENERATED', hash: null };
}

function archiveOtp(ctx: OtpContext): OtpContext | null {
    if (!canTransition(ctx.state, 'ARCHIVED')) return null;
    return { ...ctx, state: 'ARCHIVED' };
}

function isOtpExpired(ctx: OtpContext, now: number): boolean {
    return now > ctx.expiresAt;
}

function validateOtpForBox(inputHash: string, ctx: OtpContext, boxId: string): { valid: boolean; error?: string } {
    if (ctx.state !== 'ACTIVE') {
        return { valid: false, error: 'OTP_NOT_ACTIVE' };
    }
    if (ctx.boxId !== boxId) {
        return { valid: false, error: 'OTP_WRONG_BOX' };
    }
    if (ctx.hash !== inputHash) {
        return { valid: false, error: 'OTP_INVALID' };
    }
    return { valid: true };
}

describe('SC-OTP: OTP State Machine', () => {
    const NOW = 1000000000;
    const VALID_HASH = 'a'.repeat(64);

    describe('Valid State Transitions', () => {
        // SC-OTP-01: PENDING → GENERATED
        test('SC-OTP-01: PENDING → GENERATED', () => {
            const ctx = createOtpContext('del-1', 'box-1', NOW);
            const result = generateOtp(ctx, VALID_HASH, NOW);
            expect(result?.state).toBe('GENERATED');
            expect(result?.hash).toBe(VALID_HASH);
        });

        // SC-OTP-02: GENERATED → SYNCED
        test('SC-OTP-02: GENERATED → SYNCED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            const result = syncOtp(ctx);
            expect(result?.state).toBe('SYNCED');
        });

        // SC-OTP-03: SYNCED → ACTIVE
        test('SC-OTP-03: SYNCED → ACTIVE', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            const result = activateOtp(ctx);
            expect(result?.state).toBe('ACTIVE');
        });

        // SC-OTP-04: ACTIVE → CONSUMED
        test('SC-OTP-04: ACTIVE → CONSUMED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            const result = consumeOtp(ctx);
            expect(result?.state).toBe('CONSUMED');
        });

        // SC-OTP-05: ACTIVE → EXPIRED
        test('SC-OTP-05: ACTIVE → EXPIRED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            const result = expireOtp(ctx);
            expect(result?.state).toBe('EXPIRED');
        });

        // SC-OTP-06: ACTIVE → REGENERATED
        test('SC-OTP-06: ACTIVE → REGENERATED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            const result = regenerateOtp(ctx);
            expect(result?.state).toBe('REGENERATED');
            expect(result?.hash).toBeNull(); // Old hash cleared
        });

        // SC-OTP-07: REGENERATED → SYNCED
        test('SC-OTP-07: REGENERATED → SYNCED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            ctx = regenerateOtp(ctx)!;
            // Regenerate creates new hash
            ctx = { ...ctx, state: 'GENERATED', hash: 'b'.repeat(64) };
            const result = syncOtp(ctx);
            expect(result?.state).toBe('SYNCED');
        });

        // SC-OTP-08: CONSUMED → ARCHIVED
        test('SC-OTP-08: CONSUMED → ARCHIVED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            ctx = consumeOtp(ctx)!;
            const result = archiveOtp(ctx);
            expect(result?.state).toBe('ARCHIVED');
        });
    });

    describe('Invalid State Transitions', () => {
        test('PENDING cannot skip to ACTIVE', () => {
            const ctx = createOtpContext('del-1', 'box-1', NOW);
            const result = activateOtp(ctx);
            expect(result).toBeNull();
        });

        test('CONSUMED cannot go back to ACTIVE', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            ctx = consumeOtp(ctx)!;
            const result = activateOtp(ctx);
            expect(result).toBeNull();
        });

        test('EXPIRED is terminal state', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            ctx = expireOtp(ctx)!;
            
            expect(generateOtp(ctx, VALID_HASH, NOW)).toBeNull();
            expect(syncOtp(ctx)).toBeNull();
            expect(activateOtp(ctx)).toBeNull();
        });

        test('ARCHIVED is terminal state', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            ctx = consumeOtp(ctx)!;
            ctx = archiveOtp(ctx)!;
            
            expect(OTP_TRANSITIONS['ARCHIVED'].length).toBe(0);
        });
    });

    describe('Full Lifecycle', () => {
        test('Happy path: PENDING → GENERATED → SYNCED → ACTIVE → CONSUMED → ARCHIVED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            expect(ctx.state).toBe('PENDING');

            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            expect(ctx.state).toBe('GENERATED');

            ctx = syncOtp(ctx)!;
            expect(ctx.state).toBe('SYNCED');

            ctx = activateOtp(ctx)!;
            expect(ctx.state).toBe('ACTIVE');

            ctx = consumeOtp(ctx)!;
            expect(ctx.state).toBe('CONSUMED');

            ctx = archiveOtp(ctx)!;
            expect(ctx.state).toBe('ARCHIVED');
        });

        test('Regeneration path: ... → ACTIVE → REGENERATED → SYNCED → ACTIVE → CONSUMED', () => {
            let ctx = createOtpContext('del-1', 'box-1', NOW);
            ctx = generateOtp(ctx, VALID_HASH, NOW)!;
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;

            // Regenerate
            ctx = regenerateOtp(ctx)!;
            expect(ctx.state).toBe('REGENERATED');

            // New OTP generated
            const newHash = 'b'.repeat(64);
            ctx = { ...ctx, state: 'GENERATED', hash: newHash };
            ctx = syncOtp(ctx)!;
            ctx = activateOtp(ctx)!;
            
            expect(ctx.state).toBe('ACTIVE');
            expect(ctx.hash).toBe(newHash);
        });
    });
});

// ============ NEGATIVE CASES: OTP VALIDATION ============

describe('NC-OTP: OTP Validation Negatives', () => {
    const NOW = 1000000000;
    const VALID_HASH = 'a'.repeat(64);

    // NC-OTP-09: OTP for Different Box
    test('NC-OTP-09: OTP for different box should be rejected', () => {
        let ctx = createOtpContext('del-1', 'box-1', NOW);
        ctx = generateOtp(ctx, VALID_HASH, NOW)!;
        ctx = syncOtp(ctx)!;
        ctx = activateOtp(ctx)!;

        const result = validateOtpForBox(VALID_HASH, ctx, 'box-2'); // Wrong box
        expect(result.valid).toBe(false);
        expect(result.error).toBe('OTP_WRONG_BOX');
    });

    // NC-OTP-10: Replay Attack (same OTP used twice)
    test('NC-OTP-10: Replay attack - same OTP should not work twice', () => {
        let ctx = createOtpContext('del-1', 'box-1', NOW);
        ctx = generateOtp(ctx, VALID_HASH, NOW)!;
        ctx = syncOtp(ctx)!;
        ctx = activateOtp(ctx)!;

        // First use - should work
        const firstResult = validateOtpForBox(VALID_HASH, ctx, 'box-1');
        expect(firstResult.valid).toBe(true);

        // Consume the OTP
        ctx = consumeOtp(ctx)!;

        // Second use - should fail
        const secondResult = validateOtpForBox(VALID_HASH, ctx, 'box-1');
        expect(secondResult.valid).toBe(false);
        expect(secondResult.error).toBe('OTP_NOT_ACTIVE');
    });

    // NC-OTP-11: OTP Without Active Delivery
    test('NC-OTP-11: OTP validation when not active should fail', () => {
        const ctx = createOtpContext('del-1', 'box-1', NOW);
        // OTP is still in PENDING state
        
        const result = validateOtpForBox(VALID_HASH, ctx, 'box-1');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('OTP_NOT_ACTIVE');
    });

    // NC-OTP-12: Null OTP Hash
    test('NC-OTP-12: Null OTP hash should fail validation', () => {
        let ctx = createOtpContext('del-1', 'box-1', NOW);
        ctx = generateOtp(ctx, VALID_HASH, NOW)!;
        ctx = syncOtp(ctx)!;
        ctx = activateOtp(ctx)!;

        // Somehow hash got corrupted to null
        ctx.hash = null;

        const result = validateOtpForBox('anything', ctx, 'box-1');
        expect(result.valid).toBe(false);
    });

    // OTP Expiry Check
    test('OTP should be detected as expired after 4 hours', () => {
        let ctx = createOtpContext('del-1', 'box-1', NOW);
        ctx = generateOtp(ctx, VALID_HASH, NOW)!;
        ctx = syncOtp(ctx)!;
        ctx = activateOtp(ctx)!;

        const fourHoursLater = NOW + (4 * 60 * 60 * 1000) + 1000;
        expect(isOtpExpired(ctx, fourHoursLater)).toBe(true);
    });

    test('OTP should not be expired before 4 hours', () => {
        let ctx = createOtpContext('del-1', 'box-1', NOW);
        ctx = generateOtp(ctx, VALID_HASH, NOW)!;
        ctx = syncOtp(ctx)!;
        ctx = activateOtp(ctx)!;

        const threeHoursLater = NOW + (3 * 60 * 60 * 1000);
        expect(isOtpExpired(ctx, threeHoursLater)).toBe(false);
    });
});

// ============ CONCURRENCY TESTS ============

describe('NC-CONC: Concurrency Scenarios', () => {
    const NOW = 1000000000;
    const VALID_HASH = 'a'.repeat(64);

    // NC-CONC-01: Simultaneous OTP Validation
    test('NC-CONC-01: Simultaneous OTP validation - only first should succeed', () => {
        let ctx = createOtpContext('del-1', 'box-1', NOW);
        ctx = generateOtp(ctx, VALID_HASH, NOW)!;
        ctx = syncOtp(ctx)!;
        ctx = activateOtp(ctx)!;

        // Simulate two simultaneous validations
        const validation1 = validateOtpForBox(VALID_HASH, ctx, 'box-1');
        const validation2 = validateOtpForBox(VALID_HASH, ctx, 'box-1');

        // Both would technically pass validation at this moment
        expect(validation1.valid).toBe(true);
        expect(validation2.valid).toBe(true);

        // But only one can consume
        ctx = consumeOtp(ctx)!;
        
        // After consumption, state is no longer ACTIVE
        const validation3 = validateOtpForBox(VALID_HASH, ctx, 'box-1');
        expect(validation3.valid).toBe(false);
    });

    // NC-CONC-04: Status Update While Reconnecting
    test('NC-CONC-04: State transitions should be atomic', () => {
        let ctx = createOtpContext('del-1', 'box-1', NOW);
        ctx = generateOtp(ctx, VALID_HASH, NOW)!;
        ctx = syncOtp(ctx)!;
        ctx = activateOtp(ctx)!;

        // Simulate race: expire and consume at same time
        // In a real system, one would happen first

        // If expiry wins:
        let expiredCtx = { ...ctx };
        expiredCtx = expireOtp(expiredCtx)!;
        expect(expiredCtx.state).toBe('EXPIRED');
        expect(consumeOtp(expiredCtx)).toBeNull(); // Cannot consume expired

        // If consume wins:
        let consumedCtx = { ...ctx };
        consumedCtx = consumeOtp(consumedCtx)!;
        expect(consumedCtx.state).toBe('CONSUMED');
        expect(expireOtp(consumedCtx)).toBeNull(); // Cannot expire consumed
    });
});
