import { getFirebaseDatabase } from '../src/services/firebaseClient';
import { ref, set, push } from 'firebase/database';

// Usage: ts-node scripts/simulate_multiple_requests.ts <riderId>
const riderId = process.argv[2];

if (!riderId) {
    console.error('Please provide a riderId as an argument.');
    process.exit(1);
}

const db = getFirebaseDatabase();

async function simulateRequests() {
    console.log(`Simulating requests for rider: ${riderId}`);

    const requestsRef = ref(db, `rider_requests/${riderId}`);

    const request1 = {
        bookingId: `booking_${Date.now()}_1`,
        pickupLat: 14.5995,
        pickupLng: 120.9842,
        dropoffLat: 14.6095,
        dropoffLng: 121.0042,
        pickupAddress: 'Manila City Hall',
        dropoffAddress: 'SM Sta. Mesa',
        estimatedFare: 150,
        distance: 5.2,
        duration: 25,
        expiresAt: Date.now() + 60000, // 1 minute from now
        status: 'PENDING'
    };

    const request2 = {
        bookingId: `booking_${Date.now()}_2`,
        pickupLat: 14.5547,
        pickupLng: 121.0244,
        dropoffLat: 14.5647,
        dropoffLng: 121.0344,
        pickupAddress: 'Glorietta 4',
        dropoffAddress: 'Power Plant Mall',
        estimatedFare: 120,
        distance: 3.5,
        duration: 18,
        expiresAt: Date.now() + 60000,
        status: 'PENDING'
    };

    const request3 = {
        bookingId: `booking_${Date.now()}_3`,
        pickupLat: 14.6760,
        pickupLng: 121.0437,
        dropoffLat: 14.6860,
        dropoffLng: 121.0537,
        pickupAddress: 'UP Town Center',
        dropoffAddress: 'Ateneo de Manila',
        estimatedFare: 80,
        distance: 1.2,
        duration: 10,
        expiresAt: Date.now() + 60000,
        status: 'PENDING'
    };

    await push(requestsRef, request1);
    console.log('Sent Request 1');

    await push(requestsRef, request2);
    console.log('Sent Request 2');

    await push(requestsRef, request3);
    console.log('Sent Request 3');

    console.log('Done.');
    process.exit(0);
}

simulateRequests();
