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

// Request expiry time (2 minutes to accept/reject - to account for clock skew)
export const REQUEST_EXPIRY_MS = 120 * 1000;

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
    distance?: number; // EC-Fix: Added for rider preview (km)
    duration?: number; // EC-Fix: Added for rider preview (min)
    customerName?: string; // EC-Fix: Added for rider preview
    senderName?: string;
    senderPhone?: string;
    recipientName?: string;
    recipientPhone?: string;
    deliveryNotes?: string;
    snappedPickupLat?: number;
    snappedPickupLng?: number;
    snappedDropoffLat?: number;
    snappedDropoffLng?: number;
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
    snapped_pickup_lat?: number;
    snapped_pickup_lng?: number;
    snapped_dropoff_lat?: number;
    snapped_dropoff_lng?: number;
    accepted_at?: number;
    updated_at?: number;
    proof_photo_url?: string;
    pickup_photo_url?: string;
    picked_up_at?: string;
    delivered_at?: string;
    estimated_fare?: number;
    rating?: number;
    distance?: number;
    recipient_name?: string;
    sender_name?: string;
    sender_phone?: string;
    arrived_at?: number | string;
    cancellation_reason?: string;
}

export interface RiderLiveLocation {
    lat: number;
    lng: number;
    lastUpdated: number;
}

export { generateShareToken };

/**
 * Ensure a user profile exists in Supabase before inserting a delivery.
 * This prevents FK constraint violations on customer_id / rider_id.
 */
