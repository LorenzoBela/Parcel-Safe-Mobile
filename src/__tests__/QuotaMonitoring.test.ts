/**
 * EC-55: Quota Monitoring Tests (Mobile)
 * 
 * Tests for quota threshold detection, local caching,
 * and graceful degradation logic.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import {
    QUOTA_CONFIG,
    getQuotaAlertLevel,
    shouldEnableCaching,
    getCacheTTL,
    getQuotaAwareFetchInterval,
    formatBytes,
    formatPercentage,
    getAlertColor,
    getAlertMessage,
    QuotaMonitorState,
    LocalQuotaCounters,
} from '../services/quotaMonitorService';
import { QuotaState, QuotaAlertLevel } from '../services/firebaseClient';

// ============ Test Data Factories ============

function createQuotaState(overrides: Partial<QuotaState> = {}): QuotaState {
    return {
        reads: { count: 0, limit: 50000, percentage: 0 },
        writes: { count: 0, limit: 20000, percentage: 0 },
        storage: { used_bytes: 0, limit_bytes: 1073741824, percentage: 0 },
        bandwidth: { used_bytes: 0, limit_bytes: 10737418240, percentage: 0 },
        alert_level: 'OK',
        last_updated: Date.now(),
        last_reset: Date.now(),
        ...overrides,
    };
}

function createLocalCounters(overrides: Partial<LocalQuotaCounters> = {}): LocalQuotaCounters {
    return {
        reads: 0,
        writes: 0,
        lastReset: Date.now(),
        ...overrides,
    };
}

// ============ getQuotaAlertLevel Tests ============

describe('EC-55: getQuotaAlertLevel (Mobile)', () => {
    it('should return OK for percentage below warning threshold', () => {
        expect(getQuotaAlertLevel(0)).toBe('OK');
        expect(getQuotaAlertLevel(50)).toBe('OK');
        expect(getQuotaAlertLevel(79)).toBe('OK');
    });

    it('should return WARNING at warning threshold (80%)', () => {
        expect(getQuotaAlertLevel(QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT)).toBe('WARNING');
    });

    it('should return WARNING between 80% and 95%', () => {
        expect(getQuotaAlertLevel(80)).toBe('WARNING');
        expect(getQuotaAlertLevel(85)).toBe('WARNING');
        expect(getQuotaAlertLevel(90)).toBe('WARNING');
        expect(getQuotaAlertLevel(94)).toBe('WARNING');
    });

    it('should return CRITICAL at critical threshold (95%)', () => {
        expect(getQuotaAlertLevel(QUOTA_CONFIG.CRITICAL_THRESHOLD_PERCENT)).toBe('CRITICAL');
    });

    it('should return CRITICAL between 95% and 100%', () => {
        expect(getQuotaAlertLevel(95)).toBe('CRITICAL');
        expect(getQuotaAlertLevel(97)).toBe('CRITICAL');
        expect(getQuotaAlertLevel(99)).toBe('CRITICAL');
    });

    it('should return EXCEEDED at and above 100%', () => {
        expect(getQuotaAlertLevel(100)).toBe('EXCEEDED');
        expect(getQuotaAlertLevel(105)).toBe('EXCEEDED');
        expect(getQuotaAlertLevel(200)).toBe('EXCEEDED');
    });
});

// ============ shouldEnableCaching Tests ============

describe('EC-55: shouldEnableCaching (Mobile)', () => {
    it('should return false when quota state is null', () => {
        expect(shouldEnableCaching(null)).toBe(false);
    });

    it('should return false when usage is low', () => {
        const state = createQuotaState({
            reads: { count: 25000, limit: 50000, percentage: 50 },
            writes: { count: 10000, limit: 20000, percentage: 50 },
        });
        
        expect(shouldEnableCaching(state)).toBe(false);
    });

    it('should return true when reads approach limit', () => {
        const state = createQuotaState({
            reads: { count: 40000, limit: 50000, percentage: 80 },
            writes: { count: 5000, limit: 20000, percentage: 25 },
        });
        
        expect(shouldEnableCaching(state)).toBe(true);
    });

    it('should return true when writes approach limit', () => {
        const state = createQuotaState({
            reads: { count: 25000, limit: 50000, percentage: 50 },
            writes: { count: 16000, limit: 20000, percentage: 80 },
        });
        
        expect(shouldEnableCaching(state)).toBe(true);
    });

    it('should return true when both approach limit', () => {
        const state = createQuotaState({
            reads: { count: 45000, limit: 50000, percentage: 90 },
            writes: { count: 18000, limit: 20000, percentage: 90 },
        });
        
        expect(shouldEnableCaching(state)).toBe(true);
    });

    it('should return false at exactly 79% (boundary)', () => {
        const state = createQuotaState({
            reads: { count: 39500, limit: 50000, percentage: 79 },
            writes: { count: 15800, limit: 20000, percentage: 79 },
        });
        
        expect(shouldEnableCaching(state)).toBe(false);
    });
});

// ============ getCacheTTL Tests ============

describe('EC-55: getCacheTTL (Mobile)', () => {
    it('should return default TTL when quota state is null', () => {
        expect(getCacheTTL(null)).toBe(QUOTA_CONFIG.DEFAULT_CACHE_TTL_MS);
    });

    it('should return default TTL when usage is low', () => {
        const state = createQuotaState({
            reads: { count: 25000, limit: 50000, percentage: 50 },
            writes: { count: 10000, limit: 20000, percentage: 50 },
        });
        
        expect(getCacheTTL(state)).toBe(QUOTA_CONFIG.DEFAULT_CACHE_TTL_MS);
    });

    it('should return extended TTL when approaching limit', () => {
        const state = createQuotaState({
            reads: { count: 40000, limit: 50000, percentage: 80 },
            writes: { count: 5000, limit: 20000, percentage: 25 },
        });
        
        expect(getCacheTTL(state)).toBe(QUOTA_CONFIG.LIMITED_CACHE_TTL_MS);
    });

    it('should return extended TTL when writes approach limit', () => {
        const state = createQuotaState({
            reads: { count: 25000, limit: 50000, percentage: 50 },
            writes: { count: 16000, limit: 20000, percentage: 80 },
        });
        
        expect(getCacheTTL(state)).toBe(QUOTA_CONFIG.LIMITED_CACHE_TTL_MS);
    });
});

// ============ getQuotaAwareFetchInterval Tests ============

describe('EC-55: getQuotaAwareFetchInterval (Mobile)', () => {
    const baseInterval = 5000; // 5 seconds

    it('should return base interval when quota is null', () => {
        expect(getQuotaAwareFetchInterval(null, baseInterval)).toBe(baseInterval);
    });

    it('should return base interval when usage is low', () => {
        const state = createQuotaState({
            reads: { count: 25000, limit: 50000, percentage: 50 },
        });
        
        expect(getQuotaAwareFetchInterval(state, baseInterval)).toBe(baseInterval);
    });

    it('should return 2x interval at warning threshold', () => {
        const state = createQuotaState({
            reads: { count: 40000, limit: 50000, percentage: 80 },
        });
        
        expect(getQuotaAwareFetchInterval(state, baseInterval)).toBe(baseInterval * 2);
    });

    it('should return 5x interval at critical threshold', () => {
        const state = createQuotaState({
            reads: { count: 47500, limit: 50000, percentage: 95 },
        });
        
        expect(getQuotaAwareFetchInterval(state, baseInterval)).toBe(baseInterval * 5);
    });

    it('should return 5x interval when exceeded', () => {
        const state = createQuotaState({
            reads: { count: 55000, limit: 50000, percentage: 110 },
        });
        
        expect(getQuotaAwareFetchInterval(state, baseInterval)).toBe(baseInterval * 5);
    });
});

// ============ formatBytes Tests ============

describe('EC-55: formatBytes (Mobile)', () => {
    it('should format bytes correctly', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(100)).toBe('100 B');
        expect(formatBytes(1023)).toBe('1023 B');
    });

    it('should format kilobytes correctly', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format megabytes correctly', () => {
        expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
        expect(formatBytes(1024 * 1024 * 100)).toBe('100.0 MB');
    });

    it('should format gigabytes correctly', () => {
        expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
        expect(formatBytes(1024 * 1024 * 1024 * 10)).toBe('10.00 GB');
    });
});

// ============ formatPercentage Tests ============

describe('EC-55: formatPercentage (Mobile)', () => {
    it('should format percentage with one decimal', () => {
        expect(formatPercentage(0)).toBe('0.0%');
        expect(formatPercentage(50)).toBe('50.0%');
        expect(formatPercentage(99.9)).toBe('99.9%');
        expect(formatPercentage(100)).toBe('100.0%');
    });

    it('should round correctly', () => {
        expect(formatPercentage(50.123)).toBe('50.1%');
        expect(formatPercentage(50.156)).toBe('50.2%');
    });
});

// ============ getAlertColor Tests ============

describe('EC-55: getAlertColor (Mobile)', () => {
    it('should return green for OK', () => {
        expect(getAlertColor('OK')).toBe('#22c55e');
    });

    it('should return amber for WARNING', () => {
        expect(getAlertColor('WARNING')).toBe('#f59e0b');
    });

    it('should return orange for CRITICAL', () => {
        expect(getAlertColor('CRITICAL')).toBe('#f97316');
    });

    it('should return red for EXCEEDED', () => {
        expect(getAlertColor('EXCEEDED')).toBe('#ef4444');
    });

    it('should return gray for unknown level', () => {
        expect(getAlertColor('UNKNOWN' as QuotaAlertLevel)).toBe('#6b7280');
    });
});

// ============ getAlertMessage Tests ============

describe('EC-55: getAlertMessage (Mobile)', () => {
    it('should return null when quota state is null', () => {
        expect(getAlertMessage(null)).toBeNull();
    });

    it('should return null when usage is low', () => {
        const state = createQuotaState({
            reads: { count: 25000, limit: 50000, percentage: 50 },
            writes: { count: 10000, limit: 20000, percentage: 50 },
            storage: { used_bytes: 500000000, limit_bytes: 1073741824, percentage: 46 },
            bandwidth: { used_bytes: 5000000000, limit_bytes: 10737418240, percentage: 46 },
        });
        
        expect(getAlertMessage(state)).toBeNull();
    });

    it('should return warning message at 80%', () => {
        const state = createQuotaState({
            reads: { count: 40000, limit: 50000, percentage: 80 },
            writes: { count: 10000, limit: 20000, percentage: 50 },
            storage: { used_bytes: 500000000, limit_bytes: 1073741824, percentage: 46 },
            bandwidth: { used_bytes: 5000000000, limit_bytes: 10737418240, percentage: 46 },
        });
        
        const message = getAlertMessage(state);
        expect(message).not.toBeNull();
        expect(message).toContain('high');
        expect(message).toContain('cached');
    });

    it('should return critical message at 95%', () => {
        const state = createQuotaState({
            reads: { count: 47500, limit: 50000, percentage: 95 },
            writes: { count: 10000, limit: 20000, percentage: 50 },
            storage: { used_bytes: 500000000, limit_bytes: 1073741824, percentage: 46 },
            bandwidth: { used_bytes: 5000000000, limit_bytes: 10737418240, percentage: 46 },
        });
        
        const message = getAlertMessage(state);
        expect(message).not.toBeNull();
        expect(message).toContain('critically');
        expect(message).toContain('Caching enabled');
    });

    it('should return exceeded message at 100%+', () => {
        const state = createQuotaState({
            reads: { count: 50000, limit: 50000, percentage: 100 },
            writes: { count: 10000, limit: 20000, percentage: 50 },
            storage: { used_bytes: 500000000, limit_bytes: 1073741824, percentage: 46 },
            bandwidth: { used_bytes: 5000000000, limit_bytes: 10737418240, percentage: 46 },
        });
        
        const message = getAlertMessage(state);
        expect(message).not.toBeNull();
        expect(message).toContain('exceeded');
        expect(message).toContain('unavailable');
    });

    it('should use highest metric for message', () => {
        const state = createQuotaState({
            reads: { count: 25000, limit: 50000, percentage: 50 }, // Low
            writes: { count: 10000, limit: 20000, percentage: 50 }, // Low
            storage: { used_bytes: 500000000, limit_bytes: 1073741824, percentage: 46 }, // Low
            bandwidth: { used_bytes: 10000000000, limit_bytes: 10737418240, percentage: 93 }, // High but not critical
        });
        
        const message = getAlertMessage(state);
        expect(message).not.toBeNull();
        expect(message).toContain('high');
    });
});

// ============ Configuration Tests ============

describe('EC-55: QUOTA_CONFIG', () => {
    it('should have correct warning threshold', () => {
        expect(QUOTA_CONFIG.WARNING_THRESHOLD_PERCENT).toBe(80);
    });

    it('should have correct critical threshold', () => {
        expect(QUOTA_CONFIG.CRITICAL_THRESHOLD_PERCENT).toBe(95);
    });

    it('should have correct daily read limit', () => {
        expect(QUOTA_CONFIG.DAILY_READS_LIMIT).toBe(50000);
    });

    it('should have correct daily write limit', () => {
        expect(QUOTA_CONFIG.DAILY_WRITES_LIMIT).toBe(20000);
    });

    it('should have default cache TTL of 1 minute', () => {
        expect(QUOTA_CONFIG.DEFAULT_CACHE_TTL_MS).toBe(60000);
    });

    it('should have limited cache TTL of 5 minutes', () => {
        expect(QUOTA_CONFIG.LIMITED_CACHE_TTL_MS).toBe(300000);
    });
});

// ============ Boundary Tests ============

describe('EC-55: Boundary Tests (Mobile)', () => {
    it('should correctly classify 79.9% as OK', () => {
        expect(getQuotaAlertLevel(79.9)).toBe('OK');
    });

    it('should correctly classify 80.0% as WARNING', () => {
        expect(getQuotaAlertLevel(80.0)).toBe('WARNING');
    });

    it('should correctly classify 94.9% as WARNING', () => {
        expect(getQuotaAlertLevel(94.9)).toBe('WARNING');
    });

    it('should correctly classify 95.0% as CRITICAL', () => {
        expect(getQuotaAlertLevel(95.0)).toBe('CRITICAL');
    });

    it('should correctly classify 99.9% as CRITICAL', () => {
        expect(getQuotaAlertLevel(99.9)).toBe('CRITICAL');
    });

    it('should correctly classify 100.0% as EXCEEDED', () => {
        expect(getQuotaAlertLevel(100.0)).toBe('EXCEEDED');
    });
});

// ============ Caching Fallback Logic Tests ============

describe('EC-55: Caching Fallback Logic', () => {
    it('should not enable caching at 79% usage', () => {
        const state = createQuotaState({
            reads: { count: 39500, limit: 50000, percentage: 79 },
            writes: { count: 15800, limit: 20000, percentage: 79 },
        });
        
        expect(shouldEnableCaching(state)).toBe(false);
        expect(getCacheTTL(state)).toBe(QUOTA_CONFIG.DEFAULT_CACHE_TTL_MS);
    });

    it('should enable caching at 80% usage', () => {
        const state = createQuotaState({
            reads: { count: 40000, limit: 50000, percentage: 80 },
            writes: { count: 5000, limit: 20000, percentage: 25 },
        });
        
        expect(shouldEnableCaching(state)).toBe(true);
        expect(getCacheTTL(state)).toBe(QUOTA_CONFIG.LIMITED_CACHE_TTL_MS);
    });

    it('should increase fetch interval at warning level', () => {
        const state = createQuotaState({
            reads: { count: 42500, limit: 50000, percentage: 85 },
        });
        
        const baseInterval = 10000;
        const adjustedInterval = getQuotaAwareFetchInterval(state, baseInterval);
        
        expect(adjustedInterval).toBe(baseInterval * 2);
    });

    it('should significantly increase fetch interval at critical level', () => {
        const state = createQuotaState({
            reads: { count: 48000, limit: 50000, percentage: 96 },
        });
        
        const baseInterval = 10000;
        const adjustedInterval = getQuotaAwareFetchInterval(state, baseInterval);
        
        expect(adjustedInterval).toBe(baseInterval * 5);
    });
});
