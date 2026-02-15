/**
 * Rider Matching Service for Parcel-Safe
 * 
 * Handles geofenced rider matching with 3km radius,
 * finding nearby available riders and dispatching notifications.
 */

import { getFirebaseDatabase } from './firebaseClient';
import { ref, get, set, update, remove, onValue, off, onDisconnect, runTransaction } from 'firebase/database';
import { showIncomingOrderNotification } from './pushNotificationService';
import statusUpdateService from './statusUpdateService';
import { supabase } from './supabaseClient';

import { generateShareToken, generateOTP } from '../utils/tokenUtils';

// Search radius in kilometers (as per user requirement)
export const SEARCH_RADIUS_KM = 3;

// Earth's radius in kilometers (for Haversine formula)
const EARTH_RADIUS_KM = 6371;

// Request expiry time (30 seconds to accept/reject)
export const REQUEST_EXPIRY_MS = 30 * 1000;

/**
 * Rider location data structure
 */
export interface RiderLocation {
    riderId: string;
    lat: number;
    lng: number;
    pushToken: string | null;
    isAvailable: boolean;
    lastUpdated: number;
}

/**
 * Booking request structure
 */
export interface BookingRequest {
    bookingId: string;
    customerId: string;
    pickupLat: number;
    pickupLng: number;
    pickupAddress: string;
    dropoffLat: number;
    dropoffLng: number;
    dropoffAddress: string;
    estimatedFare: number;
    createdAt: number;
    shareToken?: string;
}

export interface DeliveryRecord {
    id: string;
    tracking_number: string;
    rider_id: string;
    rider_name?: string;
    rider_phone?: string;
    customer_id: string;
    box_id: string;
    pickup_lat: number;
    pickup_lng: number;
    pickup_address: string;
    dropoff_lat: number;
    dropoff_lng: number;
    dropoff_address: string;
    share_token: string;
    status: string;
    created_at: number;
    accepted_at?: number;
    updated_at?: number;
}

export interface RiderLiveLocation {
    lat: number;
    lng: number;
    lastUpdated: number;
}

export { generateShareToken };

/**
 * Rider order request structure (sent to rider)
 */
export interface RiderOrderRequest {
    bookingId: string;
    pickupAddress: string;
    dropoffAddress: string;
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    distanceToPickupKm: number;
    estimatedFare: number;
    expiresAt: number;
    customerId: string;
    distance?: number;
    duration?: number;
}

/**
 * Calculate distance between two points using Haversine formula
 * 
 * @param lat1 - Latitude of first point
 * @param lng1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lng2 - Longitude of second point
 * @returns Distance in kilometers
 */
export function calculateHaversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = EARTH_RADIUS_KM * c;

    return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Check if a rider is within the search radius
 */
export function isWithinRadius(
    riderLat: number,
    riderLng: number,
    pickupLat: number,
    pickupLng: number,
    radiusKm: number = SEARCH_RADIUS_KM
): boolean {
    const distance = calculateHaversineDistance(riderLat, riderLng, pickupLat, pickupLng);
    return distance <= radiusKm;
}

/**
 * Find all online riders within the search radius
 */
export async function findNearbyRiders(
    pickupLat: number,
    pickupLng: number,
    radiusKm: number = SEARCH_RADIUS_KM
): Promise<RiderLocation[]> {
    try {
        const db = getFirebaseDatabase();
        const snapshot = await get(ref(db, '/online_riders'));

        if (!snapshot.exists()) {
            return [];
        }

        const ridersData = snapshot.val();
        const nearbyRiders: RiderLocation[] = [];

        for (const [riderId, data] of Object.entries(ridersData)) {
            const riderData = data as any;

            // Skip unavailable riders
            if (!riderData.is_available) {
                continue;
            }

            // Check if within radius
            if (isWithinRadius(riderData.lat, riderData.lng, pickupLat, pickupLng, radiusKm)) {
                nearbyRiders.push({
                    riderId,
                    lat: riderData.lat,
                    lng: riderData.lng,
                    pushToken: riderData.push_token || null,
                    isAvailable: riderData.is_available,
                    lastUpdated: riderData.last_updated || Date.now(),
                });
            }
        }

        // Sort by distance (closest first)
        nearbyRiders.sort((a, b) => {
            const distA = calculateHaversineDistance(a.lat, a.lng, pickupLat, pickupLng);
            const distB = calculateHaversineDistance(b.lat, b.lng, pickupLat, pickupLng);
            return distA - distB;
        });

        return nearbyRiders;
    } catch (error) {
        console.error('Error finding nearby riders:', error);
        return [];
    }
}

