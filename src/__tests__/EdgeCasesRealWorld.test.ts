/**
 * Real-World Edge Case Tests
 * 
 * Tests for scenarios you'll actually encounter based on:
 * - EDGE_CASES.md: EC-01 to EC-20
 * - USE_CASES.md: Complex user journeys
 * - Actual production scenarios
 * 
 * CRITICAL: These are the scenarios that break systems in production
 */

// ============ CONSTANTS ============
const MAX_SIMULTANEOUS_DELIVERIES_PER_RIDER = 5;
const MAX_RETRY_ATTEMPTS = 3;
const ETA_RECALCULATION_THRESHOLD_M = 500; // Recalculate ETA if deviated by 500m
const SUSPICIOUS_DISTANCE_THRESHOLD_M = 5000; // 5km in a short time
const MIN_TIME_BETWEEN_DELIVERIES_MS = 60000; // 1 minute minimum

// ============ TYPES ============
interface RiderDelivery {
    id: string;
    status: string;
    priority: number;
    estimatedArrivalAt: number;
    assignedAt: number;
    dropoffLat: number;
    dropoffLng: number;
}

interface LocationUpdate {
    lat: number;
    lng: number;
    timestamp: number;
    accuracy: number;
    speed: number;
}

interface DeliveryAttempt {
    deliveryId: string;
    attemptNumber: number;
    timestamp: number;
    result: 'SUCCESS' | 'FAILED' | 'REATTEMPT';
    reason?: string;
}

interface RouteDeviation {
    expectedLat: number;
    expectedLng: number;
    actualLat: number;
    actualLng: number;
    deviationMeters: number;
}

// ============ HELPER FUNCTIONS ============
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ============ MULTI-DELIVERY HANDLING ============
function canAcceptNewDelivery(currentDeliveries: RiderDelivery[]): boolean {
    const activeCount = currentDeliveries.filter(d =>
        d.status !== 'COMPLETED' && d.status !== 'CANCELLED'
    ).length;
    return activeCount < MAX_SIMULTANEOUS_DELIVERIES_PER_RIDER;
}

function getNextDelivery(deliveries: RiderDelivery[]): RiderDelivery | null {
    const pending = deliveries
        .filter(d => d.status === 'ASSIGNED' || d.status === 'IN_TRANSIT')
        .sort((a, b) => {
            // Priority first (lower = higher priority)
            if (a.priority !== b.priority) return a.priority - b.priority;
            // Then by ETA
            return a.estimatedArrivalAt - b.estimatedArrivalAt;
        });

    return pending[0] || null;
}

function reorderDeliveries(
    deliveries: RiderDelivery[],
    riderLat: number,
    riderLng: number
): RiderDelivery[] {
    return [...deliveries]
        .filter(d => d.status !== 'COMPLETED' && d.status !== 'CANCELLED')
        .map(d => ({
            ...d,
            _distance: calculateDistance(riderLat, riderLng, d.dropoffLat, d.dropoffLng),
        }))
        .sort((a, b) => {
            // High priority always first
            if (a.priority === 0 || b.priority === 0) {
                return a.priority - b.priority;
            }
            // Otherwise by distance
            return (a as { _distance: number })._distance - (b as { _distance: number })._distance;
        });
}

// ============ DELIVERY ATTEMPT HANDLING ============
function canReattemptDelivery(attempts: DeliveryAttempt[]): boolean {
    const failedAttempts = attempts.filter(a => a.result === 'FAILED').length;
    return failedAttempts < MAX_RETRY_ATTEMPTS;
}

function getAttemptCount(attempts: DeliveryAttempt[], deliveryId: string): number {
    return attempts.filter(a => a.deliveryId === deliveryId).length;
}

function shouldEscalateToSupport(attempts: DeliveryAttempt[]): boolean {
    const failedAttempts = attempts.filter(a => a.result === 'FAILED');

    // Escalate if multiple failures with same reason
    const reasonCounts = new Map<string, number>();
    for (const attempt of failedAttempts) {
        if (attempt.reason) {
            reasonCounts.set(attempt.reason, (reasonCounts.get(attempt.reason) || 0) + 1);
        }
    }

    for (const count of reasonCounts.values()) {
        if (count >= 2) return true;
    }

    return failedAttempts.length >= MAX_RETRY_ATTEMPTS;
}

