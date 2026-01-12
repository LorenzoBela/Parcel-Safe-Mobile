/**
 * Firebase Client for Parcel-Safe Mobile App
 * 
 * Provides real-time database access for GPS location updates
 * and box connectivity monitoring.
 */

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
    getDatabase,
    ref,
    onValue,
    off,
    set,
    serverTimestamp,
    Database,
    DatabaseReference
} from 'firebase/database';

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

export function initializeFirebase(): Database {
    if (getApps().length === 0) {
        app = initializeApp(firebaseConfig);
    } else {
        app = getApps()[0];
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

// ==================== Types ====================

export interface LocationData {
    latitude: number;
    longitude: number;
    timestamp: number;
    server_timestamp?: number;
    speed?: number;
    heading?: number;
    source: 'box' | 'phone';
}

export interface BoxState {
    status: 'SLEEP' | 'STANDBY' | 'ACTIVE' | 'ARRIVED' | 'UNLOCKING' | 'LOCKED';
    delivery_id?: string;
    otp_code?: string;
    last_heartbeat?: number;
}

// ==================== Location Functions ====================

/**
 * Subscribe to live location updates for a specific box
 */
export function subscribeToLocation(
    boxId: string,
    callback: (location: LocationData | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const locationRef = ref(db, `locations/${boxId}`);

    const unsubscribe = onValue(locationRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as LocationData | null);
    });

    return () => off(locationRef);
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
    const locationRef = ref(db, `locations/${boxId}`);

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
 * Update box power state
 */
export async function updateBoxState(
    boxId: string,
    state: Partial<BoxState>
): Promise<void> {
    const db = getFirebaseDatabase();
    const stateRef = ref(db, `hardware/${boxId}`);

    await set(stateRef, {
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
 * Subscribe to box battery state updates
 */
export function subscribeToBattery(
    boxId: string,
    callback: (state: BatteryState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const batteryRef = ref(db, `hardware/${boxId}/battery`);

    const unsubscribe = onValue(batteryRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as BatteryState | null);
    });

    return () => off(batteryRef);
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

    await set(hardwareRef, {
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

    await set(hardwareRef, {
        otp_code: newOtpCode,
        otp_issued_at: serverTimestamp(),
        delivery_id: deliveryId,
        last_heartbeat: serverTimestamp(),
    });
}

export { ref, onValue, off, set, serverTimestamp };
export type { Database, DatabaseReference };