/**
 * Create a pending booking in Firebase
 */
export async function createPendingBooking(request: BookingRequest): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        const shareToken = request.shareToken || generateShareToken();
        await set(ref(db, `/pending_bookings/${request.bookingId}`), {
            customer_id: request.customerId,
            pickup_lat: request.pickupLat,
            pickup_lng: request.pickupLng,
            pickup_address: request.pickupAddress,
            dropoff_lat: request.dropoffLat,
            dropoff_lng: request.dropoffLng,
            dropoff_address: request.dropoffAddress,
            estimated_fare: request.estimatedFare,
            status: 'SEARCHING',
            accepted_by: null,
            created_at: request.createdAt,
            share_token: shareToken,
        });

        await set(ref(db, `/share_tokens/${shareToken}`), {
            delivery_id: request.bookingId,
            created_at: request.createdAt,
        });

        // Sync to Supabase (Source of Truth)
        if (supabase) {
            const otpCode = generateOTP();
            const { error } = await supabase
                .from('deliveries')
                .insert({
                    id: request.bookingId,
                    tracking_number: request.bookingId, // Use bookingId as tracking number for now
                    customer_id: request.customerId,
                    pickup_lat: request.pickupLat,
                    pickup_lng: request.pickupLng,
                    pickup_address: request.pickupAddress,
                    dropoff_lat: request.dropoffLat,
                    dropoff_lng: request.dropoffLng,
                    dropoff_address: request.dropoffAddress,
                    estimated_fare: request.estimatedFare,
                    share_token: shareToken,
                    otp_code: otpCode,
                    status: 'PENDING',
                    created_at: new Date(request.createdAt).toISOString(),
                    updated_at: new Date(request.createdAt).toISOString(),
                });

            if (error) {
                console.error('[RiderMatching] Failed to create Supabase delivery:', error.message);
                // We don't block the flow here, but we should log it. 
                // In a robust system, we might want to fail the whole operation or queue it.
            } else {
                console.log('[RiderMatching] Created Supabase delivery:', request.bookingId);
            }
        }

        return true;
    } catch (error) {
        console.error('Error creating pending booking:', error);
        return false;
    }
}

/**
 * Send order request to a specific rider
 */
export async function sendOrderRequestToRider(
    riderId: string,
    request: RiderOrderRequest
): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await set(ref(db, `/rider_requests/${riderId}/${requestId}`), {
            booking_id: request.bookingId,
            pickup_address: request.pickupAddress,
            dropoff_address: request.dropoffAddress,
            pickup_lat: request.pickupLat,
            pickup_lng: request.pickupLng,
            dropoff_lat: request.dropoffLat,
            dropoff_lng: request.dropoffLng,
            distance_to_pickup_km: request.distanceToPickupKm,
            estimated_fare: request.estimatedFare,
            expires_at: request.expiresAt,
            customer_id: request.customerId,
            status: 'PENDING',
        });

        return true;
    } catch (error) {
        console.error('Error sending order request to rider:', error);
        return false;
    }
}

/**
 * Notify all nearby riders about a new booking
 */
export async function notifyNearbyRiders(
    booking: BookingRequest
): Promise<{ notifiedCount: number; riders: string[] }> {
    const nearbyRiders = await findNearbyRiders(
        booking.pickupLat,
        booking.pickupLng,
        SEARCH_RADIUS_KM
    );

    const notifiedRiders: string[] = [];

    for (const rider of nearbyRiders) {
        const distanceToPickup = calculateHaversineDistance(
            rider.lat,
            rider.lng,
            booking.pickupLat,
            booking.pickupLng
        );

        const orderRequest: RiderOrderRequest = {
            bookingId: booking.bookingId,
            pickupAddress: booking.pickupAddress,
            dropoffAddress: booking.dropoffAddress,
            pickupLat: booking.pickupLat,
            pickupLng: booking.pickupLng,
            dropoffLat: booking.dropoffLat,
            dropoffLng: booking.dropoffLng,
            distanceToPickupKm: distanceToPickup,
            estimatedFare: booking.estimatedFare,
            expiresAt: Date.now() + REQUEST_EXPIRY_MS,
            customerId: booking.customerId,
        };

        const success = await sendOrderRequestToRider(rider.riderId, orderRequest);

        if (success) {
            notifiedRiders.push(rider.riderId);

            // Also show local notification if this is the current device
            // In a real app, you'd send this via FCM to the rider's device
        }
    }

    // Store notified rider IDs in the pending booking so that acceptOrder()
    // can later cancel their requests when one rider wins the race.
    if (notifiedRiders.length > 0) {
        try {
            const db = getFirebaseDatabase();
            await update(ref(db, `/pending_bookings/${booking.bookingId}`), {
                notified_riders: notifiedRiders,
            });
        } catch (err) {
            console.error('[RiderMatching] Failed to store notified riders on booking:', err);
        }
    }

    return {
        notifiedCount: notifiedRiders.length,
        riders: notifiedRiders,
    };
}

