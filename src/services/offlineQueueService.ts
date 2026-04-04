/**
 * Offline Queue Service
 * Validates connectivity and buffers location updates when offline.
 * Syncs data to Firebase when connection is restored.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { getFirebaseDatabase, ref, serverTimestamp } from './firebaseClient';
import { update } from 'firebase/database';
import { generateQueueUuid } from './queueIdentity';
import { NETWORK_POLICY } from './networkPolicy';
import { captureHandledError, captureHandledMessage } from './observability/sentryService';

const QUEUE_STORAGE_KEY = 'offline_location_queue';
const MAX_QUEUE_SIZE = 100; // Prevent unlimited growth

function sanitizeBoxId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined' || lowered === 'unknown_box') return null;
    return trimmed;
}

export interface QueuedLocation {
    queueId?: string;
    latitude: number;
    longitude: number;
    timestamp: number;
    speed: number;
    heading: number;
    boxId: string;
    /** Optional network status captured at enqueue time */
    networkStatus?: {
        connection: 'WiFi' | 'Cellular' | 'None';
        cellular_generation: '2g' | '3g' | '4g' | '5g' | null;
        is_connected: boolean;
        is_internet_reachable: boolean;
    };
}

class OfflineQueueService {
    private queue: QueuedLocation[] = [];
    private isSyncing: boolean = false;
    private isInitialized: boolean = false;
    private retryBackoffMs: number = NETWORK_POLICY.RETRY.BASE_MS;
    private nextRetryAt: number = 0;

    constructor() {
        this.initialize();
    }

    /**
     * Load queue from storage on app start
     */
    private async initialize() {
        try {
            const storedQueue = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
            if (storedQueue) {
                this.queue = JSON.parse(storedQueue);
            }
            this.isInitialized = true;

            // Try to sync immediately if we have data
            if (this.queue.length > 0) {
                this.processQueue();
            }
        } catch (error) {
            console.error('[OfflineQueue] Failed to load queue:', error);
            this.queue = [];
        }
    }

    /**
     * Save queue to storage
     */
    private async persistQueue() {
        try {
            if (this.queue.length === 0) {
                await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
            } else {
                await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
            }
        } catch (error) {
            console.error('[OfflineQueue] Failed to persist queue:', error);
        }
    }

    private isTimeoutError(error: unknown): boolean {
        const message = String((error as any)?.message ?? error ?? '').toLowerCase();
        return message.includes('timeout');
    }

    private upsertLatestLocation(locationData: QueuedLocation): void {
        const existingIndex = this.queue.findIndex((item) => item.boxId === locationData.boxId);

        if (existingIndex >= 0) {
            this.queue[existingIndex] = locationData;
            return;
        }

        if (this.queue.length >= MAX_QUEUE_SIZE) {
            this.queue.shift();
        }

        this.queue.push(locationData);
    }

