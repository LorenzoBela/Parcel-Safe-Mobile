/**
 * EC-55: Quota Monitor Service for Mobile
 * 
 * Monitors Firebase quota usage and implements local caching
 * to reduce Firebase operations when approaching limits.
 * 
 * Features:
 * - Track read/write operations
 * - Alert at 80% threshold
 * - Enable local caching when approaching limits
 * - Graceful degradation when quota exceeded
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { QuotaState, QuotaAlertLevel, subscribeToQuotaState } from './firebaseClient';

// ==================== EC-55: Configuration ====================

export const QUOTA_CONFIG = {
    /** Daily read operations limit (Spark plan: 50k) */
    DAILY_READS_LIMIT: 50000,
    
    /** Daily write operations limit (Spark plan: 20k) */
    DAILY_WRITES_LIMIT: 20000,
    
    /** Warning threshold percentage */
    WARNING_THRESHOLD_PERCENT: 80,
    
    /** Critical threshold percentage */
    CRITICAL_THRESHOLD_PERCENT: 95,
    
    /** Cache key prefix */
    CACHE_PREFIX: '@parcel_safe_cache:',
    
    /** Default cache TTL (ms) */
    DEFAULT_CACHE_TTL_MS: 60000, // 1 minute
    
    /** Extended cache TTL when quota is limited (ms) */
    LIMITED_CACHE_TTL_MS: 300000, // 5 minutes
    
    /** Local operation counter key */
    LOCAL_COUNTER_KEY: '@parcel_safe_quota:local_counters',
};

// ==================== Types ====================

export interface LocalQuotaCounters {
    reads: number;
    writes: number;
    lastReset: number;
}

export interface CachedData<T> {
    data: T;
    cachedAt: number;
    ttl: number;
}

export interface QuotaMonitorState {
    remoteQuota: QuotaState | null;
    localCounters: LocalQuotaCounters;
    cachingEnabled: boolean;
    lastUpdated: number;
}

// ==================== Quota Alert Level Functions ====================

/**
 * Calculate quota alert level based on percentage
 */
export function getQuotaAlertLevel(percentage: number): QuotaAlertLevel {
    if (percentage >= 100) return 'EXCEEDED';
    if (percentage >= QUOTA_CONFIG.CRITICAL_THRESHOLD_PERCENT) return 'CRITICAL';
    if (percentage >= QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT) return 'WARNING';
    return 'OK';
}

/**
 * Check if caching should be enabled based on quota state
 */
export function shouldEnableCaching(quotaState: QuotaState | null): boolean {
    if (!quotaState) return false;
    return quotaState.reads.percentage >= QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT ||
           quotaState.writes.percentage >= QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT;
}

/**
 * Get appropriate cache TTL based on quota state
 */
export function getCacheTTL(quotaState: QuotaState | null): number {
    if (!quotaState) return QUOTA_CONFIG.DEFAULT_CACHE_TTL_MS;
    if (shouldEnableCaching(quotaState)) {
        return QUOTA_CONFIG.LIMITED_CACHE_TTL_MS;
    }
    return QUOTA_CONFIG.DEFAULT_CACHE_TTL_MS;
}

/**
 * Get quota-aware fetch interval (reduce frequency when approaching limits)
 */
export function getQuotaAwareFetchInterval(
    quotaState: QuotaState | null, 
    baseInterval: number
): number {
    if (!quotaState) return baseInterval;
    
    // If approaching quota, increase interval to reduce reads
    if (quotaState.reads.percentage >= QUOTA_CONFIG.CRITICAL_THRESHOLD_PERCENT) {
        return baseInterval * 5; // 5x slower
    }
    if (quotaState.reads.percentage >= QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT) {
        return baseInterval * 2; // 2x slower
    }
    
    return baseInterval;
}

// ==================== Local Counter Management ====================

/**
 * Get local operation counters
 */
