
/**
 * SafetyLogic.ts
 * 
 * Pure business logic for handling critical edge cases defined in EDGE_CASES.md.
 * These functions are designed to be Unit Tested easily (no external dependencies).
 */

export const SAFETY_CONSTANTS = {
    MAX_OTP_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 5 * 60 * 1000, // 5 minutes
    MAX_QUEUED_PHOTOS: 10,
    OTP_VALIDITY_WINDOW_MS: 4 * 60 * 60 * 1000, // 4 hours
    MAX_SPEED_KMH: 200,
    MAX_DISTANCE_JUMP_METERS: 10000, // 10km jump in 1 sec is impossible
    TAMPER_RESET_REQUIRED: true,
    BATTERY_LOW_THRESHOLD: 20,
    BATTERY_CRITICAL_THRESHOLD: 10,
    GPS_STALE_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
    CLOCK_SKEW_TOLERANCE_MS: 5 * 60 * 1000, // 5 minutes
};

/**
 * EC-18: Physical Tampering
 * Determines if a door open event should be flagged as tampering.
 * Rule: Door open is VALID only if an OTP was successfully verified within the last X seconds (e.g. 10s).
 */
export const isTamperDetected = (isDoorOpen: boolean, lastValidUnlockTimestamp: number, currentTimestamp: number = Date.now()): boolean => {
    if (!isDoorOpen) return false; // Door closed is safe

    const UNLOCK_GRACE_PERIOD_MS = 10 * 1000; // 10 seconds to open door after OTP
    const timeSinceUnlock = currentTimestamp - lastValidUnlockTimestamp;

    // If door opened BUT no valid unlock happened recently -> TAMPERED
    return timeSinceUnlock > UNLOCK_GRACE_PERIOD_MS;
};

/**
 * EC-03: Box Battery Dies
 * Checks if battery levels are concerning.
 */
export const getBatteryStatus = (batteryPercentage: number): 'NORMAL' | 'LOW' | 'CRITICAL' => {
    if (batteryPercentage <= SAFETY_CONSTANTS.BATTERY_CRITICAL_THRESHOLD) return 'CRITICAL';
    if (batteryPercentage <= SAFETY_CONSTANTS.BATTERY_LOW_THRESHOLD) return 'LOW';
    return 'NORMAL';
};

/**
 * EC-24: GPS Module Failure
 * Checks if GPS data is stale (no updates for > 5 mins).
 */
export const isGpsStale = (lastUpdateTimestamp: number, currentTimestamp: number = Date.now()): boolean => {
    if (lastUpdateTimestamp === 0) return true; // Never updated
    return (currentTimestamp - lastUpdateTimestamp) > SAFETY_CONSTANTS.GPS_STALE_THRESHOLD_MS;
};

/**
 * EC-46: Firebase Clock Skew
 * Checks if the local device time differs significantly from server time.
 */
export const isClockSyncRequired = (serverTimestamp: number, deviceTimestamp: number = Date.now()): boolean => {
    const diff = Math.abs(serverTimestamp - deviceTimestamp);
    return diff > SAFETY_CONSTANTS.CLOCK_SKEW_TOLERANCE_MS;
};

/**
 * EC-04: Customer Enters Wrong OTP 5 Times
 * Checks if the user is currently locked out.
 */
export const isLockoutActive = (failedAttempts: number, lastAttemptTimestamp: number, currentTimestamp: number = Date.now()): boolean => {
    if (failedAttempts < SAFETY_CONSTANTS.MAX_OTP_ATTEMPTS) {
        return false;
    }
    const timeSinceLastFailure = currentTimestamp - lastAttemptTimestamp;
    return timeSinceLastFailure < SAFETY_CONSTANTS.LOCKOUT_DURATION_MS;
};

/**
 * EC-10: Photo Storage Full
 * Determines if we can add another photo to the offline queue.
 * Returns TRUE if we accept the photo, FALSE if queue full (should drop oldest or reject).
 */
export const canAddToPhotoQueue = (currentQueueSize: number): boolean => {
    return currentQueueSize < SAFETY_CONSTANTS.MAX_QUEUED_PHOTOS;
};

/**
 * EC-07: Stale OTP
 * Checks if the cached OTP is too old to be used safely.
 */
export const isOtpValid = (otpContextTimestamp: number, currentTimestamp: number = Date.now()): boolean => {
    const age = currentTimestamp - otpContextTimestamp;
    return age >= 0 && age <= SAFETY_CONSTANTS.OTP_VALIDITY_WINDOW_MS;
};

/**
 * EC-08: GPS Spoofing - Velocity Check
 * precise distance calculation (Haversine omitted for simple approx, or injected)
 * Here we use simple distance/time = speed check.
 */
export const isSpeedAnomaly = (distanceMeters: number, timeDeltaSeconds: number): boolean => {
    if (timeDeltaSeconds <= 0) return true; // Impossible or duplicate event
    const speedMetersPerSec = distanceMeters / timeDeltaSeconds;
    const speedKmh = speedMetersPerSec * 3.6;
    return speedKmh > SAFETY_CONSTANTS.MAX_SPEED_KMH;
};
