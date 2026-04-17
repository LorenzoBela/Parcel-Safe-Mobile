/**
 * Rider Matching Service for Parcel-Safe
 * 
 * Handles geofenced rider matching with 3km radius,
 * finding nearby available riders and dispatching notifications.
 */

import { getFirebaseDatabase } from './firebaseClient';
import { ref, get, set, update, remove, onValue, off, onDisconnect, runTransaction, serverTimestamp } from 'firebase/database';
import { showIncomingOrderNotification, cancelDeliveryReminderNotification } from './pushNotificationService';
import statusUpdateService from './statusUpdateService';
import { supabase } from './supabaseClient';

import { generateShareToken, generateOTP } from '../utils/tokenUtils';

/** Base URL for the Parcel Safe web API (used to dispatch server-side FCM notifications) */
const API_BASE_URL = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';

/** Map a delivery status to the NotificationType expected by /api/notifications/send */
const STATUS_TO_NOTIFICATION_TYPE: Record<string, string> = {
    ASSIGNED: 'ORDER_ACCEPTED',
    IN_TRANSIT: 'PARCEL_PICKED_UP',
    ARRIVED: 'RIDER_ARRIVED',
    COMPLETED: 'DELIVERY_COMPLETED',
    CANCELLED: 'ORDER_CANCELLED_BY_RIDER',
};

async function getNotificationAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    } catch {
        // Best effort only; backend may still allow internal routes.
    }

    return headers;
}

/**
 * Fire-and-forget: tell the server to send an FCM push notification
 * to the relevant delivery parties via Firebase Admin SDK.
 * Non-fatal — never throws.
 */
async function dispatchStatusNotification(
    deliveryId: string,
    status: string,
    context?: Record<string, string>
): Promise<void> {
    const type = STATUS_TO_NOTIFICATION_TYPE[status];
    if (!type) return; // no notification for this status
    try {
        const headers = await getNotificationAuthHeaders();
        await fetch(`${API_BASE_URL}/api/notifications/send`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                type,
                deliveryId,
                includeCustomer: true,
                includeRider: status === 'COMPLETED',
                context: context || {},
            }),
        });
    } catch (err) {
        console.warn('[Notification] dispatchStatusNotification failed (non-fatal):', err);
    }
}

/**
 * Fire-and-forget: dispatch an `INCOMING_ORDER`, `ORDER_REASSIGNED`, or
 * `NEW_POOL_ORDER` tray notification via the centralized server FCM API.
 *
 * This complements the in-app Firebase listener (`subscribeToRiderRequests`),
 * ensuring riders still see the order in their system tray even when the app
 * is killed or the OS has suspended its background connection. Non-fatal.
 */
export async function dispatchRiderOrderNotification(
    type: 'INCOMING_ORDER' | 'ORDER_REASSIGNED' | 'NEW_POOL_ORDER',
    targetUserId: string,
    context: Record<string, string>,
): Promise<void> {
    try {
        const headers = await getNotificationAuthHeaders();
        await fetch(`${API_BASE_URL}/api/notifications/send`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                type,
                targetUserId,
                context: {
                    deepLink: 'parcelsafe://rider/dashboard',
                    ...context,
                },
            }),
        });
    } catch (err) {
        console.warn(`[Notification] dispatchRiderOrderNotification(${type}) failed (non-fatal):`, err);
    }
}

/**
 * Fire-and-forget: dispatch a security/tamper notification via the server FCM API.
 * Sends to delivery parties, the rider, and all admins.
 */
export async function dispatchSecurityNotification(
    type: 'TAMPER_DETECTED' | 'THEFT_REPORTED' | 'GEOFENCE_BREACH',
    context: Record<string, string>,
    deliveryId?: string,
    targetUserId?: string
): Promise<void> {
    try {
        const hasExplicitTarget = Boolean(deliveryId || targetUserId);
        const headers = await getNotificationAuthHeaders();
        await fetch(`${API_BASE_URL}/api/notifications/send`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                type,
                ...(deliveryId ? { deliveryId, includeCustomer: true, includeRider: true } : {}),
                ...(targetUserId ? { targetUserId } : {}),
                ...(!hasExplicitTarget ? { targetRole: 'ADMIN' as const } : {}),
                includeAdmins: true,
                context,
            }),
        });
    } catch (err) {
        console.warn(`[Notification] dispatchSecurityNotification(${type}) failed (non-fatal):`, err);
    }
}

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
    return_photo_url?: string;
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
    otp_code?: string;
}

export interface RiderLiveLocation {
    lat: number;
    lng: number;
    speed?: number;
    heading?: number;
    compassHeading?: number | null;
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
        // EC-Fix: Only insert placeholder if acting on own profile to prevent overwriting others' real emails
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user || authData.user.id !== userId) {
            console.log(`[Profile] Skip placeholder check for ${userId} (Mismatch with active session)`);
            return;
        }

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
 * Possible outcomes of acceptOrder() so the UI can show a precise message
 * instead of a generic "already accepted" alert.
 */
