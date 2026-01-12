/**
 * Offline Scenario Tests
 * 
 * Tests for mobile offline functionality based on:
 * - NEGATIVE_CASES.md: NC-MOB-01 to NC-MOB-10
 * - EDGE_CASES.md: Offline delivery handling
 * - STATE_CASES.md: SC-APP session states
 * 
 * CRITICAL: Riders often work in areas with poor connectivity
 */

// ============ CONSTANTS ============
const OFFLINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const OFFLINE_QUEUE_MAX_ITEMS = 50;
const SYNC_RETRY_DELAY_MS = 5000;
const SYNC_MAX_RETRIES = 10;
const BACKGROUND_LOCATION_INTERVAL_MS = 30000;
const FOREGROUND_LOCATION_INTERVAL_MS = 5000;

// ============ TYPES ============
interface CachedDelivery {
    id: string;
    data: {
        status: string;
        otpHash: string | null;
        dropoffAddress: string;
        dropoffLat: number;
        dropoffLng: number;
    };
    cachedAt: number;
    version: number;
}

interface PendingAction {
    id: string;
    type: 'STATUS_UPDATE' | 'LOCATION_UPDATE' | 'OTP_VERIFY' | 'PHOTO_UPLOAD';
    payload: unknown;
    createdAt: number;
    retries: number;
    lastRetryAt: number | null;
}

interface SyncStatus {
    lastSyncAt: number | null;
    pendingCount: number;
    isSyncing: boolean;
    lastError: string | null;
}

type AppState = 'ACTIVE' | 'BACKGROUND' | 'INACTIVE' | 'SUSPENDED';

// ============ CACHE MANAGEMENT ============
function isCacheExpired(cachedAt: number, now: number = Date.now()): boolean {
    return (now - cachedAt) > OFFLINE_CACHE_MAX_AGE_MS;
}

function shouldRefreshCache(
    cachedAt: number,
    refreshThresholdMs: number = 5 * 60 * 1000, // 5 minutes
    now: number = Date.now()
): boolean {
    return (now - cachedAt) > refreshThresholdMs;
}

function getCacheAge(cachedAt: number, now: number = Date.now()): number {
    return now - cachedAt;
}

function canUseCachedData(
    cached: CachedDelivery | null,
    isOnline: boolean,
    now: number = Date.now()
): { canUse: boolean; reason: string } {
    if (!cached) {
        return { canUse: false, reason: 'No cached data available' };
    }
    
    if (isCacheExpired(cached.cachedAt, now)) {
        if (!isOnline) {
            return { canUse: true, reason: 'Using expired cache (offline mode)' };
        }
        return { canUse: false, reason: 'Cache expired' };
    }
    
    return { canUse: true, reason: 'Cache valid' };
}

// ============ OFFLINE QUEUE MANAGEMENT ============
function canAddToOfflineQueue(currentSize: number): boolean {
    return currentSize < OFFLINE_QUEUE_MAX_ITEMS;
}

function shouldRetryAction(action: PendingAction, now: number = Date.now()): boolean {
    if (action.retries >= SYNC_MAX_RETRIES) return false;
    if (!action.lastRetryAt) return true;
    return (now - action.lastRetryAt) >= SYNC_RETRY_DELAY_MS;
}

function getNextRetryDelay(retries: number): number {
    // Exponential backoff capped at 5 minutes
    const delay = SYNC_RETRY_DELAY_MS * Math.pow(2, retries);
    return Math.min(delay, 5 * 60 * 1000);
}

function prioritizeOfflineQueue(actions: PendingAction[]): PendingAction[] {
    const priority: Record<PendingAction['type'], number> = {
        'OTP_VERIFY': 0,      // Highest - unlocking the box
        'STATUS_UPDATE': 1,   // Important for tracking
        'LOCATION_UPDATE': 2, // Regular updates
        'PHOTO_UPLOAD': 3,    // Can be deferred
    };
    
    return [...actions].sort((a, b) => {
        const priorityDiff = priority[a.type] - priority[b.type];
        if (priorityDiff !== 0) return priorityDiff;
        return a.createdAt - b.createdAt; // FIFO within same priority
    });
}

// ============ CONFLICT RESOLUTION ============
function resolveOfflineConflict(
    localVersion: number,
    serverVersion: number,
    localData: CachedDelivery['data'],
    serverData: CachedDelivery['data']
): { winner: 'local' | 'server' | 'merge'; result: CachedDelivery['data'] } {
    // Server always wins for status (authoritative)
    // But preserve local OTP if server doesn't have it
    
    if (serverVersion > localVersion) {
        // Server is newer - but check if we have pending OTP
        if (localData.otpHash && !serverData.otpHash) {
            return {
                winner: 'merge',
                result: { ...serverData, otpHash: localData.otpHash },
            };
        }
        return { winner: 'server', result: serverData };
    }
    
    if (localVersion > serverVersion) {
        return { winner: 'local', result: localData };
    }
    
    // Same version - server wins (it's authoritative)
    return { winner: 'server', result: serverData };
}