/**
 * Accept an order as a rider (atomic via runTransaction to prevent race conditions)
 *
 * Uses Firebase runTransaction() on /pending_bookings/{bookingId} to guarantee
 * that only one rider can accept a booking even if multiple riders tap "Accept"
 * simultaneously. The losing rider(s) receive `false` so the UI can show
 * "This delivery was already accepted by another rider."
 */
export async function acceptOrder(
    riderId: string,
    bookingId: string,
    requestId: string,
    metadata?: {
        riderName?: string;
        riderPhone?: string;
        boxId?: string;
    }
): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        const bookingRef = ref(db, `/pending_bookings/${bookingId}`);
        const acceptedAt = Date.now();

        // --- Atomic claim via runTransaction ---
        // If two riders call this at the same time, Firebase will retry the
        // loser's handler with the updated data. The loser will see
        // status !== 'SEARCHING' and return `undefined` to abort.
        const txResult = await runTransaction(bookingRef, (currentData) => {
            if (!currentData) {
                // Booking no longer exists — abort
                return undefined;
            }
            if (currentData.status !== 'SEARCHING' || currentData.accepted_by) {
                // Already accepted by another rider — abort
                return undefined;
            }
            // Claim the booking for this rider
            return {
                ...currentData,
                status: 'ACCEPTED',
                accepted_by: riderId,
                accepted_at: acceptedAt,
            };
        });

        if (!txResult.committed) {
            // Transaction aborted — booking was already taken or missing
            console.log('[RiderMatching] Booking already taken or missing:', bookingId);
            return false;
        }

        // Transaction succeeded — this rider won the race.
        const booking = txResult.snapshot.val() as any;

        // Mark the request as accepted
        await update(ref(db, `/rider_requests/${riderId}/${requestId}`), {
            status: 'ACCEPTED',
        });

        // Mark rider as unavailable
        await update(ref(db, `/online_riders/${riderId}`), {
            is_available: false,
        });

        const shareToken = booking.share_token || generateShareToken();
        const deliveryRecord: DeliveryRecord = {
            id: bookingId,
            tracking_number: bookingId,
            rider_id: riderId,
            rider_name: metadata?.riderName || '',
            rider_phone: metadata?.riderPhone || '',
            customer_id: booking.customer_id,
            box_id: metadata?.boxId || '',
            pickup_lat: booking.pickup_lat,
            pickup_lng: booking.pickup_lng,
            pickup_address: booking.pickup_address,
            dropoff_lat: booking.dropoff_lat,
            dropoff_lng: booking.dropoff_lng,
            dropoff_address: booking.dropoff_address,
            share_token: shareToken,
            status: 'ASSIGNED',
            created_at: booking.created_at || acceptedAt,
            accepted_at: acceptedAt,
            updated_at: acceptedAt,
        };

        await set(ref(db, `/deliveries/${bookingId}`), deliveryRecord);

        await set(ref(db, `/share_tokens/${shareToken}`), {
            delivery_id: bookingId,
            created_at: booking.created_at || acceptedAt,
            updated_at: acceptedAt,
        });

        // Cancel other riders' pending requests for this booking
        const notifiedRiders: string[] = booking.notified_riders || [];
        await cancelOtherRiderRequests(bookingId, riderId, notifiedRiders);

        // Sync Accept to Supabase
        if (supabase) {
            const updates: any = {
                rider_id: riderId,
                rider_name: metadata?.riderName,
                rider_phone: metadata?.riderPhone,
                status: 'ASSIGNED',
                accepted_at: new Date(acceptedAt).toISOString(),
                updated_at: new Date(acceptedAt).toISOString(),
            };

            if (metadata?.boxId) {
                updates.box_id = metadata.boxId;
            }

            const { error } = await supabase
                .from('deliveries')
                .update(updates)
                .eq('id', bookingId);

            if (error) {
                console.error('[RiderMatching] Failed to update Supabase delivery on accept:', error.message);
            } else {
                console.log('[RiderMatching] Updated Supabase delivery on accept:', bookingId);
            }
        }

        return true;
    } catch (error) {
        console.error('Error accepting order:', error);
        return false;
    }
}