    /**
     * Add location to queue (or send if online)
     */
    public async enqueueLocationUpdate(
        boxId: string,
        latitude: number,
        longitude: number,
        speed: number,
        heading: number
    ): Promise<void> {
        const sanitizedBoxId = sanitizeBoxId(boxId);
        if (!sanitizedBoxId) {
            console.warn('[OfflineQueue] Dropping location update with invalid boxId:', boxId);
            return;
        }

        const netState = await NetInfo.fetch();
        const isConnected = netState.isConnected && netState.isInternetReachable;

        // Capture network status at the time of the location update
        let networkStatus: QueuedLocation['networkStatus'];
        try {
            let connection: 'WiFi' | 'Cellular' | 'None' = 'None';
            let cellularGeneration: '2g' | '3g' | '4g' | '5g' | null = null;

            if (netState.type === 'wifi') {
                connection = 'WiFi';
            } else if (netState.type === 'cellular') {
                connection = 'Cellular';
                cellularGeneration = netState.details?.cellularGeneration ?? null;
            }

            networkStatus = {
                connection,
                cellular_generation: cellularGeneration,
                is_connected: isConnected ?? false,
                is_internet_reachable: netState.isInternetReachable ?? false,
            };
        } catch {
            // If NetInfo fails, proceed without network metadata
            networkStatus = undefined;
        }

        const locationData: QueuedLocation = {
            queueId: generateQueueUuid('location'),
            boxId: sanitizedBoxId,
            latitude,
            longitude,
            speed,
            heading,
            timestamp: Date.now(), // Capture *actual* time of location
            networkStatus,
        };

        if (isConnected) {
            // Online - try to send immediately
            try {
                // If we have a queue, send that first to maintain order
                if (this.queue.length > 0) {
                    this.upsertLatestLocation(locationData);
                    captureHandledMessage('location_queue_enqueued_online', {
                        queue_uuid: locationData.queueId || 'unknown',
                        action_type: 'location_update',
                        flush_stage: 'enqueue_direct',
                        idempotency_result: 'queued_for_ordered_flush',
                    });
                    await this.processQueue();
                } else {
                    await this.sendToFirebase(locationData);
                    captureHandledMessage('location_queue_direct_sent', {
                        queue_uuid: locationData.queueId || 'unknown',
                        action_type: 'location_update',
                        flush_stage: 'enqueue_direct',
                        idempotency_result: 'sent_direct',
                    });
                }
                return;
            } catch (error) {
                console.warn('[OfflineQueue] Send failed, falling back to queue');
                captureHandledError(error, {
                    queue_uuid: locationData.queueId || 'unknown',
                    action_type: 'location_update',
                    flush_stage: 'enqueue_direct',
                    idempotency_result: 'fallback_queue',
                });
                // Fallthrough to queue logic
            }
        }

        // Offline or upload failed - add to queue
        this.upsertLatestLocation(locationData);
        captureHandledMessage('location_queue_enqueued_offline', {
            queue_uuid: locationData.queueId || 'unknown',
            action_type: 'location_update',
            flush_stage: 'enqueue_queue',
            idempotency_result: 'queued_offline',
        });
        await this.persistQueue();

        if (__DEV__) console.log(`[OfflineQueue] Location buffered. Queue size: ${this.queue.length}`);
    }

