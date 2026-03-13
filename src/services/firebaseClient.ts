/**
 * Firebase Client for Parcel-Safe Mobile App
 * 
 * Provides real-time database access for GPS location updates
 * and box connectivity monitoring.
 */

import {
    FirebaseApp,
    initializeApp,
    getApps
} from 'firebase/app';
import {
    Database,
    getDatabase,
    ref,
    onValue,
    set,
    get,
    update,
    serverTimestamp,
    off,
    DatabaseReference
} from 'firebase/database';
import { consolidateLocation } from './locationUtils';
import type { LocationData, LocationsByBoxId } from '../types';
import { initializeAuth, getAuth, Auth } from '@firebase/auth';
// @ts-ignore - This export exists at runtime for React Native
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Firebase configuration - should match web project
const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase (prevent duplicate initialization)
let app: FirebaseApp;
let database: Database;
let auth: Auth;

export function initializeFirebase(): Database {
    console.log('[Firebase] initializeFirebase called. getApps().length:', getApps().length);
    if (getApps().length === 0) {
        console.log('[Firebase] Initializing app with config:', {
            projectId: firebaseConfig.projectId,
            appId: firebaseConfig.appId?.substring(0, 10) + '...',
        });
        app = initializeApp(firebaseConfig);
        // Initialize Auth with AsyncStorage persistence for React Native
        try {
            console.log('[Firebase] Initializing Auth with React Native persistence');
            auth = initializeAuth(app, {
                persistence: getReactNativePersistence(AsyncStorage)
            });
            console.log('[Firebase] Auth successfully initialized from scratch');
        } catch (e) {
            console.error('[Firebase] Error initializing auth from scratch:', e);
        }
    } else {
        console.log('[Firebase] App already exists, fetching existing app');
        app = getApps()[0];
        // Get existing auth instance if app already initialized
        try {
            console.log('[Firebase] Attempting to getAuth(app)');
            auth = getAuth(app);
            console.log('[Firebase] Successfully retrieved existing auth');
        } catch (e: any) {
            console.warn('[Firebase] getAuth(app) failed, attempting initializeAuth:', e?.message || e);
            // Auth not initialized yet, initialize with persistence
            try {
                auth = initializeAuth(app, {
                    persistence: getReactNativePersistence(AsyncStorage)
                });
                console.log('[Firebase] Successfully initialized Auth on existing app');
            } catch (e2) {
                console.error('[Firebase] Failed fallback initializeAuth:', e2);
            }
        }
    }
    database = getDatabase(app);
    return database;
}


export function getFirebaseDatabase(): Database {
    if (!database) {
        return initializeFirebase();
    }
    return database;
}

export function getFirebaseAuth(): Auth {
    console.log('[Firebase] getFirebaseAuth called. Current auth state:', !!auth);
    if (!auth) {
        console.log('[Firebase] auth is falsy, calling initializeFirebase()');
        initializeFirebase();
    }
    return auth;
}

// ==================== Types ====================
// LocationData and LocationsByBoxId live in src/types.ts to avoid a circular
// dependency with locationUtils.ts (which also imports them).
// Re-export so existing consumers (screens, hooks, tests) need no changes.
export type { LocationData, LocationsByBoxId };

export interface BoxState {
    status: 'SLEEP' | 'STANDBY' | 'ACTIVE' | 'ARRIVED' | 'UNLOCKING' | 'LOCKED';
    command?: 'UNLOCKING' | 'LOCKED' | 'NONE';
    delivery_id?: string;
    otp_code?: string;
    last_heartbeat?: number;
    item_count?: number; // EC-80
    connection?: string; // Telemetry
    rssi?: number;       // Telemetry
    temp?: number;       // Telemetry
    csq?: number;        // Telemetry
    geo_state?: 'OUTSIDE' | 'INSIDE' | 'DEAD_ZONE' | 'ENTERING' | 'EXITING';
    geo_dist_m?: number;
    theft_state?: 'NORMAL' | 'SUSPICIOUS' | 'STOLEN' | 'LOCKDOWN' | 'RECOVERED';
}

/** Fields the firmware writes to hardware/{boxId} via REST */
export interface HardwareDiagnostics {
    /** Connection type: 'LTE' | 'WiFi' */
    connection?: string;
    /** Signal strength in dBm (e.g. -85) */
    rssi?: number;
    /** Raw CSQ value 0-31 (99 = unknown) */
    csq?: number;
    /** Carrier / operator name */
    op?: string;
    /** Whether GPS currently has a fix */
    gps_fix?: boolean;
    /** millis() timestamp of last firmware heartbeat */
    last_updated?: number;
    /** Cumulative bytes sent to Firebase */
    data_bytes?: number;
    /** Box state string */
    status?: string;
    /** Tamper sub-object */
    tamper?: {
        detected?: boolean;
        lockdown?: boolean;
    };
    /** Geofence state reported by firmware (OUTSIDE/INSIDE/DEAD_ZONE) */
    geo_state?: string;
    /** Distance to geofence target in meters */
    geo_dist_m?: number;
    /** Theft guard state reported by firmware */
    theft_state?: string;
    /** Battery Percentage 0-100 */
    batt_pct?: number;
    /** Battery Voltage */
    batt_v?: number;
    /** Low battery flag */
    batt_low?: boolean;
}

export type HardwareByBoxId = Record<string, HardwareDiagnostics>;

// ==================== Location Functions ====================

// Global cache for latest locations per box to enable smooth consolidation
const latestLocationsCache: Record<string, { box: LocationData | null, phone: LocationData | null }> = {};

/**
 * Subscribe to live location updates for a specific box
 * Uses consolidateLocation internally to smooth out overlapping phone and box coordinates.
 */
export function subscribeToLocation(
    boxId: string,
    callback: (location: LocationData | null) => void
): () => void {
    if (!latestLocationsCache[boxId]) {
        latestLocationsCache[boxId] = { box: null, phone: null };
    }

    const db = getFirebaseDatabase();
    const locationRef = ref(db, `locations/${boxId}`);

    const unsubscribe = onValue(locationRef, (snapshot) => {
        const rawData = snapshot.val();
        if (!rawData) {
            callback(null);
            return;
        }

        if (rawData.box != null || rawData.phone != null) {
            // New split-path structure: { box: { latitude, ... }, phone: { latitude, ... } }
            // Both sub-trees arrive in one snapshot — no overwriting possible.
            if (rawData.box) {
                latestLocationsCache[boxId].box = {
                    ...rawData.box,
                    latitude: Number(rawData.box.latitude ?? rawData.box.lat),
                    longitude: Number(rawData.box.longitude ?? rawData.box.lng),
                    source: rawData.box.source || 'box',
                } as LocationData;
            }
            if (rawData.phone) {
                latestLocationsCache[boxId].phone = {
                    ...rawData.phone,
                    latitude: Number(rawData.phone.latitude ?? rawData.phone.lat),
                    longitude: Number(rawData.phone.longitude ?? rawData.phone.lng),
                    source: rawData.phone.source || 'phone_background',
                } as LocationData;
            }
        } else if (rawData.latitude != null) {
            // Legacy flat structure from old firmware — route by source field
            const data: LocationData = {
                ...rawData,
                latitude: Number(rawData.latitude ?? rawData.lat),
                longitude: Number(rawData.longitude ?? rawData.lng),
                source: rawData.source || 'box',
            };
            if (data.source === 'box') {
                latestLocationsCache[boxId].box = data;
            } else {
                latestLocationsCache[boxId].phone = data;
            }
        }

        const consolidated = consolidateLocation(
            latestLocationsCache[boxId].box,
            latestLocationsCache[boxId].phone
        );

        callback(consolidated ?? latestLocationsCache[boxId].box ?? latestLocationsCache[boxId].phone);
    });

    return () => off(locationRef);
}

