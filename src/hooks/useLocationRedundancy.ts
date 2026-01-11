/**
 * useLocationRedundancy Hook
 * 
 * React hook for easy integration of the GPS redundancy system
 * into any component. Handles lifecycle management automatically.
 */

import { useState, useEffect, useCallback } from 'react';
import {
    locationRedundancy,
    RedundancyState,
    PowerState,
    LocationSource,
} from '../services/locationRedundancy';
import { LocationData } from '../services/firebaseClient';

export interface UseLocationRedundancyResult {
    /** Current power state: SLEEP, STANDBY, or ACTIVE */
    powerState: PowerState;

    /** Current GPS source: 'box', 'phone', or 'none' */
    source: LocationSource;

    /** Whether the box is currently online */
    isBoxOnline: boolean;

    /** Whether phone GPS is currently active (fallback mode) */
    phoneGpsActive: boolean;

    /** Last received location data */
    lastLocation: LocationData | null;

    /** Timestamp of last box heartbeat */
    lastBoxHeartbeat: number | null;

    /** Start monitoring a box (call when delivery is assigned) */
    startMonitoring: (boxId: string) => void;

    /** Activate GPS tracking (call when trip starts) */
    activateTracking: () => void;

    /** Deactivate GPS tracking (call when delivery completed) */
    deactivateTracking: () => void;

    /** Stop all monitoring (call when all deliveries done) */
    stopMonitoring: () => void;
}

/**
 * Hook to use the GPS redundancy system in React components
 * 
 * @param boxId - Optional box ID to start monitoring immediately
 * @param autoActivate - If true, automatically activate when boxId changes
 * 
 * @example
 * ```tsx
 * function RiderDashboard() {
 *   const { 
 *     isBoxOnline, 
 *     source, 
 *     startMonitoring, 
 *     activateTracking 
 *   } = useLocationRedundancy();
 *   
 *   useEffect(() => {
 *     startMonitoring('BOX_001');
 *   }, []);
 *   
 *   return (
 *     <View>
 *       <Text>GPS Source: {source}</Text>
 *       <Text>Box Online: {isBoxOnline ? 'Yes' : 'No'}</Text>
 *     </View>
 *   );
 * }
 * ```
 */
export function useLocationRedundancy(
    boxId?: string,
    autoActivate: boolean = false
): UseLocationRedundancyResult {
    const [state, setState] = useState<RedundancyState>(() =>
        locationRedundancy.getState()
    );

    // Subscribe to state changes
    useEffect(() => {
        const unsubscribe = locationRedundancy.subscribe(setState);
        return unsubscribe;
    }, []);

    // Auto-start monitoring if boxId provided
    useEffect(() => {
        if (boxId) {
            locationRedundancy.start(boxId);
            if (autoActivate) {
                locationRedundancy.activate();
            }
        }

        // Cleanup on unmount
        return () => {
            // Don't stop on unmount - allow background operation
            // User must explicitly call stopMonitoring()
        };
    }, [boxId, autoActivate]);

    const startMonitoring = useCallback((id: string) => {
        locationRedundancy.start(id);
    }, []);

    const activateTracking = useCallback(() => {
        locationRedundancy.activate();
    }, []);

    const deactivateTracking = useCallback(() => {
        locationRedundancy.deactivate();
    }, []);

    const stopMonitoring = useCallback(() => {
        locationRedundancy.stop();
    }, []);

    return {
        powerState: state.powerState,
        source: state.source,
        isBoxOnline: state.isBoxOnline,
        phoneGpsActive: state.phoneGpsActive,
        lastLocation: state.lastLocation,
        lastBoxHeartbeat: state.lastBoxHeartbeat,
        startMonitoring,
        activateTracking,
        deactivateTracking,
        stopMonitoring,
    };
}

/**
 * Get a human-readable status message for the current GPS state
 */
export function getStatusMessage(source: LocationSource, isBoxOnline: boolean): string {
    switch (source) {
        case 'box':
            return 'Box GPS Active';
        case 'phone':
            return 'Phone GPS Fallback';
        case 'none':
            return isBoxOnline ? 'Waiting for GPS...' : 'No Signal';
        default:
            return 'Unknown';
    }
}

/**
 * Get a status color for UI display
 */
export function getStatusColor(source: LocationSource, isBoxOnline: boolean): string {
    switch (source) {
        case 'box':
            return '#4CAF50'; // Green
        case 'phone':
            return '#FFC107'; // Yellow/Amber
        case 'none':
            return '#F44336'; // Red
        default:
            return '#9E9E9E'; // Grey
    }
}

export default useLocationRedundancy;
