/**
 * EC-89: Token Refresh Service
 * 
 * Proactively refreshes Firebase authentication tokens before expiry
 * to prevent 401 errors during mid-delivery operations.
 * 
 * Token Flow:
 * 1. Token issued at login (valid 1 hour)
 * 2. Every 5 minutes: check token age
 * 3. If age > 55 minutes: proactive refresh
 * 4. On failure: exponential backoff retry
 * 5. After 3 failures: force re-login
 */

import { getAuth, User } from 'firebase/auth';
import { getFirebaseDatabase } from './firebaseClient';
import { ref, set, serverTimestamp } from 'firebase/database';

// ==================== EC-89: Configuration ====================
export const TOKEN_REFRESH_CONFIG = {
    /** Check token age interval (ms) - 5 minutes */
    CHECK_INTERVAL_MS: 300000,
    /** Refresh when token older than this (ms) - 55 minutes */
    REFRESH_THRESHOLD_MS: 3300000,
    /** Token validity duration (ms) - 60 minutes */
    TOKEN_VALIDITY_MS: 3600000,
    /** Maximum refresh retry attempts */
    MAX_REFRESH_ATTEMPTS: 3,
    /** Base delay for exponential backoff (ms) */
    BASE_RETRY_DELAY_MS: 1000,
    /** Maximum backoff delay (ms) */
    MAX_RETRY_DELAY_MS: 16000,
};

// ==================== Types ====================
export type TokenStatus = 'HEALTHY' | 'EXPIRING' | 'EXPIRED' | 'REFRESHING' | 'FAILED';

export interface TokenHealthState {
    token_age_ms: number;
    refresh_attempts: number;
    last_refresh_at: number;
    status: TokenStatus;
    rider_id: string;
    expires_at?: number;
    error_message?: string;
}

export interface TokenRefreshCallbacks {
    onStatusChange?: (status: TokenStatus) => void;
    onRefreshSuccess?: () => void;
    onRefreshFailed?: (attempts: number) => void;
    onForceRelogin?: () => void;
}

// ==================== State ====================
let tokenCheckInterval: ReturnType<typeof setInterval> | null = null;
let refreshAttempts = 0;
let lastTokenRefreshTime = 0;
let currentStatus: TokenStatus = 'HEALTHY';
let callbacks: TokenRefreshCallbacks = {};

// ==================== Core Functions ====================

/**
 * Start the token refresh service
 * @param userCallbacks - Optional callbacks for status changes
 */
export function startTokenRefreshService(userCallbacks?: TokenRefreshCallbacks): void {
    if (tokenCheckInterval) {
        // console.log('[EC-89] Token refresh service already running');
        return;
    }

    callbacks = userCallbacks || {};
    lastTokenRefreshTime = Date.now();
    refreshAttempts = 0;
    currentStatus = 'HEALTHY';

    // console.log('[EC-89] Starting token refresh service');

    // Initial check
    checkTokenHealth();

    // Set up periodic check
    tokenCheckInterval = setInterval(
        checkTokenHealth,
        TOKEN_REFRESH_CONFIG.CHECK_INTERVAL_MS
    );
}

/**
 * Stop the token refresh service
 */
export function stopTokenRefreshService(): void {
    if (tokenCheckInterval) {
        clearInterval(tokenCheckInterval);
        tokenCheckInterval = null;
        // console.log('[EC-89] Token refresh service stopped');
    }
}

/**
 * Check current token health and refresh if needed
 */
export async function checkTokenHealth(): Promise<TokenHealthState> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        const state: TokenHealthState = {
            token_age_ms: 0,
            refresh_attempts: 0,
            last_refresh_at: 0,
            status: 'EXPIRED',
            rider_id: '',
            error_message: 'No authenticated user',
        };
        updateStatus('EXPIRED');
        return state;
    }

    const tokenAge = Date.now() - lastTokenRefreshTime;
    const isExpiring = tokenAge >= TOKEN_REFRESH_CONFIG.REFRESH_THRESHOLD_MS;
    const isExpired = tokenAge >= TOKEN_REFRESH_CONFIG.TOKEN_VALIDITY_MS;

    let status: TokenStatus = 'HEALTHY';

    if (isExpired) {
        status = 'EXPIRED';
    } else if (isExpiring) {
        status = 'EXPIRING';
    }

    const state: TokenHealthState = {
        token_age_ms: tokenAge,
        refresh_attempts: refreshAttempts,
        last_refresh_at: lastTokenRefreshTime,
        status,
        rider_id: user.uid,
        expires_at: lastTokenRefreshTime + TOKEN_REFRESH_CONFIG.TOKEN_VALIDITY_MS,
    };

    // Proactive refresh if expiring
    if (isExpiring && currentStatus !== 'REFRESHING') {
        // console.log(`[EC-89] Token expiring (age: ${Math.floor(tokenAge / 60000)} min), refreshing...`);
        await refreshToken(user);
    }

    return state;
}