/**
 * Subscribe to live location updates for all boxes.
 *
 * RTDB shape (new): locations/{boxId}/box  and  locations/{boxId}/phone
 * RTDB shape (legacy): locations/{boxId} => flat LocationData
 *
 * Returns a normalized Record<boxId, LocationData> in both cases so callers
 * can read .latitude / .longitude without caring about the internal structure.
 */
export function subscribeToAllLocations(
    callback: (locations: LocationsByBoxId | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const locationsRef = ref(db, 'locations');

    onValue(locationsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            callback(null);
            return;
        }

        const normalized: LocationsByBoxId = {};
        for (const [boxId, entry] of Object.entries<any>(data)) {
            if (entry.box != null || entry.phone != null) {
                // New split-path structure — consolidate to get best position
                const boxLoc = entry.box ? {
                    ...entry.box,
                    latitude: Number(entry.box.latitude ?? entry.box.lat),
                    longitude: Number(entry.box.longitude ?? entry.box.lng),
                    source: entry.box.source || 'box',
                } as LocationData : null;
                const phoneLoc = entry.phone ? {
                    ...entry.phone,
                    latitude: Number(entry.phone.latitude ?? entry.phone.lat),
                    longitude: Number(entry.phone.longitude ?? entry.phone.lng),
                    source: entry.phone.source || 'phone_background',
                } as LocationData : null;
                const best = consolidateLocation(boxLoc, phoneLoc) ?? boxLoc ?? phoneLoc;
                if (best) normalized[boxId] = best;
            } else if (entry.latitude != null) {
                // Legacy flat structure
                normalized[boxId] = {
                    ...entry,
                    latitude: Number(entry.latitude ?? entry.lat),
                    longitude: Number(entry.longitude ?? entry.lng),
                    source: entry.source || 'box',
                } as LocationData;
            }
        }

        callback(Object.keys(normalized).length > 0 ? normalized : null);
    });

    return () => off(locationsRef);
}

/**
 * Write phone GPS location to Firebase (fallback mode)
 */
export async function writePhoneLocation(
    boxId: string,
    latitude: number,
    longitude: number,
    speed?: number,
    heading?: number
): Promise<void> {
    const db = getFirebaseDatabase();
    const locationRef = ref(db, `locations/${boxId}/phone`);

    const locationData: LocationData = {
        latitude,
        longitude,
        timestamp: Date.now(),
        speed: speed ?? 0,
        heading: heading ?? 0,
        source: 'phone',
    };

    await set(locationRef, {
        ...locationData,
        server_timestamp: serverTimestamp(),
    });
}

/**
 * Fetch the box's last known location from Firebase (one-time read).
 *
 * Normalizes split-path (`{ box, phone }`) and legacy flat structures.
 * Prefers the `box` sub-node when available; falls back to `phone` or flat data.
 * Returns `null` if the box has never reported any location.
 */
export async function fetchBoxLocationOnce(boxId: string): Promise<LocationData | null> {
    const db = getFirebaseDatabase();
    const locationRef = ref(db, `locations/${boxId}`);

    const snapshot = await get(locationRef);
    const rawData = snapshot.val();
    if (!rawData) return null;

    // New split-path structure: { box: { latitude, ... }, phone: { latitude, ... } }
    if (rawData.box != null || rawData.phone != null) {
        const sub = rawData.box ?? rawData.phone;
        if (!sub) return null;
        return {
            ...sub,
            latitude: Number(sub.latitude ?? sub.lat),
            longitude: Number(sub.longitude ?? sub.lng),
            source: sub.source || (rawData.box ? 'box' : 'phone'),
        } as LocationData;
    }

    // Legacy flat structure
    if (rawData.latitude != null) {
        return {
            ...rawData,
            latitude: Number(rawData.latitude ?? rawData.lat),
            longitude: Number(rawData.longitude ?? rawData.lng),
            source: rawData.source || 'box',
        } as LocationData;
    }

    return null;
}

/**
 * Subscribe to box state updates
 */
export function subscribeToBoxState(
    boxId: string,
    callback: (state: BoxState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const stateRef = ref(db, `hardware/${boxId}`);

    const unsubscribe = onValue(stateRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as BoxState | null);
    });

    return () => off(stateRef);
}

/**
 * Subscribe to the entire hardware tree (admin/fleet views).
 */
export function subscribeToAllHardware(
    callback: (hardware: HardwareByBoxId | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const hardwareRef = ref(db, 'hardware');

    onValue(hardwareRef, (snapshot) => {
        const data = snapshot.val();
        callback((data ?? null) as HardwareByBoxId | null);
    });

    return () => off(hardwareRef);
}

/**
 * Update box power state
 */
export async function updateBoxState(
    boxId: string,
    state: Partial<BoxState>
): Promise<void> {
    const db = getFirebaseDatabase();
    const stateRef = ref(db, `hardware/${boxId}`);

    // Use update() instead of set() so firmware-written fields (gps_fix, rssi,
    // csq, op, last_updated, etc.) are preserved when the app patches status.
    await update(stateRef, {
        ...state,
        last_heartbeat: serverTimestamp(),
    });
}

// ==================== EC-03: Battery Monitoring ====================

export interface BatteryState {
    percentage: number;
    voltage: number;
    charging: boolean;
    lowBatteryWarning: boolean;      // < 20%
    criticalBatteryWarning: boolean; // < 10%
    timestamp: number;
}

/**
 * Subscribe to box battery state updates.
 * Firmware writes flat fields (batt_v, batt_pct, batt_low) into hardware/{boxId}.
 * We derive the BatteryState from those fields here.
 */
export function subscribeToBattery(
    boxId: string,
    callback: (state: BatteryState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const hwRef = ref(db, `hardware/${boxId}`);

    const unsubscribe = onValue(hwRef, (snapshot) => {
        const data = snapshot.val();
        if (!data || data.batt_pct == null) {
            callback(null);
            return;
        }
        const pct: number = data.batt_pct;
        const state: BatteryState = {
            percentage: pct,
            voltage: data.batt_v ?? 0,
            charging: false,
            lowBatteryWarning: pct < 20,
            criticalBatteryWarning: pct < 10,
            timestamp: data.last_updated ?? Date.now(),
        };
        callback(state);
    });

    return () => off(hwRef);
}

// ==================== EC-18: Tamper Detection ====================

export interface TamperState {
    detected: boolean;
    timestamp: number;
    photoUrl?: string;
    lockdown: boolean;
    resetBy?: string;  // Admin who reset the lockdown
}

/**
 * Subscribe to box tamper state updates
 */
export function subscribeToTamper(
    boxId: string,
    callback: (state: TamperState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const tamperRef = ref(db, `hardware/${boxId}/tamper`);

    const unsubscribe = onValue(tamperRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as TamperState | null);
    });

    return () => off(tamperRef);
}

// ==================== EC-04: OTP Lockout State ====================

export interface LockoutState {
    active: boolean;
    started_at: number;
    expires_at: number;
    attempt_count: number;
    delivery_id: string;
}

/**
 * Subscribe to box OTP lockout state (EC-04)
 */
export function subscribeToLockout(
    boxId: string,
    callback: (state: LockoutState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const lockoutRef = ref(db, `hardware/${boxId}/lockout`);

    const unsubscribe = onValue(lockoutRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as LockoutState | null);
    });

    return () => off(lockoutRef);
}

