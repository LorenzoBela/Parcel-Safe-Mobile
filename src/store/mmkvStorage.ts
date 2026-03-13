/**
 * MMKV Storage Adapter for Zustand Persist
 *
 * Wraps react-native-mmkv's synchronous API in the StateStorage interface
 * that Zustand's persist middleware expects. MMKV reads are synchronous
 * (backed by memory-mapped files), so the store is fully hydrated before
 * any React component mounts — eliminating loading screens on resume.
 *
 * Built by WeChat, used by Discord, Shopee, Grab.
 * ~30-100x faster than AsyncStorage for reads.
 */

// Single MMKV instance — isolated to prevent key collisions with other storage
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

let mmkv: any = null;
let isMMKVAvailable = false;

try {
    if (Platform.OS !== 'web') {
        const { MMKV } = require('react-native-mmkv');
        mmkv = new MMKV({ id: 'parcel-safe-store' });
        isMMKVAvailable = true;
    }
} catch (e) {
    console.warn('MMKV not available (likely Expo Go or Web), falling back to AsyncStorage', e);
}

export const mmkvStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        if (isMMKVAvailable && mmkv) {
            return mmkv.getString(name) ?? null;
        }
        return await AsyncStorage.getItem(name);
    },
    setItem: async (name: string, value: string): Promise<void> => {
        if (isMMKVAvailable && mmkv) {
            mmkv.set(name, value);
        } else {
            await AsyncStorage.setItem(name, value);
        }
    },
    removeItem: async (name: string): Promise<void> => {
        if (isMMKVAvailable && mmkv) {
            mmkv.delete(name);
        } else {
            await AsyncStorage.removeItem(name);
        }
    },
};

export default mmkvStorage;