/**
 * Cancel other riders' pending requests after a booking has been accepted.
 *
 * Marks all PENDING requests for the given bookingId as 'TAKEN' so that
 * other riders' IncomingOrderModals can auto-dismiss with a clear message.
 */
async function cancelOtherRiderRequests(
    bookingId: string,
    acceptedRiderId: string,
    notifiedRiderIds: string[]
): Promise<void> {
    const db = getFirebaseDatabase();

    for (const riderId of notifiedRiderIds) {
        if (riderId === acceptedRiderId) continue;

        try {
            const requestsRef = ref(db, `/rider_requests/${riderId}`);
            const snapshot = await get(requestsRef);
            if (!snapshot.exists()) continue;

            const requests = snapshot.val();
            for (const [reqId, reqData] of Object.entries(requests as Record<string, any>)) {
                if (reqData.booking_id === bookingId && reqData.status === 'PENDING') {
                    await update(ref(db, `/rider_requests/${riderId}/${reqId}`), {
                        status: 'TAKEN',
                    });
                }
            }
        } catch (err) {
            console.error(`[RiderMatching] Failed to cancel request for rider ${riderId}:`, err);
            // Non-critical — continue with other riders
        }
    }
}

/**
 * Mark rider as available again (e.g. after delivery completes)
 */
export async function markRiderAvailable(riderId: string): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        await update(ref(db, `/online_riders/${riderId}`), {
            is_available: true,
        });
        console.log('[RiderMatching] Rider marked available:', riderId);
        return true;
    } catch (error) {
        console.error('[RiderMatching] Failed to mark rider available:', error);
        return false;
    }
}

/**
 * Reject an order as a rider
 */
export async function rejectOrder(
    riderId: string,
    requestId: string
): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        // Remove the request (or update status) (Logic in original was update status)
        await update(ref(db, `/rider_requests/${riderId}/${requestId}`), {
            status: 'REJECTED',
        });

        return true;
    } catch (error) {
        console.error('Error rejecting order:', error);
        return false;
    }
}

/**
 * Cancel a pending booking
 */
export async function cancelBooking(bookingId: string): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        await update(ref(db, `/pending_bookings/${bookingId}`), {
            status: 'CANCELLED',
            cancelled_at: Date.now(),
        });

        return true;
    } catch (error) {
        console.error('Error cancelling booking:', error);
        return false;
    }
}

/**
 * Subscribe to booking status changes (for customer)
 */
export function subscribeToBookingStatus(
    bookingId: string,
    callback: (status: string, riderId: string | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const statusRef = ref(db, `/pending_bookings/${bookingId}`);

    const unsubscribe = onValue(statusRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            callback(data.status, data.accepted_by || null);
        }
    });

    // Return unsubscribe function
    return () => off(statusRef);
}

export function subscribeToDelivery(
    deliveryId: string,
    callback: (delivery: DeliveryRecord | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const deliveryRef = ref(db, `/deliveries/${deliveryId}`);

    onValue(deliveryRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback(null);
            return;
        }
        callback(snapshot.val() as DeliveryRecord);
    });

    return () => off(deliveryRef);
}

export function subscribeToRiderLocation(
    riderId: string,
    callback: (location: RiderLiveLocation | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const riderRef = ref(db, `/online_riders/${riderId}`);

    onValue(riderRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback(null);
            return;
        }

        const data = snapshot.val() as any;
        if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
            callback(null);
            return;
        }

        callback({
            lat: data.lat,
            lng: data.lng,
            lastUpdated: data.last_updated || Date.now(),
        });
    });

    return () => off(riderRef);
}