export async function getLocalCounters(): Promise<LocalQuotaCounters> {
    try {
        const stored = await AsyncStorage.getItem(QUOTA_CONFIG.LOCAL_COUNTER_KEY);
        if (stored) {
            const counters = JSON.parse(stored) as LocalQuotaCounters;
            
            // Reset if it's a new day
            const today = getMidnightUTC();
            if (counters.lastReset < today) {
                return { reads: 0, writes: 0, lastReset: today };
            }
            
            return counters;
        }
    } catch (error) {
        console.error('[EC-55] Failed to get local counters:', error);
    }
    
    return { reads: 0, writes: 0, lastReset: getMidnightUTC() };
}

/**
 * Increment read counter
 */
export async function incrementReadCounter(): Promise<number> {
    const counters = await getLocalCounters();
    counters.reads += 1;
    await saveLocalCounters(counters);
    return counters.reads;
}

/**
 * Increment write counter
 */
export async function incrementWriteCounter(): Promise<number> {
    const counters = await getLocalCounters();
    counters.writes += 1;
    await saveLocalCounters(counters);
    return counters.writes;
}

/**
 * Save local counters
 */
async function saveLocalCounters(counters: LocalQuotaCounters): Promise<void> {
    try {
        await AsyncStorage.setItem(
            QUOTA_CONFIG.LOCAL_COUNTER_KEY,
            JSON.stringify(counters)
        );
    } catch (error) {
        console.error('[EC-55] Failed to save local counters:', error);
    }
}

/**
 * Get midnight UTC timestamp
 */
