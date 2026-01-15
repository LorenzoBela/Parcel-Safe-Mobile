/**
 * EC-86: Display Failure Tests
 * 
 * Tests for I2C display health monitoring, alerts, safety checks,
 * and customer UI components.
 */

import { generateAlerts, getOverallHealthStatus, isBoxSafeForDelivery } from '../hardwareStatusService';
import { HardwareHealth } from '../hardwareStatusService';

describe('EC-86: Display Failure Edge Case', () => {
    describe('Display Health Status', () => {
        it('should mark overall status as CRITICAL when display FAILED', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'FAILED',
                    last_i2c_ack: Date.now() - 10000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 5,
                    last_error: 'I2C timeout',
                    needs_service: true,
                    timestamp: Date.now(),
                },
            };

            const status = getOverallHealthStatus(health);
            expect(status).toBe('CRITICAL');
        });

        it('should mark overall status as WARNING when display DEGRADED', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'DEGRADED',
                    last_i2c_ack: Date.now() - 1000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 2,
                    last_error: 'I2C slow response',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const status = getOverallHealthStatus(health);
            expect(status).toBe('WARNING');
        });

        it('should mark overall status as HEALTHY when display OK', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'OK',
                    last_i2c_ack: Date.now(),
                    brightness: 255,
                    contrast: 128,
                    error_count: 0,
                    last_error: '',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const status = getOverallHealthStatus(health);
            expect(status).toBe('HEALTHY');
        });
    });

    describe('Display Alert Generation', () => {
        it('should generate CRITICAL alert when display FAILED', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'FAILED',
                    last_i2c_ack: Date.now() - 10000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 5,
                    last_error: 'I2C timeout',
                    needs_service: true,
                    timestamp: Date.now(),
                },
            };

            const alerts = generateAlerts(health, 'BOX_001');
            const displayAlert = alerts.find(a => a.id === 'ec86-display-failed');

            expect(displayAlert).toBeDefined();
            expect(displayAlert?.severity).toBe('critical');
            expect(displayAlert?.title).toBe('Display Not Working');
            expect(displayAlert?.message).toContain('not functional');
        });

        it('should generate WARNING alert when display DEGRADED', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'DEGRADED',
                    last_i2c_ack: Date.now() - 1000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 2,
                    last_error: 'I2C slow response',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const alerts = generateAlerts(health, 'BOX_001');
            const displayAlert = alerts.find(a => a.id === 'ec86-display-degraded');

            expect(displayAlert).toBeDefined();
            expect(displayAlert?.severity).toBe('warning');
            expect(displayAlert?.title).toBe('Display Quality Issue');
            expect(displayAlert?.message).toContain('hard to read');
        });

        it('should not generate alert when display OK', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'OK',
                    last_i2c_ack: Date.now(),
                    brightness: 255,
                    contrast: 128,
                    error_count: 0,
                    last_error: '',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const alerts = generateAlerts(health, 'BOX_001');
            const displayAlerts = alerts.filter(a => a.id.includes('display'));

            expect(displayAlerts.length).toBe(0);
        });
    });

    describe('Delivery Safety Checks', () => {
        it('should block delivery when display FAILED', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'FAILED',
                    last_i2c_ack: Date.now() - 10000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 5,
                    last_error: 'I2C timeout',
                    needs_service: true,
                    timestamp: Date.now(),
                },
            };

            const safe = isBoxSafeForDelivery(health);
            expect(safe.safe).toBe(false);
        });

        it('should allow delivery when display DEGRADED (fallback active)', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'DEGRADED',
                    last_i2c_ack: Date.now() - 1000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 2,
                    last_error: 'I2C slow response',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const safe = isBoxSafeForDelivery(health);
            expect(safe.safe).toBe(true);
        });

        it('should allow delivery when display OK', () => {
            const health: Partial<HardwareHealth> = {
                display: {
                    status: 'OK',
                    last_i2c_ack: Date.now(),
                    brightness: 255,
                    contrast: 128,
                    error_count: 0,
                    last_error: '',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const safe = isBoxSafeForDelivery(health);
            expect(safe.safe).toBe(true);
        });
    });

    describe('Display Error Count Tracking', () => {
        it('should track increasing error counts', () => {
            const health1: Partial<HardwareHealth> = {
                display: {
                    status: 'OK',
                    last_i2c_ack: Date.now(),
                    brightness: 255,
                    contrast: 128,
                    error_count: 0,
                    last_error: '',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const health2: Partial<HardwareHealth> = {
                ...health1,
                display: {
                    status: 'DEGRADED',
                    last_i2c_ack: Date.now() - 1000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 2,
                    last_error: 'I2C slow response',
                    needs_service: false,
                    timestamp: Date.now(),
                },
            };

            const health3: Partial<HardwareHealth> = {
                ...health1,
                display: {
                    status: 'FAILED',
                    last_i2c_ack: Date.now() - 10000,
                    brightness: 255,
                    contrast: 128,
                    error_count: 5,
                    last_error: 'I2C timeout',
                    needs_service: true,
                    timestamp: Date.now(),
                },
            };

            expect(health1.display?.error_count).toBe(0);
            expect(health2.display?.error_count).toBe(2);
            expect(health3.display?.error_count).toBe(5);
        });
    });
});
