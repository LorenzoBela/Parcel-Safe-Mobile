/**
 * Status Update Service (EC-35)
 * 
 * Handles failed delivery status updates by queuing them locally
 * and retrying with exponential backoff when connectivity is restored.
 * 
 * Scenario: Box unlocks, but status update to "COMPLETED" fails.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, update, serverTimestamp } from 'firebase/database';
import { getFirebaseDatabase } from './firebaseClient';
import { supabase } from './supabaseClient';
import { generateQueueUuid } from './queueIdentity';
import { getExponentialBackoffDelayMs, NETWORK_POLICY } from './networkPolicy';
import { captureHandledError, captureHandledMessage } from './observability/sentryService';


// Storage keys
const STORAGE_KEYS = {
    STATUS_QUEUE: 'ec35_status_update_queue',
};

// Configuration
export const EC35_CONFIG = {
    MAX_QUEUE_ENTRIES: 10,
    MAX_RETRIES: 5,
    BASE_RETRY_MS: NETWORK_POLICY.RETRY.BASE_MS,
};

export type DeliveryStatus =
    | 'PENDING'
    | 'SEARCHING'
    | 'ACCEPTED'
    | 'ASSIGNED'
    | 'IN_TRANSIT'
    | 'ARRIVED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'RETURNED'
    | 'RECALLED'
    | 'TAMPERED'
    | 'FAILED'
    | string;

export interface StatusUpdateEntry {
    queueId?: string;
    deliveryId: string;
    boxId: string;
    status: DeliveryStatus;
    queuedAt: number;
    lastAttemptAt: number;
    retryCount: number;
    synced: boolean;
    error?: string;
}

/**
 * Calculate exponential backoff delay
 */
export function getRetryDelay(retryCount: number): number {
    return getExponentialBackoffDelayMs(
        retryCount,
        EC35_CONFIG.BASE_RETRY_MS,
        EC35_CONFIG.MAX_RETRIES
    );
}

/**
 * Check if retry is due based on exponential backoff
 */
export function isRetryDue(entry: StatusUpdateEntry, currentTime: number): boolean {
    if (entry.synced) return false;
    if (entry.retryCount >= EC35_CONFIG.MAX_RETRIES) return false;
    const delay = getRetryDelay(entry.retryCount);
    return (currentTime - entry.lastAttemptAt) >= delay;
}

/**
 * Check if max retries exceeded
 */
export function isMaxRetriesExceeded(entry: StatusUpdateEntry): boolean {
    return entry.retryCount >= EC35_CONFIG.MAX_RETRIES && !entry.synced;
}

/**
 * Status Update Queue Service
 */
class StatusUpdateService {
    private processing = false;

    /**
     * Get the current status queue from storage
     */
    async getQueue(): Promise<StatusUpdateEntry[]> {
        try {
            const data = await AsyncStorage.getItem(STORAGE_KEYS.STATUS_QUEUE);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('[EC35] Failed to get queue:', error);
            return [];
        }
    }

    /**
     * Save the queue to storage
     */
    private async saveQueue(queue: StatusUpdateEntry[]): Promise<void> {
        await AsyncStorage.setItem(STORAGE_KEYS.STATUS_QUEUE, JSON.stringify(queue));
    }

    /**
     * Queue a status update for later sync (when network fails)
     */
    async queueStatusUpdate(
        deliveryId: string,
        boxId: string = 'UNKNOWN_BOX',
        status: DeliveryStatus
    ): Promise<boolean> {
        try {
            const queue = await this.getQueue();

            // Check max entries
            if (queue.length >= EC35_CONFIG.MAX_QUEUE_ENTRIES) {
                console.warn('[EC35] Queue full, rejecting entry');
                return false;
            }

            // Check for duplicate
            const existing = queue.find(e => e.deliveryId === deliveryId && !e.synced);
            if (existing) {
                // Update existing entry
                existing.status = status;
                existing.lastAttemptAt = Date.now();
                captureHandledMessage('status_queue_updated', {
                    queue_uuid: existing.queueId || 'unknown',
                    action_type: 'status_update',
                    flush_stage: 'enqueue',
                    idempotency_result: 'updated',
                });
            } else {
                // Add new entry
                const entry: StatusUpdateEntry = {
                    queueId: generateQueueUuid('status'),
                    deliveryId,
                    boxId,
                    status,
                    queuedAt: Date.now(),
                    lastAttemptAt: Date.now(),
                    retryCount: 0,
                    synced: false,
                };
                queue.push(entry);
                captureHandledMessage('status_queue_enqueued', {
                    queue_uuid: entry.queueId || 'unknown',
                    action_type: 'status_update',
                    flush_stage: 'enqueue',
                    idempotency_result: 'new',
                });
            }

            await this.saveQueue(queue);
            console.log('[EC35] Status update queued:', deliveryId, status);
            return true;
        } catch (error) {
            console.error('[EC35] Failed to queue status update:', error);
            captureHandledError(error, {
                queue_uuid: 'unknown',
                action_type: 'status_update',
                flush_stage: 'enqueue',
                idempotency_result: 'error',
            });
            return false;
        }
    }

