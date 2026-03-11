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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MMKV } = require('react-native-mmkv');
import type { StateStorage } from 'zustand/middleware';

// Single MMKV instance — isolated to prevent key collisions with other storage
const mmkv = new MMKV({ id: 'parcel-safe-store' });

export const mmkvStorage: StateStorage = {
    getItem: (name: string): string | null => {
        return mmkv.getString(name) ?? null;
    },
    setItem: (name: string, value: string): void => {
        mmkv.set(name, value);
    },
    removeItem: (name: string): void => {
        mmkv.delete(name);
    },
};

export default mmkvStorage;