// ============ APP STATE MANAGEMENT ============
function getLocationInterval(appState: AppState): number {
    switch (appState) {
        case 'ACTIVE':
            return FOREGROUND_LOCATION_INTERVAL_MS;
        case 'BACKGROUND':
            return BACKGROUND_LOCATION_INTERVAL_MS;
        case 'INACTIVE':
        case 'SUSPENDED':
            return 0; // Don't track
    }
}

function shouldPauseLocationTracking(appState: AppState): boolean {
    return appState === 'INACTIVE' || appState === 'SUSPENDED';
}

function canShowNotification(appState: AppState): boolean {
    return appState !== 'ACTIVE'; // Only show notifications when not in foreground
}

// ============ SYNC STATUS ============
function getSyncStatusMessage(status: SyncStatus): string {
    if (status.isSyncing) {
        return `Syncing ${status.pendingCount} items...`;
    }
    
    if (status.lastError) {
        return `Sync failed: ${status.lastError}`;
    }
    
    if (status.pendingCount > 0) {
        return `${status.pendingCount} items pending sync`;
    }
    
    if (!status.lastSyncAt) {
        return 'Never synced';
    }
    
    return 'All synced';
}

function isSyncRequired(
    lastSyncAt: number | null,
    syncIntervalMs: number = 5 * 60 * 1000,
    now: number = Date.now()
): boolean {
    if (!lastSyncAt) return true;
    return (now - lastSyncAt) > syncIntervalMs;
}

// ============ TESTS ============
describe('NC-MOB: Offline Cache Management', () => {
    const NOW = Date.now();

    describe('NC-MOB-01: Cache Expiration', () => {
        test('should detect fresh cache', () => {
            expect(isCacheExpired(NOW - 60000, NOW)).toBe(false); // 1 minute ago
        });

        test('should detect expired cache (over 24 hours)', () => {
            expect(isCacheExpired(NOW - 25 * 60 * 60 * 1000, NOW)).toBe(true);
        });

        test('should handle boundary at 24 hours', () => {
            expect(isCacheExpired(NOW - OFFLINE_CACHE_MAX_AGE_MS, NOW)).toBe(false);
            expect(isCacheExpired(NOW - OFFLINE_CACHE_MAX_AGE_MS - 1, NOW)).toBe(true);
        });
    });

    describe('NC-MOB-02: Cache Refresh', () => {
        test('should suggest refresh for stale cache', () => {
            expect(shouldRefreshCache(NOW - 6 * 60 * 1000, 5 * 60 * 1000, NOW)).toBe(true);
        });

        test('should NOT suggest refresh for fresh cache', () => {
            expect(shouldRefreshCache(NOW - 2 * 60 * 1000, 5 * 60 * 1000, NOW)).toBe(false);
        });

        test('should calculate correct cache age', () => {
            expect(getCacheAge(NOW - 300000, NOW)).toBe(300000); // 5 minutes
        });
    });

    describe('NC-MOB-03: Offline Mode Decision', () => {
        test('should allow valid cache when online', () => {
            const cached: CachedDelivery = {
                id: 'del-1',
                data: {
                    status: 'IN_TRANSIT',
                    otpHash: null,
                    dropoffAddress: '123 Test St',
                    dropoffLat: 14.5995,
                    dropoffLng: 120.9842,
                },
                cachedAt: NOW - 60000,
                version: 1,
            };
            
            const result = canUseCachedData(cached, true, NOW);
            expect(result.canUse).toBe(true);
        });

        test('should reject expired cache when online', () => {
            const cached: CachedDelivery = {
                id: 'del-1',
                data: {
                    status: 'IN_TRANSIT',
                    otpHash: null,
                    dropoffAddress: '123 Test St',
                    dropoffLat: 14.5995,
                    dropoffLng: 120.9842,
                },
                cachedAt: NOW - 25 * 60 * 60 * 1000, // Expired
                version: 1,
            };
            
            const result = canUseCachedData(cached, true, NOW);
            expect(result.canUse).toBe(false);
        });

        test('should allow expired cache when offline', () => {
            const cached: CachedDelivery = {
                id: 'del-1',
                data: {
                    status: 'IN_TRANSIT',
                    otpHash: null,
                    dropoffAddress: '123 Test St',
                    dropoffLat: 14.5995,
                    dropoffLng: 120.9842,
                },
                cachedAt: NOW - 25 * 60 * 60 * 1000, // Expired
                version: 1,
            };
            
            const result = canUseCachedData(cached, false, NOW);
            expect(result.canUse).toBe(true);
            expect(result.reason).toContain('offline');
        });

        test('should reject null cache', () => {
            const result = canUseCachedData(null, true, NOW);
            expect(result.canUse).toBe(false);
        });
    });
});

