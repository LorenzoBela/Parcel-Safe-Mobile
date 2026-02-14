/**
 * Offline Queue Service
 * Validates connectivity and buffers location updates when offline.
 * Syncs data to Firebase when connection is restored.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { getFirebaseDatabase, ref, serverTimestamp } from './firebaseClient';
import { update } from 'firebase/database';

const QUEUE_STORAGE_KEY = 'offline_location_queue';
const MAX_QUEUE_SIZE = 100; // Prevent unlimited growth

export interface QueuedLocation {
    lat: number;
    lng: number;
    timestamp: number;
    speed: number;
    heading: number;
    boxId: string;
}

class OfflineQueueService {
    private queue: QueuedLocation[] = [];
    private isSyncing: boolean = false;
    private isInitialized: boolean = false;

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

    /**
     * Add location to queue (or send if online)
     */
    public async enqueueLocationUpdate(
        boxId: string,
        lat: number,
        lng: number,
        speed: number,
        heading: number
    ): Promise<void> {
        const netState = await NetInfo.fetch();
        const isConnected = netState.isConnected && netState.isInternetReachable;

        const locationData: QueuedLocation = {
            boxId,
            lat,
            lng,
            speed,
            heading,
            timestamp: Date.now(), // Capture *actual* time of location
        };

        if (isConnected) {
            // Online - try to send immediately
            try {
                // If we have a queue, send that first to maintain order
                if (this.queue.length > 0) {
                    this.queue.push(locationData);
                    await this.processQueue();
                } else {
                    await this.sendToFirebase(locationData);
                }
                return;
            } catch (error) {
                console.warn('[OfflineQueue] Send failed, falling back to queue');
                // Fallthrough to queue logic
            }
        }

        // Offline or upload failed - add to queue
        if (this.queue.length >= MAX_QUEUE_SIZE) {
            // Drop oldest if full (circular buffer behavior is usually better for tracking)
            // But for delivery, maybe we want the latest?
            // Let's drop the oldest to keep the "gap" at the beginning, usually better than a gap at the end
            this.queue.shift();
        }

        this.queue.push(locationData);
        await this.persistQueue();

        if (__DEV__) console.log(`[OfflineQueue] Location buffered. Queue size: ${this.queue.length}`);
    }

    /**
     * Process and flush the queue
     */
    public async processQueue(): Promise<void> {
        if (this.isSyncing || this.queue.length === 0) return;

        const netState = await NetInfo.fetch();
        if (!netState.isConnected) return;

        this.isSyncing = true;
        if (__DEV__) console.log(`[OfflineQueue] Processing ${this.queue.length} items...`);

        try {
            // We clone the queue to iterate safely
            const batch = [...this.queue];
            const db = getFirebaseDatabase();

            // Construct a multi-path update for atomicity (or at least efficiency)
            const updates: any = {};

            batch.forEach((item) => {
                // We overwrite the "current" location with the LATEST one ultimately
                // But we might want to log history points if we had a "history" path
                // For now, let's just make sure the latest one wins in the final state

                // Using the timestamp in the path ensures we don't overwrite if we change schema
                // But for "current location", we just want the latest.
                // We will send them sequentially or just send the batch if your backend supports history.
                // Assuming standard "location" node:
                updates[`/locations/${item.boxId}`] = {
                    lat: item.lat,
                    lng: item.lng,
                    speed: item.speed,
                    heading: item.heading,
                    timestamp: item.timestamp, // Original timestamp
                    verified_at: serverTimestamp(), // Sync timestamp
                    source: 'phone_buffered'
                };
            });

            // If we have multiple updates for the same path, the last one in the object wins
            // which is correct for "current location". 
            // If we wanted to keep points, we'd write to /locations/{boxId}/history/{timestamp}

            await update(ref(db), updates);

            // Clear queue only after successful send
            this.queue = [];
            await this.persistQueue();

            if (__DEV__) console.log('[OfflineQueue] Sync complete');

        } catch (error) {
            console.error('[OfflineQueue] Sync failed:', error);
            // Keep items in queue for next retry
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Direct Firebase write
     */
    private async sendToFirebase(data: QueuedLocation): Promise<void> {
        const db = getFirebaseDatabase();
        const updates: any = {};

        updates[`/locations/${data.boxId}`] = {
            lat: data.lat,
            lng: data.lng,
            speed: data.speed,
            heading: data.heading,
            timestamp: data.timestamp,
            verified_at: serverTimestamp(),
            source: 'phone_background' // Distinguish from buffered
        };

        await update(ref(db), updates);
    }
}

export const offlineQueueService = new OfflineQueueService();