    /**
     * Process pending status updates with exponential backoff
     */
    async processQueue(): Promise<{ success: number; failed: number; pending: number }> {
        if (this.processing) {
            return { success: 0, failed: 0, pending: 0 };
        }

        this.processing = true;
        const results = { success: 0, failed: 0, pending: 0 };

        try {
            const queue = await this.getQueue();
            const currentTime = Date.now();
            const database = getFirebaseDatabase();

            for (const entry of queue) {
                if (entry.synced) continue;

                if (!isRetryDue(entry, currentTime)) {
                    captureHandledMessage('status_queue_backoff_pending', {
                        queue_uuid: entry.queueId || 'unknown',
                        action_type: 'status_update',
                        flush_stage: 'process_backoff',
                        idempotency_result: 'backoff_pending',
                    });
                    results.pending++;
                    continue;
                }

                try {
                    // Attempt to sync to Firebase (match current delivery record schema)
                    const deliveryRef = ref(database, `deliveries/${entry.deliveryId}`);
                    await update(deliveryRef, {
                        status: entry.status,
                        updated_at: serverTimestamp(),
                        status_retry_source: 'mobile_retry',
                        status_retry_box_id: entry.boxId,
                        status_retry_queue_id: entry.queueId || null,
                    });

                    // Sync to Supabase (Source of Truth)
                    if (supabase) {
                        try {
                            const { error: sbError } = await supabase
                                .from('deliveries')
                                .update({
                                    status: entry.status,
                                    updated_at: new Date().toISOString(),
                                })
                                .eq('id', entry.deliveryId);

                            if (sbError) {
                                console.error('[EC35] Supabase sync failed during retry:', sbError.message);
                                // Note: We don't fail the entry if Supabase fails but Firebase succeeded,
                                // because the hardware relies on Firebase. The next retry might fix it 
                                // if we logic it that way, but for now we prioritize Firebase success.
                            } else {
                                console.log('[EC35] Supabase synced during retry:', entry.deliveryId);
                            }
                        } catch (sbException) {
                            console.error('[EC35] Supabase sync exception:', sbException);
                        }
                    }

                    entry.synced = true;
                    captureHandledMessage('status_queue_synced', {
                        queue_uuid: entry.queueId || 'unknown',
                        action_type: 'status_update',
                        flush_stage: 'process_sync',
                        idempotency_result: 'synced',
                    });
                    results.success++;
                    console.log('[EC35] Status synced:', entry.deliveryId);
                } catch (error) {
                    entry.retryCount++;
                    entry.lastAttemptAt = currentTime;
                    entry.error = String(error);

                    if (isMaxRetriesExceeded(entry)) {
                        captureHandledError(error, {
                            queue_uuid: entry.queueId || 'unknown',
                            action_type: 'status_update',
                            flush_stage: 'process_sync',
                            idempotency_result: 'max_retries',
                        });
                        results.failed++;
                        console.error('[EC35] Max retries exceeded:', entry.deliveryId);
                    } else {
                        captureHandledError(error, {
                            queue_uuid: entry.queueId || 'unknown',
                            action_type: 'status_update',
                            flush_stage: 'process_sync',
                            idempotency_result: 'retry_scheduled',
                        });
                        results.pending++;
                        console.log(`[EC35] Retry ${entry.retryCount} scheduled:`, entry.deliveryId);
                    }
                }
            }

            // Save updated queue (remove synced entries older than 1 hour)
            const oneHourAgo = currentTime - 3600000;
            const cleanedQueue = queue.filter(e => !e.synced || e.queuedAt > oneHourAgo);
            await this.saveQueue(cleanedQueue);
        } finally {
            this.processing = false;
        }

        return results;
    }

    /**
     * Get count of pending (unsynced) updates
     */
    async getPendingCount(): Promise<number> {
        const queue = await this.getQueue();
        return queue.filter(e => !e.synced && !isMaxRetriesExceeded(e)).length;
    }

    /**
     * Mark complete manually (rider fallback action)
     * This is used when all automated retries have failed
     */
    async markCompleteManually(deliveryId: string, boxId: string): Promise<boolean> {
        try {
            const database = getFirebaseDatabase();
            const deliveryRef = ref(database, `deliveries/${deliveryId}`);

            await update(deliveryRef, {
                status: 'COMPLETED',
                updated_at: serverTimestamp(),
                status_retry_source: 'manual_fallback',
                manual_override: true,
                status_retry_box_id: boxId,
            });

            // Sync to Supabase
            if (supabase) {
                try {
                    await supabase
                        .from('deliveries')
                        .update({
                            status: 'COMPLETED',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', deliveryId);

                    if (boxId && boxId !== 'UNKNOWN_BOX') {
                        await supabase
                            .from('smart_boxes')
                            .update({ status: 'IDLE' })
                            .eq('id', boxId);
                    }

                    console.log('[EC35] Manually marked complete in Supabase:', deliveryId);
                } catch (e) {
                    console.error('[EC35] Failed to sync manual completion to Supabase:', e);
                }
            }

            // Remove from queue
            const queue = await this.getQueue();
            const filtered = queue.filter(e => e.deliveryId !== deliveryId);
            await this.saveQueue(filtered);

            console.log('[EC35] Manually marked complete:', deliveryId);
            return true;
        } catch (error) {
            console.error('[EC35] Manual complete failed:', error);
            return false;
        }
    }

    /**
     * Reconcile on successful photo upload
     * If photo uploads successfully, we know delivery was completed
     */
    async reconcileOnPhotoSuccess(deliveryId: string): Promise<boolean> {
        const queue = await this.getQueue();
        const entry = queue.find(e => e.deliveryId === deliveryId && !e.synced);

        if (entry) {
            entry.synced = true;
            await this.saveQueue(queue);
            console.log('[EC35] Reconciled on photo success:', deliveryId);
            return true;
        }
        return false;
    }

    /**
     * Clear all entries (for testing)
     */
    async clearQueue(): Promise<void> {
        await AsyncStorage.removeItem(STORAGE_KEYS.STATUS_QUEUE);
    }
}

export const statusUpdateService = new StatusUpdateService();
export default statusUpdateService;