async function ensureProfileExists(userId: string): Promise<void> {
    if (!supabase || !userId) return;
    try {
        const { data } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', userId)
            .maybeSingle();

        if (!data) {
            // Profile doesn't exist -- create a minimal placeholder
            const { error } = await supabase
                .from('profiles')
                .upsert({
                    id: userId,
                    email: `${userId}@placeholder.local`,
                    role: 'CUSTOMER',
                    full_name: null,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'id' });

            if (error) {
                console.warn('[ensureProfileExists] Could not create placeholder profile:', error.message);
            } else {
                console.log('[Profile] Created placeholder profile for:', userId);
            }
        }
    } catch (err) {
        console.warn('[ensureProfileExists] Check failed:', err);
    }
}

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
    customerName?: string;
    senderName?: string;
    senderPhone?: string;
    recipientName?: string;
    recipientPhone?: string;
    deliveryNotes?: string;
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

        console.log(`[Booking] Found ${Object.keys(ridersData).length} total riders in /online_riders`);
        const nearbyRiders: RiderLocation[] = [];

        for (const [riderId, data] of Object.entries(ridersData)) {
            const riderData = data as any;

            // Debug Log for every rider
            console.log(`[Booking] Checking Rider ${riderId}: Available=${riderData.is_available}, Lat=${riderData.lat}, Lng=${riderData.lng}, LastUpdated=${riderData.last_updated}`);

            // Skip unavailable riders
            if (!riderData.is_available) {
                console.log(`[Booking] Skipping Rider ${riderId} - Not Available`);
                continue;
            }

            // Check if within radius
            const isInside = isWithinRadius(riderData.lat, riderData.lng, pickupLat, pickupLng, radiusKm);

            console.log(`[Booking] Rider ${riderId} isInside=${isInside}`);

            if (isInside) {
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

        console.log(`[Booking] findNearbyRiders returning ${nearbyRiders.length} riders`);
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
            customer_name: request.customerName, // EC-Fix: Store for good measure, though mostly passed via request
            sender_name: request.senderName,
            sender_phone: request.senderPhone,
            recipient_name: request.recipientName,
            recipient_phone: request.recipientPhone,
            delivery_notes: request.deliveryNotes,
            snapped_pickup_lat: request.snappedPickupLat || null,
            snapped_pickup_lng: request.snappedPickupLng || null,
            snapped_dropoff_lat: request.snappedDropoffLat || null,
            snapped_dropoff_lng: request.snappedDropoffLng || null,
        });
        console.log(`[Booking] Created pending booking in Firebase: ${request.bookingId}`);

        await set(ref(db, `/share_tokens/${shareToken}`), {
            delivery_id: request.bookingId,
            created_at: request.createdAt,
        });

        // Sync to Supabase (Source of Truth)
        if (supabase) {
            try {
                const otpCode = generateOTP();

                // Ensure customer profile exists (FK constraint)
                await ensureProfileExists(request.customerId);

                // Check if delivery already exists in Supabase (e.g., created by web booking)
                // If so, DON'T overwrite the existing OTP
                const { data: existing } = await supabase
                    .from('deliveries')
                    .select('id, otp_code')
                    .eq('id', request.bookingId)
                    .maybeSingle();

                const finalOtp = existing?.otp_code || otpCode;

                const { error } = await supabase
                    .from('deliveries')
                    .upsert({
                        id: request.bookingId,
                        tracking_number: request.bookingId,
                        customer_id: request.customerId,
                        pickup_lat: request.pickupLat,
                        pickup_lng: request.pickupLng,
                        pickup_address: request.pickupAddress,
                        dropoff_lat: request.dropoffLat,
                        dropoff_lng: request.dropoffLng,
                        dropoff_address: request.dropoffAddress,
                        estimated_fare: Math.round(request.estimatedFare),
                        distance: request.distance ? Math.round(request.distance) : null, // Persist distance (rounded)
                        duration: request.duration ? Math.round(request.duration) : null, // Persist duration (rounded)
                        share_token: shareToken,
                        sender_name: request.senderName,
                        sender_phone: request.senderPhone,
                        recipient_name: request.recipientName,
                        recipient_phone: request.recipientPhone,
                        delivery_notes: request.deliveryNotes,
                        otp_code: finalOtp,
                        status: 'PENDING',
                        created_at: new Date(request.createdAt).toISOString(),
                        updated_at: new Date(request.createdAt).toISOString(),
                        snapped_pickup_lat: request.snappedPickupLat || null,
                        snapped_pickup_lng: request.snappedPickupLng || null,
                        snapped_dropoff_lat: request.snappedDropoffLat || null,
                        snapped_dropoff_lng: request.snappedDropoffLng || null,
                    }, { onConflict: 'id' });

                if (error) {
                    console.error('[RiderMatching] Supabase delivery upsert failed:', {
                        message: error.message,
                        code: error.code,
                        details: error.details,
                        hint: error.hint,
                    });
                    // Queue for retry
                    await statusUpdateService.queueStatusUpdate(request.bookingId, 'UNKNOWN_BOX', 'PENDING');
                } else {
                    console.log(`[Booking] Synced booking to Supabase: ${request.bookingId}`);
                }
            } catch (sbError) {
                console.error('[RiderMatching] Supabase sync exception:', sbError);
            }
        }

        return true;
    } catch (error) {
        console.error(`[Booking] Error creating pending booking: ${error}`);
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
            distance: request.distance, // EC-Fix: Added
            duration: request.duration, // EC-Fix: Added
            customer_name: request.customerName, // EC-Fix: Added
            sender_name: request.senderName,
            sender_phone: request.senderPhone,
            recipient_name: request.recipientName,
            recipient_phone: request.recipientPhone,
            delivery_notes: request.deliveryNotes,
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
            distance: booking.distance, // EC-Fix: Propagate distance from booking
            duration: booking.duration, // EC-Fix: Propagate duration from booking
            customerName: booking.customerName, // EC-Fix: Propagate customer name
            senderName: booking.senderName,
            senderPhone: booking.senderPhone,
            recipientName: booking.recipientName,
            recipientPhone: booking.recipientPhone,
            deliveryNotes: booking.deliveryNotes,
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

        // GUARDRAIL: Box ID is required for delivery security
        if (!metadata?.boxId) {
            console.warn('[RiderMatching] Attempted to accept order without paired boxId');
            return false;
        }

        // GUARDRAIL: Rider Phone is required
        if (!metadata?.riderPhone) {
            console.warn('[RiderMatching] Attempted to accept order without riderPhone');
            return false;
        }

        // console.log(`[RiderMatching] acceptOrder called by ${riderId} for booking ${bookingId}`);

        // EC-FIX: Pre-fetch data to populate local cache.
        // runTransaction passes null initially if data isn't cached, causing us to abort prematurely.
        const snapshot = await get(bookingRef);
        if (!snapshot.exists()) {
            console.log(`[Booking] Accept failed - Booking ${bookingId} does not exist`);
            return false;
        }

        // --- Atomic claim via runTransaction ---
        // If two riders call this at the same time, Firebase will retry the
        // loser's handler with the updated data. The loser will see
        // status !== 'SEARCHING' and return `undefined` to abort.
        const txResult = await runTransaction(bookingRef, (currentData) => {
            // If currentData is null (common on first local run), fallback to our pre-fetched snapshot.
            // If the server has different data, the transaction will fail and retry with that real data.
            const dataToProcess = currentData || snapshot.val();

            if (!dataToProcess) {
                // Booking truly believes it doesn't exist?
                console.log('[Booking] Transaction aborted: Booking data is null/missing.');
                return undefined;
            }

            if (dataToProcess.status !== 'SEARCHING' || dataToProcess.accepted_by) {
                // Already accepted by another rider — abort
                console.log(`[Booking] Accept aborted - Booking ${bookingId} status is ${dataToProcess.status}, accepted by ${dataToProcess.accepted_by}`);
                return undefined;
            }

            // Claim the booking for this rider
            return {
                ...dataToProcess,
                status: 'ACCEPTED',
                accepted_by: riderId,
                accepted_at: acceptedAt,
            };
        });

        if (!txResult.committed) {
            // Transaction aborted — booking was already taken or missing
            console.log(`[Booking] Accept transaction not committed for ${bookingId}`);
            return false;
        }

        console.log(`[Booking] Rider ${riderId} successfully accepted booking ${bookingId}`);
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
            estimated_fare: booking.estimated_fare || 0,
        };

        if (booking.snapped_pickup_lat) deliveryRecord.snapped_pickup_lat = booking.snapped_pickup_lat;
        if (booking.snapped_pickup_lng) deliveryRecord.snapped_pickup_lng = booking.snapped_pickup_lng;
        if (booking.snapped_dropoff_lat) deliveryRecord.snapped_dropoff_lat = booking.snapped_dropoff_lat;
        if (booking.snapped_dropoff_lng) deliveryRecord.snapped_dropoff_lng = booking.snapped_dropoff_lng;

        await set(ref(db, `/deliveries/${bookingId}`), deliveryRecord);

        await set(ref(db, `/share_tokens/${shareToken}`), {
            delivery_id: bookingId,
            created_at: booking.created_at || acceptedAt,
            updated_at: acceptedAt,
        });

        // Cancel other riders' pending requests for this booking
        const notifiedRiders: string[] = booking.notified_riders || [];
        await cancelOtherRiderRequests(bookingId, riderId, notifiedRiders);

        // Sync Accept to Supabase (use upsert in case the initial insert was missed)
        if (supabase) {
            try {
                // Ensure rider profile exists (FK constraint)
                await ensureProfileExists(riderId);

                // Validate box_id FK: only include if box exists in Supabase
                let safeBoxId: string | null = null;
                if (metadata?.boxId) {
                    const { data: boxExists } = await supabase
                        .from('smart_boxes')
                        .select('id')
                        .eq('id', metadata.boxId)
                        .maybeSingle();
                    if (boxExists) {
                        safeBoxId = metadata.boxId;
                    } else {
                        // Try by hardware_mac_address
                        const { data: boxByMac } = await supabase
                            .from('smart_boxes')
                            .select('id')
                            .eq('hardware_mac_address', metadata.boxId)
                            .maybeSingle();
                        safeBoxId = boxByMac?.id || null;
                    }
                }

                // Fetch existing OTP from Supabase instead of generating a new one
                // OTP is created once at booking time and must stay consistent
                let existingOtp = '';
                try {
                    const { data: existingDelivery } = await supabase
                        .from('deliveries')
                        .select('otp_code')
                        .eq('id', bookingId)
                        .maybeSingle();
                    existingOtp = existingDelivery?.otp_code || '';
                } catch (e) {
                    console.error('[RiderMatching] Failed to fetch existing OTP:', e);
                }
                // Only generate new OTP if none exists (should not happen in normal flow)
                const finalOtp = existingOtp || generateOTP();

                const upsertData: any = {
                    id: bookingId,
                    tracking_number: bookingId,
                    rider_id: riderId,
                    rider_name: metadata?.riderName,
                    rider_phone: metadata?.riderPhone,
                    customer_id: booking.customer_id,
                    pickup_lat: booking.pickup_lat,
                    pickup_lng: booking.pickup_lng,
                    pickup_address: booking.pickup_address,
                    dropoff_lat: booking.dropoff_lat,
                    dropoff_lng: booking.dropoff_lng,
                    dropoff_address: booking.dropoff_address,
                    distance: booking.distance ? Math.round(booking.distance) : null,
                    duration: booking.duration ? Math.round(booking.duration) : null,
                    estimated_fare: booking.estimated_fare ? Math.round(booking.estimated_fare) : 0,
                    share_token: shareToken,
                    otp_code: finalOtp,
                    status: 'ASSIGNED',
                    accepted_at: new Date(acceptedAt).toISOString(),
                    updated_at: new Date(acceptedAt).toISOString(),
                    created_at: new Date(booking.created_at || acceptedAt).toISOString(),
                };

                if (booking.snapped_pickup_lat) upsertData.snapped_pickup_lat = booking.snapped_pickup_lat;
                if (booking.snapped_pickup_lng) upsertData.snapped_pickup_lng = booking.snapped_pickup_lng;
                if (booking.snapped_dropoff_lat) upsertData.snapped_dropoff_lat = booking.snapped_dropoff_lat;
                if (booking.snapped_dropoff_lng) upsertData.snapped_dropoff_lng = booking.snapped_dropoff_lng;

                if (safeBoxId) {
                    upsertData.box_id = safeBoxId;
                }

                const { error } = await supabase
                    .from('deliveries')
                    .upsert(upsertData, { onConflict: 'id' });

                if (error) {
                    console.error('[RiderMatching] Supabase accept upsert failed:', {
                        message: error.message,
                        code: error.code,
                        details: error.details,
                        hint: error.hint,
                    });
                } else {
                    console.log('[RiderMatching] Upserted Supabase delivery on accept:', bookingId);
                }
            } catch (sbError) {
                console.error('[RiderMatching] Supabase accept sync exception:', sbError);
            }
        }

        return true;
    } catch (error) {
        console.error(`[Booking] Error accepting order ${bookingId}:`, error);
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
        // console.log('[RiderMatching] Rider marked available:', riderId);
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
        console.log('[Booking] Cancelling booking:', bookingId);
        await update(ref(db, `/pending_bookings/${bookingId}`), {
            status: 'CANCELLED',
            cancelled_at: Date.now(),
        });

        // Sync to Supabase
        if (supabase) {
            const { error } = await supabase
                .from('deliveries')
                .update({
                    status: 'CANCELLED',
                    updated_at: new Date().toISOString()
                })
                .eq('id', bookingId);

            if (error) {
                console.error('[Booking] Failed to cancel in Supabase:', error);
            } else {
                console.log('[Booking] Cancelled booking in Supabase:', bookingId);
            }
        }

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

/**
 * One-shot read of a rider's current location from Firebase.
 * Used to fetch the real position BEFORE map initialization so the camera
 * doesn't center on the pickup fallback.
 */
export async function getInitialRiderLocation(
    riderId: string
): Promise<RiderLiveLocation | null> {
    try {
        const db = getFirebaseDatabase();
        const riderRef = ref(db, `/online_riders/${riderId}`);
        const snapshot = await get(riderRef);

        if (!snapshot.exists()) return null;

        const data = snapshot.val() as any;
        if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return null;

        return {
            lat: data.lat,
            lng: data.lng,
            lastUpdated: data.last_updated || Date.now(),
        };
    } catch (error) {
        console.warn('[RiderMatching] Failed to fetch initial rider location:', error);
        return null;
    }
}

/**
 * One-shot read of a box's current location from Firebase.
 * Used to fetch the real position BEFORE map initialization.
 */
export async function getInitialBoxLocation(
    boxId: string
): Promise<{ lat: number; lng: number; heading?: number; lastUpdated?: number } | null> {
    try {
        const db = getFirebaseDatabase();
        const boxRef = ref(db, `locations/${boxId}`);
        const snapshot = await get(boxRef);

        if (!snapshot.exists()) return null;

        const raw = snapshot.val();
        // Normalize split-path { box, phone } vs legacy flat object
        const data = raw.box ?? (raw.latitude != null ? raw : (raw.lat != null ? raw : null));
        if (!data) return null;

        const lat = data.lat ?? data.latitude;
        const lng = data.lng ?? data.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;

        return {
            lat,
            lng,
            heading: data?.heading,
            lastUpdated: data?.last_updated || data?.timestamp || Date.now(),
        };
    } catch (error) {
        console.warn('[RiderMatching] Failed to fetch initial box location:', error);
        return null;
    }
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
            try {
                const supabaseUpdates: Record<string, any> = {
                    status,
                    updated_at: new Date().toISOString(),
                };
                if (additionalFields?.picked_up_at) {
                    supabaseUpdates.picked_up_at = new Date(additionalFields.picked_up_at as number).toISOString();
                }
                if (additionalFields?.arrived_at) {
                    supabaseUpdates.arrived_at = new Date(additionalFields.arrived_at as number).toISOString();
                }
                if (additionalFields?.completed_at) {
                    supabaseUpdates.delivered_at = new Date(additionalFields.completed_at as number).toISOString();
                }
                if (additionalFields?.proof_photo_url) {
                    supabaseUpdates.proof_photo_url = additionalFields.proof_photo_url;
                }
                if (additionalFields?.pickup_photo_url) {
                    supabaseUpdates.pickup_photo_url = additionalFields.pickup_photo_url;
                }
                const { error: sbError } = await supabase
                    .from('deliveries')
                    .update(supabaseUpdates)
                    .eq('id', deliveryId);
                if (sbError) {
                    console.error('[updateDeliveryStatus] Supabase sync failed:', {
                        message: sbError.message,
                        code: sbError.code,
                        details: sbError.details,
                        hint: sbError.hint,
                        deliveryId,
                        status,
                    });
                } else {
                    // Update the smart box status if boxId is provided
                    const boxId = additionalFields?.boxId as string | undefined;
                    if (boxId) {
                        let boxStatus: 'IDLE' | 'IN_TRANSIT' | null = null;

                        // Map delivery status to box physical status
                        if (status === 'IN_TRANSIT' || status === 'ARRIVED') {
                            boxStatus = 'IN_TRANSIT';
                        } else if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'TAMPERED') {
                            boxStatus = 'IDLE';
                        }

                        if (boxStatus) {
                            const { error: boxError } = await supabase
                                .from('smart_boxes')
                                .update({ status: boxStatus })
                                .eq('id', boxId);

                            if (boxError) {
                                console.error('[updateDeliveryStatus] Failed to update smart_boxes status:', boxError);
                            }
                        }
                    }
                }
            } catch (sbException) {
                console.error('[updateDeliveryStatus] Supabase sync exception:', sbException);
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
        // console.log('[RiderMatching] subscribeToRiderRequests - Raw Snapshot:', requestsData);
        const requests: Array<{ requestId: string; data: RiderOrderRequest }> = [];

        for (const [requestId, data] of Object.entries(requestsData)) {
            const requestData = data as any;

            // Only include pending requests that haven't expired
            // const timeUntilExpiry = requestData.expires_at - Date.now();
            // console.log(`[RiderMatching] Checking req ${requestId}: Status=${requestData.status}, Expires=${requestData.expires_at}, Now=${Date.now()}, Remaining=${timeUntilExpiry}ms`);

            // Allow requests that expire up to 1 minute ago (grace period for clock skew)
            const GRACE_PERIOD_MS = 60 * 1000;
            const isNotExpired = requestData.expires_at > (Date.now() - GRACE_PERIOD_MS);

            if (requestData.status === 'PENDING' && isNotExpired) {
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
                        distance: requestData.distance,
                        duration: requestData.duration,
                        customerName: requestData.customer_name,
                    },
                });
            }
        }

        callback(requests);
    });

    // Return unsubscribe function
    return unsubscribe;
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
        // console.log('[RiderMatching] updateRiderStatus called for:', riderId, 'Available:', isAvailable);
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
        await update(riderRef, updateData);

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
 * Reads from `locations/{boxId}` — the same path the ESP32 hardware and web use.
 */
