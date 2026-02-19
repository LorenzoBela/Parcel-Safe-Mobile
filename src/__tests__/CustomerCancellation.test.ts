/**
 * Customer Cancellation Tests
 * 
 * Tests for customer-initiated cancellation functionality.
 * Customers can only cancel BEFORE pickup (PENDING or ASSIGNED stages).
 * 
 * Run with: npm test -- CustomerCancellation
 */

// ============ Enums ============
enum DeliveryStatus {
    PENDING = 'PENDING',
    ASSIGNED = 'ASSIGNED',
    IN_TRANSIT = 'IN_TRANSIT',
    ARRIVED = 'ARRIVED',
    DELIVERED = 'DELIVERED',
    CANCELLED = 'CANCELLED',
}

enum CustomerCancellationReason {
    CHANGED_MIND = 'CHANGED_MIND',
    ORDERED_BY_MISTAKE = 'ORDERED_BY_MISTAKE',
    FOUND_ALTERNATIVE = 'FOUND_ALTERNATIVE',
    PRICE_TOO_HIGH = 'PRICE_TOO_HIGH',
    TAKING_TOO_LONG = 'TAKING_TOO_LONG',
    OTHER = 'OTHER',
}

// ============ Types ============
interface CustomerCancellationRequest {
    deliveryId: string;
    customerId: string;
    customerName?: string;
    reason: CustomerCancellationReason;
    reasonDetails?: string;
}

// ============ Helper Functions ============
function canCustomerCancel(status: DeliveryStatus): { canCancel: boolean; reason?: string } {
    switch (status) {
        case DeliveryStatus.PENDING:
        case DeliveryStatus.ASSIGNED:
            return { canCancel: true };

        case DeliveryStatus.IN_TRANSIT:
            return {
                canCancel: false,
                reason: 'Cannot cancel after package has been picked up'
            };

        case DeliveryStatus.ARRIVED:
        case DeliveryStatus.DELIVERED:
            return {
                canCancel: false,
                reason: 'Delivery is already in progress or completed'
            };

        case DeliveryStatus.CANCELLED:
            return {
                canCancel: false,
                reason: 'Delivery has already been cancelled'
            };

        default:
            return { canCancel: false, reason: 'Unknown delivery status' };
    }
}

function formatCustomerCancellationReason(reason: CustomerCancellationReason): string {
    const reasonLabels: Record<CustomerCancellationReason, string> = {
        [CustomerCancellationReason.CHANGED_MIND]: 'Changed My Mind',
        [CustomerCancellationReason.ORDERED_BY_MISTAKE]: 'Ordered by Mistake',
        [CustomerCancellationReason.FOUND_ALTERNATIVE]: 'Found Alternative',
        [CustomerCancellationReason.PRICE_TOO_HIGH]: 'Price Too High',
        [CustomerCancellationReason.TAKING_TOO_LONG]: 'Taking Too Long',
        [CustomerCancellationReason.OTHER]: 'Other',
    };
    return reasonLabels[reason] || 'Unknown';
}

function validateCustomerCancellationRequest(
    request: CustomerCancellationRequest
): { valid: boolean; error?: string } {
    if (!request.deliveryId || request.deliveryId.trim() === '') {
        return { valid: false, error: 'Delivery ID is required' };
    }

    if (!request.customerId || request.customerId.trim() === '') {
        return { valid: false, error: 'Customer ID is required' };
    }

    if (!request.reason) {
        return { valid: false, error: 'Cancellation reason is required' };
    }

    if (!Object.values(CustomerCancellationReason).includes(request.reason)) {
        return { valid: false, error: 'Invalid cancellation reason' };
    }

    if (request.reason === CustomerCancellationReason.OTHER &&
        (!request.reasonDetails || request.reasonDetails.trim() === '')) {
        return { valid: false, error: 'Details required for OTHER reason' };
    }

    return { valid: true };
}

// ============ Tests ============

