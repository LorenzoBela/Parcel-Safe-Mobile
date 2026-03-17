import AsyncStorage from '@react-native-async-storage/async-storage';

const SNAPSHOT_KEY = 'rider_arrival_session_snapshot_v1';

export type RiderGeofenceTarget = 'pickup' | 'dropoff' | 'return_pickup';

export interface RiderSessionSnapshot {
    lastActiveDeliveryId: string;
    deliveryId: string;
    boxId: string;
    geofenceTarget: RiderGeofenceTarget;
    uiPhase: string;
    lastDistanceMeters: number | null;
    lastBoxHeartbeatAt: number;
    lastPhoneGpsAt: number;
    savedAt: number;
}

export async function loadRiderSessionSnapshot(): Promise<RiderSessionSnapshot | null> {
    try {
        const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as RiderSessionSnapshot;
    } catch (error) {
        console.warn('[RiderSessionSnapshot] Failed to load snapshot:', error);
        return null;
    }
}

export async function saveRiderSessionSnapshot(
    snapshot: Omit<RiderSessionSnapshot, 'savedAt'>
): Promise<void> {
    try {
        const payload: RiderSessionSnapshot = {
            ...snapshot,
            savedAt: Date.now(),
        };
        await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('[RiderSessionSnapshot] Failed to save snapshot:', error);
    }
}

export async function clearRiderSessionSnapshot(): Promise<void> {
    try {
        await AsyncStorage.removeItem(SNAPSHOT_KEY);
    } catch (error) {
        console.warn('[RiderSessionSnapshot] Failed to clear snapshot:', error);
    }
}
