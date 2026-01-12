/**
 * Offline Cache Tests
 * 
 * Tests for offline caching functionality based on:
 * - USE_CASES.md: UC-M04, UC-M09
 * - NEGATIVE_CASES.md: NC-MOB-09
 * - BOUNDARY_CASES.md: BC-COLL-10, BC-COLL-11
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
}));

import { offlineCache, CachedDelivery, PendingSync } from '../services/offlineCache';

describe('Offline Cache Service', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ============ USE CASES ============
    describe('UC-M04: Cache Delivery Locally', () => {
        const mockDelivery: CachedDelivery = {
            id: 'delivery-123',
            trackingNumber: 'TRK-001',
            boxId: 'BOX-001',
            otpCode: '123456',
            status: 'IN_TRANSIT',
            pickupAddress: '123 Pickup St',
            dropoffAddress: '456 Drop Ave',
            dropoffLat: 14.5995,
            dropoffLng: 120.9842,
            recipientName: 'John Doe',
            cachedAt: Date.now(),
        };

        test('should cache delivery data', async () => {
            await offlineCache.cacheDelivery(mockDelivery);
            expect(AsyncStorage.setItem).toHaveBeenCalledWith(
                'offline_active_delivery',
                expect.any(String)
            );
        });

        test('should retrieve cached delivery', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockDelivery));

            const result = await offlineCache.getCachedDelivery();
            expect(result).toHaveProperty('id', 'delivery-123');
            expect(result).toHaveProperty('otpCode', '123456');
        });

        test('should return null when no cached delivery', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

            const result = await offlineCache.getCachedDelivery();
            expect(result).toBeNull();
        });

        test('should clear cached delivery after completion', async () => {
            await offlineCache.clearCachedDelivery();
            expect(AsyncStorage.removeItem).toHaveBeenCalledWith('offline_active_delivery');
        });
    });

    describe('UC-M09: Sync Pending Updates on Reconnect', () => {
        const mockSync: Omit<PendingSync, 'createdAt' | 'retryCount'> = {
            type: 'status_update',
            deliveryId: 'delivery-123',
            payload: { status: 'COMPLETED' },
        };

        test('should queue sync for later', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('[]');

            await offlineCache.queueSync(mockSync);
            expect(AsyncStorage.setItem).toHaveBeenCalledWith(
                'offline_pending_syncs',
                expect.any(String)
            );
        });

        test('should retrieve pending syncs', async () => {
            const pendingData: PendingSync[] = [
                { ...mockSync, createdAt: Date.now(), retryCount: 0 }
            ];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(pendingData));

            const result = await offlineCache.getPendingSyncs();
            expect(result).toHaveLength(1);
            expect(result[0]).toHaveProperty('type', 'status_update');
        });

        test('should return empty array when no pending syncs', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

            const result = await offlineCache.getPendingSyncs();
            expect(result).toEqual([]);
        });

        test('should process pending syncs successfully', async () => {
            const pendingData: PendingSync[] = [
                { type: 'status_update', deliveryId: '1', payload: {}, createdAt: Date.now(), retryCount: 0 },
                { type: 'photo_upload', deliveryId: '2', payload: {}, createdAt: Date.now(), retryCount: 0 },
            ];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(pendingData));

            const mockOnSync = jest.fn().mockResolvedValue(true);
            const result = await offlineCache.processPendingSyncs(mockOnSync);

            expect(mockOnSync).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(2);
            expect(result.failed).toBe(0);
        });

        test('should retry failed syncs up to 5 times', async () => {
            const pendingData: PendingSync[] = [
                { type: 'status_update', deliveryId: '1', payload: {}, createdAt: Date.now(), retryCount: 4 },
            ];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(pendingData));

            const mockOnSync = jest.fn().mockResolvedValue(false); // Always fails
            const result = await offlineCache.processPendingSyncs(mockOnSync);

            expect(result.success).toBe(0);
            expect(result.failed).toBe(1); // Max retries exceeded
        });
    });

    // ============ NEGATIVE CASES ============
    describe('NC-MOB-09: Offline Queue Overflow', () => {
        const MAX_QUEUE_SIZE = 50; // From documentation

        test('should handle large queue without memory issues', async () => {
            const largePendingData: PendingSync[] = Array.from({ length: 100 }, (_, i) => ({
                type: 'location_update' as const,
                deliveryId: `delivery-${i}`,
                payload: { lat: 14.5995, lng: 120.9842 },
                createdAt: Date.now() - i * 1000,
                retryCount: 0,
            }));

            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(largePendingData));

            const result = await offlineCache.getPendingSyncs();
            expect(result.length).toBe(100);
        });

        test('should detect pending syncs exist', async () => {
            const pendingData: PendingSync[] = [
                { type: 'status_update', deliveryId: '1', payload: {}, createdAt: Date.now(), retryCount: 0 }
            ];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(pendingData));

            const hasPending = await offlineCache.hasPendingSyncs();
            expect(hasPending).toBe(true);
        });

        test('should detect no pending syncs', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('[]');

            const hasPending = await offlineCache.hasPendingSyncs();
            expect(hasPending).toBe(false);
        });
    });

    // ============ BOUNDARY CASES ============
    describe('BC-COLL: Pending Sync Collection Boundaries', () => {
        // BC-COLL-10: Pending Notifications = 0
        test('BC-COLL-10: Zero pending syncs should be handled', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('[]');

            const result = await offlineCache.getPendingSyncs();
            expect(result).toHaveLength(0);
        });

        // BC-COLL-11: Many pending syncs
        test('BC-COLL-11: Large number of pending syncs should be processed', async () => {
            const largePendingData: PendingSync[] = Array.from({ length: 50 }, (_, i) => ({
                type: 'location_update' as const,
                deliveryId: `delivery-${i}`,
                payload: {},
                createdAt: Date.now(),
                retryCount: 0,
            }));

            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(largePendingData));

            const mockOnSync = jest.fn().mockResolvedValue(true);
            const result = await offlineCache.processPendingSyncs(mockOnSync);

            expect(mockOnSync).toHaveBeenCalledTimes(50);
            expect(result.success).toBe(50);
        });
    });

    // ============ SYNC STATUS ============
    describe('Sync Status Queries', () => {
        test('should return correct sync status', async () => {
            const pendingData: PendingSync[] = [
                { type: 'status_update', deliveryId: '1', payload: {}, createdAt: Date.now(), retryCount: 0 },
                { type: 'photo_upload', deliveryId: '2', payload: {}, createdAt: Date.now(), retryCount: 0 },
            ];

            (AsyncStorage.getItem as jest.Mock)
                .mockResolvedValueOnce(JSON.stringify(pendingData)) // pending syncs
                .mockResolvedValueOnce('1704067200000') // last sync timestamp
                .mockResolvedValueOnce(JSON.stringify({ id: 'delivery-1' })); // cached delivery

            const status = await offlineCache.getSyncStatus();

            expect(status.pendingCount).toBe(2);
            expect(status.lastSync).toBe(1704067200000);
            expect(status.hasCachedDelivery).toBe(true);
        });

        test('should update last sync timestamp', async () => {
            await offlineCache.updateLastSync();
            expect(AsyncStorage.setItem).toHaveBeenCalledWith(
                'offline_last_sync',
                expect.any(String)
            );
        });
    });

    // ============ ERROR HANDLING ============
    describe('Error Handling', () => {
        test('should handle AsyncStorage errors gracefully on cache', async () => {
            (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Storage full'));

            // Should not throw
            await expect(offlineCache.cacheDelivery({
                id: 'test',
                trackingNumber: 'TRK',
                boxId: 'BOX',
                otpCode: '123456',
                status: 'PENDING',
                pickupAddress: 'Test',
                dropoffAddress: 'Test',
                dropoffLat: 0,
                dropoffLng: 0,
                recipientName: 'Test',
                cachedAt: Date.now(),
            })).resolves.toBeUndefined();
        });

        test('should handle AsyncStorage errors gracefully on get', async () => {
            (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('Read error'));

            const result = await offlineCache.getCachedDelivery();
            expect(result).toBeNull();
        });

        test('should handle AsyncStorage errors gracefully on getPendingSyncs', async () => {
            (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('Read error'));

            const result = await offlineCache.getPendingSyncs();
            expect(result).toEqual([]);
        });

        test('should not double-process syncs', async () => {
            const pendingData: PendingSync[] = [
                { type: 'status_update', deliveryId: '1', payload: {}, createdAt: Date.now(), retryCount: 0 }
            ];
            (AsyncStorage.getItem as jest.Mock)
                .mockResolvedValueOnce(JSON.stringify(pendingData))
                .mockResolvedValueOnce(JSON.stringify(pendingData));

            const mockOnSync = jest.fn().mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(true), 100))
            );

            // Start first processing
            const first = offlineCache.processPendingSyncs(mockOnSync);

            // Try to start second while first is in progress
            const second = offlineCache.processPendingSyncs(mockOnSync);

            await Promise.all([first, second]);

            // Should only process once due to syncInProgress guard
            expect(mockOnSync).toHaveBeenCalledTimes(1);
        });
    });
});
