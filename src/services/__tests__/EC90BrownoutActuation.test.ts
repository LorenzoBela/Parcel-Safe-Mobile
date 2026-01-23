/**
 * EC-90: Brownout Actuation / Power State Tests
 * 
 * Tests for low voltage detection and solenoid blocking logic.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock voltage thresholds (should match hardware/LockControl.h)
const VOLTAGE_THRESHOLDS = {
    HEALTHY: 12.0,
    WARNING: 11.5,
    CRITICAL: 11.5,
    DEAD: 10.5,
};

// Power status enum (should match hardware/LockControl.h)
type PowerStatusType = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'DEAD';

// Helper functions for testing
function getVoltageStatus(voltage: number): PowerStatusType {
    if (voltage >= VOLTAGE_THRESHOLDS.HEALTHY) return 'HEALTHY';
    if (voltage >= VOLTAGE_THRESHOLDS.WARNING) return 'WARNING';
    if (voltage >= VOLTAGE_THRESHOLDS.DEAD) return 'CRITICAL';
    return 'DEAD';
}

function isSolenoidBlocked(voltage: number): boolean {
    return voltage < VOLTAGE_THRESHOLDS.CRITICAL;
}

function canUnlock(voltage: number): boolean {
    return voltage >= VOLTAGE_THRESHOLDS.CRITICAL;
}

describe('EC-90: Brownout Actuation (Low Voltage Lockout)', () => {
    describe('Voltage Thresholds', () => {
        it('should define healthy voltage at 12.0V', () => {
            expect(VOLTAGE_THRESHOLDS.HEALTHY).toBe(12.0);
        });

        it('should define warning voltage at 11.5V', () => {
            expect(VOLTAGE_THRESHOLDS.WARNING).toBe(11.5);
        });

        it('should define critical voltage at 11.5V', () => {
            expect(VOLTAGE_THRESHOLDS.CRITICAL).toBe(11.5);
        });

        it('should define dead voltage at 10.5V', () => {
            expect(VOLTAGE_THRESHOLDS.DEAD).toBe(10.5);
        });
    });

    describe('Voltage Status Detection', () => {
        it('should return HEALTHY for 12.4V', () => {
            expect(getVoltageStatus(12.4)).toBe('HEALTHY');
        });

        it('should return HEALTHY for exactly 12.0V', () => {
            expect(getVoltageStatus(12.0)).toBe('HEALTHY');
        });

        it('should return WARNING for 11.8V', () => {
            expect(getVoltageStatus(11.8)).toBe('WARNING');
        });

        it('should return WARNING for exactly 11.5V', () => {
            expect(getVoltageStatus(11.5)).toBe('WARNING');
        });

        it('should return CRITICAL for 11.2V', () => {
            expect(getVoltageStatus(11.2)).toBe('CRITICAL');
        });

        it('should return CRITICAL for 10.8V', () => {
            expect(getVoltageStatus(10.8)).toBe('CRITICAL');
        });

        it('should return DEAD for 10.2V', () => {
            expect(getVoltageStatus(10.2)).toBe('DEAD');
        });

        it('should return DEAD for 9.0V', () => {
            expect(getVoltageStatus(9.0)).toBe('DEAD');
        });
    });

    describe('Solenoid Blocking Logic', () => {
        it('should NOT block solenoid at 12.4V', () => {
            expect(isSolenoidBlocked(12.4)).toBe(false);
        });

        it('should NOT block solenoid at 12.0V', () => {
            expect(isSolenoidBlocked(12.0)).toBe(false);
        });

        it('should NOT block solenoid at 11.5V', () => {
            expect(isSolenoidBlocked(11.5)).toBe(false);
        });

        it('should block solenoid at 11.4V', () => {
            expect(isSolenoidBlocked(11.4)).toBe(true);
        });

        it('should block solenoid at 11.0V', () => {
            expect(isSolenoidBlocked(11.0)).toBe(true);
        });

        it('should block solenoid at 10.5V', () => {
            expect(isSolenoidBlocked(10.5)).toBe(true);
        });

        it('should block solenoid at 10.0V', () => {
            expect(isSolenoidBlocked(10.0)).toBe(true);
        });
    });

    describe('Unlock Permission', () => {
        it('should allow unlock at healthy voltage', () => {
            expect(canUnlock(12.4)).toBe(true);
        });

        it('should allow unlock at warning voltage', () => {
            expect(canUnlock(11.8)).toBe(true);
        });

        it('should allow unlock at exactly critical threshold', () => {
            expect(canUnlock(11.5)).toBe(true);
        });

        it('should deny unlock below critical voltage', () => {
            expect(canUnlock(11.4)).toBe(false);
        });

        it('should deny unlock at dead voltage', () => {
            expect(canUnlock(10.2)).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('should handle exactly boundary values correctly', () => {
            // At 11.50000 should be allowed
            expect(isSolenoidBlocked(11.50000)).toBe(false);

            // At 11.49999 should be blocked
            expect(isSolenoidBlocked(11.49999)).toBe(true);
        });

        it('should handle very high voltages', () => {
            expect(getVoltageStatus(14.0)).toBe('HEALTHY');
            expect(isSolenoidBlocked(14.0)).toBe(false);
        });

        it('should handle zero voltage', () => {
            expect(getVoltageStatus(0)).toBe('DEAD');
            expect(isSolenoidBlocked(0)).toBe(true);
        });

        it('should handle negative voltage (error state)', () => {
            expect(getVoltageStatus(-1)).toBe('DEAD');
            expect(isSolenoidBlocked(-1)).toBe(true);
        });
    });
});