export type AcceptOrderReason =
    | 'success'
    | 'missing_box'        // rider has no paired box
    | 'missing_phone'      // rider has no contact number on profile
    | 'booking_missing'    // pending_bookings/{id} no longer exists
    | 'already_accepted'   // another rider already claimed it (status !== SEARCHING or accepted_by set)
    | 'reserved_for_other' // booking is still in another rider's exclusive offer window
    | 'transaction_failed' // Firebase transaction did not commit for unknown reason
    | 'error';             // unexpected exception

export interface AcceptOrderResult {
    success: boolean;
    reason: AcceptOrderReason;
    message?: string;
    /** When `reason === 'reserved_for_other'`, ms until the exclusive window expires. */
    retryAfterMs?: number;
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
    radiusKm: number = SEARCH_RADIUS_KM,
    /**
     * Widen the search ring if *no* rider is found inside the primary radius.
     * Prevents a lone online rider who happens to be just outside the 3 km ring
     * from being silently skipped (the booking would otherwise fall straight
     * to the open pool with no candidate set and no tray notification).
     */
    fallbackRadiusKm: number = 10,
): Promise<RiderLocation[]> {
    try {
        const db = getFirebaseDatabase();
        const snapshot = await get(ref(db, '/online_riders'));

        if (!snapshot.exists()) {
            return [];
        }

        const ridersData = snapshot.val();

        console.log(`[Booking] Found ${Object.keys(ridersData).length} total riders in /online_riders`);
        const primary: RiderLocation[] = [];
        const fallback: RiderLocation[] = [];

        for (const [riderId, data] of Object.entries(ridersData)) {
            const riderData = data as any;

            console.log(`[Booking] Checking Rider ${riderId}: Available=${riderData.is_available}, Lat=${riderData.lat}, Lng=${riderData.lng}, LastUpdated=${riderData.last_updated}`);

            if (!riderData.is_available) {
                console.log(`[Booking] Skipping Rider ${riderId} - Not Available`);
                continue;
            }
            if (typeof riderData.lat !== 'number' || typeof riderData.lng !== 'number') {
                console.log(`[Booking] Skipping Rider ${riderId} - Missing coordinates`);
                continue;
            }

            const entry: RiderLocation = {
                riderId,
                lat: riderData.lat,
                lng: riderData.lng,
                pushToken: riderData.push_token || null,
                isAvailable: riderData.is_available,
                lastUpdated: riderData.last_updated || Date.now(),
            };

            if (isWithinRadius(riderData.lat, riderData.lng, pickupLat, pickupLng, radiusKm)) {
                primary.push(entry);
            } else if (isWithinRadius(riderData.lat, riderData.lng, pickupLat, pickupLng, fallbackRadiusKm)) {
                fallback.push(entry);
            }
        }

        if (primary.length > 0) {
            console.log(`[Booking] findNearbyRiders returning ${primary.length} rider(s) inside ${radiusKm}km`);
            return primary;
        }
        if (fallback.length > 0) {
            console.log(`[Booking] No riders within ${radiusKm}km; falling back to ${fallbackRadiusKm}km (${fallback.length} rider(s))`);
            return fallback;
        }
        return [];
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
                        // EC-Fix: Remove snapped_ coordinates as they might not exist in Supabase schema
                        // snapped_pickup_lat: request.snappedPickupLat || null,
                        // snapped_pickup_lng: request.snappedPickupLng || null,
                        // snapped_dropoff_lat: request.snappedDropoffLat || null,
                        // snapped_dropoff_lng: request.snappedDropoffLng || null,
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
                    return false; // EC-Fix: Reject creation to prevent inconsistent state
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
 * Evaluate and rank nearby riders to form a candidate queue.
 * Prioritizes based on distance to pickup and idle time (time since last assigned order).
 */
export async function rankRidersForBooking(
    booking: BookingRequest,
    nearbyRiders: RiderLocation[]
): Promise<string[]> {
    if (nearbyRiders.length === 0) return [];

    const db = getFirebaseDatabase();
    
    // Fetch recent delivery history for riders to determine idle time
    // In a real production app, we might query Supabase or a specific Firebase node for 'last_completed_at'
    // For this implementation, we use the rider's lastUpdated timestamp as a proxy for idle time if available,
    // or simulate an idle score. 
    // Weighting: 1 km of distance penalty = ~5 minutes of idle time bonus
    const distanceWeight = 1.0;
    const idleTimeBonusPerMinute = 0.2; 
    
    const now = Date.now();
    
    const scoredRiders = nearbyRiders.map(rider => {
        const distanceToPickup = calculateHaversineDistance(
            rider.lat,
            rider.lng,
            booking.pickupLat,
            booking.pickupLng
        );
        
        // Calculate minutes idle (max 60 mins to prevent extreme skew)
        const minutesIdle = Math.min(60, Math.max(0, (now - rider.lastUpdated) / 60000));
        
        // Lower score is better. Distance adds to score, idle time subtracts from score.
        const score = (distanceToPickup * distanceWeight) - (minutesIdle * idleTimeBonusPerMinute);
        
        return {
            riderId: rider.riderId,
            distance: distanceToPickup,
            score: score
        };
    });
    
    // Sort by lowest score first
    scoredRiders.sort((a, b) => a.score - b.score);
    
    console.log(`[RiderMatching] Ranked Candidate Queue for ${booking.bookingId}:`, scoredRiders.map(r => `${r.riderId} (score: ${r.score.toFixed(2)}, dist: ${r.distance}km)`));
    
    return scoredRiders.map(r => r.riderId);
}

/**
 * Notify all nearby riders about a new booking (Sequential Cascading version)
 * This finds nearby riders, ranks them, stores the candidate queue, and actively pings *only* the best candidate.
 */
export async function notifyNearbyRiders(
    booking: BookingRequest
): Promise<{ notifiedCount: number; riders: string[] }> {
    const nearbyRiders = await findNearbyRiders(
        booking.pickupLat,
        booking.pickupLng,
        SEARCH_RADIUS_KM
    );

    if (nearbyRiders.length === 0) {
        return { notifiedCount: 0, riders: [] };
    }
    
    // 1. Generate the Candidate Queue based on fairness
    const candidateQueue = await rankRidersForBooking(booking, nearbyRiders);
    const topCandidateId = candidateQueue[0];
    
    // 2. Store the Candidate Queue in the pending booking
    try {
        const db = getFirebaseDatabase();
        await update(ref(db, `/pending_bookings/${booking.bookingId}`), {
            candidate_queue: candidateQueue,
            current_candidate: topCandidateId,
            offer_expires_at: Date.now() + REQUEST_EXPIRY_MS,
            rejected_by: []
        });
        console.log(`[RiderMatching] Stored candidate queue for ${booking.bookingId}. Current candidate: ${topCandidateId}`);
    } catch (err) {
        console.error('[RiderMatching] Failed to store candidate queue details:', err);
    }

    // 3. Find the top candidate's distance for their specific request payload
    let distanceToPickup = 0;
    const topCandidateData = nearbyRiders.find(r => r.riderId === topCandidateId);
    if (topCandidateData) {
        distanceToPickup = calculateHaversineDistance(
            topCandidateData.lat,
            topCandidateData.lng,
            booking.pickupLat,
            booking.pickupLng
        );
    }

    const notifiedRiders: string[] = [];

    // ONLY notify the top candidate
    if (topCandidateId) {
        // Find the top candidate's data again to get the exact distance
        const topCandidateData = nearbyRiders.find(r => r.riderId === topCandidateId);
        if (topCandidateData) {
            const distanceToPickup = calculateHaversineDistance(
                topCandidateData.lat,
                topCandidateData.lng,
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
                expiresAt: Date.now() + 15000, // 15 seconds exclusive window
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

            const success = await sendOrderRequestToRider(topCandidateId, orderRequest);

            if (success) {
                notifiedRiders.push(topCandidateId);
                console.log(`[RiderMatching] Sent exclusive offer to candidate ${topCandidateId} for booking ${booking.bookingId}`);

                // Fire the centralized tray push so the notification still reaches
                // the rider when the app is killed / backgrounded / offline-return.
                void dispatchRiderOrderNotification('INCOMING_ORDER', topCandidateId, {
                    bookingId: booking.bookingId,
                    pickupAddress: booking.pickupAddress || '',
                    dropoffAddress: booking.dropoffAddress || '',
                    estimatedFare: String(booking.estimatedFare ?? 0),
                    distanceKm: distanceToPickup.toFixed(2),
                });
            }
        }
    }

    // Store notified rider IDs in the pending booking so that acceptOrder()
    // can later cancel their requests
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
): Promise<AcceptOrderResult> {
    try {
        const db = getFirebaseDatabase();
        const bookingRef = ref(db, `/pending_bookings/${bookingId}`);
        const acceptedAt = Date.now();

        const normalizedBoxId = typeof metadata?.boxId === 'string' ? metadata.boxId.trim() : '';
        console.log(`[RiderMatching] acceptOrder: riderId=${riderId} bookingId=${bookingId} normalizedBoxId='${normalizedBoxId}'`);
        const hasValidBoxId = Boolean(
            normalizedBoxId
            && normalizedBoxId.toLowerCase() !== 'null'
            && normalizedBoxId.toLowerCase() !== 'undefined'
            && normalizedBoxId.toLowerCase() !== 'unknown_box'
        );

        // GUARDRAIL: Box ID is required for delivery security
        if (!hasValidBoxId) {
            console.warn('[RiderMatching] Attempted to accept order without paired boxId');
            return { success: false, reason: 'missing_box', message: 'Pair a Smart Box first to accept deliveries.' };
        }

        // GUARDRAIL: Rider Phone is required
        if (!metadata?.riderPhone) {
            console.warn('[RiderMatching] Attempted to accept order without riderPhone');
            return { success: false, reason: 'missing_phone', message: 'Add a contact number to your profile to accept deliveries.' };
        }

        // EC-FIX: Pre-fetch data to populate local cache.
        // runTransaction passes null initially if data isn't cached, causing us to abort prematurely.
        const snapshot = await get(bookingRef);
        if (!snapshot.exists()) {
            console.log(`[Booking] Accept failed - Booking ${bookingId} does not exist`);
            return { success: false, reason: 'booking_missing', message: 'This delivery is no longer available.' };
        }

        // Track *why* the transaction handler aborted so the outer code can
        // surface a precise message ("already accepted" vs "still reserved").
        let abortReason: AcceptOrderReason | null = null;
        let reservedRetryAfterMs = 0;

        // --- Atomic claim via runTransaction ---
        // If two riders call this at the same time, Firebase will retry the
        // loser's handler with the updated data. The loser will see
        // status !== 'SEARCHING' and return `undefined` to abort.
        const txResult = await runTransaction(bookingRef, (currentData) => {
            // If currentData is null (common on first local run), fallback to our pre-fetched snapshot.
            // If the server has different data, the transaction will fail and retry with that real data.
            const dataToProcess = currentData || snapshot.val();

            if (!dataToProcess) {
                console.log('[Booking] Transaction aborted: Booking data is null/missing.');
                abortReason = 'booking_missing';
                return undefined;
            }

            if (dataToProcess.status !== 'SEARCHING' || dataToProcess.accepted_by) {
                // Already accepted by another rider — abort
                console.log(`[Booking] Accept aborted - Booking ${bookingId} status is ${dataToProcess.status}, accepted by ${dataToProcess.accepted_by}`);
                abortReason = 'already_accepted';
                return undefined;
            }

            // --- SEQUENTIAL ASSIGNMENT CHECKS ---
            // If it's still in the exclusive phase, verify candidate and timer
            if (dataToProcess.current_candidate && dataToProcess.offer_expires_at) {
                const now = Date.now();
                // 2-second grace for network drift.
                if (now <= dataToProcess.offer_expires_at + 2000) {
                    if (dataToProcess.current_candidate !== riderId) {
                        console.warn(`[RiderMatching] Rider ${riderId} attempted to accept, but current candidate is ${dataToProcess.current_candidate}`);
                        abortReason = 'reserved_for_other';
                        reservedRetryAfterMs = Math.max(0, (dataToProcess.offer_expires_at + 2000) - now);
                        return undefined;
                    }
                }
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
            console.log(`[Booking] Accept transaction not committed for ${bookingId} (reason=${abortReason || 'transaction_failed'})`);
            const reason: AcceptOrderReason = abortReason || 'transaction_failed';
            const messages: Record<AcceptOrderReason, string> = {
                already_accepted: 'Another rider just claimed this delivery.',
                reserved_for_other: `This delivery is currently being offered to another rider. It will return to the open pool in about ${Math.ceil(reservedRetryAfterMs / 1000)}s if they don't accept.`,
                booking_missing: 'This delivery is no longer available.',
                transaction_failed: 'Could not claim this delivery. Please try again.',
                missing_box: '',
                missing_phone: '',
                error: '',
                success: '',
            };
            return {
                success: false,
                reason,
                message: messages[reason],
                ...(reason === 'reserved_for_other' ? { retryAfterMs: reservedRetryAfterMs } : {}),
            };
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

        // --- Fetch OTP (MUST happen before Firebase delivery sync) ---
        // otp_code is only in Supabase, not in Firebase pending_bookings.
        let resolvedOtp = '';
        if (supabase) {
            try {
                const { data: otpRow } = await supabase
                    .from('deliveries')
                    .select('otp_code')
                    .eq('id', bookingId)
                    .maybeSingle();
                resolvedOtp = otpRow?.otp_code || '';
            } catch (e) {
                console.error('[RiderMatching] OTP pre-fetch failed:', e);
            }
        }
        if (!resolvedOtp) resolvedOtp = generateOTP();

        const shareToken = booking.share_token || generateShareToken();
        const deliveryRecord: DeliveryRecord = {
            id: bookingId,
            tracking_number: bookingId,
            rider_id: riderId,
            rider_name: metadata?.riderName || '',
            rider_phone: metadata?.riderPhone || '',
            customer_id: booking.customer_id,
            box_id: normalizedBoxId,
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
            otp_code: resolvedOtp, // EC-Fix: Store OTP in Firebase delivery node too
        };

        if (booking.snapped_pickup_lat) deliveryRecord.snapped_pickup_lat = booking.snapped_pickup_lat;
        if (booking.snapped_pickup_lng) deliveryRecord.snapped_pickup_lng = booking.snapped_pickup_lng;
        if (booking.snapped_dropoff_lat) deliveryRecord.snapped_dropoff_lat = booking.snapped_dropoff_lat;
        if (booking.snapped_dropoff_lng) deliveryRecord.snapped_dropoff_lng = booking.snapped_dropoff_lng;

        await set(ref(db, `/deliveries/${bookingId}`), deliveryRecord);

        // Write OTP to hardware node

        if (normalizedBoxId) {
            try {
                await update(ref(db, `hardware/${normalizedBoxId}`), {
                    otp_code: resolvedOtp,
                    delivery_id: bookingId,
                    otp_issued_at: serverTimestamp(),
                    target_lat: booking.dropoff_lat || 0,
                    target_lng: booking.dropoff_lng || 0,
                    pickup_lat: booking.pickup_lat || 0,
                    pickup_lng: booking.pickup_lng || 0,
                });
                console.log(`[RiderMatching] Written OTP='${resolvedOtp}' + pickup/dropoff coords to hardware/${normalizedBoxId}`);
            } catch (hwErr) {
                console.error('[RiderMatching] Failed to write to hardware node:', hwErr);
            }
        }

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
                
                // Ensure customer profile exists (FK constraint)
                if (booking.customer_id) {
                    await ensureProfileExists(booking.customer_id);
                }

                // Validate box_id FK: only include if box exists in Supabase
                let safeBoxId: string | null = null;
                if (normalizedBoxId) {
                    const { data: boxExists } = await supabase
                        .from('smart_boxes')
                        .select('id')
                        .eq('id', normalizedBoxId)
                        .maybeSingle();
                    if (boxExists) {
                        safeBoxId = normalizedBoxId;
                    } else {
                        // Try by hardware_mac_address
                        const { data: boxByMac } = await supabase
                            .from('smart_boxes')
                            .select('id')
                            .eq('hardware_mac_address', normalizedBoxId)
                            .maybeSingle();
                        safeBoxId = boxByMac?.id || null;
                    }
                }

                // OTP was already fetched and written to hardware above.
                // Reuse it here for the Supabase upsert.
                const finalOtp = resolvedOtp;

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

                // EC-Fix: Remove snapped_ coordinates as they might not exist in Supabase schema
                // if (booking.snapped_pickup_lat) upsertData.snapped_pickup_lat = booking.snapped_pickup_lat;
                // if (booking.snapped_pickup_lng) upsertData.snapped_pickup_lng = booking.snapped_pickup_lng;
                // if (booking.snapped_dropoff_lat) upsertData.snapped_dropoff_lat = booking.snapped_dropoff_lat;
                // if (booking.snapped_dropoff_lng) upsertData.snapped_dropoff_lng = booking.snapped_dropoff_lng;

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
                    // Note: We don't return false because Firebase already committed the claim.
                    // The subsequent forceDeliverySync() will attempt self-healing.
                } else {
                    console.log('[RiderMatching] Upserted Supabase delivery on accept:', bookingId);
                }
            } catch (sbError) {
                console.error('[RiderMatching] Supabase accept sync exception:', sbError);
            }
        }

        // Fire ORDER_ACCEPTED push notification to the customer
        await dispatchStatusNotification(bookingId, 'ASSIGNED', {
            riderName: metadata?.riderName || 'Your rider',
        });

        return { success: true, reason: 'success' };
    } catch (error) {
        console.error(`[Booking] Error accepting order ${bookingId}:`, error);
        return {
            success: false,
            reason: 'error',
            message: error instanceof Error ? error.message : 'Unexpected error while accepting this delivery.',
        };
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
 * Pass an order to the next candidate in the queue
 */
export async function passOrderToNextCandidate(
    bookingId: string,
    rejectingRiderId: string
): Promise<void> {
    const db = getFirebaseDatabase();
    const bookingRef = ref(db, `/pending_bookings/${bookingId}`);

    try {
        await runTransaction(bookingRef, (booking) => {
            if (!booking || booking.status !== 'SEARCHING') return undefined;

            // Only process if this rider is actually the current candidate
            if (booking.current_candidate !== rejectingRiderId) return undefined;

            // Add to rejected list
            const rejectedBy = booking.rejected_by || [];
            if (!rejectedBy.includes(rejectingRiderId)) {
                rejectedBy.push(rejectingRiderId);
            }

            // Remove from candidate queue
            const queue = booking.candidate_queue || [];
            const newQueue = queue.filter((id: string) => id !== rejectingRiderId);

            if (newQueue.length > 0) {
                // There are still candidates left, pass to the next one
                const nextCandidate = newQueue[0];
                return {
                    ...booking,
                    rejected_by: rejectedBy,
                    candidate_queue: newQueue,
                    current_candidate: nextCandidate,
                    offer_expires_at: Date.now() + 15000, // 15 seconds for the next guy
                };
            } else {
                // No exclusive candidates left! The order unlocks to the Open Market.
                // It will be picked up by AvailableOrdersModal
                return {
                    ...booking,
                    rejected_by: rejectedBy,
                    candidate_queue: [],
                    current_candidate: null,
                    offer_expires_at: null,
                };
            }
        });

        // After the transaction completes, if there's a new candidate, we need to ping them.
        const snapshot = await get(bookingRef);
        if (snapshot.exists()) {
            const updatedBooking = snapshot.val();
            if (updatedBooking.status === 'SEARCHING' && updatedBooking.current_candidate) {
                const nextCandidateId = updatedBooking.current_candidate;
                
                console.log(`[RiderMatching] Order ${bookingId} passed from ${rejectingRiderId} to ${nextCandidateId}`);
                
                // Fetch rider's location to calculate distance for the request
                const riderSnap = await get(ref(db, `/online_riders/${nextCandidateId}`));
                if (riderSnap.exists()) {
                    const riderData = riderSnap.val();
                    const distanceToPickup = calculateHaversineDistance(
                        riderData.lat, 
                        riderData.lng, 
                        updatedBooking.pickup_lat, 
                        updatedBooking.pickup_lng
                    );

                    const orderRequest: RiderOrderRequest = {
                        bookingId: bookingId,
                        pickupAddress: updatedBooking.pickup_address,
                        dropoffAddress: updatedBooking.dropoff_address,
                        pickupLat: updatedBooking.pickup_lat,
                        pickupLng: updatedBooking.pickup_lng,
                        dropoffLat: updatedBooking.dropoff_lat,
                        dropoffLng: updatedBooking.dropoff_lng,
                        distanceToPickupKm: distanceToPickup,
                        estimatedFare: updatedBooking.estimated_fare,
                        expiresAt: updatedBooking.offer_expires_at, // Use the new expiry
                        customerId: updatedBooking.customer_id,
                        // Propagate other fields if they exist
                        distance: updatedBooking.distance, 
                        duration: updatedBooking.duration, 
                        customerName: updatedBooking.customer_name, 
                        senderName: updatedBooking.sender_name,
                        senderPhone: updatedBooking.sender_phone,
                        recipientName: updatedBooking.recipient_name,
                        recipientPhone: updatedBooking.recipient_phone,
                        deliveryNotes: updatedBooking.delivery_notes,
                    };

                    await sendOrderRequestToRider(nextCandidateId, orderRequest);

                    // Add the new rider to notified_riders array
                    const notified = updatedBooking.notified_riders || [];
                    if (!notified.includes(nextCandidateId)) {
                        await update(bookingRef, {
                            notified_riders: [...notified, nextCandidateId]
                        });
                    }

                    // Fire centralized tray push for the reassignment.
                    void dispatchRiderOrderNotification('ORDER_REASSIGNED', nextCandidateId, {
                        bookingId,
                        pickupAddress: updatedBooking.pickup_address || '',
                        dropoffAddress: updatedBooking.dropoff_address || '',
                        estimatedFare: String(updatedBooking.estimated_fare ?? 0),
                        distanceKm: distanceToPickup.toFixed(2),
                    });
                }
            } else if (updatedBooking.status === 'SEARCHING' && !updatedBooking.current_candidate) {
                console.log(`[RiderMatching] Order ${bookingId} queue exhausted. Unlocked to open market.`);

                // Broadcast a low-priority NEW_POOL_ORDER heads-up to every
                // online rider within the primary radius so they can open
                // AvailableOrdersModal and claim it. This runs fire-and-forget.
                try {
                    const poolCandidates = await findNearbyRiders(
                        updatedBooking.pickup_lat,
                        updatedBooking.pickup_lng,
                        SEARCH_RADIUS_KM,
                    );
                    const alreadyNotified = new Set<string>(updatedBooking.notified_riders || []);
                    for (const rider of poolCandidates) {
                        // Avoid re-pinging people who already received the exclusive offer.
                        if (alreadyNotified.has(rider.riderId)) continue;
                        void dispatchRiderOrderNotification('NEW_POOL_ORDER', rider.riderId, {
                            bookingId,
                            pickupAddress: updatedBooking.pickup_address || '',
                            dropoffAddress: updatedBooking.dropoff_address || '',
                            estimatedFare: String(updatedBooking.estimated_fare ?? 0),
                        });
                    }
                } catch (broadcastError) {
                    console.warn('[RiderMatching] NEW_POOL_ORDER broadcast failed:', broadcastError);
                }
            }
        }
    } catch (error) {
        console.error(`[RiderMatching] Error passing order ${bookingId} to next candidate:`, error);
    }
}

/**
 * Handle order rejection and pass it to the next candidate
 */
export async function rejectOrder(
    riderId: string,
    requestId: string,
    bookingId?: string // Now necessary to advance the queue
): Promise<boolean> {
    try {
        const db = getFirebaseDatabase();
        // Mark the local request as rejected
        await update(ref(db, `/rider_requests/${riderId}/${requestId}`), {
            status: 'REJECTED',
        });

        if (bookingId) {
            // Trigger cascading queue logic
            await passOrderToNextCandidate(bookingId, riderId);
        }

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

        // Clean up the pending_bookings node (Firebase-specific, not a status transition)
        await update(ref(db, `/pending_bookings/${bookingId}`), {
            status: 'CANCELLED',
            cancelled_at: Date.now(),
        });

        // Centralized status transition via server API (handles dual write + notifications + audit)
        try {
            const headers = await getNotificationAuthHeaders();
            const response = await fetch(`${API_BASE_URL}/api/deliveries/transition`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    deliveryId: bookingId,
                    toStatus: 'CANCELLED',
                    reason: 'Booking cancelled by rider',
                }),
            });

            if (!response.ok) {
                console.warn('[Booking] Transition API returned non-OK:', response.status);
            }
        } catch (transitionError) {
            console.warn('[Booking] Transition API call failed, falling back to Supabase direct:', transitionError);
            if (supabase) {
                await supabase
                    .from('deliveries')
                    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
                    .eq('id', bookingId);
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

    return unsubscribe;
}

/**
 * Perform a sweep of pending bookings to check for expired offers
 * This is a "cron-like" function that should ideally run on a trusted backend (e.g., Firebase Cloud Functions or an Admin Node script).
 * Running it from multiple clients is not ideal but possible with careful transaction usage.
 */
export async function runTimeoutSweep(): Promise<void> {
    try {
        const db = getFirebaseDatabase();
        const pendingRef = ref(db, `/pending_bookings`);
        
        // We do a get() to find searching bookings, then process expirations.
        // Doing this strictly via REST/Admin SDK is better, but here's the client-side approximation
        const snapshot = await get(pendingRef);
        if (!snapshot.exists()) return;

        const bookings = snapshot.val();
        const now = Date.now();

        for (const [bookingId, data] of Object.entries<any>(bookings)) {
            if (data.status === 'SEARCHING' && data.current_candidate && data.offer_expires_at) {
                if (now > data.offer_expires_at) {
                    console.log(`[RiderMatching] Sweeper detected expired offer for order ${bookingId} (candidate: ${data.current_candidate})`);
                    // The candidate missed the window. Force a rejection to pop the queue.
                    await passOrderToNextCandidate(bookingId, data.current_candidate);
                }
            }
        }
    } catch (error) {
        console.error('[RiderMatching] Sweep failed:', error);
    }
}

export function subscribeToDelivery(
    deliveryId: string,
    callback: (delivery: DeliveryRecord | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const deliveryRef = ref(db, `/deliveries/${deliveryId}`);
    const auditRef = ref(db, `/audit_logs/${deliveryId}`);

    let latestDelivery: DeliveryRecord | null = null;
    let latestAuditUrl: string | null = null;

    const pushUpdate = () => {
        if (!latestDelivery) {
            callback(null);
            return;
        }
        
        // Merge audit photo url if main delivery lacks proof_photo_url
        const merged = { ...latestDelivery };
        if (!merged.proof_photo_url && latestAuditUrl) {
            merged.proof_photo_url = latestAuditUrl;
        }
        callback(merged);
    };

    const unsubDelivery = onValue(deliveryRef, (snapshot) => {
        if (!snapshot.exists()) {
            latestDelivery = null;
        } else {
            latestDelivery = snapshot.val() as DeliveryRecord;
        }
        pushUpdate();
    });

    const unsubAudit = onValue(auditRef, (snapshot) => {
        if (snapshot.exists()) {
            const auditData = snapshot.val();
            if (auditData?.latest_photo_url) {
                latestAuditUrl = auditData.latest_photo_url;
                pushUpdate();
            }
        }
    });

    return () => {
        unsubDelivery();
        unsubAudit();
    };
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
            speed: data.speed,
            heading: data.heading,
            compassHeading: data.compassHeading,
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
            speed: data.speed,
            heading: data.heading,
            compassHeading: data.compassHeading,
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

        // Cancel 2-hour reminder when delivery finalizes
        if (status === 'COMPLETED' || status === 'CANCELLED') {
            cancelDeliveryReminderNotification().catch(() => { /* ignore */ });

            // Clear the hardware node's delivery context (box → STANDBY)
            try {
                const deliverySnap = await get(ref(db, `/deliveries/${deliveryId}`));
                const deliveryData = deliverySnap.exists() ? deliverySnap.val() : null;
                const hwBoxId = deliveryData?.box_id
                    || (additionalFields?.boxId as string)
                    || '';
                if (hwBoxId) {
                    await update(ref(db, `/hardware/${hwBoxId}`), {
                        otp_code: null,
                        delivery_id: null,
                    });
                    console.log(`[updateDeliveryStatus] Cleared hardware context for ${hwBoxId}`);
                }
            } catch (hwClearErr) {
                console.error('[updateDeliveryStatus] Failed to clear hardware context:', hwClearErr);
            }
        }

        // Centralized status transition via server API (handles dual write + notifications + audit)
        const headers = await getNotificationAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/deliveries/transition`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                deliveryId,
                toStatus: status,
                metadata: additionalFields || {},
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.warn('[updateDeliveryStatus] Transition API returned non-OK:', response.status, errText);
            // Fallback: direct Firebase write so hardware is unblocked
            await update(ref(db, `/deliveries/${deliveryId}`), {
                status,
                updated_at: Date.now(),
                ...(additionalFields || {}),
            });
        }

        // Box status sync (hardware-specific, stays mobile-side)
        if (supabase) {
            const boxId = additionalFields?.boxId as string | undefined;
            if (boxId) {
                let boxStatus: 'IDLE' | 'IN_TRANSIT' | null = null;
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
    pushToken?: string,
    speed?: number,
    heading?: number,
    compassHeading?: number | null
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

        if (speed !== undefined) updateData.speed = speed;
        if (heading !== undefined) updateData.heading = heading;
        if (compassHeading !== undefined) updateData.compassHeading = compassHeading;

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
                .in('status', ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED'])
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

/**
 * Returns true when the booking is "openly claimable" — either no exclusive
 * offer exists, the offer has expired, or the offer is reserved for the given rider.
 *
 * Used by both the pool subscription and one-shot fetch so the rider never sees
 * an order in the pool that `acceptOrder` would reject with `reserved_for_other`.
 */
function isBookingClaimable(booking: any, currentRiderId?: string): boolean {
    if (!booking.current_candidate || !booking.offer_expires_at) return true;
    const now = Date.now();
    // Grace window keeps parity with acceptOrder's 2s drift tolerance.
    if (now > booking.offer_expires_at + 2000) return true;
    return Boolean(currentRiderId && booking.current_candidate === currentRiderId);
}

/**
 * Fetch available orders manually (one-time fetch)
 */
export async function fetchAvailableOrders(
    riderLat: number,
    riderLng: number,
    radiusKm: number = SEARCH_RADIUS_KM,
    currentRiderId?: string
): Promise<RiderOrderRequest[]> {
    try {
        const db = getFirebaseDatabase();
        const pendingRef = ref(db, '/pending_bookings');
        const snapshot = await get(pendingRef);

        if (!snapshot.exists()) return [];

        const data = snapshot.val();
        const availableOrders: RiderOrderRequest[] = [];

        for (const [bookingId, b] of Object.entries(data)) {
            const booking = b as any;
            if (
                booking.status === 'SEARCHING'
                && !booking.accepted_by
                && isBookingClaimable(booking, currentRiderId)
            ) {
                // Check distance
                const distance = calculateHaversineDistance(
                    riderLat,
                    riderLng,
                    booking.pickup_lat,
                    booking.pickup_lng
                );

                if (distance <= radiusKm) {
                    availableOrders.push({
                        bookingId,
                        pickupAddress: booking.pickup_address,
                        dropoffAddress: booking.dropoff_address,
                        pickupLat: booking.pickup_lat,
                        pickupLng: booking.pickup_lng,
                        dropoffLat: booking.dropoff_lat,
                        dropoffLng: booking.dropoff_lng,
                        distanceToPickupKm: distance,
                        estimatedFare: booking.estimated_fare,
                        expiresAt: booking.created_at + REQUEST_EXPIRY_MS, // Though pool orders might live longer natively, we map it
                        customerId: booking.customer_id,
                        distance: booking.distance,
                        duration: booking.duration,
                        customerName: booking.customer_name,
                        senderName: booking.sender_name,
                        senderPhone: booking.sender_phone,
                        recipientName: booking.recipient_name,
                        recipientPhone: booking.recipient_phone,
                        deliveryNotes: booking.delivery_notes,
                    });
                }
            }
        }
        
        // Sort by distance ascending
        return availableOrders.sort((a, b) => a.distanceToPickupKm - b.distanceToPickupKm);
    } catch (error) {
        console.error('[AvailableOrders] Fetched failed:', error);
        return [];
    }
}

/**
 * Subscribe to available orders in real-time
 */
export function subscribeToAvailableOrders(
    riderLat: number,
    riderLng: number,
    radiusKm: number,
    callback: (orders: RiderOrderRequest[]) => void,
    currentRiderId?: string
): () => void {
    const db = getFirebaseDatabase();
    const pendingRef = ref(db, '/pending_bookings');

    const unsubscribe = onValue(pendingRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback([]);
            return;
        }

        const data = snapshot.val();
        const availableOrders: RiderOrderRequest[] = [];

        for (const [bookingId, b] of Object.entries(data)) {
            const booking = b as any;
            if (
                booking.status === 'SEARCHING'
                && !booking.accepted_by
                && isBookingClaimable(booking, currentRiderId)
            ) {
                const distance = calculateHaversineDistance(
                    riderLat,
                    riderLng,
                    booking.pickup_lat,
                    booking.pickup_lng
                );

                if (distance <= radiusKm) {
                    availableOrders.push({
                        bookingId,
                        pickupAddress: booking.pickup_address,
                        dropoffAddress: booking.dropoff_address,
                        pickupLat: booking.pickup_lat,
                        pickupLng: booking.pickup_lng,
                        dropoffLat: booking.dropoff_lat,
                        dropoffLng: booking.dropoff_lng,
                        distanceToPickupKm: distance,
                        estimatedFare: booking.estimated_fare,
                        // Expire slightly differently or just omit visual timer for pool
                        expiresAt: booking.created_at + REQUEST_EXPIRY_MS, 
                        customerId: booking.customer_id,
                        distance: booking.distance,
                        duration: booking.duration,
                        customerName: booking.customer_name,
                        senderName: booking.sender_name,
                        senderPhone: booking.sender_phone,
                        recipientName: booking.recipient_name,
                        recipientPhone: booking.recipient_phone,
                        deliveryNotes: booking.delivery_notes,
                    });
                }
            }
        }

        // Sort by distance ascending
        availableOrders.sort((a, b) => a.distanceToPickupKm - b.distanceToPickupKm);
        callback(availableOrders);
    });

    return () => off(pendingRef, 'value', unsubscribe);
}

/**
 * Force trigger the next.js delivery sync API to ensure source-of-truth is updated
 */
export async function forceDeliverySync(): Promise<void> {
    try {
        console.log('[Booking] Triggering forced delivery sync to Supabase...');
        const response = await fetch(`${API_BASE_URL}/api/sync-deliveries`, {
            method: 'GET',
        });
        const result = await response.json();
        console.log('[Booking] Force sync result:', result);
    } catch (e) {
        console.warn('[Booking] Force sync failed (non-fatal):', e);
    }
}
