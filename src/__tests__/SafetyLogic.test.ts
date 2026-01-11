
import {
    isLockoutActive,
    canAddToPhotoQueue,
    isOtpValid,
    isSpeedAnomaly,
    isTamperDetected,
    getBatteryStatus,
    isGpsStale,
    isClockSyncRequired,
    SAFETY_CONSTANTS
} from '../services/SafetyLogic';

describe('SafetyLogic Edge Cases', () => {

    // --- EC-03: Battery Logic ---
    describe('EC-03: Battery Monitoring', () => {
        test('should return CRITICAL if <= 10%', () => {
            expect(getBatteryStatus(10)).toBe('CRITICAL');
            expect(getBatteryStatus(0)).toBe('CRITICAL');
        });

        test('should return LOW if <= 20% but > 10%', () => {
            expect(getBatteryStatus(20)).toBe('LOW');
            expect(getBatteryStatus(11)).toBe('LOW');
        });

        test('should return NORMAL if > 20%', () => {
            expect(getBatteryStatus(21)).toBe('NORMAL');
            expect(getBatteryStatus(100)).toBe('NORMAL');
        });
    });

    // --- EC-24: GPS Stale Logic ---
    describe('EC-24: GPS Staleness', () => {
        const NOW = 1000000;
        test('should be STALE if never updated (0)', () => {
            expect(isGpsStale(0, NOW)).toBe(true);
        });

        test('should be STALE if last update > 5 mins ago', () => {
            const sixMinsAgo = NOW - (6 * 60 * 1000);
            expect(isGpsStale(sixMinsAgo, NOW)).toBe(true);
        });

        test('should be VALID if last update < 5 mins ago', () => {
            const fourMinsAgo = NOW - (4 * 60 * 1000);
            expect(isGpsStale(fourMinsAgo, NOW)).toBe(false);
        });
    });

    // --- EC-46: Clock Skew ---
    describe('EC-46: Clock Skew', () => {
        const NOW = 1000000;
        test('should require sync if skew > 5 mins', () => {
            const serverTime = NOW + (6 * 60 * 1000); // Server is 6 mins ahead
            expect(isClockSyncRequired(serverTime, NOW)).toBe(true);
        });

        test('should NOT require sync if skew < 5 mins', () => {
            const serverTime = NOW - (4 * 60 * 1000); // Server is 4 mins behind
            expect(isClockSyncRequired(serverTime, NOW)).toBe(false);
        });
    });

    // --- EC-18: Physical Tampering ---
    describe('EC-18: Tamper Detection', () => {
        const NOW = 1000000;

        test('should FALSE (Safe) if door is CLOSED', () => {
            // Door closed is always safe, regardless of unlock time
            expect(isTamperDetected(false, 0, NOW)).toBe(false);
        });

        test('should FALSE (Safe) if door OPENED 5 seconds AFTER unlock', () => {
            const unlockTime = NOW - 5000; // 5 secs ago
            expect(isTamperDetected(true, unlockTime, NOW)).toBe(false);
        });

        test('should TRUE (Tamper!) if door OPENED 30 seconds AFTER unlock (grace period exceeded)', () => {
            const unlockTime = NOW - 30000; // 30 secs ago
            expect(isTamperDetected(true, unlockTime, NOW)).toBe(true);
        });

        test('should TRUE (Tamper!) if door OPENED with NO previous unlock (timestamp 0)', () => {
            expect(isTamperDetected(true, 0, NOW)).toBe(true);
        });
    });

    // --- EC-04: Wrong OTP Lockout ---
    describe('EC-04: OTP Lockout Policy', () => {
        const NOW = 1000000; // Fixed time reference

        test('should NOT lockout if attempts < MAX_ATTEMPTS', () => {
            expect(isLockoutActive(4, NOW, NOW)).toBe(false);
        });

        test('should activate lockout immediately after 5th failure', () => {
            expect(isLockoutActive(5, NOW, NOW)).toBe(true);
        });

        test('should remain locked out inside the duration window (e.g. 4 mins later)', () => {
            const fourMinutesLater = NOW + (4 * 60 * 1000);
            expect(isLockoutActive(5, NOW, fourMinutesLater)).toBe(true);
        });

        test('should lift lockout after duration expires (e.g. 6 mins later)', () => {
            const sixMinutesLater = NOW + (6 * 60 * 1000);
            expect(isLockoutActive(5, NOW, sixMinutesLater)).toBe(false);
        });
    });

    // --- EC-10: Photo Queue Limits ---
    describe('EC-10: Photo Storage Logic', () => {
        test('should accept photos when queue is empty', () => {
            expect(canAddToPhotoQueue(0)).toBe(true);
        });

        test('should accept photos when queue is just below limit', () => {
            expect(canAddToPhotoQueue(SAFETY_CONSTANTS.MAX_QUEUED_PHOTOS - 1)).toBe(true);
        });

        test('should REJECT photos when queue is full', () => {
            expect(canAddToPhotoQueue(SAFETY_CONSTANTS.MAX_QUEUED_PHOTOS)).toBe(false);
        });
    });

    // --- EC-07: Stale OTP ---
    describe('EC-07: OTP Expiry', () => {
        const NOW = 1000000;

        test('should consider fresh OTP valid', () => {
            expect(isOtpValid(NOW - 1000, NOW)).toBe(true);
        });

        test('should consider 3.9 hour old OTP valid', () => {
            const almostExpired = NOW - (3.9 * 60 * 60 * 1000);
            expect(isOtpValid(almostExpired, NOW)).toBe(true);
        });

        test('should consider 4.1 hour old OTP INVALID (Expired)', () => {
            const expired = NOW - (4.1 * 60 * 60 * 1000);
            expect(isOtpValid(expired, NOW)).toBe(false);
        });
    });

    // --- EC-08: GPS Spoofing ---
    describe('EC-08: GPS Anomaly Detection', () => {
        test('should flag 10km jump in 1 second as anomaly', () => {
            const distance = 10000; // 10km
            const time = 1; // 1 second
            expect(isSpeedAnomaly(distance, time)).toBe(true);
        });

        test('should accept normal highway speed (e.g., 100m in 5s = 72km/h)', () => {
            const distance = 100;
            const time = 5;
            expect(isSpeedAnomaly(distance, time)).toBe(false);
        });
    });

});
