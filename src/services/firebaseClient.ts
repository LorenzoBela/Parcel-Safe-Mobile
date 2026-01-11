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

export { ref, onValue, off, set, serverTimestamp };
export type { Database, DatabaseReference };
