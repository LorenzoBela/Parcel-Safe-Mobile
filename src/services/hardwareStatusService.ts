/**
 * Hardware Status Service for Parcel-Safe Mobile App
 * 
 * Provides hardware health monitoring and alerts for:
 * - EC-21: Solenoid Stuck Closed
 * - EC-22: Solenoid Stuck Open  
 * - EC-23: Camera Failure
 * - EC-25: ESP32 Brownout/Reboot
 * - EC-82: Keypad Stuck
 * - EC-83: Hinge Damage
 * - EC-86: Display Failure
 * - EC-90: Low Voltage / Brownout
 * - EC-91: Resource Conflict
 * 
 * Used by riders to monitor box health during deliveries.
 */

import {
    subscribeToSolenoid,
    subscribeToCamera,
    subscribeToReboot,
    subscribeToKeypad,
    subscribeToHinge,
    subscribeToDisplay,
    subscribeToPower,
    subscribeToResourceConflict,
    subscribeToLockHealth, // EC-96
    clearRebootFlag,
    SolenoidState,
    CameraState,
    RebootState,
    KeypadState,
    HingeState,
    DisplayState,
    PowerState,
    ResourceConflictState,
    SolenoidStatusType,
    CameraStatusType,
    LockHealthState, // EC-96
} from './firebaseClient';

// ==================== Types ====================

export type OverallHealthStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'OUT_OF_SERVICE';

export interface HardwareHealth {
    solenoid: SolenoidState | null;
    camera: CameraState | null;
    reboot: RebootState | null;
    keypad: KeypadState | null;
    hinge: HingeState | null;
    display: DisplayState | null;
    power: PowerState | null;  // EC-90
    resourceConflict: ResourceConflictState | null;  // EC-91
    lockHealth: LockHealthState | null; // EC-96
    overallStatus: OverallHealthStatus;
    alerts: HardwareAlert[];
}

export interface HardwareAlert {
    id: string;
    type: 'solenoid' | 'camera' | 'reboot' | 'keypad' | 'hinge' | 'display' | 'power' | 'resource';
    severity: 'info' | 'warning' | 'error' | 'critical';
    title: string;
    message: string;
    action?: string;
    timestamp: number;
}

// ==================== Helper Functions ====================

/**
 * Determine overall hardware health status
 */
export function getOverallHealthStatus(health: Partial<HardwareHealth>): OverallHealthStatus {
    // EC-22: Solenoid stuck open is most critical - box is unsecured
    if (health.solenoid?.out_of_service || health.solenoid?.status === 'STUCK_OPEN') {
        return 'OUT_OF_SERVICE';
    }

    // EC-83: Hinge Damaged means physical security compromise
    if (health.hinge?.status === 'DAMAGED') {
        return 'OUT_OF_SERVICE';
    }

    // EC-21: Solenoid stuck closed or EC-23: Camera hardware error
    if (health.solenoid?.status === 'STUCK_CLOSED' || health.camera?.has_hardware_error) {
        return 'CRITICAL';
    }

    // EC-82: Stuck Key is Critical (prevents OTP entry)
    if (health.keypad?.is_stuck) {
        return 'CRITICAL';
    }

    // EC-86: Display Failed is Critical (customer can't see OTP entry)
    if (health.display?.status === 'FAILED') {
        return 'CRITICAL';
    }

    // EC-23: Camera failed or EC-25: Recent reboot during delivery
    // EC-83: Hinge Flapping is a warning
    // EC-86: Display Degraded is a warning
    if (health.camera?.status === 'FAILED' || health.reboot?.rebooted || health.hinge?.status === 'FLAPPING' || health.display?.status === 'DEGRADED') {
        return 'WARNING';
    }

    return 'HEALTHY';
}

/**
 * Generate alerts from hardware state
 */
