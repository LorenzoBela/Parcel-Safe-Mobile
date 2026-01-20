/**
 * Admin Override Service (EC-77)
 * 
 * Handles admin remote unlock detection and notification.
 * Per user approval: Admin override is IMMEDIATE (no confirmation required).
 * 
 * Firebase Node: /boxes/{boxId}/admin_override/
 */

import { getFirebaseDatabase } from './firebaseClient';
import { ref, onValue, off, set, serverTimestamp } from 'firebase/database';

// ==================== EC-77: Types ====================

export interface AdminOverrideState {
    active: boolean;
    triggered_by: string;
    triggered_at: number;
    reason?: string;
    processed?: boolean;
}

// ==================== EC-77: Constants ====================

export const ADMIN_OVERRIDE_TIMEOUT_MS = 5000; // Override state clears after 5s

// ==================== EC-77: Functions ====================

/**
 * Subscribe to admin override state for a box
 */
export function subscribeToAdminOverride(
    boxId: string,
    callback: (state: AdminOverrideState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const overrideRef = ref(db, `boxes/${boxId}/admin_override`);

    onValue(overrideRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            callback({
                active: data.active ?? false,
                triggered_by: data.triggered_by ?? '',
                triggered_at: data.triggered_at ?? 0,
                reason: data.reason,
                processed: data.processed,
            });
        } else {
            callback(null);
        }
    });

    return () => off(overrideRef);
}

/**
 * Check if admin override is active and should be processed
 */
export function shouldProcessOverride(state: AdminOverrideState | null): boolean {
    if (!state) return false;
    return state.active && !state.processed;
}

/**
 * Mark override as processed (called after handling)
 */
export async function markOverrideProcessed(boxId: string): Promise<void> {
    const db = getFirebaseDatabase();
    const processedRef = ref(db, `boxes/${boxId}/admin_override/processed`);
    await set(processedRef, true);
}

/**
 * Check if override has timed out
 */
export function isOverrideTimedOut(
    state: AdminOverrideState | null,
    currentTime: number = Date.now()
): boolean {
    if (!state || !state.active) return false;
    return (currentTime - state.triggered_at) >= ADMIN_OVERRIDE_TIMEOUT_MS;
}

/**
 * Get display message for admin override notification
 */
export function getOverrideNotificationMessage(state: AdminOverrideState): string {
    if (state.reason) {
        return `Box remotely unlocked by admin: ${state.reason}`;
    }
    return 'Box has been remotely unlocked by an administrator';
}

/**
 * Format admin ID for display (truncate if too long)
 */
export function formatAdminId(adminId: string): string {
    if (adminId.length <= 20) return adminId;
    return `${adminId.substring(0, 8)}...${adminId.substring(adminId.length - 4)}`;
}

/**
 * Trigger an admin override to unlock a box
 */
export async function triggerAdminOverride(
    boxId: string,
    adminId: string,
    reason: string
): Promise<void> {
    const db = getFirebaseDatabase();
    const overrideRef = ref(db, `boxes/${boxId}/admin_override`);

    await set(overrideRef, {
        active: true,
        triggered_by: adminId,
        triggered_at: serverTimestamp(),
        reason: reason,
        processed: false
    });
}
