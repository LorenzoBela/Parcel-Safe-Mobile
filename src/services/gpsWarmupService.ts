/**
 * GPS Warmup Service (Enhanced)
 *
 * Forces the OS to power on the GPS radio as early as possible (AuthLoadingScreen)
 * so the first reading in RiderDashboard is accurate — eliminating snap-back lines
 * and the 10-second delay.
 *
 * Enhancements over a naive one-shot:
 *   1. Two-stage warmup — Balanced (cell/WiFi, fast) → High (GPS satellites, accurate).
 *   2. Subscription warmup — briefly runs watchPositionAsync for ~3s to keep the GPS
 *      radio persistently powered, maximizing the chance of a hot satellite lock.
 *   3. Cached warmup fix — stores the result so downstream code can compare accuracy.
 *   4. Firebase pre-connection — pokes Firebase RTDB to establish the WebSocket early,
 *      eliminating first-write latency when RiderDashboard starts sending location.
 *
 * Idempotent: multiple calls are no-ops after the first.
 * Non-blocking: has a hard 5s timeout so it never blocks navigation.
 * Permission-safe: only runs if foreground permission is already granted.
 */

import * as Location from 'expo-location';

// ==================== State ====================

let warmupPromise: Promise<void> | null = null;
let warmedUp = false;

/** The best fix obtained during warmup (null if warmup was skipped/timed out) */
let cachedWarmupFix: Location.LocationObject | null = null;

/** Hard timeout — never block the user longer than this (ms) */
const WARMUP_TIMEOUT_MS = 5000;

/** How long the subscription warmup keeps the GPS radio active (ms) */
const SUBSCRIPTION_DURATION_MS = 3000;

/** Minimum time since last warmup before allowing a re-warmup (ms) */
const RE_WARMUP_COOLDOWN_MS = 60000;

/** Timestamp of last warmup completion */
let lastWarmupTime = 0;
let foregroundWarmSub: Location.LocationSubscription | null = null;
let foregroundWarmTimer: NodeJS.Timeout | null = null;

// ==================== Public API ====================

/**
 * Whether the GPS chip has been warmed up (or timed out trying).
 * Use this to gate navigation in loading screens.
 */
export function isGpsWarmedUp(): boolean {
    return warmedUp;
}

/**
 * Get the cached warmup fix, if one was obtained.
 * Downstream code can compare this against the first real fix to detect garbage.
 */
export function getCachedWarmupFix(): Location.LocationObject | null {
    return cachedWarmupFix;
}

/**
 * Fire-and-forget GPS warmup.
 *
 * - Checks if foreground location permission is already granted (does NOT prompt).
 * - Runs a two-stage warmup (Balanced → High) + subscription warmup.
 * - Pre-connects Firebase RTDB + Supabase.
 * - Resolves when complete OR after WARMUP_TIMEOUT_MS, whichever is first.
 * - Idempotent: subsequent calls return the same promise.
 *
 * @returns A promise that resolves when warmup is complete (or skipped/timed out).
 */
export function warmUpLocationServices(): Promise<void> {
    if (warmupPromise) return warmupPromise;

    warmupPromise = executeWarmup();
    return warmupPromise;
}

/**
 * Reset the warmup state so it can run again.
 * Call this when the app returns to foreground after being backgrounded for a while.
 * Has a cooldown (RE_WARMUP_COOLDOWN_MS) to prevent excessive warmups.
 */
export function resetWarmup(): void {
    const now = Date.now();
    if (lastWarmupTime > 0 && now - lastWarmupTime < RE_WARMUP_COOLDOWN_MS) {
        // Too soon — GPS is probably still warm
        return;
    }
    console.log('[GPSWarmup] Resetting warmup state for re-warmup');
    warmupPromise = null;
    warmedUp = false;
    cachedWarmupFix = null;
}

/**
 * Foreground warm window: keep high-accuracy watcher active briefly after resume
 * so first in-screen GPS lock is fast and stable.
 */
export async function startForegroundGpsWarmWindow(durationMs = 25000): Promise<void> {
    try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;

        if (foregroundWarmSub) {
            foregroundWarmSub.remove();
            foregroundWarmSub = null;
        }
        if (foregroundWarmTimer) {
            clearTimeout(foregroundWarmTimer);
            foregroundWarmTimer = null;
        }

        foregroundWarmSub = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.High,
                timeInterval: 1000,
                distanceInterval: 1,
            },
            (location) => {
                storeBestFix(location);
            }
        );

        foregroundWarmTimer = setTimeout(() => {
            if (foregroundWarmSub) {
                foregroundWarmSub.remove();
                foregroundWarmSub = null;
            }
            foregroundWarmTimer = null;
        }, durationMs);
    } catch (error) {
        console.log('[GPSWarmup] Foreground warm window failed (non-fatal):', error);
    }
}

// ==================== Internal ====================

