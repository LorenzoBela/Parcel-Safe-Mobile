/**
 * Delivery Reassignment Service (EC-78)
 * 
 * Handles delivery reassignment during navigation.
 * Per user approval: Auto-acknowledge after 30-second timeout.
 * 
 * Firebase Node: /boxes/{boxId}/reassignment/
 */

import { getFirebaseDatabase } from './firebaseClient';
import { ref, onValue, off, set, update, serverTimestamp } from 'firebase/database';

// ==================== EC-78: Types ====================

export interface ReassignmentState {
    pending: boolean;
    old_rider_id: string;
    new_rider_id: string;
    delivery_id: string;
    acknowledged: boolean;
    acknowledged_at?: number;
    triggered_at: number;
}

export type ReassignmentCallback = (state: ReassignmentState | null) => void;

// ==================== EC-78: Constants ====================

export const REASSIGNMENT_AUTO_ACK_TIMEOUT_MS = 30000; // 30 seconds
export const REASSIGNMENT_CHECK_INTERVAL_MS = 1000;    // Check every second

// ==================== EC-78: Functions ====================

/**
 * Subscribe to delivery reassignment state
 */
export function subscribeToReassignment(
    boxId: string,
    callback: ReassignmentCallback
): () => void {
    const db = getFirebaseDatabase();
    const reassignmentRef = ref(db, `boxes/${boxId}/reassignment`);

    onValue(reassignmentRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            callback({
                pending: data.pending ?? false,
                old_rider_id: data.old_rider_id ?? '',
                new_rider_id: data.new_rider_id ?? '',
                delivery_id: data.delivery_id ?? '',
                acknowledged: data.acknowledged ?? false,
                acknowledged_at: data.acknowledged_at,
                triggered_at: data.triggered_at ?? 0,
            });
        } else {
            callback(null);
        }
    });

    return () => off(reassignmentRef);
}

/**
 * Check if reassignment is pending for current rider
 */
export function isReassignmentPending(state: ReassignmentState | null): boolean {
    if (!state) return false;
    return state.pending && !state.acknowledged;
}

/**
 * Check if reassignment affects the current rider
 * @param state Reassignment state
 * @param currentRiderId Current rider's ID
 * @returns 'outgoing' if rider is being replaced, 'incoming' if rider is new assignment, null otherwise
 */
export function getReassignmentType(
    state: ReassignmentState | null,
    currentRiderId: string
): 'outgoing' | 'incoming' | null {
    if (!state || !state.pending) return null;

    if (state.old_rider_id === currentRiderId) return 'outgoing';
    if (state.new_rider_id === currentRiderId) return 'incoming';
    return null;
}

/**
 * Calculate remaining time before auto-acknowledge (in seconds)
 */
export function getRemainingAutoAckSeconds(
    state: ReassignmentState | null,
    currentTime: number = Date.now()
): number {
    if (!state || !state.pending || state.acknowledged) return 0;

    const elapsed = currentTime - state.triggered_at;
    const remaining = REASSIGNMENT_AUTO_ACK_TIMEOUT_MS - elapsed;

    return Math.max(0, Math.floor(remaining / 1000));
}

/**
 * Check if auto-acknowledge should trigger
 */
export function shouldAutoAcknowledge(
    state: ReassignmentState | null,
    currentTime: number = Date.now()
): boolean {
    if (!state || !state.pending || state.acknowledged) return false;
    return (currentTime - state.triggered_at) >= REASSIGNMENT_AUTO_ACK_TIMEOUT_MS;
}

/**
 * Acknowledge the reassignment (manually or auto)
 */
export async function acknowledgeReassignment(
    boxId: string,
    riderId: string
): Promise<void> {
    const db = getFirebaseDatabase();
    const reassignmentRef = ref(db, `boxes/${boxId}/reassignment`);

    await update(reassignmentRef, {
        acknowledged: true,
        acknowledged_at: Date.now(),
        acknowledged_by: riderId,
        pending: false,
    });

    console.log(`[EC-78] Reassignment acknowledged by ${riderId}`);
}

/**
 * Get display message for reassignment alert
 */
export function getReassignmentAlertMessage(
    state: ReassignmentState,
    type: 'outgoing' | 'incoming'
): string {
    if (type === 'outgoing') {
        return `This delivery has been reassigned to another rider. You have ${getRemainingAutoAckSeconds(state)} seconds to respond.`;
    }
    return `A delivery has been reassigned to you. Please review and acknowledge.`;
}

/**
 * Format time remaining for display (MM:SS)
 */
export function formatRemainingTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Start auto-acknowledge timer
 * Returns a cleanup function to cancel the timer
 */
export function startAutoAckTimer(
    boxId: string,
    riderId: string,
    state: ReassignmentState,
    onAutoAck: () => void
): () => void {
    const remaining = getRemainingAutoAckSeconds(state);

    if (remaining <= 0) {
        // Already timed out, acknowledge immediately
        acknowledgeReassignment(boxId, riderId)
            .then(onAutoAck)
            .catch(console.error);
        return () => { };
    }

    const timeoutId = setTimeout(async () => {
        try {
            await acknowledgeReassignment(boxId, riderId);
            onAutoAck();
        } catch (error) {
            console.error('[EC-78] Auto-acknowledge failed:', error);
        }
    }, remaining * 1000);

    return () => clearTimeout(timeoutId);
}