export function subscribeToBoxLocation(
    boxId: string,
    callback: (location: { lat: number; lng: number; heading?: number; lastUpdated?: number } | null) => void
): () => void {
    const db = getFirebaseDatabase();
    // Must match web & hardware path: locations/{boxId}
    const boxRef = ref(db, `locations/${boxId}`);

    const unsubscribe = onValue(boxRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback(null);
            return;
        }

        const raw = snapshot.val();
        // Normalize split-path { box, phone } vs legacy flat object
        const data = raw?.box ?? (raw?.latitude != null ? raw : (raw?.lat != null ? raw : null));
        // Normalize: hardware writes latitude/longitude, but interface expects lat/lng
        const lat = data?.lat ?? data?.latitude;
        const lng = data?.lng ?? data?.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
            callback(null);
            return;
        }

        callback({
            lat,
            lng,
            heading: data?.heading,
            lastUpdated: data?.last_updated || data?.timestamp || Date.now(),
        });
    });

    return () => off(boxRef);
}

export interface RiderProfile {
    id: string;
    full_name: string;
    avatar_url: string | null;
    rating?: number;
    totalDeliveries?: number;
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

        const { count } = await supabase
            .from('deliveries')
            .select('*', { count: 'exact', head: true })
            .eq('rider_id', riderId)
            .eq('status', 'COMPLETED');

