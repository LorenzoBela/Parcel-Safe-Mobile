/**
 * EC-15: OEM Kill Protection
 * 
 * Detects aggressive battery-killing Android manufacturers (Xiaomi MIUI, 
 * Huawei EMUI, Samsung One UI, Oppo ColorOS, Vivo FunTouch) and shows
 * a one-time dialog with device-specific whitelisting instructions.
 * 
 * Reference: https://dontkillmyapp.com
 * Used by: Lalamove, Grab, Uber, and most delivery apps.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Expo Device - conditionally imported to prevent crashes if not available
let Device: any = null;
try {
    Device = require('expo-device');
} catch (_e) {
    // expo-device not available
}

const STORAGE_KEY = 'oem_kill_protection_done';

interface OemInfo {
    name: string;
    url: string;
    instructions: string;
}

/**
 * Device-specific battery optimization instructions.
 * Each entry maps a lowercase manufacturer substring to user-facing guidance.
 */
const OEM_KILL_INFO: Record<string, OemInfo> = {
    xiaomi: {
        name: 'Xiaomi',
        url: 'https://dontkillmyapp.com/xiaomi',
        instructions: 'Go to Settings > Battery > App Battery Saver > Parcel Safe > No restrictions',
    },
    huawei: {
        name: 'Huawei',
        url: 'https://dontkillmyapp.com/huawei',
        instructions: 'Go to Settings > Battery > App Launch > Parcel Safe > Manage manually > Enable all',
    },
    samsung: {
        name: 'Samsung',
        url: 'https://dontkillmyapp.com/samsung',
        instructions: 'Go to Settings > Battery > Background usage limits > Never sleeping apps > Add Parcel Safe',
    },
    oppo: {
        name: 'Oppo',
        url: 'https://dontkillmyapp.com/oppo',
        instructions: 'Go to Settings > Battery > Energy Saver > Parcel Safe > Allow background activity',
    },
    vivo: {
        name: 'Vivo',
        url: 'https://dontkillmyapp.com/vivo',
        instructions: 'Go to Settings > Battery > High background power > Allow Parcel Safe',
    },
    oneplus: {
        name: 'OnePlus',
        url: 'https://dontkillmyapp.com/oneplus',
        instructions: "Go to Settings > Battery > Battery Optimization > Parcel Safe > Don't optimize",
    },
    realme: {
        name: 'Realme',
        url: 'https://dontkillmyapp.com/realme',
        instructions: 'Go to Settings > Battery > App Quick Freeze > Parcel Safe > Disable',
    },
};

/**
 * Check if the current device needs OEM battery protection whitelisting.
 * Returns the manufacturer info and whether the user has already been prompted.
 */
export async function checkOemProtection(): Promise<{
    needsAction: boolean;
    manufacturer: string;
    info: OemInfo | null;
}> {
    // Only relevant on Android
    if (Platform.OS !== 'android') {
        return { needsAction: false, manufacturer: '', info: null };
    }

    // Check if user already handled this
    try {
        const alreadyHandled = await AsyncStorage.getItem(STORAGE_KEY);
        if (alreadyHandled === 'true') {
            return { needsAction: false, manufacturer: '', info: null };
        }
    } catch (_e) {
        // AsyncStorage failure is non-critical
    }

    // Get device manufacturer
    const manufacturer = (Device?.manufacturer || '').toLowerCase();
    if (!manufacturer) {
        return { needsAction: false, manufacturer: '', info: null };
    }

    // Match against known aggressive OEMs
    const matchedKey = Object.keys(OEM_KILL_INFO).find(k => manufacturer.includes(k));

    if (matchedKey) {
        return {
            needsAction: true,
            manufacturer,
            info: OEM_KILL_INFO[matchedKey],
        };
    }

    return { needsAction: false, manufacturer, info: null };
}

/**
 * Mark OEM protection as handled so the dialog isn't shown again.
 */
export async function markOemProtectionDone(): Promise<void> {
    try {
        await AsyncStorage.setItem(STORAGE_KEY, 'true');
    } catch (_e) {
        // Non-critical
    }
}

/**
 * Reset the OEM protection flag (for testing).
 */
export async function resetOemProtection(): Promise<void> {
    try {
        await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (_e) {
        // Non-critical
    }
}