export function generateAlerts(health: Partial<HardwareHealth>, deliveryId?: string): HardwareAlert[] {
    const alerts: HardwareAlert[] = [];
    const now = Date.now();

    // EC-21: Solenoid Stuck Closed
    if (health.solenoid?.status === 'STUCK_CLOSED') {
        alerts.push({
            id: 'ec21-solenoid-stuck-closed',
            type: 'solenoid',
            severity: 'error',
            title: 'Lock Mechanism Jammed',
            message: `Unable to unlock box after ${health.solenoid.retry_count} attempts. Customer may need physical key.`,
            action: 'Contact support for assistance',
            timestamp: health.solenoid.timestamp || now,
        });
    }

    // EC-22: Solenoid Stuck Open
    if (health.solenoid?.status === 'STUCK_OPEN') {
        alerts.push({
            id: 'ec22-solenoid-stuck-open',
            type: 'solenoid',
            severity: 'critical',
            title: 'Box Cannot Be Secured',
            message: 'Lock mechanism failed - box is unsecured. Do not use for deliveries.',
            action: 'Report to support immediately',
            timestamp: health.solenoid.timestamp || now,
        });
    }

    // EC-96: Solenoid Overheated
    if (health.lockHealth?.overheated) {
        alerts.push({
            id: 'ec96-solenoid-overheated',
            type: 'solenoid',
            severity: 'error',
            title: 'Lock Mechanism Overheated',
            message: 'Solenoid coil temperature too high. Actuation temporarily blocked.',
            action: 'Wait for cool down',
            timestamp: health.lockHealth.timestamp || now,
        });
    }

    // EC-22: Out of Service
    if (health.solenoid?.out_of_service && health.solenoid.status !== 'STUCK_OPEN') {
        alerts.push({
            id: 'ec22-out-of-service',
            type: 'solenoid',
            severity: 'critical',
            title: 'Box Out of Service',
            message: 'This box has been marked out of service due to hardware issues.',
            action: 'Use a different box',
            timestamp: health.solenoid.timestamp || now,
        });
    }

    // EC-23: Camera Failed
    if (health.camera?.status === 'FAILED') {
        alerts.push({
            id: 'ec23-camera-failed',
            type: 'camera',
            severity: 'warning',
            title: 'Photo Capture Failed',
            message: `Camera failed after ${health.camera.last_capture_attempts} attempts. Delivery can proceed but is flagged for review.`,
            action: 'Delivery will be marked for manual verification',
            timestamp: health.camera.timestamp || now,
        });
    }

    // EC-23: Camera Hardware Error
    if (health.camera?.has_hardware_error) {
        alerts.push({
            id: 'ec23-camera-hardware',
            type: 'camera',
            severity: 'error',
            title: 'Camera Hardware Error',
            message: 'Camera has a persistent hardware issue. Photos cannot be captured.',
            action: 'Report to support - box needs service',
            timestamp: health.camera.timestamp || now,
        });
    }

    // EC-25: Reboot During Delivery
    if (health.reboot?.rebooted && health.reboot.had_active_delivery) {
        const isCurrentDelivery = !deliveryId || health.reboot.delivery_id === deliveryId;
        if (isCurrentDelivery) {
            alerts.push({
                id: 'ec25-reboot',
                type: 'reboot',
                severity: 'info',
                title: 'System Recovered',
                message: 'Box restarted during delivery but has automatically resumed. All data preserved.',
                action: 'No action needed - delivery continuing normally',
                timestamp: health.reboot.timestamp || now,
            });
        }
    }

    // EC-82: Keypad Stuck
    if (health.keypad?.is_stuck) {
        alerts.push({
            id: 'ec82-keypad-stuck',
            type: 'keypad',
            severity: 'critical',
            title: 'Keypad Malfunction',
            message: `Key '${health.keypad.stuck_key}' is stuck. OTP entry may be impossible.`,
            action: 'Try to unstick key or use App Override',
            timestamp: health.keypad.timestamp || now,
        });
    }

    // EC-83: Hinge Flapping
    if (health.hinge?.status === 'FLAPPING') {
        alerts.push({
            id: 'ec83-hinge-flapping',
            type: 'hinge',
            severity: 'warning',
            title: 'Door Sensor Unstable',
            message: 'Door sensor is flapping (intermittent signal). Check for obstructions.',
            action: 'Secure door properly',
            timestamp: health.hinge.timestamp || now,
        });
    }

    // EC-83: Hinge Damaged
    if (health.hinge?.status === 'DAMAGED') {
        alerts.push({
            id: 'ec83-hinge-damaged',
            type: 'hinge',
            severity: 'critical',
            title: 'Physical Damage Detected',
            message: 'Door sensor indicates OPEN while Lock is LOCKED. Possible forced entry damage.',
            action: 'Inspect hardware immediately',
            timestamp: health.hinge.timestamp || now,
        });
    }

    // EC-86: Display Failed
    if (health.display?.status === 'FAILED') {
        alerts.push({
            id: 'ec86-display-failed',
            type: 'display',
            severity: 'critical',
            title: 'Display Not Working',
            message: 'Box display is not functional. Customer cannot see OTP entry.',
            action: 'Use mobile app unlock or contact customer to use tracking link',
            timestamp: health.display.timestamp || now,
        });
    }

    // EC-86: Display Degraded
    if (health.display?.status === 'DEGRADED') {
        alerts.push({
            id: 'ec86-display-degraded',
            type: 'display',
            severity: 'warning',
            title: 'Display Quality Issue',
            message: `Display may be hard to read. Buzzer and LED feedback active. Error count: ${health.display.error_count}`,
            action: 'Monitor customer feedback',
            timestamp: health.display.timestamp || now,
        });
    }

    return alerts;
}

/**
 * Check if box is safe to use for new deliveries
 */