/**
 * Reset OTP lockout (admin action) - EC-04
 */
export async function resetLockout(boxId: string): Promise<void> {
    const db = getFirebaseDatabase();
    const resetRef = ref(db, `hardware/${boxId}/reset_lockout`);
    await set(resetRef, true);
}

// ==================== EC-07: OTP Expiry State ====================

export interface OtpStatus {
    otp_expired: boolean;
    expired_at?: number;
    delivery_id: string;
}

export interface OtpAssignment {
    otp_code: string;
    otp_issued_at: number;  // EC-07: Timestamp for expiry tracking
    delivery_id: string;
    target_lat: number;
    target_lng: number;
    pickup_lat?: number;
    pickup_lng?: number;
}

/**
 * Subscribe to OTP status (expiry notifications) - EC-07
 */
export function subscribeToOtpStatus(
    boxId: string,
    callback: (status: OtpStatus | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const statusRef = ref(db, `hardware/${boxId}/otp_status`);

    const unsubscribe = onValue(statusRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as OtpStatus | null);
    });

    return () => off(statusRef);
}

/**
 * Assign OTP to box with timestamp for expiry tracking - EC-07
 */
export async function assignOtpToBox(
    boxId: string,
    assignment: OtpAssignment
): Promise<void> {
    const db = getFirebaseDatabase();
    const hardwareRef = ref(db, `hardware/${boxId}`);

    await update(hardwareRef, {
        ...assignment,
        otp_issued_at: serverTimestamp(), // EC-07: Server timestamp for accuracy
        last_heartbeat: serverTimestamp(),
    });
}

/**
 * Revoke OTP (delivery cancelled/reassigned) - EC-07
 */
export async function revokeOtp(boxId: string): Promise<void> {
    const db = getFirebaseDatabase();
    const revokeRef = ref(db, `hardware/${boxId}/otp_revoked`);
    await set(revokeRef, true);
}

/**
 * Regenerate OTP (when compromised) - EC-07
 */
export async function regenerateOtp(
    boxId: string,
    newOtpCode: string,
    deliveryId: string
): Promise<void> {
    const db = getFirebaseDatabase();
    const hardwareRef = ref(db, `hardware/${boxId}`);

    await update(hardwareRef, {
        otp_code: newOtpCode,
        otp_issued_at: serverTimestamp(),
        delivery_id: deliveryId,
        last_heartbeat: serverTimestamp(),
    });
}

// ==================== EC-20: OTP Collision Prevention ====================

/**
 * EC-20: OTP Collision Prevention Constants
 */
export const OTP_COLLISION_CONFIG = {
    OTP_LENGTH: 6,
    MIN_OTP_REUSE_INTERVAL_MS: 300000, // 5 minutes
};

export interface OtpSource {
    deliveryId: string;
    boxId: string;
    issuedAt: number;
    otpCode: string;
    hash: string;
}

/**
 * EC-20: Generate a secure 6-digit OTP
 */
export function generateSecureOtp(): string {
    // Generate random 6-digit OTP
    const otp = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return otp;
}

/**
 * EC-20: Generate OTP uniqueness hash
 */
