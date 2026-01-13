/**
 * EC-32: Rider Cancellation Tests (Mobile)
 * 
 * Tests for rider cancellation after pickup functionality.
 * 
 * Run with: npm test -- RiderCancellation
 */

// ============ Constants ============
const RETURN_OTP_VALIDITY_MS = 86400000; // 24 hours
const RETURN_OTP_LENGTH = 6;

// ============ Enums ============
enum CancellationReason {
    CUSTOMER_UNAVAILABLE = 'CUSTOMER_UNAVAILABLE',
    ADDRESS_INVALID = 'ADDRESS_INVALID',
    RIDER_EMERGENCY = 'RIDER_EMERGENCY',
    PACKAGE_DAMAGED = 'PACKAGE_DAMAGED',
    CUSTOMER_REFUSED = 'CUSTOMER_REFUSED',
    WEATHER_UNSAFE = 'WEATHER_UNSAFE',
    OTHER = 'OTHER',
}

// ============ Types ============
interface CancellationRequest {
    deliveryId: string;
    boxId: string;
    reason: CancellationReason;
    reasonDetails?: string;
    riderId: string;
    riderName?: string;
}

// ============ Helper Functions ============
function generateReturnOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateCancellationRequest(request: CancellationRequest): { valid: boolean; error?: string } {
    if (!request.deliveryId || request.deliveryId.trim() === '') {
        return { valid: false, error: 'Delivery ID is required' };
    }

    if (!request.boxId || request.boxId.trim() === '') {
        return { valid: false, error: 'Box ID is required' };
    }

    if (!request.reason) {
        return { valid: false, error: 'Cancellation reason is required' };
    }

    if (!Object.values(CancellationReason).includes(request.reason)) {
        return { valid: false, error: 'Invalid cancellation reason' };
    }

    if (!request.riderId || request.riderId.trim() === '') {
        return { valid: false, error: 'Rider ID is required' };
    }

    if (request.reason === CancellationReason.OTHER &&
        (!request.reasonDetails || request.reasonDetails.trim() === '')) {
        return { valid: false, error: 'Details required for OTHER reason' };
    }

    return { valid: true };
}

function isReturnOtpValid(issuedAt: number, currentTime: number): boolean {
    return (currentTime - issuedAt) < RETURN_OTP_VALIDITY_MS;
}

function getReturnOtpRemainingHours(issuedAt: number, currentTime: number): number {
    if (!isReturnOtpValid(issuedAt, currentTime)) return 0;

    const elapsed = currentTime - issuedAt;
    const remaining = RETURN_OTP_VALIDITY_MS - elapsed;
    return Math.floor(remaining / 3600000);
}

function formatCancellationReason(reason: CancellationReason): string {
    const reasonLabels: Record<CancellationReason, string> = {
        [CancellationReason.CUSTOMER_UNAVAILABLE]: 'Customer Unavailable',
        [CancellationReason.ADDRESS_INVALID]: 'Invalid Address',
        [CancellationReason.RIDER_EMERGENCY]: 'Rider Emergency',
        [CancellationReason.PACKAGE_DAMAGED]: 'Package Damaged',
        [CancellationReason.CUSTOMER_REFUSED]: 'Customer Refused',
        [CancellationReason.WEATHER_UNSAFE]: 'Unsafe Weather',
        [CancellationReason.OTHER]: 'Other',
    };
    return reasonLabels[reason] || 'Unknown';
}

// ============ Tests ============