/**
 * Refresh the Firebase auth token
 * @param user - Current Firebase user
 */
async function refreshToken(user: User): Promise<boolean> {
    updateStatus('REFRESHING');

    for (let attempt = 1; attempt <= TOKEN_REFRESH_CONFIG.MAX_REFRESH_ATTEMPTS; attempt++) {
        try {
            // console.log(`[EC-89] Token refresh attempt ${attempt}/${TOKEN_REFRESH_CONFIG.MAX_REFRESH_ATTEMPTS}`);

            // Force token refresh
            await user.getIdToken(true);

            // Success
            lastTokenRefreshTime = Date.now();
            refreshAttempts = 0;
            updateStatus('HEALTHY');

            // Report to Firebase
            await reportTokenHealthToFirebase(user.uid, 'HEALTHY');

            // console.log('[EC-89] Token refreshed successfully');
            callbacks.onRefreshSuccess?.();

            return true;
        } catch (error) {
            refreshAttempts = attempt;
            // console.warn(`[EC-89] Token refresh failed (attempt ${attempt}):`, error);

            // Exponential backoff
            const delay = Math.min(
                TOKEN_REFRESH_CONFIG.BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
                TOKEN_REFRESH_CONFIG.MAX_RETRY_DELAY_MS
            );

            if (attempt < TOKEN_REFRESH_CONFIG.MAX_REFRESH_ATTEMPTS) {
                // console.log(`[EC-89] Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    // All attempts failed
    updateStatus('FAILED');
    callbacks.onRefreshFailed?.(refreshAttempts);

    // Report failure to Firebase
    await reportTokenHealthToFirebase(user.uid, 'FAILED', 'Max refresh attempts exceeded');

    // Force re-login after max failures
    if (refreshAttempts >= TOKEN_REFRESH_CONFIG.MAX_REFRESH_ATTEMPTS) {
        // console.error('[EC-89] Token refresh failed after max attempts - forcing re-login');
        callbacks.onForceRelogin?.();
    }

    return false;
}

/**
 * Report token health to Firebase RTDB for monitoring
 */
async function reportTokenHealthToFirebase(
    riderId: string,
    status: TokenStatus,
    errorMessage?: string
): Promise<void> {
    try {
        const db = getFirebaseDatabase();
        const healthRef = ref(db, `riders/${riderId}/token_health`);

        const state: TokenHealthState = {
            token_age_ms: Date.now() - lastTokenRefreshTime,
            refresh_attempts: refreshAttempts,
            last_refresh_at: lastTokenRefreshTime,
            status,
            rider_id: riderId,
            expires_at: lastTokenRefreshTime + TOKEN_REFRESH_CONFIG.TOKEN_VALIDITY_MS,
            error_message: errorMessage,
        };

        await set(healthRef, {
            ...state,
            timestamp: serverTimestamp(),
        });
    } catch (error) {
        // Silent fail - don't block on reporting
        // console.warn('[EC-89] Failed to report token health:', error);
    }
}

/**
 * Update internal status and notify callback
 */
function updateStatus(status: TokenStatus): void {
    if (status !== currentStatus) {
        currentStatus = status;
        callbacks.onStatusChange?.(status);
    }
}

/**
 * Get current token status
 */
export function getTokenStatus(): TokenStatus {
    return currentStatus;
}

/**
 * Get time until token expiry in seconds
 */
export function getTimeUntilExpiry(): number {
    const expiresAt = lastTokenRefreshTime + TOKEN_REFRESH_CONFIG.TOKEN_VALIDITY_MS;
    const remaining = expiresAt - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
}

/**
 * Reset token refresh timer (call after successful login)
 */
export function resetTokenTimer(): void {
    lastTokenRefreshTime = Date.now();
    refreshAttempts = 0;
    updateStatus('HEALTHY');
    // console.log('[EC-89] Token timer reset');
}

/**
 * Force an immediate token refresh
 */
export async function forceTokenRefresh(): Promise<boolean> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        // console.warn('[EC-89] Cannot force refresh - no user');
        return false;
    }

    return refreshToken(user);
}

// ==================== Helpers ====================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format remaining time for display
 * @returns e.g., "4m 30s" or "Expired"
 */
export function formatTimeUntilExpiry(): string {
    const seconds = getTimeUntilExpiry();

    if (seconds <= 0) {
        return 'Expired';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    return `${remainingSeconds}s`;
}