// ============ LOCATION ANOMALY DETECTION ============
function detectLocationAnomaly(updates: LocationUpdate[]): boolean {
    if (updates.length < 2) return false;

    for (let i = 1; i < updates.length; i++) {
        const prev = updates[i - 1];
        const curr = updates[i];
        const timeDelta = (curr.timestamp - prev.timestamp) / 1000; // seconds
        const distance = calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);

        if (timeDelta <= 0) return true; // Time went backwards
        if (timeDelta < 1 && distance > 100) return true; // Impossible speed

        const speedMps = distance / timeDelta;
        if (speedMps > 55.56) return true; // > 200 km/h
    }

    return false;
}

function shouldRecalculateEta(
    expectedRoute: { lat: number; lng: number }[],
    currentLocation: LocationUpdate
): boolean {
    if (expectedRoute.length === 0) return true;

    // Find minimum distance to expected route
    let minDistance = Infinity;
    for (const point of expectedRoute) {
        const dist = calculateDistance(
            currentLocation.lat,
            currentLocation.lng,
            point.lat,
            point.lng
        );
        if (dist < minDistance) minDistance = dist;
    }

    return minDistance > ETA_RECALCULATION_THRESHOLD_M;
}

function isSuspiciousJump(prev: LocationUpdate, curr: LocationUpdate): boolean {
    const timeDelta = curr.timestamp - prev.timestamp;
    const distance = calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);

    // Suspicious if moved > 5km in < 5 minutes
    if (distance > SUSPICIOUS_DISTANCE_THRESHOLD_M && timeDelta < 5 * 60 * 1000) {
        return true;
    }

    return false;
}

// ============ RAPID DELIVERY DETECTION ============
function isRapidDelivery(
    completedAt: number,
    nextAssignedAt: number
): boolean {
    return (nextAssignedAt - completedAt) < MIN_TIME_BETWEEN_DELIVERIES_MS;
}

function detectDeliveryChurning(
    deliveryTimes: { startedAt: number; completedAt: number }[]
): boolean {
    // Detect if rider is gaming the system with impossibly fast deliveries
    const suspiciousCount = deliveryTimes.filter(d => {
        const duration = d.completedAt - d.startedAt;
        return duration < 30000; // < 30 seconds
    }).length;

    return suspiciousCount >= 3; // 3 or more suspicious deliveries
}

// ============ CONCURRENT OTP ATTEMPTS ============
function resolveConcurrentOtpAttempts(
    attempts: { riderId: string; timestamp: number; otp: string }[],
    validOtp: string
): { allowed: string | null; reason: string } {
    // Sort by timestamp
    const sorted = [...attempts].sort((a, b) => a.timestamp - b.timestamp);

    // Find first valid attempt
    const validAttempt = sorted.find(a => a.otp === validOtp);

    if (!validAttempt) {
        return { allowed: null, reason: 'No valid OTP provided' };
    }

    // Check for concurrent attempts within 1 second
    const nearbyAttempts = sorted.filter(a =>
        Math.abs(a.timestamp - validAttempt.timestamp) < 1000
    );

    if (nearbyAttempts.length > 1) {
        // Multiple riders tried at same time
        return {
            allowed: validAttempt.riderId,
            reason: 'Concurrent attempt resolved by timestamp',
        };
    }

    return { allowed: validAttempt.riderId, reason: 'Single valid attempt' };
}