export function isBoxSafeForDelivery(health: Partial<HardwareHealth>): {
    safe: boolean;
    reason?: string;
} {
    // EC-22: Out of service
    if (health.solenoid?.out_of_service) {
        return {
            safe: false,
            reason: 'Box is marked out of service',
        };
    }

    // EC-22: Stuck open
    if (health.solenoid?.status === 'STUCK_OPEN') {
        return {
            safe: false,
            reason: 'Lock mechanism cannot secure the box',
        };
    }

    // EC-96: Overheated (not strictly unsafe to *use*, but unsafe to *actuate*, so maybe just warning? 
    // Actually if it's overheated we can't lock/unlock so it's unsafe for delivery operation.)
    if (health.lockHealth?.overheated) {
        return {
            safe: false,
            reason: 'Lock mechanism overheated - operation blocked',
        };
    }

    // EC-21: Stuck closed (delivery possible but risky)
    if (health.solenoid?.status === 'STUCK_CLOSED') {
        return {
            safe: false,
            reason: 'Lock mechanism is jammed - may not open for customer',
        };
    }

    // EC-83: Hinge Damage
    if (health.hinge?.status === 'DAMAGED') {
        return {
            safe: false,
            reason: 'Box physical integrity compromised (Hinge Damaged)',
        };
    }

    // EC-86: Display Failed (customer experience severely degraded)
    if (health.display?.status === 'FAILED') {
        return {
            safe: false,
            reason: 'Display not working - customer cannot see OTP entry',
        };
    }

    return { safe: true };
}

/**
 * Check if delivery can proceed despite hardware issues
 */
export function canProceedWithDelivery(health: Partial<HardwareHealth>): {
    canProceed: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];

    // Camera issues don't block delivery
    if (health.camera?.status === 'FAILED' || health.camera?.has_hardware_error) {
        warnings.push('Photo capture unavailable - delivery will be flagged for review');
    }

    // Reboot doesn't block delivery
    if (health.reboot?.rebooted) {
        warnings.push('System recovered from restart - delivery continuing');
    }

    // Solenoid issues DO block delivery
    if (health.solenoid?.status === 'STUCK_OPEN' || health.solenoid?.out_of_service) {
        return {
            canProceed: false,
            warnings: ['Box cannot be used - lock mechanism failure'],
        };
    }

    if (health.solenoid?.status === 'STUCK_CLOSED') {
        return {
            canProceed: false,
            warnings: ['Box lock is jammed - customer cannot retrieve package'],
        };
    }

    // EC-83: Hinge Damage blocks delivery
    if (health.hinge?.status === 'DAMAGED') {
        return {
            canProceed: false,
            warnings: ['Box physical integrity compromised'],
        };
    }

    // EC-82: Stuck key warns but doesn't strictly block (app override exists)
    if (health.keypad?.is_stuck) {
        warnings.push(`Keypad key '${health.keypad.stuck_key}' is stuck - use App Unlock`);
    }

    return {
        canProceed: true,
        warnings,
    };
}

/**
 * Get human-readable status text
 */
export function getStatusText(status: OverallHealthStatus): string {
    switch (status) {
        case 'HEALTHY':
            return 'All Systems Normal';
        case 'WARNING':
            return 'Minor Issues Detected';
        case 'CRITICAL':
            return 'Hardware Issue';
        case 'OUT_OF_SERVICE':
            return 'Out of Service';
    }
}

/**
 * Get status color for UI
 */
export function getStatusColor(status: OverallHealthStatus): string {
    switch (status) {
        case 'HEALTHY':
            return '#22c55e'; // green-500
        case 'WARNING':
            return '#eab308'; // yellow-500
        case 'CRITICAL':
            return '#ef4444'; // red-500
        case 'OUT_OF_SERVICE':
            return '#6b7280'; // gray-500
    }
}

/**
 * Get status icon emoji
 */
export function getStatusIcon(status: OverallHealthStatus): string {
    switch (status) {
        case 'HEALTHY':
            return '✅';
        case 'WARNING':
            return '⚠️';
        case 'CRITICAL':
            return '🔴';
        case 'OUT_OF_SERVICE':
            return '🚫';
    }
}

// ==================== Exports ====================

export {
    subscribeToSolenoid,
    subscribeToCamera,
    subscribeToReboot,
    subscribeToKeypad,
    subscribeToHinge,
    subscribeToDisplay, // Fix missing export
    clearRebootFlag,
    subscribeToLockHealth, // EC-96
    subscribeToPower, // EC-90
    subscribeToResourceConflict, // EC-91
};

export type {
    SolenoidState,
    CameraState,
    RebootState,
    KeypadState,
    HingeState,
    DisplayState,
    SolenoidStatusType,
    CameraStatusType,
    LockHealthState, // EC-96
    PowerState, // EC-90
    ResourceConflictState, // EC-91
};
