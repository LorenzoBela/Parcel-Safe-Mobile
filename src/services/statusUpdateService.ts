/**
 * Status Update Service (EC-35)
 * 
 * Handles failed delivery status updates by queuing them locally
 * and retrying with exponential backoff when connectivity is restored.
 * 
 * Scenario: Box unlocks, but status update to "COMPLETED" fails.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
// Firebase RTDB is no longer written directly from this service — every
// status change now flows through the centralized transition API. Imports
// removed intentionally.
import { supabase } from './supabaseClient';
import { generateQueueUuid } from './queueIdentity';
import { getExponentialBackoffDelayMs, NETWORK_POLICY } from './networkPolicy';
import { captureHandledError, captureHandledMessage } from './observability/sentryService';

const API_BASE_URL = (
    process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
    || process.env.EXPO_PUBLIC_API_URL
    || 'https://parcel-safe.vercel.app'
).replace(/\/+$/, '');

async function getAccessToken(): Promise<string | null> {
    if (!supabase) return null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token || null;
    } catch {
        return null;
    }
}


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
    metadata?: Record<string, unknown>;
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

export function buildRetryTransitionMetadata(entry: StatusUpdateEntry): Record<string, unknown> {
    return {
        ...(entry.metadata || {}),
        retrySource: 'mobile_retry',
        boxId: entry.boxId,
        queueId: entry.queueId,
    };
}

class PermanentTransitionRejection extends Error { }

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
        status: DeliveryStatus,
        metadata?: Record<string, unknown>
    ): Promise<boolean> {
        try {
            const queue = await this.getQueue();

            // Check for duplicate
            const existing = queue.find(e => e.deliveryId === deliveryId && !e.synced);
            if (existing) {
                // Update existing entry
                existing.status = status;
                existing.metadata = {
                    ...(existing.metadata || {}),
                    ...(metadata || {}),
                };
                existing.lastAttemptAt = Date.now();
                captureHandledMessage('status_queue_updated', {
                    queue_uuid: existing.queueId || 'unknown',
                    action_type: 'status_update',
                    flush_stage: 'enqueue',
                    idempotency_result: 'updated',
                });
            } else {
                // Check max entries
                if (queue.length >= EC35_CONFIG.MAX_QUEUE_ENTRIES) {
                    console.warn('[EC35] Queue full, rejecting entry');
                    return false;
                }

                // Add new entry
                const entry: StatusUpdateEntry = {
                    queueId: generateQueueUuid('status'),
                    deliveryId,
                    boxId,
                    status,
                    metadata,
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
                    // Attempt sync via centralized transition API (handles dual write)
                    let transitionOk = false;
                    const token = await getAccessToken();
                    if (token) {
                        try {
                            const response = await fetch(`${API_BASE_URL}/api/deliveries/transition`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${token}`,
                                },
                                body: JSON.stringify({
                                    deliveryId: entry.deliveryId,
                                    toStatus: entry.status,
                                    metadata: buildRetryTransitionMetadata(entry),
                                }),
                            });
                            if (response.ok) {
                                transitionOk = true;
                            } else if (response.status >= 500) {
                                throw new Error(`transition-api-${response.status}`);
                            } else {
                                const responseText = await response.text().catch(() => '');
                                throw new PermanentTransitionRejection(`transition-api-rejected-${response.status}:${responseText}`);
                            }
                        } catch (error) {
                            if (error instanceof PermanentTransitionRejection) {
                                throw error;
                            }
                            // API unreachable, fall through to direct write
                        }
                    }

                    if (!transitionOk) {
                        // The API was unreachable or rejected the retry. Keep the
                        // entry queued so the next connectivity-restored flush
                        // can try again — do NOT force a direct Firebase write,
                        // which would drift Supabase out of sync.
                        throw new Error('transition-api-unreachable');
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
                    if (error instanceof PermanentTransitionRejection) {
                        entry.retryCount = EC35_CONFIG.MAX_RETRIES;
                        entry.lastAttemptAt = currentTime;
                        entry.error = error.message;
                        captureHandledError(error, {
                            queue_uuid: entry.queueId || 'unknown',
                            action_type: 'status_update',
                            flush_stage: 'process_sync',
                            idempotency_result: 'permanent_rejection',
                        });
                        results.failed++;
                        console.error('[EC35] Permanent transition rejection:', entry.deliveryId);
                        continue;
                    }

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
            // Attempt centralized transition API first
            let transitionOk = false;
            const token = await getAccessToken();
            if (token) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/deliveries/transition`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            deliveryId,
                            toStatus: 'COMPLETED',
                            reason: 'manual_fallback',
                            metadata: { boxId, manualOverride: true },
                        }),
                    });
                    transitionOk = response.ok;
                } catch {
                    // API unreachable, fall through to direct write
                }
            }

            if (!transitionOk) {
                // The centralized transition API is the only path that can
                // safely flip a delivery to COMPLETED — it owns the audit log
                // and notification fan-out. If it is unreachable we surface
                // the failure to the UI instead of forging a direct Firebase
                // write that would leave Supabase drifted.
                console.error('[EC35] markCompleteManually: transition API unreachable or rejected; aborting.');
                return false;
            }

            // Box status sync (hardware-specific, stays mobile-side)
            if (supabase && boxId && boxId !== 'UNKNOWN_BOX') {
                try {
                    await supabase
                        .from('smart_boxes')
                        .update({ status: 'IDLE' })
                        .eq('id', boxId);
                } catch (e) {
                    console.error('[EC35] Failed to update box status:', e);
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
