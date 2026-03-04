/**
 * EC-11: Customer Not Home Service
 * 
 * Handles the scenario when a rider arrives but the customer is not home.
 * Features:
 * - Wait timer: 5 min countdown before return option
 * - Photo proof: Capture photo showing arrival
 * - Notification: Push to customer "Driver is waiting"
 * - Reschedule: Web form to pick new time (via tracking link)
 */

import { getFirebaseDatabase, serverTimestamp, ref, set, onValue, off } from './firebaseClient';

// ==================== Configuration ====================

export const CONFIG = {
    /** Default wait time before return option becomes available (ms) */
    WAIT_DURATION_MS: 300000, // 5 minutes

    /** Notification retry attempts */
    NOTIFICATION_RETRY_ATTEMPTS: 3,

    /** Interval between notification retries (ms) */
    NOTIFICATION_RETRY_INTERVAL_MS: 30000, // 30 seconds

    /** Photo capture timeout (ms) */
    PHOTO_CAPTURE_TIMEOUT_MS: 10000,
};

// ==================== Types ====================

export type WaitStatus = 'NOT_STARTED' | 'WAITING' | 'EXPIRED' | 'CUSTOMER_ARRIVED' | 'RETURNED';

export interface WaitTimerState {
    status: WaitStatus;
    deliveryId: string;
    boxId: string;
    startedAt: number;
    expiresAt: number;
    notificationsSent: number;
    arrivalPhotoUrl?: string;
    customerNotifiedAt?: number;
    returnInitiatedAt?: number;
}

export interface RescheduleRequest {
    deliveryId: string;
    newDate: string; // ISO date string
    newTimeSlot: string; // e.g., "14:00-16:00"
    customerNotes?: string;
    requestedAt: number;
}

export interface CustomerNotHomeEvent {
    type: 'WAIT_STARTED' | 'NOTIFICATION_SENT' | 'WAIT_EXPIRED' | 'CUSTOMER_ARRIVED' | 'RETURN_INITIATED' | 'PHOTO_CAPTURED';
    timestamp: number;
    deliveryId: string;
    metadata?: Record<string, unknown>;
}

// ==================== Wait Timer Functions ====================

/**
 * Initialize wait timer state
 */
export function initWaitTimerState(deliveryId: string, boxId: string): WaitTimerState {
    const now = Date.now();
    return {
        status: 'NOT_STARTED',
        deliveryId,
        boxId,
        startedAt: 0,
        expiresAt: 0,
        notificationsSent: 0,
    };
}

/**
 * Start the wait timer when rider arrives and customer is not home
 */
export function startWaitTimer(state: WaitTimerState, currentTime: number): WaitTimerState {
    return {
        ...state,
        status: 'WAITING',
        startedAt: currentTime,
        expiresAt: currentTime + CONFIG.WAIT_DURATION_MS,
    };
}

/**
 * Check if wait timer has expired
 */
export function isWaitTimerExpired(state: WaitTimerState, currentTime: number): boolean {
    if (state.status !== 'WAITING') return false;
    return currentTime >= state.expiresAt;
}

/**
 * Get remaining wait time in seconds
 */
export function getRemainingWaitSeconds(state: WaitTimerState, currentTime: number): number {
    if (state.status !== 'WAITING') return 0;
    if (currentTime >= state.expiresAt) return 0;
    return Math.ceil((state.expiresAt - currentTime) / 1000);
}

/**
 * Get remaining wait time as formatted string (MM:SS)
 */