// ============ TESTS ============
describe('EC-01: Multiple Simultaneous Deliveries', () => {
    test('should allow new delivery when under limit', () => {
        const deliveries: RiderDelivery[] = [
            { id: '1', status: 'IN_TRANSIT', priority: 1, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
            { id: '2', status: 'ASSIGNED', priority: 1, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
        ];
        expect(canAcceptNewDelivery(deliveries)).toBe(true);
    });

    test('should reject new delivery at limit', () => {
        const deliveries: RiderDelivery[] = Array.from({ length: 5 }, (_, i) => ({
            id: String(i),
            status: 'IN_TRANSIT',
            priority: 1,
            estimatedArrivalAt: 0,
            assignedAt: 0,
            dropoffLat: 0,
            dropoffLng: 0,
        }));
        expect(canAcceptNewDelivery(deliveries)).toBe(false);
    });

    test('should not count completed/cancelled deliveries', () => {
        const deliveries: RiderDelivery[] = [
            { id: '1', status: 'COMPLETED', priority: 1, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
            { id: '2', status: 'CANCELLED', priority: 1, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
            { id: '3', status: 'IN_TRANSIT', priority: 1, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
        ];
        expect(canAcceptNewDelivery(deliveries)).toBe(true);
    });
});

describe('EC-02: Delivery Prioritization', () => {
    const NOW = Date.now();

    test('should prioritize by priority then ETA', () => {
        const deliveries: RiderDelivery[] = [
            { id: '1', status: 'IN_TRANSIT', priority: 2, estimatedArrivalAt: NOW + 5000, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
            { id: '2', status: 'IN_TRANSIT', priority: 1, estimatedArrivalAt: NOW + 10000, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
            { id: '3', status: 'IN_TRANSIT', priority: 2, estimatedArrivalAt: NOW + 3000, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
        ];

        const next = getNextDelivery(deliveries);
        expect(next?.id).toBe('2'); // Highest priority wins
    });

    test('should skip completed deliveries', () => {
        const deliveries: RiderDelivery[] = [
            { id: '1', status: 'COMPLETED', priority: 0, estimatedArrivalAt: NOW, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
            { id: '2', status: 'IN_TRANSIT', priority: 1, estimatedArrivalAt: NOW + 5000, assignedAt: 0, dropoffLat: 0, dropoffLng: 0 },
        ];

        const next = getNextDelivery(deliveries);
        expect(next?.id).toBe('2');
    });
});

describe('EC-03: Delivery Re-attempts', () => {
    const NOW = Date.now();

    test('should allow re-attempt when under limit', () => {
        const attempts: DeliveryAttempt[] = [
            { deliveryId: 'del-1', attemptNumber: 1, timestamp: NOW - 60000, result: 'FAILED', reason: 'Customer unavailable' },
        ];
        expect(canReattemptDelivery(attempts)).toBe(true);
    });

    test('should reject re-attempt at limit', () => {
        const attempts: DeliveryAttempt[] = Array.from({ length: 3 }, (_, i) => ({
            deliveryId: 'del-1',
            attemptNumber: i + 1,
            timestamp: NOW - (3 - i) * 60000,
            result: 'FAILED' as const,
            reason: 'Customer unavailable',
        }));
        expect(canReattemptDelivery(attempts)).toBe(false);
    });

    test('should escalate after multiple failures with same reason', () => {
        const attempts: DeliveryAttempt[] = [
            { deliveryId: 'del-1', attemptNumber: 1, timestamp: NOW - 120000, result: 'FAILED', reason: 'Gate locked' },
            { deliveryId: 'del-1', attemptNumber: 2, timestamp: NOW - 60000, result: 'FAILED', reason: 'Gate locked' },
        ];
        expect(shouldEscalateToSupport(attempts)).toBe(true);
    });

    test('should NOT escalate for different failure reasons', () => {
        const attempts: DeliveryAttempt[] = [
            { deliveryId: 'del-1', attemptNumber: 1, timestamp: NOW - 60000, result: 'FAILED', reason: 'Gate locked' },
            { deliveryId: 'del-1', attemptNumber: 2, timestamp: NOW, result: 'FAILED', reason: 'No answer' },
        ];
        expect(shouldEscalateToSupport(attempts)).toBe(false);
    });
});

describe('EC-04: Location Anomaly Detection', () => {
    const NOW = Date.now();

    test('should detect impossible speed', () => {
        const updates: LocationUpdate[] = [
            { lat: 14.5995, lng: 120.9842, timestamp: NOW - 1000, accuracy: 10, speed: 5 },
            { lat: 14.6995, lng: 120.9842, timestamp: NOW, accuracy: 10, speed: 5 }, // ~11km jump in 1 second
        ];
        expect(detectLocationAnomaly(updates)).toBe(true);
    });

    test('should detect time going backwards', () => {
        const updates: LocationUpdate[] = [
            { lat: 14.5995, lng: 120.9842, timestamp: NOW, accuracy: 10, speed: 5 },
            { lat: 14.5996, lng: 120.9842, timestamp: NOW - 1000, accuracy: 10, speed: 5 },
        ];
        expect(detectLocationAnomaly(updates)).toBe(true);
    });

    test('should accept normal movement', () => {
        const updates: LocationUpdate[] = [
            { lat: 14.5995, lng: 120.9842, timestamp: NOW - 10000, accuracy: 10, speed: 5 },
            { lat: 14.5996, lng: 120.9843, timestamp: NOW, accuracy: 10, speed: 5 }, // ~14m in 10s = 1.4m/s
        ];
        expect(detectLocationAnomaly(updates)).toBe(false);
    });

    test('should detect suspicious location jump', () => {
        const prev: LocationUpdate = { lat: 14.5995, lng: 120.9842, timestamp: NOW - 60000, accuracy: 10, speed: 5 };
        const curr: LocationUpdate = { lat: 14.6500, lng: 120.9842, timestamp: NOW, accuracy: 10, speed: 5 }; // ~5.6km in 1 min

        expect(isSuspiciousJump(prev, curr)).toBe(true);
    });
});

describe('EC-05: Route Deviation', () => {
    test('should detect significant deviation', () => {
        const expectedRoute = [
            { lat: 14.5995, lng: 120.9842 },
            { lat: 14.6000, lng: 120.9850 },
            { lat: 14.6005, lng: 120.9860 },
        ];
        const currentLocation: LocationUpdate = {
            lat: 14.6100, // ~1km off route
            lng: 120.9900,
            timestamp: Date.now(),
            accuracy: 10,
            speed: 5,
        };

        expect(shouldRecalculateEta(expectedRoute, currentLocation)).toBe(true);
    });

    test('should NOT recalculate for on-route location', () => {
        const expectedRoute = [
            { lat: 14.5995, lng: 120.9842 },
            { lat: 14.6000, lng: 120.9850 },
        ];
        const currentLocation: LocationUpdate = {
            lat: 14.5997, // ~22m from first point
            lng: 120.9844,
            timestamp: Date.now(),
            accuracy: 10,
            speed: 5,
        };

        expect(shouldRecalculateEta(expectedRoute, currentLocation)).toBe(false);
    });
});

describe('EC-06: Rapid Delivery Detection (Fraud Prevention)', () => {
    const NOW = Date.now();

    test('should detect rapid delivery assignment', () => {
        expect(isRapidDelivery(NOW, NOW + 30000)).toBe(true); // 30 seconds
    });

    test('should accept normal delivery spacing', () => {
        expect(isRapidDelivery(NOW, NOW + 120000)).toBe(false); // 2 minutes
    });

    test('should detect delivery churning', () => {
        const deliveryTimes = [
            { startedAt: NOW - 300000, completedAt: NOW - 290000 }, // 10 seconds
            { startedAt: NOW - 200000, completedAt: NOW - 185000 }, // 15 seconds
            { startedAt: NOW - 100000, completedAt: NOW - 80000 },  // 20 seconds
        ];
        expect(detectDeliveryChurning(deliveryTimes)).toBe(true);
    });

    test('should NOT flag legitimate deliveries', () => {
        const deliveryTimes = [
            { startedAt: NOW - 600000, completedAt: NOW - 300000 }, // 5 minutes
            { startedAt: NOW - 250000, completedAt: NOW - 100000 }, // 2.5 minutes
        ];
        expect(detectDeliveryChurning(deliveryTimes)).toBe(false);
    });
});

describe('EC-07: Concurrent OTP Attempts', () => {
    const NOW = Date.now();

    test('should resolve to first valid attempt', () => {
        const attempts = [
            { riderId: 'rider-2', timestamp: NOW + 100, otp: '123456' },
            { riderId: 'rider-1', timestamp: NOW, otp: '123456' },
        ];

        const result = resolveConcurrentOtpAttempts(attempts, '123456');
        expect(result.allowed).toBe('rider-1');
    });

    test('should reject all invalid attempts', () => {
        const attempts = [
            { riderId: 'rider-1', timestamp: NOW, otp: '111111' },
            { riderId: 'rider-2', timestamp: NOW + 100, otp: '222222' },
        ];

        const result = resolveConcurrentOtpAttempts(attempts, '123456');
        expect(result.allowed).toBe(null);
    });

    test('should handle concurrent attempts from multiple riders', () => {
        const attempts = [
            { riderId: 'rider-1', timestamp: NOW, otp: '123456' },
            { riderId: 'rider-2', timestamp: NOW + 500, otp: '123456' }, // Within 1 second
        ];

        const result = resolveConcurrentOtpAttempts(attempts, '123456');
        expect(result.allowed).toBe('rider-1');
        expect(result.reason).toContain('Concurrent');
    });
});

describe('EC-08: Delivery Reordering by Distance', () => {
    test('should reorder by distance but respect priority', () => {
        const deliveries: RiderDelivery[] = [
            { id: 'far-urgent', status: 'IN_TRANSIT', priority: 0, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 14.7000, dropoffLng: 120.9842 },
            { id: 'near', status: 'IN_TRANSIT', priority: 1, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 14.6000, dropoffLng: 120.9842 },
            { id: 'far', status: 'IN_TRANSIT', priority: 1, estimatedArrivalAt: 0, assignedAt: 0, dropoffLat: 14.7000, dropoffLng: 120.9842 },
        ];

        const riderLocation = { lat: 14.5995, lng: 120.9842 };
        const reordered = reorderDeliveries(deliveries, riderLocation.lat, riderLocation.lng);

        expect(reordered[0].id).toBe('far-urgent'); // Priority 0 first despite distance
        expect(reordered[1].id).toBe('near'); // Nearest among priority 1
    });
});
