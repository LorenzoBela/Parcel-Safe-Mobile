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
    
    // Set with idempotency data
    await set(hardwareRef, {
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

export { ref, onValue, off, set, serverTimestamp };
export type { Database, DatabaseReference };