        return {
            ...data,
            totalDeliveries: count || 0,
        } as RiderProfile;
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
                        const candidate = {
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

                        // EC-FIX: Double check with Supabase to ensure it's not a "Zombie" booking
                        // that was cancelled but failed to update Firebase.
                        if (supabase) {
                            const { data: sbData } = await supabase
                                .from('deliveries')
                                .select('status')
                                .eq('id', key)
                                .maybeSingle();

                            if (sbData && (sbData.status === 'CANCELLED' || sbData.status === 'COMPLETED')) {
                                console.log('[checkActiveBookings] Ignoring zombie booking:', key);
                                continue;
                            }
                        }

                        return candidate;
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

                // EC-FIX: Auto-heal "PENDING" zombies
                // If status is PENDING in Supabase, valid bookings MUST exist in Firebase pending_bookings and NOT be cancelled.
                if (delivery.status === 'PENDING') {
                    try {
                        const db = getFirebaseDatabase();
                        const pendingSnapshot = await get(ref(db, `pending_bookings/${delivery.id}`));

                        if (!pendingSnapshot.exists() || pendingSnapshot.val().status === 'CANCELLED') {
                            console.log('[checkActiveBookings] Found zombie PENDING booking in Supabase. Auto-correcting...', delivery.id);

                            // Auto-heal: data is inconsistent, so we fix the source of truth to match reality (it's gone)
                            await supabase.from('deliveries').update({
                                status: 'CANCELLED',
                                updated_at: new Date().toISOString()
                            }).eq('id', delivery.id);

                            // Skip this one, it's not active
                            return null;
                        }
                    } catch (e) {
                        console.error('[checkActiveBookings] Error verifying pending booking:', e);
                        // Fallback: If we can't verify, we might assume it's valid to be safe, or just return it.
                    }
                }

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
