/**
 * Hardware Status Service Tests (Mobile)
 * 
 * Tests for EC-21, EC-22, EC-23, EC-25 edge cases in mobile app.
 * 
 * Run with: npm test -- hardwareStatus
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import {
    getOverallHealthStatus,
    generateAlerts,
    isBoxSafeForDelivery,
    canProceedWithDelivery,
    getStatusText,
    getStatusColor,
    getStatusIcon,
    HardwareHealth,
    SolenoidState,
    CameraState,
    RebootState,
    OverallHealthStatus,
} from '../services/hardwareStatusService';

// ============ Test Data Factories ============

function createSolenoidState(overrides: Partial<SolenoidState> = {}): SolenoidState {
    return {
        status: 'OK',
        retry_count: 0,
        out_of_service: false,
        timestamp: Date.now(),
        delivery_id: 'delivery-123',
        ...overrides,
    };
}

function createCameraState(overrides: Partial<CameraState> = {}): CameraState {
    return {
        status: 'OK',
        has_hardware_error: false,
        last_capture_attempts: 1,
        failure_reason: '',
        timestamp: Date.now(),
        delivery_id: 'delivery-123',
        ...overrides,
    };
}

function createRebootState(overrides: Partial<RebootState> = {}): RebootState {
    return {
        rebooted: false,
        boot_count: 5,
        had_active_delivery: false,
        delivery_id: '',
        timestamp: Date.now(),
        ...overrides,
    };
}

// ============ getOverallHealthStatus Tests ============

describe('getOverallHealthStatus', () => {
    it('should return HEALTHY when all systems normal', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState(),
            reboot: createRebootState(),
        };
        
        expect(getOverallHealthStatus(health)).toBe('HEALTHY');
    });

    it('should return OUT_OF_SERVICE when solenoid stuck open (EC-22)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_OPEN' }),
            camera: createCameraState(),
            reboot: createRebootState(),
        };
        
        expect(getOverallHealthStatus(health)).toBe('OUT_OF_SERVICE');
    });

    it('should return OUT_OF_SERVICE when marked out of service (EC-22)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ out_of_service: true }),
            camera: createCameraState(),
            reboot: createRebootState(),
        };
        
        expect(getOverallHealthStatus(health)).toBe('OUT_OF_SERVICE');
    });

    it('should return CRITICAL when solenoid stuck closed (EC-21)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_CLOSED', retry_count: 3 }),
            camera: createCameraState(),
            reboot: createRebootState(),
        };
        
        expect(getOverallHealthStatus(health)).toBe('CRITICAL');
    });

    it('should return CRITICAL when camera has hardware error (EC-23)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState({ has_hardware_error: true }),
            reboot: createRebootState(),
        };
        
        expect(getOverallHealthStatus(health)).toBe('CRITICAL');
    });

    it('should return WARNING when camera failed (EC-23)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState({ status: 'FAILED', last_capture_attempts: 3 }),
            reboot: createRebootState(),
        };
        
        expect(getOverallHealthStatus(health)).toBe('WARNING');
    });

    it('should return WARNING when recently rebooted (EC-25)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState(),
            reboot: createRebootState({ rebooted: true }),
        };
        
        expect(getOverallHealthStatus(health)).toBe('WARNING');
    });
});

// ============ generateAlerts Tests ============

describe('generateAlerts', () => {
    it('should return empty array when all healthy', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState(),
            reboot: createRebootState(),
        };
        
        const alerts = generateAlerts(health);
        expect(alerts).toHaveLength(0);
    });

    it('should generate alert for solenoid stuck closed (EC-21)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_CLOSED', retry_count: 3 }),
        };
        
        const alerts = generateAlerts(health);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].id).toBe('ec21-solenoid-stuck-closed');
        expect(alerts[0].severity).toBe('error');
        expect(alerts[0].title).toContain('Jammed');
    });

    it('should generate alert for solenoid stuck open (EC-22)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_OPEN' }),
        };
        
        const alerts = generateAlerts(health);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].id).toBe('ec22-solenoid-stuck-open');
        expect(alerts[0].severity).toBe('critical');
        expect(alerts[0].title).toContain('Cannot Be Secured');
    });

    it('should generate alert for out of service (EC-22)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ out_of_service: true, status: 'OK' }),
        };
        
        const alerts = generateAlerts(health);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].id).toBe('ec22-out-of-service');
        expect(alerts[0].severity).toBe('critical');
    });

    it('should generate alert for camera failed (EC-23)', () => {
        const health: Partial<HardwareHealth> = {
            camera: createCameraState({ status: 'FAILED', last_capture_attempts: 3 }),
        };
        
        const alerts = generateAlerts(health);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].id).toBe('ec23-camera-failed');
        expect(alerts[0].severity).toBe('warning');
    });

    it('should generate alert for camera hardware error (EC-23)', () => {
        const health: Partial<HardwareHealth> = {
            camera: createCameraState({ has_hardware_error: true }),
        };
        
        const alerts = generateAlerts(health);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].id).toBe('ec23-camera-hardware');
        expect(alerts[0].severity).toBe('error');
    });

    it('should generate alert for reboot during delivery (EC-25)', () => {
        const health: Partial<HardwareHealth> = {
            reboot: createRebootState({ 
                rebooted: true, 
                had_active_delivery: true,
                delivery_id: 'delivery-123',
            }),
        };
        
        const alerts = generateAlerts(health, 'delivery-123');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].id).toBe('ec25-reboot');
        expect(alerts[0].severity).toBe('info');
    });

    it('should not generate reboot alert for different delivery', () => {
        const health: Partial<HardwareHealth> = {
            reboot: createRebootState({ 
                rebooted: true, 
                had_active_delivery: true,
                delivery_id: 'delivery-other',
            }),
        };
        
        const alerts = generateAlerts(health, 'delivery-123');
        expect(alerts).toHaveLength(0);
    });

    it('should generate multiple alerts for multiple issues', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_CLOSED', retry_count: 3 }),
            camera: createCameraState({ status: 'FAILED', last_capture_attempts: 3 }),
        };
        
        const alerts = generateAlerts(health);
        expect(alerts).toHaveLength(2);
    });
});

// ============ isBoxSafeForDelivery Tests ============

describe('isBoxSafeForDelivery', () => {
    it('should return safe when healthy', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
        };
        
        const result = isBoxSafeForDelivery(health);
        expect(result.safe).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('should return unsafe when out of service (EC-22)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ out_of_service: true }),
        };
        
        const result = isBoxSafeForDelivery(health);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('out of service');
    });

    it('should return unsafe when stuck open (EC-22)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_OPEN' }),
        };
        
        const result = isBoxSafeForDelivery(health);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('secure');
    });

    it('should return unsafe when stuck closed (EC-21)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_CLOSED' }),
        };
        
        const result = isBoxSafeForDelivery(health);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('jammed');
    });

    it('should return safe despite camera issues (EC-23)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState({ status: 'FAILED' }),
        };
        
        const result = isBoxSafeForDelivery(health);
        expect(result.safe).toBe(true);
    });
});

// ============ canProceedWithDelivery Tests ============

describe('canProceedWithDelivery', () => {
    it('should allow proceed when healthy', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState(),
        };
        
        const result = canProceedWithDelivery(health);
        expect(result.canProceed).toBe(true);
        expect(result.warnings).toHaveLength(0);
    });

    it('should allow proceed with camera failure warning (EC-23)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            camera: createCameraState({ status: 'FAILED' }),
        };
        
        const result = canProceedWithDelivery(health);
        expect(result.canProceed).toBe(true);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('Photo');
    });

    it('should allow proceed with reboot warning (EC-25)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState(),
            reboot: createRebootState({ rebooted: true }),
        };
        
        const result = canProceedWithDelivery(health);
        expect(result.canProceed).toBe(true);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('restart');
    });

    it('should block proceed when stuck open (EC-22)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_OPEN' }),
        };
        
        const result = canProceedWithDelivery(health);
        expect(result.canProceed).toBe(false);
        expect(result.warnings).toHaveLength(1);
    });

    it('should block proceed when stuck closed (EC-21)', () => {
        const health: Partial<HardwareHealth> = {
            solenoid: createSolenoidState({ status: 'STUCK_CLOSED' }),
        };
        
        const result = canProceedWithDelivery(health);
        expect(result.canProceed).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('jammed');
    });
});

// ============ UI Helper Tests ============

describe('UI Helpers', () => {
    describe('getStatusText', () => {
        it('should return correct text for each status', () => {
            expect(getStatusText('HEALTHY')).toBe('All Systems Normal');
            expect(getStatusText('WARNING')).toBe('Minor Issues Detected');
            expect(getStatusText('CRITICAL')).toBe('Hardware Issue');
            expect(getStatusText('OUT_OF_SERVICE')).toBe('Out of Service');
        });
    });

    describe('getStatusColor', () => {
        it('should return hex colors', () => {
            expect(getStatusColor('HEALTHY')).toMatch(/^#[0-9a-f]{6}$/i);
            expect(getStatusColor('WARNING')).toMatch(/^#[0-9a-f]{6}$/i);
            expect(getStatusColor('CRITICAL')).toMatch(/^#[0-9a-f]{6}$/i);
            expect(getStatusColor('OUT_OF_SERVICE')).toMatch(/^#[0-9a-f]{6}$/i);
        });

        it('should return green for healthy', () => {
            expect(getStatusColor('HEALTHY')).toBe('#22c55e');
        });

        it('should return red for critical', () => {
            expect(getStatusColor('CRITICAL')).toBe('#ef4444');
        });
    });

    describe('getStatusIcon', () => {
        it('should return emoji for each status', () => {
            expect(getStatusIcon('HEALTHY')).toBe('✅');
            expect(getStatusIcon('WARNING')).toBe('⚠️');
            expect(getStatusIcon('CRITICAL')).toBe('🔴');
            expect(getStatusIcon('OUT_OF_SERVICE')).toBe('🚫');
        });
    });
});
