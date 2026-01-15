/**
 * useHardwareStatus Hook
 * 
 * React hook for monitoring hardware health status in the mobile app.
 * Handles EC-21, EC-22, EC-23, EC-25, EC-82, EC-83, EC-86 edge cases.
 * 
 * Usage:
 * ```tsx
 * const { health, alerts, isLoading, isSafe, canProceed } = useHardwareStatus('BOX_001', 'delivery-123');
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import {
    subscribeToSolenoid,
    subscribeToCamera,
    subscribeToReboot,
    subscribeToKeypad,
    subscribeToHinge,
    subscribeToDisplay,
    clearRebootFlag,
    SolenoidState,
    CameraState,
    RebootState,
    KeypadState,
    HingeState,
    DisplayState,
    HardwareHealth,
    HardwareAlert,
    OverallHealthStatus,
    getOverallHealthStatus,
    generateAlerts,
    isBoxSafeForDelivery,
    canProceedWithDelivery,
    getStatusText,
    getStatusColor,
    getStatusIcon,
} from '../services/hardwareStatusService';

export interface UseHardwareStatusResult {
    // State
    health: HardwareHealth;
    alerts: HardwareAlert[];
    isLoading: boolean;
    error: string | null;

    // Computed values
    overallStatus: OverallHealthStatus;
    statusText: string;
    statusColor: string;
    statusIcon: string;

    // Safety checks
    isSafe: boolean;
    safetyReason?: string;
    canProceed: boolean;
    proceedWarnings: string[];

    // Actions
    dismissAlert: (alertId: string) => void;
    acknowledgeReboot: () => Promise<void>;
    refresh: () => void;
}

export function useHardwareStatus(
    boxId: string | null,
    deliveryId?: string
): UseHardwareStatusResult {
    // State
    const [solenoidState, setSolenoidState] = useState<SolenoidState | null>(null);
    const [cameraState, setCameraState] = useState<CameraState | null>(null);
    const [rebootState, setRebootState] = useState<RebootState | null>(null);
    const [keypadState, setKeypadState] = useState<KeypadState | null>(null);
    const [hingeState, setHingeState] = useState<HingeState | null>(null);
    const [displayState, setDisplayState] = useState<DisplayState | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
    const [refreshKey, setRefreshKey] = useState(0);

    // Subscribe to hardware states
    useEffect(() => {
        if (!boxId) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);
        let loadedCount = 0;
        const totalSources = 6; // Solenoid, Camera, Reboot, Keypad, Hinge, Display

        const checkLoaded = () => {
            loadedCount++;
            if (loadedCount >= totalSources) {
                setIsLoading(false);
            }
        };

        try {
            const unsubSolenoid = subscribeToSolenoid(boxId, (state) => {
                setSolenoidState(state);
                checkLoaded();
            });

            const unsubCamera = subscribeToCamera(boxId, (state) => {
                setCameraState(state);
                checkLoaded();
            });

            const unsubReboot = subscribeToReboot(boxId, (state) => {
                setRebootState(state);
                checkLoaded();
            });

            const unsubKeypad = subscribeToKeypad(boxId, (state) => {
                setKeypadState(state);
                checkLoaded();
            });

            const unsubHinge = subscribeToHinge(boxId, (state) => {
                setHingeState(state);
                checkLoaded();
            });

            const unsubDisplay = subscribeToDisplay(boxId, (state) => {
                setDisplayState(state);
                checkLoaded();
            });

            return () => {
                unsubSolenoid();
                unsubCamera();
                unsubReboot();
                unsubKeypad();
                unsubHinge();
                unsubDisplay();
            };
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to subscribe to hardware status');
            setIsLoading(false);
        }
    }, [boxId, refreshKey]);

    // Build health object
    const health: HardwareHealth = {
        solenoid: solenoidState,
        camera: cameraState,
        reboot: rebootState,
        keypad: keypadState,
        hinge: hingeState,
        display: displayState,
        overallStatus: getOverallHealthStatus({
            solenoid: solenoidState,
            camera: cameraState,
            reboot: rebootState,
            keypad: keypadState,
            hinge: hingeState,
            display: displayState
        }),
        alerts: [],
    };

    // Generate and filter alerts
    const allAlerts = generateAlerts(health, deliveryId);
    const alerts = allAlerts.filter(alert => !dismissedAlerts.has(alert.id));
    health.alerts = alerts;

    // Compute overall status
    const overallStatus = health.overallStatus;
    const statusText = getStatusText(overallStatus);
    const statusColor = getStatusColor(overallStatus);
    const statusIcon = getStatusIcon(overallStatus);

    // Safety checks
    const safetyCheck = isBoxSafeForDelivery(health);
    const proceedCheck = canProceedWithDelivery(health);

    // Actions
    const dismissAlert = useCallback((alertId: string) => {
        setDismissedAlerts(prev => new Set(prev).add(alertId));
    }, []);

    const acknowledgeReboot = useCallback(async () => {
        if (boxId && rebootState?.rebooted) {
            try {
                await clearRebootFlag(boxId);
            } catch (err) {
                console.error('[EC-25] Failed to clear reboot flag:', err);
            }
        }
    }, [boxId, rebootState]);

    const refresh = useCallback(() => {
        setRefreshKey(prev => prev + 1);
    }, []);

    return {
        // State
        health,
        alerts,
        isLoading,
        error,

        // Computed values
        overallStatus,
        statusText,
        statusColor,
        statusIcon,

        // Safety checks
        isSafe: safetyCheck.safe,
        safetyReason: safetyCheck.reason,
        canProceed: proceedCheck.canProceed,
        proceedWarnings: proceedCheck.warnings,

        // Actions
        dismissAlert,
        acknowledgeReboot,
        refresh,
    };
}

export default useHardwareStatus;