describe('NC-MOB-04: Offline Queue', () => {
    const NOW = Date.now();

    test('should allow adding to queue under limit', () => {
        expect(canAddToOfflineQueue(0)).toBe(true);
        expect(canAddToOfflineQueue(49)).toBe(true);
    });

    test('should reject adding to full queue', () => {
        expect(canAddToOfflineQueue(50)).toBe(false);
        expect(canAddToOfflineQueue(51)).toBe(false);
    });

    describe('Retry Logic', () => {
        test('should allow first retry', () => {
            const action: PendingAction = {
                id: 'action-1',
                type: 'STATUS_UPDATE',
                payload: {},
                createdAt: NOW - 60000,
                retries: 0,
                lastRetryAt: null,
            };
            expect(shouldRetryAction(action, NOW)).toBe(true);
        });

        test('should respect retry delay', () => {
            const action: PendingAction = {
                id: 'action-1',
                type: 'STATUS_UPDATE',
                payload: {},
                createdAt: NOW - 60000,
                retries: 1,
                lastRetryAt: NOW - 1000, // 1 second ago
            };
            expect(shouldRetryAction(action, NOW)).toBe(false);
        });

        test('should allow retry after delay', () => {
            const action: PendingAction = {
                id: 'action-1',
                type: 'STATUS_UPDATE',
                payload: {},
                createdAt: NOW - 60000,
                retries: 1,
                lastRetryAt: NOW - 10000, // 10 seconds ago
            };
            expect(shouldRetryAction(action, NOW)).toBe(true);
        });

        test('should stop after max retries', () => {
            const action: PendingAction = {
                id: 'action-1',
                type: 'STATUS_UPDATE',
                payload: {},
                createdAt: NOW - 60000,
                retries: SYNC_MAX_RETRIES,
                lastRetryAt: NOW - 60000,
            };
            expect(shouldRetryAction(action, NOW)).toBe(false);
        });
    });

    describe('Queue Prioritization', () => {
        test('should prioritize OTP_VERIFY first', () => {
            const actions: PendingAction[] = [
                { id: '1', type: 'PHOTO_UPLOAD', payload: {}, createdAt: NOW - 1000, retries: 0, lastRetryAt: null },
                { id: '2', type: 'OTP_VERIFY', payload: {}, createdAt: NOW - 500, retries: 0, lastRetryAt: null },
                { id: '3', type: 'STATUS_UPDATE', payload: {}, createdAt: NOW - 2000, retries: 0, lastRetryAt: null },
            ];
            
            const sorted = prioritizeOfflineQueue(actions);
            expect(sorted[0].type).toBe('OTP_VERIFY');
            expect(sorted[1].type).toBe('STATUS_UPDATE');
            expect(sorted[2].type).toBe('PHOTO_UPLOAD');
        });

        test('should use FIFO within same priority', () => {
            const actions: PendingAction[] = [
                { id: '1', type: 'LOCATION_UPDATE', payload: {}, createdAt: NOW - 1000, retries: 0, lastRetryAt: null },
                { id: '2', type: 'LOCATION_UPDATE', payload: {}, createdAt: NOW - 3000, retries: 0, lastRetryAt: null },
                { id: '3', type: 'LOCATION_UPDATE', payload: {}, createdAt: NOW - 2000, retries: 0, lastRetryAt: null },
            ];
            
            const sorted = prioritizeOfflineQueue(actions);
            expect(sorted[0].id).toBe('2'); // Oldest first
            expect(sorted[1].id).toBe('3');
            expect(sorted[2].id).toBe('1');
        });
    });
});