    /**
     * Process and flush the queue
     */
    public async processQueue(): Promise<void> {
        if (this.isSyncing || this.queue.length === 0) return;

        const now = Date.now();
        if (now < this.nextRetryAt) return;

        const netState = await NetInfo.fetch();
        if (!netState.isConnected) return;

        this.isSyncing = true;
        if (__DEV__) console.log(`[OfflineQueue] Processing ${this.queue.length} items...`);

        try {
            // We clone the queue to iterate safely
            const batch = [...this.queue];
            captureHandledMessage('location_queue_flush_start', {
                queue_uuid: batch.map((item) => item.queueId || 'unknown').join(','),
                action_type: 'location_update',
                flush_stage: 'flush_batch',
                idempotency_result: `batch_${batch.length}`,
            });
            const db = getFirebaseDatabase();

            // Construct a multi-path update for atomicity (or at least efficiency)
            const updates: any = {};

            batch.forEach((item) => {
                const sanitizedBoxId = sanitizeBoxId(item.boxId);
                if (!sanitizedBoxId) {
                    return;
                }

                // We overwrite the "current" location with the LATEST one ultimately
                // But we might want to log history points if we had a "history" path
                // For now, let's just make sure the latest one wins in the final state

                // Using the timestamp in the path ensures we don't overwrite if we change schema
                // But for "current location", we just want the latest.
                // We will send them sequentially or just send the batch if your backend supports history.
                // Assuming standard "location" node:
                updates[`/locations/${sanitizedBoxId}/phone`] = {
                    latitude: item.latitude,
                    longitude: item.longitude,
                    speed: item.speed,
                    heading: item.heading,
                    timestamp: item.timestamp, // Original timestamp
                    verified_at: serverTimestamp(), // Sync timestamp
                    source: 'phone_buffered'
                };

                // Include phone network status from the buffered data
                if (item.networkStatus) {
                    // Write leaf fields so we don't clobber existing data_bytes.
                    updates[`/hardware/${sanitizedBoxId}/phone_status/connection`] = item.networkStatus.connection;
                    updates[`/hardware/${sanitizedBoxId}/phone_status/cellular_generation`] = item.networkStatus.cellular_generation;
                    updates[`/hardware/${sanitizedBoxId}/phone_status/is_connected`] = item.networkStatus.is_connected;
                    updates[`/hardware/${sanitizedBoxId}/phone_status/is_internet_reachable`] = item.networkStatus.is_internet_reachable;
                    updates[`/hardware/${sanitizedBoxId}/phone_status/source`] = 'phone_buffered';
                    updates[`/hardware/${sanitizedBoxId}/phone_status/timestamp`] = item.timestamp;
                    updates[`/hardware/${sanitizedBoxId}/phone_status/gps_accuracy`] = null;
                    updates[`/hardware/${sanitizedBoxId}/phone_status/gps_altitude`] = null;
                }
            });

            // If we have multiple updates for the same path, the last one in the object wins
            // which is correct for "current location". 
            // If we wanted to keep points, we'd write to /locations/{boxId}/history/{timestamp}

            await Promise.race([
                update(ref(db), updates),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase write timeout')), NETWORK_POLICY.TIMEOUTS_MS.FIREBASE_WRITE))
            ]);

            // Clear queue only after successful send
            this.queue = [];
            await this.persistQueue();
            this.retryBackoffMs = NETWORK_POLICY.RETRY.BASE_MS;
            this.nextRetryAt = 0;
            captureHandledMessage('location_queue_flush_success', {
                queue_uuid: batch.map((item) => item.queueId || 'unknown').join(','),
                action_type: 'location_update',
                flush_stage: 'flush_committed',
                idempotency_result: 'all_synced',
            });

            if (__DEV__) console.log('[OfflineQueue] Sync complete');

        } catch (error) {
            console.error('[OfflineQueue] Sync failed:', error);
            if (this.isTimeoutError(error)) {
                this.nextRetryAt = Date.now() + this.retryBackoffMs;
                this.retryBackoffMs = Math.min(this.retryBackoffMs * 2, 30_000);
            }
            const queueUuids = this.queue.map((item) => item.queueId || 'unknown').join(',');
            captureHandledError(error, {
                queue_uuid: queueUuids || 'unknown',
                action_type: 'location_update',
                flush_stage: 'flush_failed',
                idempotency_result: 'retry_later',
            });
            // Keep items in queue for next retry
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Direct Firebase write
     */
    private async sendToFirebase(data: QueuedLocation): Promise<void> {
        const sanitizedBoxId = sanitizeBoxId(data.boxId);
        if (!sanitizedBoxId) {
            console.warn('[OfflineQueue] Dropping direct send with invalid boxId:', data.boxId);
            return;
        }

        const db = getFirebaseDatabase();
        const updates: any = {};

        updates[`/locations/${sanitizedBoxId}/phone`] = {
            latitude: data.latitude,
            longitude: data.longitude,
            speed: data.speed,
            heading: data.heading,
            timestamp: data.timestamp,
            verified_at: serverTimestamp(),
            source: 'phone_background' // Distinguish from buffered
        };

        // Include phone network status from the location update
        if (data.networkStatus) {
            // Write leaf fields so we don't clobber existing data_bytes.
            updates[`/hardware/${sanitizedBoxId}/phone_status/connection`] = data.networkStatus.connection;
            updates[`/hardware/${sanitizedBoxId}/phone_status/cellular_generation`] = data.networkStatus.cellular_generation;
            updates[`/hardware/${sanitizedBoxId}/phone_status/is_connected`] = data.networkStatus.is_connected;
            updates[`/hardware/${sanitizedBoxId}/phone_status/is_internet_reachable`] = data.networkStatus.is_internet_reachable;
            updates[`/hardware/${sanitizedBoxId}/phone_status/source`] = 'phone_background';
            updates[`/hardware/${sanitizedBoxId}/phone_status/timestamp`] = data.timestamp;
            updates[`/hardware/${sanitizedBoxId}/phone_status/gps_accuracy`] = null;
            updates[`/hardware/${sanitizedBoxId}/phone_status/gps_altitude`] = null;
        }

        await Promise.race([
            update(ref(db), updates),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase write timeout')), NETWORK_POLICY.TIMEOUTS_MS.FIREBASE_WRITE))
        ]);
        captureHandledMessage('location_direct_send_success', {
            queue_uuid: data.queueId || 'unknown',
            action_type: 'location_update',
            flush_stage: 'send_direct',
            idempotency_result: 'sent',
        });
    }
}

export const offlineQueueService = new OfflineQueueService();
