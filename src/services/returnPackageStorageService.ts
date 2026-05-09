import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'return_package_v1_';

export type ReturnPackageStep =
    | 'NAVIGATING'
    | 'ARRIVED'
    | 'PHOTO_CAPTURE'
    | 'UPLOADING'
    | 'COMPLETED';

export interface ReturnPackageSnapshot {
    currentStep: ReturnPackageStep;
    hardwareSuccess: boolean;
    hardwareProofUrl: string | null;
    cameraFailed: boolean;
    boxOtpValidated: boolean;
    faceDetected: boolean;
    fallbackPhotoUri: string | null;
    savedAt: number;
}

function keyForDelivery(deliveryId: string): string {
    return `${KEY_PREFIX}${deliveryId}`;
}

export async function loadReturnPackageSnapshot(
    deliveryId: string
): Promise<ReturnPackageSnapshot | null> {
    try {
        const raw = await AsyncStorage.getItem(keyForDelivery(deliveryId));
        if (!raw) return null;
        return JSON.parse(raw) as ReturnPackageSnapshot;
    } catch (error) {
        console.warn('[ReturnPackageStorage] Failed to load snapshot:', error);
        return null;
    }
}

export async function saveReturnPackageSnapshot(
    deliveryId: string,
    snapshot: Omit<ReturnPackageSnapshot, 'savedAt'>
): Promise<void> {
    try {
        const payload: ReturnPackageSnapshot = {
            ...snapshot,
            savedAt: Date.now(),
        };
        await AsyncStorage.setItem(keyForDelivery(deliveryId), JSON.stringify(payload));
    } catch (error) {
        console.warn('[ReturnPackageStorage] Failed to save snapshot:', error);
    }
}

export async function clearReturnPackageSnapshot(deliveryId: string): Promise<void> {
    try {
        await AsyncStorage.removeItem(keyForDelivery(deliveryId));
    } catch (error) {
        console.warn('[ReturnPackageStorage] Failed to clear snapshot:', error);
    }
}
