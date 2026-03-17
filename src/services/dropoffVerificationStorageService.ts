import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'dropoff_verification_v1_';

export interface DropoffVerificationSnapshot {
    boxOtpValidated: boolean;
    faceDetected: boolean;
    cameraFailed: boolean;
    hardwareSuccess: boolean;
    fallbackPhotoUri: string | null;
    hardwareProofUrl: string | null;
    auditProofUrl: string | null;
    proofVersion: number;
    manualModeEnabled: boolean;
    savedAt: number;
}

function keyForDelivery(deliveryId: string): string {
    return `${KEY_PREFIX}${deliveryId}`;
}

export async function loadDropoffVerificationSnapshot(
    deliveryId: string
): Promise<DropoffVerificationSnapshot | null> {
    try {
        const raw = await AsyncStorage.getItem(keyForDelivery(deliveryId));
        if (!raw) return null;
        return JSON.parse(raw) as DropoffVerificationSnapshot;
    } catch (error) {
        console.warn('[DropoffStorage] Failed to load snapshot:', error);
        return null;
    }
}

export async function saveDropoffVerificationSnapshot(
    deliveryId: string,
    snapshot: Omit<DropoffVerificationSnapshot, 'savedAt'>
): Promise<void> {
    try {
        const payload: DropoffVerificationSnapshot = {
            ...snapshot,
            savedAt: Date.now(),
        };
        await AsyncStorage.setItem(keyForDelivery(deliveryId), JSON.stringify(payload));
    } catch (error) {
        console.warn('[DropoffStorage] Failed to save snapshot:', error);
    }
}

export async function clearDropoffVerificationSnapshot(deliveryId: string): Promise<void> {
    try {
        await AsyncStorage.removeItem(keyForDelivery(deliveryId));
    } catch (error) {
        console.warn('[DropoffStorage] Failed to clear snapshot:', error);
    }
}