describe('Customer Cancellation', () => {

    describe('Cancellation Eligibility by Delivery Status', () => {
        it('should allow cancellation when PENDING', () => {
            const result = canCustomerCancel(DeliveryStatus.PENDING);
            expect(result.canCancel).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        it('should allow cancellation when ASSIGNED (before pickup)', () => {
            const result = canCustomerCancel(DeliveryStatus.ASSIGNED);
            expect(result.canCancel).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        // Removed test for PICKED_UP as it's no longer a valid status

        it('should NOT allow cancellation when IN_TRANSIT', () => {
            const result = canCustomerCancel(DeliveryStatus.IN_TRANSIT);
            expect(result.canCancel).toBe(false);
            expect(result.reason).toBe('Cannot cancel after package has been picked up');
        });

        it('should NOT allow cancellation when ARRIVED', () => {
            const result = canCustomerCancel(DeliveryStatus.ARRIVED);
            expect(result.canCancel).toBe(false);
            expect(result.reason).toBe('Delivery is already in progress or completed');
        });

        it('should NOT allow cancellation when DELIVERED', () => {
            const result = canCustomerCancel(DeliveryStatus.DELIVERED);
            expect(result.canCancel).toBe(false);
            expect(result.reason).toBe('Delivery is already in progress or completed');
        });

        it('should NOT allow cancellation when already CANCELLED', () => {
            const result = canCustomerCancel(DeliveryStatus.CANCELLED);
            expect(result.canCancel).toBe(false);
            expect(result.reason).toBe('Delivery has already been cancelled');
        });

        it('should reject unknown status', () => {
            const result = canCustomerCancel('UNKNOWN_STATUS' as DeliveryStatus);
            expect(result.canCancel).toBe(false);
            expect(result.reason).toBe('Unknown delivery status');
        });
    });

    describe('Cancellation Request Validation', () => {
        const baseRequest: CustomerCancellationRequest = {
            deliveryId: 'del_123',
            customerId: 'cust_456',
            reason: CustomerCancellationReason.CHANGED_MIND,
        };

        it('should accept valid request', () => {
            const result = validateCustomerCancellationRequest(baseRequest);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should reject missing delivery ID', () => {
            const request = { ...baseRequest, deliveryId: '' };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Delivery ID is required');
        });

        it('should reject whitespace-only delivery ID', () => {
            const request = { ...baseRequest, deliveryId: '   ' };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Delivery ID is required');
        });

        it('should reject missing customer ID', () => {
            const request = { ...baseRequest, customerId: '' };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Customer ID is required');
        });

        it('should reject missing reason', () => {
            const request = { ...baseRequest, reason: undefined as unknown as CustomerCancellationReason };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Cancellation reason is required');
        });

        it('should reject invalid reason', () => {
            const request = { ...baseRequest, reason: 'INVALID_REASON' as CustomerCancellationReason };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid cancellation reason');
        });

        it('should require details for OTHER reason', () => {
            const request = {
                ...baseRequest,
                reason: CustomerCancellationReason.OTHER,
                reasonDetails: undefined,
            };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Details required for OTHER reason');
        });

        it('should accept OTHER reason with details', () => {
            const request = {
                ...baseRequest,
                reason: CustomerCancellationReason.OTHER,
                reasonDetails: 'Custom cancellation reason',
            };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(true);
        });

        it('should accept optional customer name', () => {
            const request = {
                ...baseRequest,
                customerName: 'John Doe',
            };
            const result = validateCustomerCancellationRequest(request);
            expect(result.valid).toBe(true);
        });
    });

    describe('Cancellation Reason Formatting', () => {
        it('should format CHANGED_MIND', () => {
            expect(formatCustomerCancellationReason(CustomerCancellationReason.CHANGED_MIND))
                .toBe('Changed My Mind');
        });

        it('should format ORDERED_BY_MISTAKE', () => {
            expect(formatCustomerCancellationReason(CustomerCancellationReason.ORDERED_BY_MISTAKE))
                .toBe('Ordered by Mistake');
        });

        it('should format FOUND_ALTERNATIVE', () => {
            expect(formatCustomerCancellationReason(CustomerCancellationReason.FOUND_ALTERNATIVE))
                .toBe('Found Alternative');
        });

        it('should format PRICE_TOO_HIGH', () => {
            expect(formatCustomerCancellationReason(CustomerCancellationReason.PRICE_TOO_HIGH))
                .toBe('Price Too High');
        });

        it('should format TAKING_TOO_LONG', () => {
            expect(formatCustomerCancellationReason(CustomerCancellationReason.TAKING_TOO_LONG))
                .toBe('Taking Too Long');
        });

        it('should format OTHER', () => {
            expect(formatCustomerCancellationReason(CustomerCancellationReason.OTHER))
                .toBe('Other');
        });

        it('should format all valid reasons correctly', () => {
            const reasons = Object.values(CustomerCancellationReason);
            for (const reason of reasons) {
                const formatted = formatCustomerCancellationReason(reason);
                expect(formatted).not.toBe('Unknown');
                expect(typeof formatted).toBe('string');
                expect(formatted.length).toBeGreaterThan(0);
            }
        });

        it('should return Unknown for invalid reason', () => {
            expect(formatCustomerCancellationReason('INVALID' as CustomerCancellationReason))
                .toBe('Unknown');
        });
    });

    describe('Edge Cases', () => {
        it('should handle all delivery statuses', () => {
            const statuses = Object.values(DeliveryStatus);
            for (const status of statuses) {
                const result = canCustomerCancel(status);
                expect(typeof result.canCancel).toBe('boolean');
            }
        });

        it('should only allow cancellation for PENDING and ASSIGNED', () => {
            const cancellableStatuses = [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED];
            const nonCancellableStatuses = [
                DeliveryStatus.IN_TRANSIT,
                DeliveryStatus.ARRIVED,
                DeliveryStatus.DELIVERED,
                DeliveryStatus.CANCELLED,
            ];

            for (const status of cancellableStatuses) {
                expect(canCustomerCancel(status).canCancel).toBe(true);
            }

            for (const status of nonCancellableStatuses) {
                expect(canCustomerCancel(status).canCancel).toBe(false);
            }
        });
    });

    describe('Business Rule: No cancel after pickup', () => {
        it('should follow the rule: cannot cancel once parcel is picked up', () => {
            // Before pickup - can cancel
            expect(canCustomerCancel(DeliveryStatus.PENDING).canCancel).toBe(true);
            expect(canCustomerCancel(DeliveryStatus.ASSIGNED).canCancel).toBe(true);

            // After pickup - cannot cancel
            expect(canCustomerCancel(DeliveryStatus.IN_TRANSIT).canCancel).toBe(false);
            expect(canCustomerCancel(DeliveryStatus.ARRIVED).canCancel).toBe(false);
            expect(canCustomerCancel(DeliveryStatus.DELIVERED).canCancel).toBe(false);
        });
    });
});