export async function updateDeliveryStatus(
    deliveryId: string,
    status: string,
    additionalFields?: Record<string, unknown>
): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        await update(ref(db, `/deliveries/${deliveryId}`), {
            status,
            updated_at: Date.now(),
            ...(additionalFields || {}),
        });

        // Sync status to Supabase (Source of Truth)
        if (supabase) {
            const supabaseUpdates: Record<string, any> = {
                status,
                updated_at: new Date().toISOString(),
            };
            // Map common additional fields to Supabase columns
            if (additionalFields?.picked_up_at) {
                supabaseUpdates.picked_up_at = new Date(additionalFields.picked_up_at as number).toISOString();
            }
            if (additionalFields?.completed_at) {
                supabaseUpdates.delivered_at = new Date(additionalFields.completed_at as number).toISOString();
            }
            if (additionalFields?.proof_photo_url) {
                supabaseUpdates.proof_photo_url = additionalFields.proof_photo_url;
            }
            const { error: sbError } = await supabase
                .from('deliveries')
                .update(supabaseUpdates)
                .eq('id', deliveryId);
            if (sbError) {
                console.error('[updateDeliveryStatus] Supabase sync failed:', sbError.message);
                // Don't fail the whole operation — Firebase is already updated
            } else {
                console.log('[updateDeliveryStatus] Supabase synced:', deliveryId, status);
            }
        }

        return true;
    } catch (error) {
        console.error('Error updating delivery status:', error);

        // EC-35: Queue for retry when connectivity is restored.
        try {
            const fields = additionalFields || {};
            const candidateBoxId =
                (typeof (fields as any).boxId === 'string' && (fields as any).boxId) ||
                (typeof (fields as any).box_id === 'string' && (fields as any).box_id) ||
                (typeof (fields as any).status_retry_box_id === 'string' && (fields as any).status_retry_box_id) ||
                'UNKNOWN_BOX';

            await statusUpdateService.queueStatusUpdate(deliveryId, candidateBoxId, status);
        } catch (queueError) {
            console.error('[EC35] Failed to queue status update:', queueError);
        }

        return false;
    }
}

/**
 * Subscribe to incoming order requests (for rider)
 */
export function subscribeToRiderRequests(
    riderId: string,
    callback: (requests: Array<{ requestId: string; data: RiderOrderRequest }>) => void
): () => void {
    const db = getFirebaseDatabase();
    const requestsRef = ref(db, `/rider_requests/${riderId}`);

    const unsubscribe = onValue(requestsRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback([]);
            return;
        }

        const requestsData = snapshot.val();
        const requests: Array<{ requestId: string; data: RiderOrderRequest }> = [];

        for (const [requestId, data] of Object.entries(requestsData)) {
            const requestData = data as any;

            // Only include pending requests that haven't expired
            if (requestData.status === 'PENDING' && requestData.expires_at > Date.now()) {
                requests.push({
                    requestId,
                    data: {
                        bookingId: requestData.booking_id,
                        pickupAddress: requestData.pickup_address,
                        dropoffAddress: requestData.dropoff_address,
                        pickupLat: requestData.pickup_lat,
                        pickupLng: requestData.pickup_lng,
                        dropoffLat: requestData.dropoff_lat,
                        dropoffLng: requestData.dropoff_lng,
                        distanceToPickupKm: requestData.distance_to_pickup_km,
                        estimatedFare: requestData.estimated_fare,
                        expiresAt: requestData.expires_at,
                        customerId: requestData.customer_id,
                    },
                });
            }
        }

        callback(requests);
    });

    // Return unsubscribe function
    return () => off(requestsRef);
}

/**
 * Update rider's online status and location
 */
export async function updateRiderStatus(
    riderId: string,
    lat: number,
    lng: number,
    isAvailable: boolean,
    pushToken?: string
): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        const updateData: any = {
            lat,
            lng,
            is_available: isAvailable,
            last_updated: Date.now(),
        };

        if (pushToken) {
            updateData.push_token = pushToken;
        }

        const riderRef = ref(db, `/online_riders/${riderId}`);
        await set(riderRef, updateData);

        // EC-ENHANCE: Ensure rider is removed if they disconnect unexpectedly (Deadman Switch)
        // This prevents "Zombie Riders" who are offline but still receiving orders
        if (isAvailable) {
            await onDisconnect(riderRef).remove();
        } else {
            // If explicitly setting to unavailable, cancel the onDisconnect op
            await onDisconnect(riderRef).cancel();
        }

        return true;
    } catch (error) {
        console.error('Error updating rider status:', error);
        return false;
    }
}