describe('NC-MOB-05: Conflict Resolution', () => {
    test('should prefer server when server version is newer', () => {
        const local = { status: 'IN_TRANSIT', otpHash: null, dropoffAddress: 'A', dropoffLat: 0, dropoffLng: 0 };
        const server = { status: 'ARRIVED', otpHash: null, dropoffAddress: 'A', dropoffLat: 0, dropoffLng: 0 };
        
        const result = resolveOfflineConflict(1, 2, local, server);
        expect(result.winner).toBe('server');
        expect(result.result.status).toBe('ARRIVED');
    });

    test('should prefer local when local version is newer', () => {
        const local = { status: 'ARRIVED', otpHash: 'hash123', dropoffAddress: 'A', dropoffLat: 0, dropoffLng: 0 };
        const server = { status: 'IN_TRANSIT', otpHash: null, dropoffAddress: 'A', dropoffLat: 0, dropoffLng: 0 };
        
        const result = resolveOfflineConflict(2, 1, local, server);
        expect(result.winner).toBe('local');
        expect(result.result.status).toBe('ARRIVED');
    });

    test('should merge when server newer but local has OTP', () => {
        const local = { status: 'IN_TRANSIT', otpHash: 'localhash', dropoffAddress: 'A', dropoffLat: 0, dropoffLng: 0 };
        const server = { status: 'ARRIVED', otpHash: null, dropoffAddress: 'A', dropoffLat: 0, dropoffLng: 0 };
        
        const result = resolveOfflineConflict(1, 2, local, server);
        expect(result.winner).toBe('merge');
        expect(result.result.status).toBe('ARRIVED'); // Server status
        expect(result.result.otpHash).toBe('localhash'); // Local OTP
    });
});

describe('NC-MOB-06: App State Management', () => {
    test('should use faster interval when active', () => {
        expect(getLocationInterval('ACTIVE')).toBe(FOREGROUND_LOCATION_INTERVAL_MS);
    });

    test('should use slower interval when in background', () => {
        expect(getLocationInterval('BACKGROUND')).toBe(BACKGROUND_LOCATION_INTERVAL_MS);
    });

    test('should stop tracking when inactive/suspended', () => {
        expect(getLocationInterval('INACTIVE')).toBe(0);
        expect(getLocationInterval('SUSPENDED')).toBe(0);
    });

    test('should pause tracking for inactive states', () => {
        expect(shouldPauseLocationTracking('ACTIVE')).toBe(false);
        expect(shouldPauseLocationTracking('BACKGROUND')).toBe(false);
        expect(shouldPauseLocationTracking('INACTIVE')).toBe(true);
        expect(shouldPauseLocationTracking('SUSPENDED')).toBe(true);
    });

    test('should show notifications only when not active', () => {
        expect(canShowNotification('ACTIVE')).toBe(false);
        expect(canShowNotification('BACKGROUND')).toBe(true);
        expect(canShowNotification('INACTIVE')).toBe(true);
    });
});

describe('NC-MOB-07: Sync Status', () => {
    test('should report syncing status', () => {
        const status: SyncStatus = {
            lastSyncAt: Date.now(),
            pendingCount: 5,
            isSyncing: true,
            lastError: null,
        };
        expect(getSyncStatusMessage(status)).toContain('Syncing');
    });

    test('should report error status', () => {
        const status: SyncStatus = {
            lastSyncAt: Date.now(),
            pendingCount: 5,
            isSyncing: false,
            lastError: 'Network error',
        };
        expect(getSyncStatusMessage(status)).toContain('failed');
    });

    test('should report pending items', () => {
        const status: SyncStatus = {
            lastSyncAt: Date.now(),
            pendingCount: 5,
            isSyncing: false,
            lastError: null,
        };
        expect(getSyncStatusMessage(status)).toContain('pending');
    });

    test('should report all synced', () => {
        const status: SyncStatus = {
            lastSyncAt: Date.now(),
            pendingCount: 0,
            isSyncing: false,
            lastError: null,
        };
        expect(getSyncStatusMessage(status)).toContain('synced');
    });

    test('should detect when sync is required', () => {
        const NOW = Date.now();
        expect(isSyncRequired(null, 5 * 60 * 1000, NOW)).toBe(true);
        expect(isSyncRequired(NOW - 6 * 60 * 1000, 5 * 60 * 1000, NOW)).toBe(true);
        expect(isSyncRequired(NOW - 2 * 60 * 1000, 5 * 60 * 1000, NOW)).toBe(false);
    });
});

describe('Exponential Backoff', () => {
    test('should calculate increasing delays', () => {
        const delays = [0, 1, 2, 3, 4].map(getNextRetryDelay);
        expect(delays[0]).toBe(5000);      // 5s
        expect(delays[1]).toBe(10000);     // 10s
        expect(delays[2]).toBe(20000);     // 20s
        expect(delays[3]).toBe(40000);     // 40s
        expect(delays[4]).toBe(80000);     // 80s
    });

    test('should cap at maximum delay', () => {
        expect(getNextRetryDelay(10)).toBe(5 * 60 * 1000); // Max 5 minutes
        expect(getNextRetryDelay(15)).toBe(5 * 60 * 1000);
    });
});
