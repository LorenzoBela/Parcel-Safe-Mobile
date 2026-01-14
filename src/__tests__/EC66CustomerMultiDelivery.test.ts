/**
 * EC-66: Customer Multi-Delivery Tests (Mobile)
 * 
 * Tests for multi-delivery handling when customer has orders from multiple riders.
 * Based on EDGE_CASES.md EC-66 specification.
 */

import {
    hasMultipleActiveDeliveries,
    formatMultiDeliveryMessage,
    getDistinctOtpCodes,
    MULTI_DELIVERY_CONFIG,
    MultiDeliveryContext,
    RiderDeliveryInfo,
    DeliveryStatus,
} from '../services/firebaseClient';

// Helper to create mock delivery info
const createRiderDelivery = (overrides: Partial<RiderDeliveryInfo>): RiderDeliveryInfo => ({
    deliveryId: `delivery_${Math.random().toString(36).substr(2, 9)}`,
    customerId: 'customer_001',
    customerName: 'John Customer',
    boxId: 'box_001',
    otpCode: '123456',
    status: 'IN_TRANSIT' as DeliveryStatus,
    dropoffLat: 10.0,
    dropoffLng: 10.0,
    isSameDestinationGroup: false,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now(),
    ...overrides,
});

// Helper to create mock multi-delivery context
const createMultiDeliveryContext = (overrides: Partial<MultiDeliveryContext>): MultiDeliveryContext => ({
    customerId: 'customer_001',
    customerName: 'John Customer',
    totalActiveDeliveries: 2,
    myDeliveryIndex: 1,
    otherRiders: [
        { riderId: 'rider_002', riderName: 'Jane Rider', status: 'IN_TRANSIT' as DeliveryStatus },
    ],
    ...overrides,
});

describe('EC-66: Customer Multi-Delivery Tracking (Mobile)', () => {

    // ============ Multi-Delivery Detection ============

    describe('Multi-Delivery Detection', () => {
        test('Detects multiple active deliveries', () => {
            const context = createMultiDeliveryContext({ totalActiveDeliveries: 2 });
            expect(hasMultipleActiveDeliveries(context)).toBe(true);
        });

        test('Returns false for single delivery', () => {
            const context = createMultiDeliveryContext({ totalActiveDeliveries: 1, otherRiders: [] });
            expect(hasMultipleActiveDeliveries(context)).toBe(false);
        });

        test('Returns false for null context', () => {
            expect(hasMultipleActiveDeliveries(null)).toBe(false);
        });
    });

    // ============ Message Formatting ============

    describe('Multi-Delivery Message Formatting', () => {
        test('Returns empty string for single delivery', () => {
            const context = createMultiDeliveryContext({ totalActiveDeliveries: 1, otherRiders: [] });
            expect(formatMultiDeliveryMessage(context)).toBe('');
        });

        test('Shows single other rider message', () => {
            const context = createMultiDeliveryContext({
                totalActiveDeliveries: 2,
                otherRiders: [{ riderId: 'r2', riderName: 'Jane', status: 'IN_TRANSIT' }],
            });
            const message = formatMultiDeliveryMessage(context);
            expect(message).toContain('Another rider');
            expect(message).toContain('Jane');
        });

        test('Shows multiple riders message', () => {
            const context = createMultiDeliveryContext({
                totalActiveDeliveries: 3,
                otherRiders: [
                    { riderId: 'r2', riderName: 'Jane', status: 'IN_TRANSIT' },
                    { riderId: 'r3', riderName: 'Bob', status: 'ARRIVED' },
                ],
            });
            const message = formatMultiDeliveryMessage(context);
            expect(message).toContain('2 other riders');
        });
    });

    // ============ OTP Separation ============

    describe('Separate OTPs per Delivery', () => {
        test('Gets distinct OTP codes', () => {
            const deliveries: RiderDeliveryInfo[] = [
                createRiderDelivery({ deliveryId: 'd1', otpCode: '111111' }),
                createRiderDelivery({ deliveryId: 'd2', otpCode: '222222' }),
            ];

            const otpMap = getDistinctOtpCodes(deliveries);
            expect(otpMap.size).toBe(2);
            expect(otpMap.get('d1')).toBe('111111');
            expect(otpMap.get('d2')).toBe('222222');
        });

        test('Handles deliveries without OTP', () => {
            const deliveries: RiderDeliveryInfo[] = [
                createRiderDelivery({ deliveryId: 'd1', otpCode: '123456' }),
                createRiderDelivery({ deliveryId: 'd2', otpCode: '' }),
            ];

            const otpMap = getDistinctOtpCodes(deliveries);
            expect(otpMap.size).toBe(1);
        });
    });

    // ============ Configuration Values ============

    describe('Multi-Delivery Configuration', () => {
        test('Notification group window is 5 minutes', () => {
            expect(MULTI_DELIVERY_CONFIG.NOTIFICATION_GROUP_WINDOW_MS).toBe(300000);
        });

        test('Max visible deliveries is 5', () => {
            expect(MULTI_DELIVERY_CONFIG.MAX_VISIBLE_DELIVERIES).toBe(5);
        });
    });
});
