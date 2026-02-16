/**
 * Delivery Sync Service
 * 
 * Triggers the Vercel-hosted sync endpoint to push Firebase deliveries
 * into Supabase. Called on app startup and screen focus to ensure
 * Supabase always has the latest data.
 */

const SYNC_ENDPOINT = `${process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app'}/api/sync-deliveries`;

// Throttle: don't sync more than once per 30 seconds
let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 30_000;

let syncInProgress = false;

export interface SyncResult {
    synced: number;
    skipped: number;
    total: number;
    errors: string[];
    message: string;
}

/**
 * Trigger a Firebase-to-Supabase sync via the Vercel API endpoint.
 * Throttled to avoid excessive calls.
 *
 * @param force - bypass the throttle
 * @returns sync result or null if throttled/skipped
 */
export async function triggerDeliverySync(force = false): Promise<SyncResult | null> {
    const now = Date.now();

    if (!force && (now - lastSyncTime) < SYNC_THROTTLE_MS) {
        return null;
    }

    if (syncInProgress) {
        return null;
    }

    syncInProgress = true;
    lastSyncTime = now;
    console.log('[DeliverySync] Triggering sync at:', SYNC_ENDPOINT);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        const response = await fetch(SYNC_ENDPOINT, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.warn('[DeliverySync] Endpoint returned:', response.status);
            return null;
        }

        const result: SyncResult = await response.json();
        console.log('[DeliverySync] Sync complete:', result.message);
        return result;
    } catch (err: any) {
        if (err.name === 'AbortError') {
            console.warn('[DeliverySync] Sync request timed out');
        } else {
            console.warn('[DeliverySync] Sync failed:', err.message);
        }
        return null;
    } finally {
        syncInProgress = false;
    }
}