async function executeWarmup(): Promise<void> {
    try {
        // Only proceed if permission is already granted — never prompt during warmup
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
            console.log('[GPSWarmup] Foreground permission not granted — skipping warmup');
            warmedUp = true;
            return;
        }

        console.log('[GPSWarmup] Starting enhanced GPS warmup...');
        const startTime = Date.now();

        // Race everything against the hard timeout
        await Promise.race([
            runWarmupPipeline(),
            new Promise<void>((resolve) => setTimeout(resolve, WARMUP_TIMEOUT_MS)),
        ]);

        const elapsed = Date.now() - startTime;
        const accuracy = cachedWarmupFix?.coords.accuracy?.toFixed(0) ?? 'N/A';
        console.log(`[GPSWarmup] ✓ Warmup complete in ${elapsed}ms (best accuracy: ${accuracy}m)`);
    } catch (error) {
        // Non-fatal — the worst case is the first fix in RiderDashboard is a bit slow
        console.warn('[GPSWarmup] Warmup failed (non-fatal):', error);
    } finally {
        warmedUp = true;
        lastWarmupTime = Date.now();
    }
}

/**
 * The actual warmup pipeline. All stages run concurrently:
 *   - Stage A: Two-shot (Balanced → High)
 *   - Stage B: Subscription warmup (3s watchPositionAsync)
 *   - Stage C: Firebase RTDB pre-connection
 *   - Stage D: Supabase connection pre-warm
 */
async function runWarmupPipeline(): Promise<void> {
    await Promise.allSettled([
        stageA_twoShotFix(),
        stageB_subscriptionWarmup(),
        stageC_firebasePreConnect(),
        stageD_supabasePreWarm(),
    ]);
}

// ---- Stage A: Two-shot fix (Balanced → High) ----

async function stageA_twoShotFix(): Promise<void> {
    try {
        // Step 1: Fast cell/WiFi fix (~0.5-1s) — powers on the location subsystem
        const balancedFix = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });
        storeBestFix(balancedFix);
        console.log(`[GPSWarmup] Stage A.1: Balanced fix (acc=${balancedFix.coords.accuracy?.toFixed(0) ?? '?'}m)`);

        // Step 2: High-accuracy GPS fix — forces actual satellite acquisition
        const highFix = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
        });
        storeBestFix(highFix);
        console.log(`[GPSWarmup] Stage A.2: High fix (acc=${highFix.coords.accuracy?.toFixed(0) ?? '?'}m)`);
    } catch (error) {
        // One or both stages failed — that's OK, the subscription warmup may succeed
        console.log('[GPSWarmup] Stage A partial/full failure (non-fatal):', error);
    }
}

// ---- Stage B: Subscription warmup (keeps GPS radio persistently powered) ----

async function stageB_subscriptionWarmup(): Promise<void> {
    let subscription: Location.LocationSubscription | null = null;
    try {
        subscription = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.High,
                timeInterval: 1000,
                distanceInterval: 0,
            },
            (location) => {
                storeBestFix(location);
            }
        );

        // Keep the subscription alive for SUBSCRIPTION_DURATION_MS
        await new Promise<void>((resolve) =>
            setTimeout(resolve, SUBSCRIPTION_DURATION_MS)
        );
    } catch (error) {
        console.log('[GPSWarmup] Stage B failure (non-fatal):', error);
    } finally {
        if (subscription) {
            subscription.remove();
        }
    }
}

// ---- Stage C: Firebase RTDB pre-connection ----

async function stageC_firebasePreConnect(): Promise<void> {
    try {
        // Dynamically import to avoid circular dependency issues during early init.
        // Just touching getFirebaseDatabase() forces the SDK to establish its
        // WebSocket connection to the RTDB server, so by the time RiderDashboard
        // calls writePhoneLocation(), the socket is already open.
        const { getFirebaseDatabase } = await import('./firebaseClient');
        getFirebaseDatabase();
        console.log('[GPSWarmup] Stage C: Firebase RTDB pre-connected');
    } catch (error) {
        // Non-fatal — Firebase will connect lazily when first needed
        console.log('[GPSWarmup] Stage C failure (non-fatal):', error);
    }
}

// ---- Stage D: Supabase connection pre-warm ----

async function stageD_supabasePreWarm(): Promise<void> {
    try {
        const { supabase } = await import('./supabaseClient');
        if (supabase) {
            // getSession() forces the Supabase client to establish its HTTP connection
            // and refresh any stale JWT tokens, so RiderDashboard queries are instant.
            await supabase.auth.getSession();
            console.log('[GPSWarmup] Stage D: Supabase pre-warmed');
        }
    } catch (error) {
        console.log('[GPSWarmup] Stage D failure (non-fatal):', error);
    }
}

// ---- Helpers ----

/**
 * Keep the most accurate fix we've seen during warmup.
 */
function storeBestFix(fix: Location.LocationObject): void {
    const newAcc = fix.coords.accuracy ?? 999;
    const existingAcc = cachedWarmupFix?.coords.accuracy ?? 999;

    if (!cachedWarmupFix || newAcc < existingAcc) {
        cachedWarmupFix = fix;
    }
}
