/**
 * Offline Cache Service
 * 
 * Caches delivery data locally so the app works without network.
 * Syncs changes when connectivity is restored.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const STORAGE_KEYS = {
    ACTIVE_DELIVERY: 'offline_active_delivery',
    PENDING_SYNCS: 'offline_pending_syncs',
    LAST_SYNC: 'offline_last_sync',
};

export interface CachedDelivery {
    id: string;
    trackingNumber: string;
    boxId: string;
    otpCode: string;
    status: string;
    pickupAddress: string;
    dropoffAddress: string;
    dropoffLat: number;
    dropoffLng: number;
    recipientName: string;
    recipientPhone?: string;
    cachedAt: number;
}

export interface PendingSync {
    type: 'status_update' | 'photo_upload' | 'location_update';
    deliveryId: string;
    payload: Record<string, unknown>;
    createdAt: number;
    retryCount: number;
}

class OfflineCacheService {
    private syncInProgress = false;

    /**
     * Cache a delivery for offline access
     */
    async cacheDelivery(delivery: CachedDelivery): Promise<void> {
        try {
            await AsyncStorage.setItem(
                STORAGE_KEYS.ACTIVE_DELIVERY,
                JSON.stringify({ ...delivery, cachedAt: Date.now() })
            );
            console.log('[OfflineCache] Delivery cached:', delivery.id);
        } catch (error) {
            console.error('[OfflineCache] Failed to cache delivery:', error);
        }
    }

    /**
     * Get cached delivery (works without network)
     */
    async getCachedDelivery(): Promise<CachedDelivery | null> {
        try {
            const cached = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_DELIVERY);
            return cached ? JSON.parse(cached) : null;
        } catch (error) {
            console.error('[OfflineCache] Failed to get cached delivery:', error);
            return null;
        }
    }

    /**
     * Clear cached delivery (after completion)
     */
    async clearCachedDelivery(): Promise<void> {
        try {
            await AsyncStorage.removeItem(STORAGE_KEYS.ACTIVE_DELIVERY);
            console.log('[OfflineCache] Cached delivery cleared');
        } catch (error) {
            console.error('[OfflineCache] Failed to clear cache:', error);
        }
    }

    /**
     * Queue an action for later sync
     */
    async queueSync(sync: Omit<PendingSync, 'createdAt' | 'retryCount'>): Promise<void> {
        try {
            const existing = await this.getPendingSyncs();
            const newSync: PendingSync = {
                ...sync,
                createdAt: Date.now(),
                retryCount: 0,
            };
            existing.push(newSync);
            await AsyncStorage.setItem(STORAGE_KEYS.PENDING_SYNCS, JSON.stringify(existing));
            console.log('[OfflineCache] Sync queued:', sync.type);
        } catch (error) {
            console.error('[OfflineCache] Failed to queue sync:', error);
        }
    }

    /**
     * Get all pending syncs
     */
    async getPendingSyncs(): Promise<PendingSync[]> {
        try {
            const pending = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_SYNCS);
            return pending ? JSON.parse(pending) : [];
        } catch (error) {
            console.error('[OfflineCache] Failed to get pending syncs:', error);
            return [];
        }
    }

    /**
     * Process pending syncs when back online
     */
    async processPendingSyncs(
        onSync: (sync: PendingSync) => Promise<boolean>
    ): Promise<{ success: number; failed: number }> {
        if (this.syncInProgress) {
            console.log('[OfflineCache] Sync already in progress');
            return { success: 0, failed: 0 };
        }

        this.syncInProgress = true;
        const results = { success: 0, failed: 0 };

        try {
            const pending = await this.getPendingSyncs();
            const remaining: PendingSync[] = [];

            for (const sync of pending) {
                try {
                    const success = await onSync(sync);
                    if (success) {
                        results.success++;
                    } else {
                        sync.retryCount++;
                        if (sync.retryCount < 5) {
                            remaining.push(sync);
                        } else {
                            results.failed++;
                            console.warn('[OfflineCache] Sync exceeded max retries:', sync.type);
                        }
                    }
                } catch (error) {
                    sync.retryCount++;
                    if (sync.retryCount < 5) {
                        remaining.push(sync);
                    } else {
                        results.failed++;
                    }
                }
            }

            await AsyncStorage.setItem(STORAGE_KEYS.PENDING_SYNCS, JSON.stringify(remaining));
            console.log(`[OfflineCache] Sync complete: ${results.success} success, ${results.failed} failed`);
        } finally {
            this.syncInProgress = false;
        }

        return results;
    }

    /**
     * Check if we have pending syncs
     */
    async hasPendingSyncs(): Promise<boolean> {
        const pending = await this.getPendingSyncs();
        return pending.length > 0;
    }

    /**
     * Get sync status for UI display
     */
    async getSyncStatus(): Promise<{
        pendingCount: number;
        lastSync: number | null;
        hasCachedDelivery: boolean;
    }> {
        const pending = await this.getPendingSyncs();
        const lastSyncStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC);
        const cached = await this.getCachedDelivery();

        return {
            pendingCount: pending.length,
            lastSync: lastSyncStr ? parseInt(lastSyncStr, 10) : null,
            hasCachedDelivery: cached !== null,
        };
    }

    /**
     * Update last sync timestamp
     */
    async updateLastSync(): Promise<void> {
        await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, Date.now().toString());
    }
}

export const offlineCache = new OfflineCacheService();
export default offlineCache;
