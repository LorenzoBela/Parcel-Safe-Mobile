/**
 * EC-35: Status Update Lost Tests
 * 
 * Tests for delivery status update queue with exponential backoff retry
 */

import {
    EC35_CONFIG,
    getRetryDelay,
    isRetryDue,
    isMaxRetriesExceeded,
    buildRetryTransitionMetadata,
    statusUpdateService,
    StatusUpdateEntry,
} from '../services/statusUpdateService';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('EC-35: Status Update Lost', () => {
    describe('getRetryDelay', () => {
        it('should return base delay for first retry', () => {
            expect(getRetryDelay(0)).toBe(EC35_CONFIG.BASE_RETRY_MS);
        });

        it('should double delay with each retry', () => {
            expect(getRetryDelay(1)).toBe(2000);  // 2s
            expect(getRetryDelay(2)).toBe(4000);  // 4s
            expect(getRetryDelay(3)).toBe(8000);  // 8s
            expect(getRetryDelay(4)).toBe(16000); // 16s
        });

        it('should return 0 when max retries exceeded', () => {
            expect(getRetryDelay(5)).toBe(0);
            expect(getRetryDelay(10)).toBe(0);
        });
    });

    describe('isRetryDue', () => {
        it('should return false for synced entries', () => {
            const entry: StatusUpdateEntry = {
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 0,
                synced: true,
            };
            expect(isRetryDue(entry, 1002000)).toBe(false);
        });

        it('should return false when delay not elapsed', () => {
            const entry: StatusUpdateEntry = {
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 1,
                synced: false,
            };
            // Retry 1 needs 2s delay
            expect(isRetryDue(entry, 1001000)).toBe(false);
        });

        it('should return true when delay elapsed', () => {
            const entry: StatusUpdateEntry = {
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 1,
                synced: false,
            };
            // Retry 1 needs 2s delay
            expect(isRetryDue(entry, 1002000)).toBe(true);
            expect(isRetryDue(entry, 1005000)).toBe(true);
        });

        it('should return false when max retries exceeded', () => {
            const entry: StatusUpdateEntry = {
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 5,
                synced: false,
            };
            expect(isRetryDue(entry, 2000000)).toBe(false);
        });
    });

    describe('isMaxRetriesExceeded', () => {
        it('should return true when retry count >= max and not synced', () => {
            const entry: StatusUpdateEntry = {
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 5,
                synced: false,
            };
            expect(isMaxRetriesExceeded(entry)).toBe(true);
        });

        it('should return false when retry count < max', () => {
            const entry: StatusUpdateEntry = {
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 4,
                synced: false,
            };
            expect(isMaxRetriesExceeded(entry)).toBe(false);
        });

        it('should return false when synced even with max retries', () => {
            const entry: StatusUpdateEntry = {
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 5,
                synced: true,
            };
            expect(isMaxRetriesExceeded(entry)).toBe(false);
        });
    });

    describe('Queue Configuration', () => {
        it('should have correct default configuration', () => {
            expect(EC35_CONFIG.MAX_QUEUE_ENTRIES).toBe(10);
            expect(EC35_CONFIG.MAX_RETRIES).toBe(5);
            expect(EC35_CONFIG.BASE_RETRY_MS).toBe(1000);
        });
    });

    describe('Retry Metadata', () => {
        it('should preserve photo metadata when replaying a completed status update', () => {
            const entry: StatusUpdateEntry = {
                queueId: 'status-queue-1',
                deliveryId: 'DEL-001',
                boxId: 'BOX-001',
                status: 'COMPLETED',
                metadata: {
                    proof_photo_url: 'https://example.test/proof.jpg',
                    proof_photo_uploaded_at: 1710000000000,
                    completed_at: 1710000000000,
                },
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 1,
                synced: false,
            };

            expect(buildRetryTransitionMetadata(entry)).toEqual({
                proof_photo_url: 'https://example.test/proof.jpg',
                proof_photo_uploaded_at: 1710000000000,
                completed_at: 1710000000000,
                retrySource: 'mobile_retry',
                boxId: 'BOX-001',
                queueId: 'status-queue-1',
            });
        });

        it('should merge newer photo metadata into an existing entry even when the queue is full', async () => {
            const fullQueue: StatusUpdateEntry[] = Array.from({ length: EC35_CONFIG.MAX_QUEUE_ENTRIES }, (_, index) => ({
                queueId: `status-queue-${index}`,
                deliveryId: index === 0 ? 'DEL-001' : `DEL-${index}`,
                boxId: 'BOX-001',
                status: 'IN_TRANSIT',
                metadata: index === 0 ? { pickup_photo_url: 'https://example.test/pickup.jpg' } : undefined,
                queuedAt: 1000000,
                lastAttemptAt: 1000000,
                retryCount: 0,
                synced: false,
            }));

            (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(fullQueue));

            const queued = await statusUpdateService.queueStatusUpdate('DEL-001', 'BOX-001', 'COMPLETED', {
                proof_photo_url: 'https://example.test/proof.jpg',
                proof_photo_uploaded_at: 1710000000000,
                completed_at: 1710000000000,
            });

            expect(queued).toBe(true);
            const savedQueue = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedQueue).toHaveLength(EC35_CONFIG.MAX_QUEUE_ENTRIES);
            expect(savedQueue[0]).toEqual(
                expect.objectContaining({
                    deliveryId: 'DEL-001',
                    status: 'COMPLETED',
                    metadata: {
                        pickup_photo_url: 'https://example.test/pickup.jpg',
                        proof_photo_url: 'https://example.test/proof.jpg',
                        proof_photo_uploaded_at: 1710000000000,
                        completed_at: 1710000000000,
                    },
                }),
            );
        });
    });
});
