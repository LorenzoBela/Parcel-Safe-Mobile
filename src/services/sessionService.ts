/**
 * Session Service (EC-36)
 * 
 * Manages device sessions to prevent multiple riders from using
 * the same account simultaneously. Force logs out old devices
 * when a new device logs in.
 * 
 * Scenario: Rider shares credentials, two phones active.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, onValue, set, off, serverTimestamp } from 'firebase/database';
import { getFirebaseDatabase } from './firebaseClient';
import { getSecureItem, setSecureItem } from './security/secureStoreService';
import { collectDeviceRiskSnapshot } from './security/deviceRiskService';

// Storage keys
const STORAGE_KEYS = {
    SESSION_ID: 'ec36_session_id',
    DEVICE_ID: 'ec36_device_id',
};

const DEVICE_ID_SECURE_KEY = 'session_device_id';

// Configuration
export const EC36_CONFIG = {
    SESSION_CHECK_INTERVAL_MS: 30000, // 30 seconds
    SESSION_TIMEOUT_MS: 86400000, // 24 hours
};

export interface DeviceSession {
    sessionId: string;
    deviceId: string;
    platform: 'ios' | 'android';
    createdAt: number;
    lastActiveAt: number;
    appVersion?: string;
}

export interface SessionState {
    activeSessionId: string;
    activeDeviceId: string;
    lastUpdated: number;
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `sess-${timestamp}-${random}`;
}

/**
 * Generate or retrieve a persistent device ID
 */
export async function getDeviceId(): Promise<string> {
    try {
        let deviceId = await getSecureItem(DEVICE_ID_SECURE_KEY);

        if (!deviceId) {
            // Backward-compatible fallback for old installs.
            deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
        }

        if (!deviceId) {
            deviceId = `device-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
            await setSecureItem(DEVICE_ID_SECURE_KEY, deviceId);
            await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
        } else {
            // Migrate legacy value into secure storage and keep AsyncStorage for compatibility.
            await setSecureItem(DEVICE_ID_SECURE_KEY, deviceId);
        }
        return deviceId;
    } catch {
        return `device-fallback-${Date.now()}`;
    }
}

/**
 * Session Management Service
 */
class SessionService {
    private currentSessionId: string | null = null;
    private unsubscribe: (() => void) | null = null;
    private forceLogoutCallback: (() => void) | null = null;

    /**
     * Register a new device session (call on login)
     * This will force logout any other devices
     */
    async registerSession(
        riderId: string,
        platform: 'ios' | 'android',
        appVersion?: string
    ): Promise<{ sessionId: string; deviceId: string }> {
        const sessionId = generateSessionId();
        const deviceId = await getDeviceId();
        const deviceRisk = await collectDeviceRiskSnapshot();
        const database = getFirebaseDatabase();

        // Save session locally
        this.currentSessionId = sessionId;
        await AsyncStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);

        // Write to Firebase (this invalidates other sessions)
        const sessionRef = ref(database, `riders/${riderId}/session`);
        await set(sessionRef, {
            sessionId,
            deviceId,
            platform,
            appVersion,
            deviceRisk,
            createdAt: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
        });

        console.log('[EC36] Session registered:', sessionId);
        return { sessionId, deviceId };
    }

    /**
     * Subscribe to session status (call after login)
     * Will trigger forceLogout callback if another device logs in
     */
    subscribeToSession(riderId: string, onForceLogout: () => void): () => void {
        this.forceLogoutCallback = onForceLogout;
        const database = getFirebaseDatabase();
        const sessionRef = ref(database, `riders/${riderId}/session`);

        const callback = async (snapshot: { val: () => SessionState | null }) => {
            const remoteSession = snapshot.val();

            if (!remoteSession || !this.currentSessionId) return;

            // Check if our session is still the active one
            if (remoteSession.activeSessionId !== this.currentSessionId) {
                console.log('[EC36] Session invalidated by new login');
                if (this.forceLogoutCallback) {
                    this.forceLogoutCallback();
                }
            }
        };

        onValue(sessionRef, callback);
        this.unsubscribe = () => off(sessionRef, 'value', callback);

        return this.unsubscribe;
    }

    /**
     * Check if current session is valid
     */
    async isSessionValid(riderId: string): Promise<boolean> {
        if (!this.currentSessionId) return false;

        try {
            const database = getFirebaseDatabase();
            const sessionRef = ref(database, `riders/${riderId}/session`);

            return new Promise((resolve) => {
                onValue(sessionRef, (snapshot) => {
                    const remoteSession = snapshot.val();
                    resolve(remoteSession?.sessionId === this.currentSessionId);
                }, { onlyOnce: true });
            });
        } catch {
            return false;
        }
    }

    /**
     * Update session heartbeat (call periodically to show active)
     */
    async updateHeartbeat(riderId: string): Promise<void> {
        if (!this.currentSessionId) return;

        try {
            const database = getFirebaseDatabase();
            const heartbeatRef = ref(database, `riders/${riderId}/session/lastActiveAt`);
            await set(heartbeatRef, serverTimestamp());
        } catch (error) {
            console.error('[EC36] Failed to update heartbeat:', error);
        }
    }

    /**
     * Get current session ID
     */
    async getCurrentSessionId(): Promise<string | null> {
        if (this.currentSessionId) return this.currentSessionId;
        return AsyncStorage.getItem(STORAGE_KEYS.SESSION_ID);
    }

    /**
     * Clear session (on logout)
     */
    async clearSession(riderId: string): Promise<void> {
        // Unsubscribe from updates
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        // Clear local session
        this.currentSessionId = null;
        this.forceLogoutCallback = null;
        await AsyncStorage.removeItem(STORAGE_KEYS.SESSION_ID);

        // Clear Firebase session
        try {
            const database = getFirebaseDatabase();
            const sessionRef = ref(database, `riders/${riderId}/session`);
            await set(sessionRef, null);
        } catch (error) {
            console.error('[EC36] Failed to clear Firebase session:', error);
        }

        console.log('[EC36] Session cleared');
    }

    /**
     * Force end another session (admin action)
     */
    async forceEndSession(riderId: string): Promise<void> {
        const database = getFirebaseDatabase();
        const sessionRef = ref(database, `riders/${riderId}/session`);
        await set(sessionRef, null);
        console.log('[EC36] Session force ended for rider:', riderId);
    }
}

export const sessionService = new SessionService();
export default sessionService;
