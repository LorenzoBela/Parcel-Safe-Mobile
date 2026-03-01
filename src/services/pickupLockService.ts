/**
 * Pickup Lock Service — Grace Period & No-Show Management
 *
 * Once a rider arrives (status = ARRIVED), a grace period begins.
 * If the customer doesn't appear within GRACE_PERIOD_MS the rider
 * can mark the delivery as a "Customer No-Show", which cancels
 * the booking and applies a penalty.
 *
 * Design decisions:
 * - Grace period is measured from the ARRIVED timestamp, not from
 *   when the rider opens the screen, to prevent gaming.
 * - All Firebase writes use the rider's auth context.
 * - The no-show API call is server-authoritative; this service only
 *   manages local timer state and exposes helpers.
 */

import { ref, set, serverTimestamp } from 'firebase/database';

// ==================== Constants ====================

/** Grace period duration in milliseconds (10 minutes) */
export const GRACE_PERIOD_MS = 10 * 60 * 1000;

/** Statuses where the pickup location is permanently locked */
const LOCKED_STATUSES = [
    'ARRIVED',
    'COMPLETED',
    'RETURNED',
    'ATTEMPTED',
    'TAMPERED',
    'CANCELLED',
] as const;

/** Cancellation reason for no-show events */
export const NO_SHOW_REASON = 'CUSTOMER_NO_SHOW' as const;

// ==================== Types ====================

export interface GracePeriodState {
    deliveryId: string;
    startedAt: number;      // Epoch ms — when ARRIVED status was set
    durationMs: number;     // Grace period length
    status: 'ACTIVE' | 'EXPIRED';
}

// ==================== Pickup Lock ====================

/**
 * Returns true if the delivery status indicates the pickup
 * coordinates are permanently locked and cannot be changed.
 */
export function isPickupLocked(status: string): boolean {
    return LOCKED_STATUSES.includes(status as any);
}

/**
 * Inverse of isPickupLocked — returns true if the delivery is
 * still in a state where coordinates COULD theoretically be
 * updated (but we have removed that feature — this exists as
 * a guard in case any future code attempts to update).
 */
export function canUpdatePickupCoordinates(status: string): boolean {
    return !isPickupLocked(status);
}

// ==================== Grace Period ====================

/**
 * Create a new grace period state object.
 *
 * @param deliveryId  The delivery ID
 * @param arrivedAt   Epoch ms when the rider arrived (from ARRIVED timestamp)
 */
export function createGracePeriod(
    deliveryId: string,
    arrivedAt: number
): GracePeriodState {
    const now = Date.now();
    const elapsed = now - arrivedAt;

    return {
        deliveryId,
        startedAt: arrivedAt,
        durationMs: GRACE_PERIOD_MS,
        status: elapsed >= GRACE_PERIOD_MS ? 'EXPIRED' : 'ACTIVE',
    };
}

/**
 * Returns the number of milliseconds remaining in the grace period.
 * Returns 0 if expired.
 */
export function getGracePeriodRemaining(arrivedAt: number): number {
    const elapsed = Date.now() - arrivedAt;
    return Math.max(0, GRACE_PERIOD_MS - elapsed);
}

/**
 * Check if the grace period has fully expired.
 */
export function isGracePeriodExpired(arrivedAt: number): boolean {
    return getGracePeriodRemaining(arrivedAt) === 0;
}

/**
 * Format remaining grace period as MM:SS string
 */
export function formatGracePeriodRemaining(arrivedAt: number): string {
    const remaining = getGracePeriodRemaining(arrivedAt);
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ==================== No-Show ====================

/**
 * Write the grace period state to Firebase so the admin panel
 * can observe it.
 */
export async function writeGracePeriodToFirebase(
    database: any,
    deliveryId: string,
    arrivedAt: number
): Promise<void> {
    const gracePeriodRef = ref(database, `deliveries/${deliveryId}/grace_period`);
    await set(gracePeriodRef, {
        started_at: arrivedAt,
        duration_ms: GRACE_PERIOD_MS,
        reason: 'ARRIVED_WAITING',
    });
}

/**
 * Call the server-side no-show API to cancel the delivery.
 *
 * @returns Object with success flag and optional error message.
 */
export async function markNoShow(
    deliveryId: string,
    riderId: string,
    baseUrl?: string
): Promise<{ success: boolean; error?: string; penalty_applied?: boolean }> {
    try {
        const url = baseUrl
            ? `${baseUrl}/api/deliveries/${deliveryId}/no-show`
            : `/api/deliveries/${deliveryId}/no-show`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                riderId,
                reason: NO_SHOW_REASON,
                timestamp: Date.now(),
            }),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            return {
                success: false,
                error: data.error || `Server returned ${response.status}`,
            };
        }

        const data = await response.json();
        return {
            success: true,
            penalty_applied: data.penalty_applied ?? false,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || 'Network error — could not reach server',
        };
    }
}