function getMidnightUTC(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// ==================== Cache Management ====================

/**
 * Get cached data for a key
 */
export async function getCachedData<T>(key: string): Promise<T | null> {
    try {
        const cacheKey = `${QUOTA_CONFIG.CACHE_PREFIX}${key}`;
        const stored = await AsyncStorage.getItem(cacheKey);
        
        if (stored) {
            const cached = JSON.parse(stored) as CachedData<T>;
            const age = Date.now() - cached.cachedAt;
            
            // Check if cache is still valid
            if (age < cached.ttl) {
                console.log(`[EC-55] Cache hit for ${key}, age: ${Math.round(age / 1000)}s`);
                return cached.data;
            }
            
            console.log(`[EC-55] Cache expired for ${key}`);
        }
    } catch (error) {
        console.error(`[EC-55] Failed to get cached data for ${key}:`, error);
    }
    
    return null;
}

/**
 * Set cached data for a key
 */
export async function setCachedData<T>(
    key: string, 
    data: T, 
    ttl: number = QUOTA_CONFIG.DEFAULT_CACHE_TTL_MS
): Promise<void> {
    try {
        const cacheKey = `${QUOTA_CONFIG.CACHE_PREFIX}${key}`;
        const cached: CachedData<T> = {
            data,
            cachedAt: Date.now(),
            ttl,
        };
        
        await AsyncStorage.setItem(cacheKey, JSON.stringify(cached));
        console.log(`[EC-55] Cached data for ${key}, TTL: ${Math.round(ttl / 1000)}s`);
    } catch (error) {
        console.error(`[EC-55] Failed to cache data for ${key}:`, error);
    }
}

/**
 * Clear cached data for a key
 */
export async function clearCachedData(key: string): Promise<void> {
    try {
        const cacheKey = `${QUOTA_CONFIG.CACHE_PREFIX}${key}`;
        await AsyncStorage.removeItem(cacheKey);
    } catch (error) {
        console.error(`[EC-55] Failed to clear cached data for ${key}:`, error);
    }
}

/**
 * Clear all cached data
 */
export async function clearAllCachedData(): Promise<void> {
    try {
        const keys = await AsyncStorage.getAllKeys();
        const cacheKeys = keys.filter(k => k.startsWith(QUOTA_CONFIG.CACHE_PREFIX));
        if (cacheKeys.length > 0) {
            await AsyncStorage.multiRemove(cacheKeys);
            console.log(`[EC-55] Cleared ${cacheKeys.length} cached items`);
        }
    } catch (error) {
        console.error('[EC-55] Failed to clear all cached data:', error);
    }
}

// ==================== Quota Monitor Class ====================

type QuotaStateCallback = (state: QuotaMonitorState) => void;

class QuotaMonitor {
    private state: QuotaMonitorState;
    private unsubscribe: (() => void) | null = null;
    private callbacks: Set<QuotaStateCallback> = new Set();

    constructor() {
        this.state = {
            remoteQuota: null,
            localCounters: { reads: 0, writes: 0, lastReset: getMidnightUTC() },
            cachingEnabled: false,
            lastUpdated: 0,
        };
    }

    /**
     * Start monitoring quota state
     */
    async start(): Promise<void> {
        // Load local counters
        this.state.localCounters = await getLocalCounters();
        
        // Subscribe to remote quota state
        this.unsubscribe = subscribeToQuotaState((quotaState) => {
            this.state.remoteQuota = quotaState;
            this.state.cachingEnabled = shouldEnableCaching(quotaState);
            this.state.lastUpdated = Date.now();
            this.notifyCallbacks();
        });
        
        console.log('[EC-55] Quota monitor started');
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        console.log('[EC-55] Quota monitor stopped');
    }

    /**
     * Subscribe to state changes
     */
    subscribe(callback: QuotaStateCallback): () => void {
        this.callbacks.add(callback);
        // Immediately call with current state
        callback(this.state);
        
        return () => {
            this.callbacks.delete(callback);
        };
    }

    /**
     * Get current state
     */
    getState(): QuotaMonitorState {
        return this.state;
    }

    /**
     * Check if operations should be throttled
     */
    shouldThrottleReads(): boolean {
        if (!this.state.remoteQuota) return false;
        return this.state.remoteQuota.reads.percentage >= QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT;
    }

    /**
     * Check if writes should be blocked
     */
    shouldBlockWrites(): boolean {
        if (!this.state.remoteQuota) return false;
        return this.state.remoteQuota.writes.percentage >= 100;
    }

    /**
     * Track a read operation
     */
    async trackRead(): Promise<void> {
        this.state.localCounters.reads = await incrementReadCounter();
        this.notifyCallbacks();
    }

    /**
     * Track a write operation
     */
    async trackWrite(): Promise<void> {
        this.state.localCounters.writes = await incrementWriteCounter();
        this.notifyCallbacks();
    }

    private notifyCallbacks(): void {
        for (const callback of this.callbacks) {
            try {
                callback(this.state);
            } catch (error) {
                console.error('[EC-55] Callback error:', error);
            }
        }
    }
}

// Singleton instance
export const quotaMonitor = new QuotaMonitor();

// ==================== Helper Functions ====================

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format percentage for display
 */
export function formatPercentage(percentage: number): string {
    return `${percentage.toFixed(1)}%`;
}

/**
 * Get alert color for UI
 */
export function getAlertColor(level: QuotaAlertLevel): string {
    switch (level) {
        case 'OK': return '#22c55e'; // Green
        case 'WARNING': return '#f59e0b'; // Amber
        case 'CRITICAL': return '#f97316'; // Orange
        case 'EXCEEDED': return '#ef4444'; // Red
        default: return '#6b7280'; // Gray
    }
}

/**
 * Get alert message for UI
 */
export function getAlertMessage(quotaState: QuotaState | null): string | null {
    if (!quotaState) return null;
    
    const maxPercentage = Math.max(
        quotaState.reads.percentage,
        quotaState.writes.percentage,
        quotaState.storage.percentage,
        quotaState.bandwidth.percentage
    );
    
    if (maxPercentage >= 100) {
        return 'Firebase quota exceeded. Some features may be unavailable.';
    }
    if (maxPercentage >= QUOTA_CONFIG.CRITICAL_THRESHOLD_PERCENT) {
        return 'Firebase quota critically low. Caching enabled.';
    }
    if (maxPercentage >= QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT) {
        return 'Firebase quota usage high. Some data may be cached.';
    }
    
    return null;
}

export default quotaMonitor;
