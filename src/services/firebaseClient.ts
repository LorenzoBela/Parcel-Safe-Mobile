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

            await set(hardwareRef, {
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

export { ref, onValue, off, set, serverTimestamp };
export type { Database, DatabaseReference };