export function getFormattedRemainingTime(state: WaitTimerState, currentTime: number): string {
    const seconds = getRemainingWaitSeconds(state, currentTime);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Mark customer as arrived (cancel wait timer)
 */
export function markCustomerArrived(state: WaitTimerState): WaitTimerState {
    return {
        ...state,
        status: 'CUSTOMER_ARRIVED',
    };
}

/**
 * Mark wait timer as expired
 */
export function markWaitExpired(state: WaitTimerState): WaitTimerState {
    return {
        ...state,
        status: 'EXPIRED',
    };
}

/**
 * Initiate return (after wait expired)
 */
export function initiateReturn(state: WaitTimerState, currentTime: number): WaitTimerState {
    return {
        ...state,
        status: 'RETURNED',
        returnInitiatedAt: currentTime,
    };
}

/**
 * Record notification sent
 */
export function recordNotificationSent(state: WaitTimerState, currentTime: number): WaitTimerState {
    return {
        ...state,
        notificationsSent: state.notificationsSent + 1,
        customerNotifiedAt: currentTime,
    };
}

/**
 * Record arrival photo URL
 */
export function recordArrivalPhoto(state: WaitTimerState, photoUrl: string): WaitTimerState {
    return {
        ...state,
        arrivalPhotoUrl: photoUrl,
    };
}

/**
 * Check if return option should be available
 */
export function canInitiateReturn(state: WaitTimerState, currentTime: number): boolean {
    return state.status === 'EXPIRED' || 
           (state.status === 'WAITING' && currentTime >= state.expiresAt);
}

// ==================== Firebase Functions ====================

/**
 * Write wait timer state to Firebase
 */
export async function writeWaitTimerToFirebase(state: WaitTimerState): Promise<void> {
    const db = getFirebaseDatabase();
    const waitRef = ref(db, `deliveries/${state.deliveryId}/customer_not_home`);
    
    await set(waitRef, {
        ...state,
        updated_at: serverTimestamp(),
    });
}

/**
 * Subscribe to wait timer state updates
 */
export function subscribeToWaitTimer(
    deliveryId: string,
    callback: (state: WaitTimerState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const waitRef = ref(db, `deliveries/${deliveryId}/customer_not_home`);
    
    onValue(waitRef, (snapshot) => {
        const data = snapshot.val();
        callback(data as WaitTimerState | null);
    });
    
    return () => off(waitRef);
}

/**
 * Send push notification to customer that rider has arrived at the pickup point
 */
export async function sendPickupArrivalNotification(
    deliveryId: string,
    customerPhone: string,
    riderName: string
): Promise<boolean> {
    const db = getFirebaseDatabase();
    const notificationRef = ref(db, `notifications/${deliveryId}/rider_at_pickup`);

    try {
        await set(notificationRef, {
            type: 'RIDER_AT_PICKUP',
            deliveryId,
            message: `Your rider ${riderName} has arrived at the pickup point and is collecting your parcel.`,
            customerPhone,
            sentAt: serverTimestamp(),
        });
        return true;
    } catch (error) {
        console.error('[ArrivalNotif] Failed to send pickup arrival notification:', error);
        return false;
    }
}

/**
 * Send push notification to customer that driver is waiting
 */
export async function sendDriverWaitingNotification(
    deliveryId: string,
    customerPhone: string,
    riderName: string
): Promise<boolean> {
    const db = getFirebaseDatabase();
    const notificationRef = ref(db, `notifications/${deliveryId}/driver_waiting`);
    
    try {
        await set(notificationRef, {
            type: 'DRIVER_WAITING',
            deliveryId,
            message: `Your driver ${riderName} has arrived and is waiting for you.`,
            customerPhone,
            sentAt: serverTimestamp(),
        });
        return true;
    } catch (error) {
        console.error('[EC-11] Failed to send notification:', error);
        return false;
    }
}

/**
 * Submit reschedule request
 */
export async function submitRescheduleRequest(request: RescheduleRequest): Promise<boolean> {
    const db = getFirebaseDatabase();
    const rescheduleRef = ref(db, `deliveries/${request.deliveryId}/reschedule_request`);
    
    try {
        await set(rescheduleRef, {
            ...request,
            status: 'PENDING',
            createdAt: serverTimestamp(),
        });
        return true;
    } catch (error) {
        console.error('[EC-11] Failed to submit reschedule request:', error);
        return false;
    }
}

/**
 * Log customer not home event for audit trail
 */
export async function logCustomerNotHomeEvent(event: CustomerNotHomeEvent): Promise<void> {
    const db = getFirebaseDatabase();
    const eventRef = ref(db, `deliveries/${event.deliveryId}/events/${event.timestamp}`);
    
    await set(eventRef, {
        ...event,
        serverTimestamp: serverTimestamp(),
    });
}

// ==================== Validation ====================

/**
 * Validate wait timer state
 */
export function isValidWaitTimerState(state: WaitTimerState): boolean {
    if (!state.deliveryId || !state.boxId) return false;
    if (state.status === 'WAITING') {
        return state.startedAt > 0 && state.expiresAt > state.startedAt;
    }
    return true;
}

/**
 * Validate reschedule request
 */
export function isValidRescheduleRequest(request: Partial<RescheduleRequest>): boolean {
    if (!request.deliveryId) return false;
    if (!request.newDate) return false;
    if (!request.newTimeSlot) return false;
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(request.newDate)) return false;
    
    // Validate time slot format (HH:MM-HH:MM)
    const timeSlotRegex = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
    if (!timeSlotRegex.test(request.newTimeSlot)) return false;
    
    // Validate date is in the future
    const requestedDate = new Date(request.newDate);
    if (requestedDate <= new Date()) return false;
    
    return true;
}
