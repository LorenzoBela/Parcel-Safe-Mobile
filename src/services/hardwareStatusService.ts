/**
 * Hardware Status Service for Parcel-Safe Mobile App
 * 
 * Provides hardware health monitoring and alerts for:
 * - EC-21: Solenoid Stuck Closed
 * - EC-22: Solenoid Stuck Open  
 * - EC-23: Camera Failure
 * - EC-25: ESP32 Brownout/Reboot
 * 
 * Used by riders to monitor box health during deliveries.
 */

import {
    subscribeToSolenoid,
    subscribeToCamera,
    subscribeToReboot,
    clearRebootFlag,
    SolenoidState,
    CameraState,
    RebootState,
    SolenoidStatusType,
    CameraStatusType,
} from './firebaseClient';

// ==================== Types ====================

export type OverallHealthStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'OUT_OF_SERVICE';

export interface HardwareHealth {
    solenoid: SolenoidState | null;
    camera: CameraState | null;
    reboot: RebootState | null;
    overallStatus: OverallHealthStatus;
    alerts: HardwareAlert[];
}

export interface HardwareAlert {
    id: string;
    type: 'solenoid' | 'camera' | 'reboot';
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
    
    // EC-21: Solenoid stuck closed or EC-23: Camera hardware error
    if (health.solenoid?.status === 'STUCK_CLOSED' || health.camera?.has_hardware_error) {
        return 'CRITICAL';
    }
    
    // EC-23: Camera failed or EC-25: Recent reboot during delivery
    if (health.camera?.status === 'FAILED' || health.reboot?.rebooted) {
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
    
    // EC-21: Stuck closed (delivery possible but risky)
    if (health.solenoid?.status === 'STUCK_CLOSED') {
        return {
            safe: false,
            reason: 'Lock mechanism is jammed - may not open for customer',
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
    clearRebootFlag,
};

export type {
    SolenoidState,
    CameraState,
    RebootState,
    SolenoidStatusType,
    CameraStatusType,
};