export function generateOtpHash(deliveryId: string, boxId: string, timestamp: number): string {
    const input = `${deliveryId}:${boxId}:${timestamp}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * EC-20: Check for OTP collision before assignment
 */
export async function checkOtpCollision(
    boxId: string,
    proposedOtp: string
): Promise<{ hasCollision: boolean; existingDeliveryId?: string }> {
    try {
        const db = getFirebaseDatabase();
        const hardwareRef = ref(db, `hardware/${boxId}`);
        return new Promise((resolve) => {
            onValue(hardwareRef, (snapshot) => {
                const data = snapshot.val();
                if (data && data.otp_code === proposedOtp && data.delivery_id) {
                    resolve({ hasCollision: true, existingDeliveryId: data.delivery_id });
                } else {
                    resolve({ hasCollision: false });
                }
            }, { onlyOnce: true });
        });
    } catch (error) {
        console.error('[EC-20] Collision check failed:', error);
        return { hasCollision: false };
    }
}

/**
 * EC-20: Assign OTP with collision prevention
 */
export async function assignOtpWithCollisionCheck(
    boxId: string,
    deliveryId: string,
    targetLat: number,
    targetLng: number
): Promise<{ success: boolean; otpCode: string; attempts: number; error?: string }> {
    const db = getFirebaseDatabase();
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const otpCode = generateSecureOtp();
        const collision = await checkOtpCollision(boxId, otpCode);

        if (!collision.hasCollision) {
            const hardwareRef = ref(db, `hardware/${boxId}`);
            const timestamp = Date.now();

            await update(hardwareRef, {
                delivery_id: deliveryId,
                otp_code: otpCode,
                otp_issued_at: serverTimestamp(),
                otp_hash: generateOtpHash(deliveryId, boxId, timestamp),
                target_lat: targetLat,
                target_lng: targetLng,
                last_heartbeat: serverTimestamp(),
            });

            return { success: true, otpCode, attempts: attempt };
        }
    }

    return {
        success: false,
        otpCode: '',
        attempts: MAX_ATTEMPTS,
        error: 'Failed to generate unique OTP after 3 attempts'
    };
}

// ==================== EC-29: OTP Regeneration (Immediate) ====================

export const OTP_REGENERATION_CONFIG = {
    COOLDOWN_MS: 600000, // 10 minutes
    MAX_REGENERATIONS_PER_DELIVERY: 5,
};

export interface OtpRegenerationRequest {
    deliveryId: string;
    reason: string;
    requestedAt: number;
    status: 'PENDING' | 'COMPLETED' | 'RATE_LIMITED' | 'MAX_REACHED';
    newOtp?: string;
    completedAt?: number;
    regenerationCount: number;
    nextAllowedAt?: number;
}

export interface OtpRegenerationState {
    deliveryId: string;
    regenerationCount: number;
    lastRegeneratedAt: number;
    history: Array<{
        oldOtp: string;
        newOtp: string;
        reason: string;
        timestamp: number;
    }>;
}

/**
 * EC-29: Check if regeneration cooldown is active
 */
export function isRegenerationCooldownActive(lastRegeneratedAt: number): boolean {
    return (Date.now() - lastRegeneratedAt) < OTP_REGENERATION_CONFIG.COOLDOWN_MS;
}

/**
 * EC-29: Get remaining cooldown time in seconds
 */
export function getRegenerationCooldownRemaining(lastRegeneratedAt: number): number {
    const elapsed = Date.now() - lastRegeneratedAt;
    if (elapsed >= OTP_REGENERATION_CONFIG.COOLDOWN_MS) return 0;
    return Math.ceil((OTP_REGENERATION_CONFIG.COOLDOWN_MS - elapsed) / 1000);
}

/**
 * EC-29: Request immediate OTP regeneration (rider action)
 */
export async function requestOtpRegeneration(
    deliveryId: string,
    boxId: string,
    reason: string
): Promise<{ success: boolean; newOtp?: string; error?: string; cooldownSeconds?: number }> {
    try {
        const db = getFirebaseDatabase();
        const stateRef = ref(db, `deliveries/${deliveryId}/otp_regeneration`);

        const currentState = await new Promise<OtpRegenerationState | null>((resolve) => {
            onValue(stateRef, (snapshot) => {
                resolve(snapshot.val() as OtpRegenerationState | null);
            }, { onlyOnce: true });
        });

        // Check rate limiting
        if (currentState && isRegenerationCooldownActive(currentState.lastRegeneratedAt)) {
            const remaining = getRegenerationCooldownRemaining(currentState.lastRegeneratedAt);
            return {
                success: false,
                error: `Please wait ${Math.ceil(remaining / 60)} minutes`,
                cooldownSeconds: remaining
            };
        }

        // Check max regenerations
        const regenCount = currentState?.regenerationCount ?? 0;
        if (regenCount >= OTP_REGENERATION_CONFIG.MAX_REGENERATIONS_PER_DELIVERY) {
            return { success: false, error: 'Maximum OTP regenerations reached' };
        }

        // Get current OTP
        const hardwareRef = ref(db, `hardware/${boxId}`);
        const currentHardware = await new Promise<any>((resolve) => {
            onValue(hardwareRef, (snapshot) => resolve(snapshot.val()), { onlyOnce: true });
        });

        const oldOtp = currentHardware?.otp_code || '';

        // Generate new OTP with collision check
        const result = await assignOtpWithCollisionCheck(
            boxId,
            deliveryId,
            currentHardware?.target_lat || 0,
            currentHardware?.target_lng || 0
        );

        if (!result.success) {
            return { success: false, error: result.error };
        }

        // Update regeneration state
        const now = Date.now();
        const newHistory = currentState?.history || [];
        newHistory.push({ oldOtp, newOtp: result.otpCode, reason, timestamp: now });

        await set(stateRef, {
            deliveryId,
            regenerationCount: regenCount + 1,
            lastRegeneratedAt: now,
            history: newHistory
        });

        return { success: true, newOtp: result.otpCode };

    } catch (error) {
        console.error('[EC-29] Failed to regenerate OTP:', error);
        return { success: false, error: 'Failed to regenerate OTP' };
    }
}

/**
 * EC-29: Subscribe to OTP regeneration requests (for rider)
 */
export function subscribeToOtpRegenerationRequests(
    deliveryId: string,
    callback: (request: OtpRegenerationRequest | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const requestRef = ref(db, `deliveries/${deliveryId}/otp_regeneration_request`);

    const unsubscribe = onValue(requestRef, (snapshot) => {
        callback(snapshot.val() as OtpRegenerationRequest | null);
    });

    return () => off(requestRef);
}


// ==================== EC-21/EC-22: Solenoid State ====================
export type SolenoidStatusType = 'OK' | 'STUCK_CLOSED' | 'STUCK_OPEN' | 'UNKNOWN';

export interface SolenoidState {
    status: SolenoidStatusType;
    retry_count: number;
    out_of_service: boolean;
    timestamp: number;
    delivery_id: string;
    failure_type?: string;
    message?: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * Subscribe to solenoid state updates (EC-21/EC-22)
 */
export function subscribeToSolenoid(
    boxId: string,
    callback: (state: SolenoidState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const solenoidRef = ref(db, `hardware/${boxId}/solenoid`);

    const unsubscribe = onValue(solenoidRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as SolenoidState | null);
    });

    return () => off(solenoidRef);
}

// ==================== EC-23: Camera State ====================
export type CameraStatusType = 'OK' | 'RETRY_SUCCESS' | 'FAILED' | 'NOT_INITIALIZED' | 'HARDWARE_ERROR';

export interface CameraState {
    status: CameraStatusType;
    has_hardware_error: boolean;
    last_capture_attempts: number;
    failure_reason: string;
    timestamp: number;
    delivery_id: string;
    last_upload_delivery_id?: string;
    last_upload_object_path?: string;
    last_upload_public_url?: string;
    last_upload_timestamp?: number;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH';
    message?: string;
}

/**
 * Subscribe to camera state updates (EC-23)
 */
export function subscribeToCamera(
    boxId: string,
    callback: (state: CameraState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const cameraRef = ref(db, `hardware/${boxId}/camera`);

    const unsubscribe = onValue(cameraRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as CameraState | null);
    });

    return () => off(cameraRef);
}

export interface PhotoAuditState {
    delivery_id?: string;
    box_id?: string;
    latest_photo_url?: string;
    latest_photo_object_path?: string;
    latest_photo_uploaded_at?: number;
}

export interface DeliveryProofState {
    proof_photo_url?: string;
    proof_photo_object_path?: string;
    proof_photo_uploaded_at?: number;
    pickup_photo_url?: string;
    pickup_photo_storage_path?: string;
    pickup_photo_uploaded_at?: number;
}

/**
 * Subscribe to photo audit log written by firmware at audit_logs/{deliveryId}
 */
export function subscribeToPhotoAuditLog(
    deliveryId: string,
    callback: (state: PhotoAuditState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const auditRef = ref(db, `audit_logs/${deliveryId}`);

    const unsubscribe = onValue(auditRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as PhotoAuditState | null);
    });

    return () => off(auditRef);
}

/**
 * Subscribe to delivery proof photo fields at deliveries/{deliveryId}
 */
export function subscribeToDeliveryProof(
    deliveryId: string,
    callback: (state: DeliveryProofState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const deliveryRef = ref(db, `deliveries/${deliveryId}`);

    const unsubscribe = onValue(deliveryRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as DeliveryProofState | null);
    });

    return () => off(deliveryRef);
}

// ==================== Lock Events (OTP + Face Detection from Hardware) ====================

export interface LockEvent {
    otp_valid: boolean;
    face_detected: boolean;
    unlocked: boolean;
    timestamp: number;
    device_epoch?: number;
    timestamp_str?: string;
}

/**
 * Subscribe to lock events written by firmware via GPS/LTE proxy.
 * Path: lock_events/{boxId}/latest
 *
 * Fires when the customer enters OTP on the physical keypad and
 * the system validates OTP + face detection.
 */
export function subscribeToLockEvents(
    boxId: string,
    callback: (event: LockEvent | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const lockRef = ref(db, `lock_events/${boxId}/latest`);

    const unsubscribe = onValue(lockRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as LockEvent | null);
    });

    return () => off(lockRef);
}

export type LowLightTier = 'NORMAL' | 'ENHANCED' | 'FLASH' | 'FALLBACK';

export interface LowLightState {
    /** Low-light condition detected by camera */
    isLowLight: boolean;
    /** Current brightness level (0-255) */
    brightness: number;
    /** Current capture tier being used */
    tier: LowLightTier;
    /** Whether fallback verification is required (face NOT found after all tiers) */
    fallbackRequired: boolean;
    /** Whether flash was used for capture */
    flashUsed: boolean;
    /** Whether night mode is enabled on OV3660 */
    nightModeEnabled: boolean;
    /** Timestamp of last brightness check */
    timestamp: number;
    /** Associated delivery for this capture attempt */
    deliveryId: string;
    /** Reason fallback is required (displayed to user) */
    fallbackReason?: string;
}

/**
 * Subscribe to low-light camera state updates (EC-97)
 * 
 * Used to trigger fallback verification UI when face detection fails
 * due to poor lighting conditions.
 * 
 * @param boxId - The box MAC address
 * @param callback - Called with updated low-light state
 * @returns Unsubscribe function
 */
export function subscribeToLowLight(
    boxId: string,
    callback: (state: LowLightState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const lowLightRef = ref(db, `hardware/${boxId}/low_light`);

    const unsubscribe = onValue(lowLightRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as LowLightState | null);
    });

    return () => off(lowLightRef);
}

/**
 * Check if fallback verification is required (EC-97)
 * 
 * @param state - The current low-light state
 * @returns true if user should use alternative verification
 */
export function isLowLightFallbackRequired(state: LowLightState | null): boolean {
    return state?.fallbackRequired === true && state?.tier === 'FALLBACK';
}

/**
 * Get user-friendly low-light status message (EC-97)
 * 
 * @param state - The current low-light state
 * @returns Localized message for UI display
 */
export function getLowLightMessage(state: LowLightState | null): string {
    if (!state) return '';

    if (state.fallbackRequired) {
        return state.fallbackReason || 'Camera cannot detect face in low light. Please use alternative verification.';
    }

    switch (state.tier) {
        case 'ENHANCED':
            return 'Low light detected. Using enhanced capture mode.';
        case 'FLASH':
            return 'Very low light. Flash enabled for capture.';
        default:
            return '';
    }
}

// ==================== EC-25: Reboot State ====================
export interface RebootState {
    rebooted: boolean;
    boot_count: number;
    had_active_delivery: boolean;
    delivery_id: string;
    timestamp: number;
    restored_state?: {
        delivery_id: string;
        is_arrived: boolean;
        is_unlocked: boolean;
        power_state: number;
    };
}

/**
 * Subscribe to reboot state updates (EC-25)
 */
export function subscribeToReboot(
    boxId: string,
    callback: (state: RebootState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const rebootRef = ref(db, `hardware/${boxId}/reboot`);

    const unsubscribe = onValue(rebootRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as RebootState | null);
    });

    return () => off(rebootRef);
}

/**
 * Clear reboot flag after acknowledgment
 */
export async function clearRebootFlag(boxId: string): Promise<void> {
    const db = getFirebaseDatabase();
    const rebootRef = ref(db, `hardware/${boxId}/reboot/rebooted`);
    await set(rebootRef, false);
}

// ==================== EC-84: GPS Health Monitoring ====================

export interface GpsHealthState {
    box_hdop: number;
    satellites_visible: number;
    obstruction_detected: boolean;
    timestamp: number;
}

/**
 * Subscribe to GPS health updates (EC-84)
 */
export function subscribeToGpsHealth(
    boxId: string,
    callback: (state: GpsHealthState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const healthRef = ref(db, `boxes/${boxId}/gps_health`);

    const unsubscribe = onValue(healthRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as GpsHealthState | null);
    });

    return () => off(healthRef);
}

// ==================== EC-47: Duplicate Delivery Prevention ====================

export type DuplicateCheckResult = 'NEW' | 'SAME' | 'UPDATE' | 'REJECTED';

export interface IdempotencyKey {
    delivery_id: string;
    otp_code: string;
    issued_at: number;
    request_hash: string;  // Combined hash of the request
    created_at: number;
}

export interface DuplicateDeliveryEvent {
    attempted_delivery_id: string;
    active_delivery_id: string;
    result: DuplicateCheckResult;
    timestamp: number;
    update_count: number;
}

/**
 * Generate idempotency key for a delivery assignment
 * EC-47: Used to detect and handle duplicate requests
 */
export function generateIdempotencyKey(
    deliveryId: string,
    otpCode: string,
    issuedAt: number
): string {
    return `${deliveryId}:${otpCode}:${issuedAt}`;
}

/**
 * Assign delivery with idempotency check - EC-47
 * Prevents duplicate delivery records from retries
 */
export async function assignDeliveryWithIdempotency(
    boxId: string,
    deliveryId: string,
    otpCode: string,
    targetLat: number,
    targetLng: number
): Promise<{ success: boolean; result: DuplicateCheckResult }> {
    const db = getFirebaseDatabase();
    const hardwareRef = ref(db, `hardware/${boxId}`);

    // Generate idempotency key
    const issuedAt = Date.now();
    const idempotencyKey = generateIdempotencyKey(deliveryId, otpCode, issuedAt);

    // Update with idempotency data (use update() to preserve firmware fields)
    await update(hardwareRef, {
        delivery_id: deliveryId,
        otp_code: otpCode,
        otp_issued_at: serverTimestamp(),
        target_lat: targetLat,
        target_lng: targetLng,
        idempotency_key: idempotencyKey,
        last_heartbeat: serverTimestamp(),
    });

    return { success: true, result: 'NEW' };
}

/**
 * Subscribe to duplicate delivery events - EC-47
 */
export function subscribeToDuplicateEvents(
    boxId: string,
    callback: (event: DuplicateDeliveryEvent | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const eventRef = ref(db, `hardware/${boxId}/duplicate_event`);

    const unsubscribe = onValue(eventRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as DuplicateDeliveryEvent | null);
    });

    return () => off(eventRef);
}

// ==================== EC-48: Data Integrity Monitoring ====================

export type IntegrityStatus = 'OK' | 'CORRUPTED' | 'RECOVERED_RTC' | 'RECOVERED_FIREBASE' | 'LOST';
export type QueueIntegrityStatus = 'OK' | 'ISSUE' | 'RECOVERED' | 'LOST';

export interface DataIntegrityState {
    delivery_state: {
        status: IntegrityStatus;
        corruption_count: number;
        needs_firebase_recovery: boolean;
    };
    photo_queue: {
        status: QueueIntegrityStatus;
        corruption_detected: boolean;
        recovery_count: number;
    };
    timestamp: number;
    boot_count: number;
}

export interface CorruptionEvent {
    filename: string;
    check_result: 'VALID' | 'CHECKSUM_FAIL' | 'PARSE_FAIL' | 'FILE_MISSING' | 'READ_ERROR';
    recovery_status: 'NOT_NEEDED' | 'FROM_RTC' | 'FROM_FIREBASE' | 'FAILED' | 'PARTIAL';
    timestamp: number;
    expected_checksum?: string;
    actual_checksum?: string;
}

/**
 * Subscribe to data integrity state updates - EC-48
 */
export function subscribeToDataIntegrity(
    boxId: string,
    callback: (state: DataIntegrityState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const integrityRef = ref(db, `hardware/${boxId}/data_integrity`);

    const unsubscribe = onValue(integrityRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as DataIntegrityState | null);
    });

    return () => off(integrityRef);
}

// ==================== EC-82: Keypad Stuck Detection ====================

export interface KeypadState {
    stuck_key?: string;
    is_stuck: boolean;
    timestamp: number;
}

/**
 * Subscribe to keypad health updates (EC-82)
 */
export function subscribeToKeypad(
    boxId: string,
    callback: (state: KeypadState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const keypadRef = ref(db, `hardware/${boxId}/keypad`);

    const unsubscribe = onValue(keypadRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as KeypadState | null);
    });

    return () => off(keypadRef);
}

// ==================== EC-83: Hinge Damage Detection ====================

export interface HingeState {
    status: 'OK' | 'DAMAGED' | 'FLAPPING';
    event_count: number;
    timestamp: number;
}

/**
 * Subscribe to hinge health updates (EC-83)
 */
export function subscribeToHinge(
    boxId: string,
    callback: (state: HingeState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const hingeRef = ref(db, `hardware/${boxId}/hinge`);

    const unsubscribe = onValue(hingeRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as HingeState | null);
    });

    return () => off(hingeRef);
}

// ==================== EC-86: Display Failure Detection ====================

export interface DisplayState {
    status: 'OK' | 'DEGRADED' | 'FAILED';
    last_i2c_ack: number;
    brightness: number;
    contrast: number;
    error_count: number;
    last_error: string;
    needs_service: boolean;
    timestamp: number;
}

/**
 * Subscribe to display health updates (EC-86)
 */
export function subscribeToDisplay(
    boxId: string,
    callback: (state: DisplayState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const displayRef = ref(db, `hardware/${boxId}/display_health`);

    const unsubscribe = onValue(displayRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as DisplayState | null);
    });

    return () => off(displayRef);
}

/**
 * Check if box needs Firebase recovery - EC-48
 */
export async function checkRecoveryNeeded(boxId: string): Promise<boolean> {
    const db = getFirebaseDatabase();
    const recoveryRef = ref(db, `hardware/${boxId}/data_integrity/delivery_state/needs_firebase_recovery`);

    return new Promise((resolve) => {
        onValue(recoveryRef, (snapshot) => {
            const data = snapshot.val();
            resolve(data === true);
        }, { onlyOnce: true });
    });
}

/**
 * Send recovery data to box - EC-48
 * Used when box reports corruption and needs data re-fetch
 */
export async function sendRecoveryData(
    boxId: string,
    deliveryId: string,
    otpCode: string,
    targetLat: number,
    targetLng: number
): Promise<void> {
    const db = getFirebaseDatabase();
    const recoveryRef = ref(db, `hardware/${boxId}/recovery_data`);

    await set(recoveryRef, {
        delivery_id: deliveryId,
        otp_code: otpCode,
        otp_issued_at: serverTimestamp(),
        target_lat: targetLat,
        target_lng: targetLng,
        sent_at: serverTimestamp(),
    });
}

/**
 * Acknowledge corruption event (admin action) - EC-48
 */
export async function acknowledgeCorruption(boxId: string): Promise<void> {
    const db = getFirebaseDatabase();
    const ackRef = ref(db, `hardware/${boxId}/data_integrity/acknowledged`);
    await set(ackRef, {
        acknowledged: true,
        timestamp: serverTimestamp(),
    });
}

// ==================== EC-55: Firebase Quota Types ====================

export type QuotaAlertLevel = 'OK' | 'WARNING' | 'CRITICAL' | 'EXCEEDED';

export interface QuotaState {
    reads: {
        count: number;
        limit: number;
        percentage: number;
    };
    writes: {
        count: number;
        limit: number;
        percentage: number;
    };
    storage: {
        used_bytes: number;
        limit_bytes: number;
        percentage: number;
    };
    bandwidth: {
        used_bytes: number;
        limit_bytes: number;
        percentage: number;
    };
    alert_level: QuotaAlertLevel;
    last_updated: number;
    last_reset: number;
}

/**
 * Subscribe to quota state updates (EC-55) - For app monitoring
 */
export function subscribeToQuotaState(
    callback: (state: QuotaState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const quotaRef = ref(db, 'admin/quota_state');

    const unsubscribe = onValue(quotaRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as QuotaState | null);
    });

    return () => off(quotaRef);
}

// ==================== EC-56: Photo Upload Types ====================

export type PhotoUploadStatus = 'PENDING' | 'COMPRESSING' | 'UPLOADING' | 'COMPLETED' | 'FAILED';

export interface PhotoUploadState {
    delivery_id: string;
    status: PhotoUploadStatus;
    progress_percent: number;
    original_size_bytes: number;
    compressed_size_bytes: number;
    compression_ratio: number;
    upload_started_at?: number;
    upload_completed_at?: number;
    error_message?: string;
    retry_count: number;
}

/**
 * Subscribe to photo upload state (EC-56)
 */
export function subscribeToPhotoUploadState(
    boxId: string,
    callback: (state: PhotoUploadState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const uploadRef = ref(db, `hardware/${boxId}/photo_upload`);

    const unsubscribe = onValue(uploadRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as PhotoUploadState | null);
    });

    return () => off(uploadRef);
}

// ==================== EC-49: Out-of-Order Event Handling ====================

/**
 * EC-49: Delivery status type for state machine transitions
 * Same as web implementation for consistency
 */
export type DeliveryStatus =
    | 'PENDING'
    | 'IN_TRANSIT'
    | 'ARRIVED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'TAMPERED'
    | 'EXPIRED'
    | 'ATTEMPTED'
    | 'RETURNED';

/**
 * EC-49: Valid state transitions map
 */
export const DELIVERY_VALID_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
    PENDING: ['IN_TRANSIT', 'CANCELLED', 'EXPIRED'],
    IN_TRANSIT: ['ARRIVED', 'CANCELLED', 'TAMPERED'],
    ARRIVED: ['COMPLETED', 'RETURNED', 'ATTEMPTED', 'CANCELLED'],
    ATTEMPTED: ['ARRIVED', 'CANCELLED'],  // ARRIVED = admin reset
    COMPLETED: [],  // Terminal state
    CANCELLED: [],  // Terminal state
    TAMPERED: [],   // Terminal until admin reset
    EXPIRED: [],    // Terminal state
    RETURNED: [],   // Terminal state
};

/**
 * EC-49: Check if a state transition is valid
 */
export function validateDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
    const validTargets = DELIVERY_VALID_TRANSITIONS[from];
    return validTargets.includes(to);
}

/**
 * EC-49: Check if status is a terminal state
 */
export function isTerminalStatus(status: DeliveryStatus): boolean {
    return DELIVERY_VALID_TRANSITIONS[status].length === 0;
}

/**
 * EC-49: Out-of-order event interface
 */
export interface OutOfOrderEvent {
    rejectedTransition: {
        from: DeliveryStatus;
        to: DeliveryStatus;
    };
    expectedStates: DeliveryStatus[];
    timestamp: number;
    deliveryId: string;
    boxId: string;
    eventId: string;
    acknowledged: boolean;
}

/**
 * EC-49: Subscribe to out-of-order events for a box (rider view)
 */
export function subscribeToOutOfOrderEvents(
    boxId: string,
    callback: (events: OutOfOrderEvent[] | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const eventsRef = ref(db, `hardware/${boxId}/out_of_order_events`);

    const unsubscribe = onValue(eventsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            callback(null);
            return;
        }
        const events = Object.values(data) as OutOfOrderEvent[];
        callback(events);
    });

    return () => off(eventsRef);
}

/**
 * EC-49: Get expected transitions from current status
 */
export function getExpectedTransitions(from: DeliveryStatus): DeliveryStatus[] {
    return DELIVERY_VALID_TRANSITIONS[from];
}

/**
 * EC-49: Format expected transitions as readable string
 */
export function formatExpectedTransitions(from: DeliveryStatus): string {
    const valid = DELIVERY_VALID_TRANSITIONS[from];
    if (valid.length === 0) {
        return '(terminal state)';
    }
    return valid.join(', ');
}

// ==================== EC-66: Customer Multi-Delivery Tracking ====================

/**
 * EC-66: Individual delivery info for rider's view
 */
export interface RiderDeliveryInfo {
    deliveryId: string;
    customerId: string;
    customerName: string;
    customerPhone?: string;
    boxId: string;
    otpCode: string;
    status: DeliveryStatus;
    eta?: number;
    distance?: number;
    dropoffLat: number;
    dropoffLng: number;
    packageDescription?: string;
    isSameDestinationGroup: boolean;  // True if customer has other active deliveries
    createdAt: number;
    updatedAt: number;
}

/**
 * EC-66: Multi-delivery context for riders
 * Shows when multiple deliveries are going to the same customer
 */
export interface MultiDeliveryContext {
    customerId: string;
    customerName: string;
    totalActiveDeliveries: number;
    myDeliveryIndex: number;  // This rider's position (e.g., 1 of 2)
    otherRiders: Array<{
        riderId: string;
        riderName: string;
        status: DeliveryStatus;
    }>;
}

/**
 * EC-66: Customer multi-delivery state
 */
export interface CustomerMultiDeliveryState {
    customerId: string;
    deliveries: RiderDeliveryInfo[];
    activeCount: number;
    completedCount: number;
}

/**
 * EC-66: Configuration for multi-delivery handling
 */
export const MULTI_DELIVERY_CONFIG = {
    NOTIFICATION_GROUP_WINDOW_MS: 300000, // 5 minutes
    MAX_VISIBLE_DELIVERIES: 5,
};

/**
 * EC-66: Subscribe to multi-delivery context for a specific delivery
 * Rider sees if their customer has multiple inbound deliveries
 */
export function subscribeToMultiDeliveryContext(
    deliveryId: string,
    callback: (context: MultiDeliveryContext | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const contextRef = ref(db, `deliveries/${deliveryId}/multi_delivery_context`);

    const unsubscribe = onValue(contextRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as MultiDeliveryContext | null);
    });

    return () => off(contextRef);
}

/**
 * EC-66: Subscribe to all deliveries going to the same destination
 * Rider can see other deliveries in their queue with same drop-off
 */
export function subscribeToSameDestinationGroup(
    riderId: string,
    callback: (deliveries: RiderDeliveryInfo[] | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const groupRef = ref(db, `riders/${riderId}/same_destination_group`);

    const unsubscribe = onValue(groupRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            callback(null);
            return;
        }
        const deliveries = Object.values(data) as RiderDeliveryInfo[];
        callback(deliveries);
    });

    return () => off(groupRef);
}

/**
 * EC-66: Check if a customer has multiple active deliveries
 */
export function hasMultipleActiveDeliveries(context: MultiDeliveryContext | null): boolean {
    return context !== null && context.totalActiveDeliveries > 1;
}

/**
 * EC-66: Format multi-delivery info message for rider
 */
export function formatMultiDeliveryMessage(context: MultiDeliveryContext): string {
    const { totalActiveDeliveries, myDeliveryIndex, otherRiders } = context;

    if (totalActiveDeliveries === 1) {
        return '';
    }

    const otherCount = otherRiders.length;
    if (otherCount === 1) {
        return `Another rider (${otherRiders[0].riderName}) is also delivering to this customer`;
    }

    return `${otherCount} other riders are also delivering to this customer`;
}

/**
 * EC-66: Get distinct OTP codes for rider's deliveries
 */
export function getDistinctOtpCodes(deliveries: RiderDeliveryInfo[]): Map<string, string> {
    const otpMap = new Map<string, string>();
    deliveries.forEach(d => {
        if (d.otpCode) {
            otpMap.set(d.deliveryId, d.otpCode);
        }
    });
    return otpMap;
}

// ==================== EC-89: Token Health Monitoring ====================

export type TokenStatus = 'HEALTHY' | 'EXPIRING' | 'EXPIRED' | 'REFRESHING' | 'FAILED';

export interface TokenHealthState {
    token_age_ms: number;
    refresh_attempts: number;
    last_refresh_at: number;
    status: TokenStatus;
    rider_id: string;
    expires_at?: number;
    error_message?: string;
    timestamp?: number;
}

/**
 * EC-89: Subscribe to rider's token health state
 * Used for admin monitoring of rider session status
 */
export function subscribeToTokenHealth(
    riderId: string,
    callback: (state: TokenHealthState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const healthRef = ref(db, `riders/${riderId}/token_health`);

    const unsubscribe = onValue(healthRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as TokenHealthState | null);
    });

    return () => off(healthRef);
}

// ==================== EC-90: Power State Monitoring (Brownout Actuation) ====================

export type PowerStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'DEAD';

export interface PowerState {
    voltage: number;
    status: PowerStatus;
    solenoid_blocked: boolean;
    low_voltage_since?: number;
    last_successful_unlock_voltage?: number;
    timestamp: number;
}

/**
 * EC-90: Subscribe to box power state
 * Monitors voltage levels and solenoid blocking status
 */
export function subscribeToPower(
    boxId: string,
    callback: (state: PowerState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const powerRef = ref(db, `hardware/${boxId}/power`);

    const unsubscribe = onValue(powerRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as PowerState | null);
    });

    return () => off(powerRef);
}

/**
 * EC-90: Get human-readable power status message
 */
export function getPowerStatusMessage(state: PowerState | null): string {
    if (!state) return 'Power status unknown';

    switch (state.status) {
        case 'HEALTHY':
            return `Battery OK (${state.voltage.toFixed(1)}V)`;
        case 'WARNING':
            return `Low battery warning (${state.voltage.toFixed(1)}V)`;
        case 'CRITICAL':
            return `Battery too low to unlock (${state.voltage.toFixed(1)}V)`;
        case 'DEAD':
            return 'Battery critically low';
        default:
            return 'Power status unknown';
    }
}

/**
 * EC-90: Check if solenoid is blocked due to low voltage
 */
export function isSolenoidBlockedByVoltage(state: PowerState | null): boolean {
    return state?.solenoid_blocked === true;
}

// ==================== EC-91: Resource Conflict Monitoring ====================

export interface ResourceConflictState {
    in_critical_section: boolean;
    queued_events: number;
    last_conflict_at?: number;
    wdt_resets: number;
    timestamp: number;
}

/**
 * EC-91: Subscribe to resource conflict state
 * Monitors SPI bus conflicts between camera and keypad
 */
export function subscribeToResourceConflict(
    boxId: string,
    callback: (state: ResourceConflictState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const conflictRef = ref(db, `hardware/${boxId}/resource_conflict`);

    const unsubscribe = onValue(conflictRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as ResourceConflictState | null);
    });

    return () => off(conflictRef);
}

/**
 * EC-91: Check if box is currently in critical section (busy)
 */
export function isBoxBusy(state: ResourceConflictState | null): boolean {
    return state?.in_critical_section === true;
}

/**
 * EC-91: Get count of queued keypad events
 */
export function getQueuedEventCount(state: ResourceConflictState | null): number {
    return state?.queued_events ?? 0;
}

// ==================== EC-96: Lock Health (Thermal) ====================
export interface LockHealthState {
    overheated: boolean;
    status: 'NORMAL' | 'OVERHEATED';
    timestamp: number;
}

/**
 * Subscribe to lock health updates (EC-96)
 */
export function subscribeToLockHealth(
    boxId: string,
    callback: (state: LockHealthState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const healthRef = ref(db, `hardware/${boxId}/lock_health`);

    const unsubscribe = onValue(healthRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as LockHealthState | null);
    });

    return () => off(healthRef);
}

// ==================== EC-97: Face Auth Status ====================
export type FaceAuthStatus = 'IDLE' | 'SEARCHING' | 'AUTHENTICATED' | 'TIMEOUT_REMOVE_HELMET' | 'FAILED_USE_OTP';

/**
 * Subscribe to Face Auth status updates (EC-97)
 */
export function subscribeToFaceAuthStatus(
    boxId: string,
    callback: (status: FaceAuthStatus | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const statusRef = ref(db, `hardware/${boxId}/face_auth_status`);

    const unsubscribe = onValue(statusRef, (snapshot) => {
        const data = snapshot.val();
        callback((data as FaceAuthStatus) || 'IDLE');
    });

    return () => off(statusRef);
}

/**
 * Send command to start Face Scan (EC-97)
 */
export async function startFaceScan(boxId: string): Promise<void> {
    const db = getFirebaseDatabase();
    const cmdRef = ref(db, `hardware/${boxId}/start_face_scan`);
    await set(cmdRef, true);
}

// ==================== EC-81: Theft Detection ====================

export type TheftState = 'NORMAL' | 'SUSPICIOUS' | 'STOLEN' | 'LOCKDOWN' | 'RECOVERED';

export interface LocationHistoryEntry {
    lat: number;
    lng: number;
    timestamp: number;
}

export interface GeofenceConfig {
    centerLat: number;
    centerLng: number;
    radiusKm: number;
    configured: boolean;
}

export interface TheftStatus {
    state: TheftState;
    is_stolen: boolean;
    reported_by: string;
    reported_at: number;
    last_known_location: {
        lat: number;
        lng: number;
        heading: number;
        speed: number;
    };
    location_history: LocationHistoryEntry[];
    lockdown_active: boolean;
    lockdown_at?: number;
    recovery_photos: string[];
    geofence_breach_at?: number;
    notes?: string;
}

/**
 * Subscribe to all stolen boxes (admin dashboard) - EC-81
 */
export function subscribeToStolenBoxes(
    callback: (boxes: Record<string, TheftStatus> | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const boxesRef = ref(db, 'boxes');

    const unsubscribe = onValue(boxesRef, (snapshot) => {
        const allBoxes = snapshot.val();
        if (!allBoxes) {
            callback(null);
            return;
        }

        const stolenBoxes: Record<string, TheftStatus> = {};
        Object.keys(allBoxes).forEach(boxId => {
            const theftStatus = allBoxes[boxId]?.theft_status;
            if (theftStatus?.is_stolen) {
                stolenBoxes[boxId] = theftStatus;
            }
        });

        callback(Object.keys(stolenBoxes).length > 0 ? stolenBoxes : null);
    });

    return () => off(boxesRef);
}

/**
 * Report a box as stolen or missing (Rider action)
 * Updates theft status and triggers hardware lockdown
 */
export async function reportBoxStolen(
    boxId: string,
    reportedBy: string,
    location: { lat: number; lng: number; heading?: number; speed?: number },
    deliveryId?: string,
    notes?: string
): Promise<void> {
    const db = getFirebaseDatabase();
    const timestamp = Date.now();

    // 1. Update boxes/{boxId}/theft_status
    const theftStatusRef = ref(db, `boxes/${boxId}/theft_status`);
    await set(theftStatusRef, {
        state: 'STOLEN',
        is_stolen: true,
        reported_by: reportedBy,
        reported_at: timestamp,
        last_known_location: {
            lat: location.lat,
            lng: location.lng,
            heading: location.heading || 0,
            speed: location.speed || 0
        },
        location_history: [{
            lat: location.lat,
            lng: location.lng,
            timestamp
        }],
        lockdown_active: true,
        lockdown_at: timestamp,
        notes: notes || 'Reported stolen by rider via app'
    } as TheftStatus);

    // 2. Trigger hardware lockdown (redundancy)
    const hardwareTamperRef = ref(db, `hardware/${boxId}/tamper`);
    await set(hardwareTamperRef, {
        detected: true,
        lockdown: true,
        timestamp,
        source: 'rider_reported'
    });

    // 3. Update hardware status to locked just in case
    const hardwareStatusRef = ref(db, `hardware/${boxId}/status`);
    await set(hardwareStatusRef, 'LOCKED');

    // Also update server timestamp heartbeat
    const heartbeatRef = ref(db, `hardware/${boxId}/last_heartbeat`);
    await set(heartbeatRef, serverTimestamp());

    // 4. Write lockdown flag to the hardware node the firmware reads
    await set(ref(db, `hardware/${boxId}/lockdown`), true);

    // 5. Dispatch push notification (fire-and-forget, imported lazily to avoid circular dep)
    try {
        const { dispatchSecurityNotification } = await import('./riderMatchingService');
        dispatchSecurityNotification('THEFT_REPORTED', {
            boxId,
            reportedBy,
            ...(deliveryId ? { deliveryId } : {}),
        }, deliveryId).catch(() => {});
    } catch (_) { /* dynamic import may fail in some envs */ }
}

export { ref, onValue, off, set, update, serverTimestamp };
export type { Database, DatabaseReference };