describe('EC-32: Rider Cancellation - Mobile', () => {

    describe('Return OTP Generation', () => {
        it('should generate 6-digit return OTP', () => {
            const otp = generateReturnOtp();
            expect(otp.length).toBe(RETURN_OTP_LENGTH);
        });

        it('should generate numeric OTP', () => {
            const otp = generateReturnOtp();
            expect(/^\d{6}$/.test(otp)).toBe(true);
        });

        it('should generate OTP >= 100000', () => {
            const otp = generateReturnOtp();
            expect(parseInt(otp)).toBeGreaterThanOrEqual(100000);
        });

        it('should generate OTP <= 999999', () => {
            const otp = generateReturnOtp();
            expect(parseInt(otp)).toBeLessThanOrEqual(999999);
        });

        it('should generate unique OTPs (probabilistic)', () => {
            const otps = new Set<string>();
            for (let i = 0; i < 100; i++) {
                otps.add(generateReturnOtp());
            }
            // Should have at least 90 unique OTPs out of 100
            expect(otps.size).toBeGreaterThan(90);
        });
    });

    describe('Cancellation Request Validation', () => {
        const baseRequest: CancellationRequest = {
            deliveryId: 'del_123',
            boxId: 'box_ABC',
            reason: CancellationReason.CUSTOMER_UNAVAILABLE,
            riderId: 'rider_456',
        };

        it('should accept valid request', () => {
            const result = validateCancellationRequest(baseRequest);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should reject missing delivery ID', () => {
            const request = { ...baseRequest, deliveryId: '' };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Delivery ID is required');
        });

        it('should reject whitespace-only delivery ID', () => {
            const request = { ...baseRequest, deliveryId: '   ' };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Delivery ID is required');
        });

        it('should reject missing box ID', () => {
            const request = { ...baseRequest, boxId: '' };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Box ID is required');
        });

        it('should reject missing reason', () => {
            const request = { ...baseRequest, reason: undefined as unknown as CancellationReason };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Cancellation reason is required');
        });

        it('should reject invalid reason', () => {
            const request = { ...baseRequest, reason: 'INVALID_REASON' as CancellationReason };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid cancellation reason');
        });

        it('should reject missing rider ID', () => {
            const request = { ...baseRequest, riderId: '' };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Rider ID is required');
        });

        it('should require details for OTHER reason', () => {
            const request = {
                ...baseRequest,
                reason: CancellationReason.OTHER,
                reasonDetails: undefined,
            };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Details required for OTHER reason');
        });

        it('should accept OTHER reason with details', () => {
            const request = {
                ...baseRequest,
                reason: CancellationReason.OTHER,
                reasonDetails: 'Custom cancellation reason',
            };
            const result = validateCancellationRequest(request);
            expect(result.valid).toBe(true);
        });
    });

    describe('Return OTP Validity', () => {
        it('should be valid immediately after issue', () => {
            const now = Date.now();
            expect(isReturnOtpValid(now, now)).toBe(true);
        });

        it('should be valid after 12 hours', () => {
            const issuedAt = Date.now();
            const currentTime = issuedAt + (12 * 3600000);
            expect(isReturnOtpValid(issuedAt, currentTime)).toBe(true);
        });

        it('should expire after 24 hours', () => {
            const issuedAt = Date.now();
            const currentTime = issuedAt + RETURN_OTP_VALIDITY_MS;
            expect(isReturnOtpValid(issuedAt, currentTime)).toBe(false);
        });
    });

    describe('Remaining Hours Calculation', () => {
        it('should show 24 hours at start', () => {
            const now = Date.now();
            expect(getReturnOtpRemainingHours(now, now)).toBe(24);
        });

        it('should show 12 hours halfway through', () => {
            const issuedAt = Date.now();
            const currentTime = issuedAt + (12 * 3600000);
            expect(getReturnOtpRemainingHours(issuedAt, currentTime)).toBe(12);
        });

        it('should show 0 hours after expiry', () => {
            const issuedAt = Date.now();
            const currentTime = issuedAt + RETURN_OTP_VALIDITY_MS;
            expect(getReturnOtpRemainingHours(issuedAt, currentTime)).toBe(0);
        });
    });

    describe('Cancellation Reason Formatting', () => {
        it('should format all valid reasons', () => {
            const reasons = Object.values(CancellationReason);
            for (const reason of reasons) {
                const formatted = formatCancellationReason(reason);
                expect(formatted).not.toBe('Unknown');
                expect(typeof formatted).toBe('string');
                expect(formatted.length).toBeGreaterThan(0);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle cancellation at timestamp 0', () => {
            expect(isReturnOtpValid(0, 0)).toBe(true);
            expect(isReturnOtpValid(0, RETURN_OTP_VALIDITY_MS)).toBe(false);
        });

        it('should handle very old timestamp', () => {
            const veryOldTime = Date.now() - (365 * 24 * 3600000); // 1 year ago
            expect(isReturnOtpValid(veryOldTime, Date.now())).toBe(false);
        });
    });
});