/**
 * Remove rider from online list (when going offline)
 */
export async function removeRiderFromOnline(riderId: string): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        const riderRef = ref(db, `/online_riders/${riderId}`);

        // Remove immediately
        await remove(riderRef);

        // Cancel the onDisconnect listener since we've handled it manually
        await onDisconnect(riderRef).cancel();

        return true;
    } catch (error) {
        console.error('Error removing rider from online list:', error);
        return false;
    }
}
/**
 * Subscribe to box location updates (for real-time parcel tracking)
 */
export function subscribeToBoxLocation(
    boxId: string,
    callback: (location: { lat: number; lng: number; heading?: number; lastUpdated?: number } | null) => void
): () => void {
    const db = getFirebaseDatabase();
    // Assuming box location is stored at /boxes/{boxId}/location based on rule book and usage
    const boxRef = ref(db, `/boxes/${boxId}/location`);

    const unsubscribe = onValue(boxRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback(null);
            return;
        }

        const data = snapshot.val();
        if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
            callback(null);
            return;
        }

        callback({
            lat: data.lat,
            lng: data.lng,
            heading: data.heading,
            lastUpdated: data.last_updated || Date.now(), // Fallback if not provided by hardware
        });
    });

    return () => off(boxRef);
}

export interface RiderProfile {
    id: string;
    full_name: string;
    avatar_url: string | null;
    rating?: number;
}

/**
 * Fetch rider profile from Supabase
 */
export async function getRiderProfile(riderId: string): Promise<RiderProfile | null> {
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url, rating')
            .eq('id', riderId)
            .single();

        if (error) {
            console.error('Error fetching rider profile:', error);
            return null;
        }

        return data as RiderProfile;
    } catch (error) {
        console.error('Error in getRiderProfile:', error);
        return null;
    }
}

/**
 * Checks for any active booking for the current user.
 * Returns the booking details if found, or null otherwise.
 */
export async function checkActiveBookings(userId: string): Promise<any | null> {
    try {
        // 1. Check for Pending Bookings (in Firebase)
        // These are bookings that are "Searching for Riders"
        const db = getFirebaseDatabase();
        const pendingRef = ref(db, `pending_bookings`);
        const pendingSnapshot = await get(pendingRef);

        if (pendingSnapshot.exists()) {
            const bookings = pendingSnapshot.val();
            // Iterate to find a booking for this user
            for (const key in bookings) {
                const b = bookings[key];
                if (b.customer_id === userId && (b.status === 'SEARCHING' || b.status === 'ACCEPTED')) {
                    // Check if it's not stale (e.g. older than 10 mins for SEARCHING)
                    const createdAt = b.created_at;
                    const now = Date.now();
                    if (b.status === 'ACCEPTED' || (now - createdAt < 10 * 60 * 1000)) {
                        return {
                            bookingId: key,
                            customerId: b.customer_id,
                            pickupAddress: b.pickup_address,
                            dropoffAddress: b.dropoff_address,
                            pickupLat: b.pickup_lat,
                            pickupLng: b.pickup_lng,
                            dropoffLat: b.dropoff_lat,
                            dropoffLng: b.dropoff_lng,
                            estimatedFare: b.estimated_fare,
                            shareToken: b.share_token,
                            riderId: b.accepted_by || null,
                            status: b.status === 'SEARCHING' ? 'PENDING' : b.status,
                        };
                    }
                }
            }
        }

        // 2. Check for Active Deliveries (in Supabase/PostgreSQL)
        // These are bookings that have been created or accepted by a rider
        if (supabase) {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*')
                .eq('customer_id', userId)
                .in('status', ['PENDING', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED'])
                .order('created_at', { ascending: false })
                .limit(1);

            if (!error && data && data.length > 0) {
                const delivery = data[0];
                return {
                    bookingId: delivery.id,
                    riderId: delivery.rider_id,
                    shareToken: delivery.share_token,
                    status: delivery.status,
                    // Map other fields as needed for restoration
                    pickupLat: delivery.pickup_lat,
                    pickupLng: delivery.pickup_lng,
                    dropoffLat: delivery.dropoff_lat,
                    dropoffLng: delivery.dropoff_lng,
                    estimatedFare: delivery.estimated_fare
                };
            }
        }

        return null;
    } catch (error) {
        console.error('Error checking active bookings:', error);
        return null;
    }
}
