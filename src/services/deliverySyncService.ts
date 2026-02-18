/**
 * Delivery Sync Service
 * 
 * Triggers the Vercel-hosted sync endpoint to push Firebase deliveries
 * into Supabase. Called on app startup and screen focus to ensure
 * Supabase always has the latest data.
 * 
 * IMPROVEMENTS:
 * - Exponential backoff retries (1s, 2s, 4s)
 * - Robust error handling for 500/503
 * - Timeout enforcement
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
 * Wait for a specified duration (ms)
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Trigger a Firebase-to-Supabase sync via the Vercel API endpoint.
 * Throttled to avoid excessive calls. Uses exponential backoff for reliability.
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
        console.log('[DeliverySync] Sync already in progress, skipping.');
        return null;
    }

    syncInProgress = true;
    lastSyncTime = now;
    console.log('[DeliverySync] Triggering sync at:', SYNC_ENDPOINT);

    const MAX_RETRIES = 3;
    let attempt = 0;

    try {
        while (attempt < MAX_RETRIES) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15s timeout

                const response = await fetch(SYNC_ENDPOINT, {
                    method: 'GET',
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const result: SyncResult = await response.json();
                    console.log(`[DeliverySync] Success: ${result.message}`);
                    return result;
                }

                // If 5xx error, throw to trigger retry
                if (response.status >= 500) {
                    throw new Error(`Server Error ${response.status}`);
                }

                // If 4xx error, don't retry, just log and exit
                console.warn('[DeliverySync] Client Error:', response.status);
                return null;

            } catch (err: any) {
                attempt++;
                const isTimeout = err.name === 'AbortError';
                const errorMessage = isTimeout ? 'Request Timed Out' : err.message;

                console.warn(`[DeliverySync] Attempt ${attempt} failed: ${errorMessage}`);

                if (attempt >= MAX_RETRIES) {
                    console.error('[DeliverySync] Max retries reached. Sync failed.');
                    lastSyncTime = 0; // Reset throttle so we can try again sooner next time manually
                    return null; // Give up
                }

                // Exponential backoff: 1s, 2s, 4s...
                const backoffTime = Math.pow(2, attempt - 1) * 1000;
                console.log(`[DeliverySync] Retrying in ${backoffTime}ms...`);
                await delay(backoffTime);
            }
        }
    } finally {
        syncInProgress = false;
    }

    return null;
}
