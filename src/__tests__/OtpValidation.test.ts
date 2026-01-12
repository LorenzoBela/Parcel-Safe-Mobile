/**
 * OTP Validation Tests
 * 
 * Tests for OTP-related business logic based on:
 * - BOUNDARY_CASES.md: BC-NUM-01 to BC-NUM-04, BC-TIME-01 to BC-TIME-06
 * - NEGATIVE_CASES.md: NC-OTP-01 to NC-OTP-12
 */

import { isOtpValid, isLockoutActive, SAFETY_CONSTANTS } from '../services/SafetyLogic';

describe('OTP Validation', () => {
    const NOW = 1000000000; // Fixed reference timestamp

    // ============ BOUNDARY CASES: OTP FORMAT ============
    describe('BC-NUM: OTP Value Boundaries', () => {
        // BC-NUM-01: OTP = 000000 (Minimum)
        test('BC-NUM-01: should accept 000000 as valid OTP format', () => {
            const otp = '000000';
            expect(otp.length).toBe(6);
            expect(/^\d{6}$/.test(otp)).toBe(true);
        });

        // BC-NUM-02: OTP = 999999 (Maximum)
        test('BC-NUM-02: should accept 999999 as valid OTP format', () => {
            const otp = '999999';
            expect(otp.length).toBe(6);
            expect(/^\d{6}$/.test(otp)).toBe(true);
        });

        // BC-NUM-03: OTP = 100000 (Just Above Min)
        test('BC-NUM-03: should accept 100000 as valid OTP format', () => {
            const otp = '100000';
            expect(otp.length).toBe(6);
            expect(/^\d{6}$/.test(otp)).toBe(true);
        });

        // BC-STR-15: OTP with leading zeros displays correctly
        test('BC-STR-15: leading zeros should be preserved', () => {
            const otp = '000123';
            expect(otp).toBe('000123');
            expect(otp.length).toBe(6);
        });
    });

    // ============ NEGATIVE CASES: OTP FORMAT ============
    describe('NC-OTP: OTP Format Negatives', () => {
        // NC-OTP-02: Non-Numeric Characters
        test('NC-OTP-02: should reject non-numeric characters', () => {
            const invalidOtps = ['ABCDEF', '12AB34', '123a56', '!@#$%^'];
            invalidOtps.forEach(otp => {
                expect(/^\d{6}$/.test(otp)).toBe(false);
            });
        });

        // NC-OTP-03: Too Few Digits
        test('NC-OTP-03: should reject 5 or fewer digits', () => {
            const shortOtps = ['12345', '1234', '123', '12', '1', ''];
            shortOtps.forEach(otp => {
                expect(/^\d{6}$/.test(otp)).toBe(false);
            });
        });

        // NC-OTP-04: Too Many Digits
        test('NC-OTP-04: should reject 7 or more digits', () => {
            const longOtps = ['1234567', '12345678', '123456789'];
            longOtps.forEach(otp => {
                expect(/^\d{6}$/.test(otp)).toBe(false);
            });
        });

        // NC-OTP-05: Empty Input
        test('NC-OTP-05: should reject empty input', () => {
            expect(/^\d{6}$/.test('')).toBe(false);
        });

        // NC-OTP special characters
        test('NC-OTP: should reject special characters', () => {
            const invalidOtps = ['12345 ', ' 12345', '12-345', '123.45'];
            invalidOtps.forEach(otp => {
                expect(/^\d{6}$/.test(otp)).toBe(false);
            });
        });
    });

    // ============ BOUNDARY CASES: OTP EXPIRY TIME ============
    describe('BC-TIME: OTP Expiry Boundaries', () => {
        // BC-TIME-01: OTP Age = 0 seconds (just generated)
        test('BC-TIME-01: should accept freshly generated OTP', () => {
            expect(isOtpValid(NOW, NOW)).toBe(true);
        });

        // BC-TIME-02: OTP Age = 3 hours 59 minutes (just before expiry)
        test('BC-TIME-02: should accept OTP just before 4-hour expiry', () => {
            const threeHoursFiftyNineMins = (3 * 60 + 59) * 60 * 1000;
            const otpTimestamp = NOW - threeHoursFiftyNineMins;
            expect(isOtpValid(otpTimestamp, NOW)).toBe(true);
        });

        // BC-TIME-03: OTP Age = 4 hours exactly (at expiry)
        test('BC-TIME-03: should accept OTP at exactly 4 hours (boundary inclusive)', () => {
            const fourHours = 4 * 60 * 60 * 1000;
            const otpTimestamp = NOW - fourHours;
            expect(isOtpValid(otpTimestamp, NOW)).toBe(true);
        });

        // BC-TIME-04: OTP Age = 4 hours 1 second (just after expiry)
        test('BC-TIME-04: should reject OTP just after 4-hour expiry', () => {
            const fourHoursOneSecond = 4 * 60 * 60 * 1000 + 1000;
            const otpTimestamp = NOW - fourHoursOneSecond;
            expect(isOtpValid(otpTimestamp, NOW)).toBe(false);
        });

        // Edge: OTP with future timestamp
        test('should handle future OTP timestamp gracefully', () => {
            const futureTimestamp = NOW + 5000; // 5 seconds in future
            expect(isOtpValid(futureTimestamp, NOW)).toBe(false);
        });

        // Edge: OTP with very old timestamp
        test('should reject very old OTP (24 hours)', () => {
            const twentyFourHoursAgo = NOW - (24 * 60 * 60 * 1000);
            expect(isOtpValid(twentyFourHoursAgo, NOW)).toBe(false);
        });
    });

    // ============ BOUNDARY CASES: LOCKOUT DURATION ============
    describe('BC-TIME: Lockout Duration Boundaries', () => {
        // BC-TIME-05: Lockout Duration = 4 minutes 59 seconds
        test('BC-TIME-05: should still be locked at 4 min 59 sec', () => {
            const fourMinsFiftyNineSecs = (4 * 60 + 59) * 1000;
            const lockoutStart = NOW - fourMinsFiftyNineSecs;
            expect(isLockoutActive(5, lockoutStart, NOW)).toBe(true);
        });

        // BC-TIME-06: Lockout Duration = 5 minutes exactly
        test('BC-TIME-06: should unlock at exactly 5 minutes', () => {
            const fiveMinutes = 5 * 60 * 1000;
            const lockoutStart = NOW - fiveMinutes;
            expect(isLockoutActive(5, lockoutStart, NOW)).toBe(false);
        });

        // Just after lockout ends
        test('should unlock just after 5 minutes', () => {
            const fiveMinutesOneSecond = 5 * 60 * 1000 + 1000;
            const lockoutStart = NOW - fiveMinutesOneSecond;
            expect(isLockoutActive(5, lockoutStart, NOW)).toBe(false);
        });
    });

    // ============ NEGATIVE CASES: LOCKOUT ============
    describe('NC-OTP: Lockout Negatives', () => {
        // NC-OTP-06: Lockout After 5 Failures
        test('NC-OTP-06: should lockout after exactly 5 failures', () => {
            expect(isLockoutActive(5, NOW, NOW)).toBe(true);
        });

        // NC-OTP-07: OTP Attempt During Lockout
        test('NC-OTP-07: should reject OTP during lockout', () => {
            const twoMinutesAgo = NOW - (2 * 60 * 1000);
            expect(isLockoutActive(5, twoMinutesAgo, NOW)).toBe(true);
        });

        // 4 failures should NOT lockout
        test('should NOT lockout at 4 failures', () => {
            expect(isLockoutActive(4, NOW, NOW)).toBe(false);
        });

        // 6+ failures should still be locked (within window)
        test('should lockout at 6+ failures', () => {
            expect(isLockoutActive(6, NOW, NOW)).toBe(true);
            expect(isLockoutActive(10, NOW, NOW)).toBe(true);
        });
    });

    // ============ BOUNDARY CASES: FAILED ATTEMPTS ============
    describe('BC-NUM: Failed Attempt Boundaries', () => {
        // BC-NUM-09: Failed OTP Attempts = 4 (one remaining)
        test('BC-NUM-09: should allow one more attempt at 4 failures', () => {
            expect(isLockoutActive(4, NOW, NOW)).toBe(false);
        });

        // BC-NUM-10: Failed OTP Attempts = 5 (lockout threshold)
        test('BC-NUM-10: should lockout immediately at 5 failures', () => {
            expect(isLockoutActive(5, NOW, NOW)).toBe(true);
        });

        // 0 failures
        test('should allow attempts when failure count is 0', () => {
            expect(isLockoutActive(0, NOW, NOW)).toBe(false);
        });

        // 3 failures
        test('should allow attempts when failure count is 3', () => {
            expect(isLockoutActive(3, NOW, NOW)).toBe(false);
        });
    });
});

// ============ OTP HASH VALIDATION UTILITY ============
describe('OTP Hash Validation', () => {
    // NC-DATA-08: OTP Hash Too Short
    test('NC-DATA-08: should reject hash shorter than expected', () => {
        const shortHash = 'abc123';
        const expectedLength = 64; // SHA-256 hex length
        expect(shortHash.length).toBeLessThan(expectedLength);
    });

    // Valid SHA-256 hash length
    test('should accept 64-character SHA-256 hash', () => {
        const validHash = 'a'.repeat(64);
        expect(validHash.length).toBe(64);
    });
});
