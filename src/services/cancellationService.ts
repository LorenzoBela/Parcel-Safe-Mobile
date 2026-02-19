/**
 * EC-32: Rider Cancellation Service
 * 
 * Handles the scenario where a rider cancels a delivery after pickup.
 * Implements:
 * - OTP invalidation (locks the box)
 * - Sender notification
 * - Return OTP generation for package retrieval
 * 
 * @see EDGE_CASES.md EC-32
 */

import { getFirebaseDatabase } from './firebaseClient';
import { ref, set, update, serverTimestamp, onValue, off } from 'firebase/database';
import { supabase } from './supabaseClient';

// ==================== Constants ====================
export const RETURN_OTP_VALIDITY_MS = 86400000; // 24 hours
export const RETURN_OTP_LENGTH = 6;

// ==================== Enums ====================
export enum CancellationReason {
  CUSTOMER_UNAVAILABLE = 'CUSTOMER_UNAVAILABLE',
  ADDRESS_INVALID = 'ADDRESS_INVALID',
  RIDER_EMERGENCY = 'RIDER_EMERGENCY',
  PACKAGE_DAMAGED = 'PACKAGE_DAMAGED',
  CUSTOMER_REFUSED = 'CUSTOMER_REFUSED',
  WEATHER_UNSAFE = 'WEATHER_UNSAFE',
  OTHER = 'OTHER',
}

// ==================== Types ====================
export interface CancellationState {
  cancelled: boolean;
  cancelledAt: number;
  reason: CancellationReason;
  reasonDetails?: string;
  riderId: string;
  riderName?: string;
  returnOtp: string;
  returnOtpIssuedAt: number;
  returnOtpExpiresAt: number;
  senderNotified: boolean;
  packageRetrieved: boolean;
  retrievedAt?: number;
}

export interface CancellationRequest {
  deliveryId: string;
  boxId: string;
  reason: CancellationReason;
  reasonDetails?: string;
  riderId: string;
  riderName?: string;
}

export interface CancellationResult {
  success: boolean;
  returnOtp?: string;
  error?: string;
}

// ==================== Helper Functions ====================

/**
 * Generate a random 6-digit OTP for return pickup
 */
export function generateReturnOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Validate cancellation request
 */
export function validateCancellationRequest(request: CancellationRequest): { valid: boolean; error?: string } {
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

  // If reason is OTHER, require details
  if (request.reason === CancellationReason.OTHER &&
    (!request.reasonDetails || request.reasonDetails.trim() === '')) {
    return { valid: false, error: 'Details required for OTHER reason' };
  }

  return { valid: true };
}

/**
 * Check if a return OTP is still valid
 */
export function isReturnOtpValid(issuedAt: number, currentTime: number): boolean {
  return (currentTime - issuedAt) < RETURN_OTP_VALIDITY_MS;
}

/**
 * Get remaining time for return OTP in hours
 */
export function getReturnOtpRemainingHours(issuedAt: number, currentTime: number): number {
  if (!isReturnOtpValid(issuedAt, currentTime)) return 0;

  const elapsed = currentTime - issuedAt;
  const remaining = RETURN_OTP_VALIDITY_MS - elapsed;
  return Math.floor(remaining / 3600000);
}

/**
 * Format cancellation reason for display
 */
export function formatCancellationReason(reason: CancellationReason): string {
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

// ==================== Firebase Operations ====================

/**
 * Request cancellation of a delivery after pickup
 * This will:
 * 1. Write cancellation state to Firebase
 * 2. Revoke the current OTP
 * 3. Generate a return OTP for sender
 * 4. Trigger sender notification
 */
export async function requestCancellation(
  request: CancellationRequest
): Promise<CancellationResult> {
  // Validate request
  const validation = validateCancellationRequest(request);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const database = getFirebaseDatabase();
  const currentTime = Date.now();
  const returnOtp = generateReturnOtp();

  const cancellationState: CancellationState = {
    cancelled: true,
    cancelledAt: currentTime,
    reason: request.reason,
    reasonDetails: request.reasonDetails,
    riderId: request.riderId,
    riderName: request.riderName,
    returnOtp: returnOtp,
    returnOtpIssuedAt: currentTime,
    returnOtpExpiresAt: currentTime + RETURN_OTP_VALIDITY_MS,
    senderNotified: false,
    packageRetrieved: false,
  };

  try {
    // 1. Write cancellation state
    const cancellationRef = ref(database, `cancellations/${request.deliveryId}`);
    await set(cancellationRef, {
      ...cancellationState,
      cancelledAt: serverTimestamp(),
      returnOtpIssuedAt: serverTimestamp(),
    });

    // 2. Revoke current OTP on box
    const boxDeliveryRef = ref(database, `boxes/${request.boxId}/delivery_context`);
    await set(boxDeliveryRef, {
      otp_revoked: true,
      revoked_reason: 'RIDER_CANCELLED',
      revoked_at: serverTimestamp(),
      return_otp_hash: returnOtp, // Box stores for validation
      delivery_id: request.deliveryId,
    });

    // 3. Mark sender notification as pending (handled by cloud function or separate service)
    const notificationRef = ref(database, `notifications/pending/${request.deliveryId}`);
    await set(notificationRef, {
      type: 'DELIVERY_CANCELLED',
      delivery_id: request.deliveryId,
      return_otp: returnOtp,
      created_at: serverTimestamp(),
      sent: false,
    });

    // 4. Update delivery status to CANCELLED (Firebase)
    // IMPORTANT: This ensures the rider is no longer "Active" on this delivery technically, 
    // although they still need to process the return.
    // The UI should handle "Return Pending" via checking `cancellations/` or local state if possible,
    // but for data consistency, the delivery is Cancelled.
    const deliveryRef = ref(database, `deliveries/${request.deliveryId}/status`);
    await set(deliveryRef, 'CANCELLED');

    // 5. Sync to Supabase
    if (supabase) {
      const { error } = await supabase
        .from('deliveries')
        .update({
          status: 'CANCELLED',
          updated_at: new Date().toISOString()
        })
        .eq('id', request.deliveryId);

      if (error) {
        console.error('[EC-32] Failed to sync cancellation to Supabase:', error);
      } else {
        console.log('[EC-32] Synced cancellation to Supabase:', request.deliveryId);
      }
    }

    return {
      success: true,
      returnOtp: returnOtp,
    };
  } catch (error) {
    console.error('[EC-32] Cancellation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Cancellation failed',
    };
  }
}

/**
 * Subscribe to cancellation state for a delivery
 */
export function subscribeToCancellation(
  deliveryId: string,
  callback: (state: CancellationState | null) => void
): () => void {
  const database = getFirebaseDatabase();
  const cancellationRef = ref(database, `cancellations/${deliveryId}`);

  const listener = onValue(cancellationRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val() as CancellationState);
    } else {
      callback(null);
    }
  });

  // Return unsubscribe function
  return () => off(cancellationRef);
}

/**
 * Mark package as retrieved (sender picked up)
 */
export async function markPackageRetrieved(
  deliveryId: string,
  boxId: string
): Promise<boolean> {
  const database = getFirebaseDatabase();

  try {
    const cancellationRef = ref(database, `cancellations/${deliveryId}`);
    await set(cancellationRef, {
      packageRetrieved: true,
      retrievedAt: serverTimestamp(),
    });

    // Clear box state
    const boxRef = ref(database, `boxes/${boxId}/delivery_context`);
    await set(boxRef, null);

    return true;
  } catch (error) {
    console.error('[EC-32] Mark retrieved failed:', error);
    return false;
  }
}

// ==================== Customer Cancellation ====================

/**
 * Delivery stages that determine cancellation eligibility
 */
export enum DeliveryStatus {
  PENDING = 'PENDING',       // Order placed, no rider assigned
  ASSIGNED = 'ASSIGNED',     // Rider assigned, hasn't picked up
  PICKED_UP = 'PICKED_UP',   // Package in box, in transit
  IN_TRANSIT = 'IN_TRANSIT', // Rider en route to destination
  ARRIVED = 'ARRIVED',       // Rider at destination
  DELIVERED = 'DELIVERED',   // Handover complete
  CANCELLED = 'CANCELLED',   // Already cancelled
}

/**
 * Customer-specific cancellation reasons
 */
export enum CustomerCancellationReason {
  CHANGED_MIND = 'CHANGED_MIND',
  ORDERED_BY_MISTAKE = 'ORDERED_BY_MISTAKE',
  FOUND_ALTERNATIVE = 'FOUND_ALTERNATIVE',
  PRICE_TOO_HIGH = 'PRICE_TOO_HIGH',
  TAKING_TOO_LONG = 'TAKING_TOO_LONG',
  OTHER = 'OTHER',
}

export interface CustomerCancellationRequest {
  deliveryId: string;
  customerId: string;
  customerName?: string;
  reason: CustomerCancellationReason;
  reasonDetails?: string;
}

export interface CustomerCancellationState {
  cancelled: boolean;
  cancelledAt: number;
  initiatedBy: 'CUSTOMER';
  customerId: string;
  customerName?: string;
  reason: CustomerCancellationReason;
  reasonDetails?: string;
  refundStatus: 'PENDING' | 'APPROVED' | 'PROCESSED';
  riderNotified: boolean;
  riderId?: string;
}

export interface CustomerCancellationResult {
  success: boolean;
  refundStatus?: 'PENDING' | 'APPROVED';
  error?: string;
}

/**
 * Check if a customer can cancel based on delivery status
 * Rule: Customers can only cancel BEFORE pickup (PENDING or ASSIGNED stages)
 */
export function canCustomerCancel(status: DeliveryStatus): { canCancel: boolean; reason?: string } {
  switch (status) {
    case DeliveryStatus.PENDING:
    case DeliveryStatus.ASSIGNED:
      return { canCancel: true };

    case DeliveryStatus.PICKED_UP:
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

/**
 * Format customer cancellation reason for display
 */
export function formatCustomerCancellationReason(reason: CustomerCancellationReason): string {
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

/**
 * Validate customer cancellation request
 */
export function validateCustomerCancellationRequest(
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

  // If reason is OTHER, require details
  if (request.reason === CustomerCancellationReason.OTHER &&
    (!request.reasonDetails || request.reasonDetails.trim() === '')) {
    return { valid: false, error: 'Details required for OTHER reason' };
  }

  return { valid: true };
}

/**
 * Request cancellation of a delivery by customer
 * Only allowed before package pickup
 */
export async function requestCustomerCancellation(
  request: CustomerCancellationRequest,
  currentStatus: DeliveryStatus,
  assignedRiderId?: string
): Promise<CustomerCancellationResult> {
  // Validate request
  const validation = validateCustomerCancellationRequest(request);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Check if cancellation is allowed at this stage
  const canCancelResult = canCustomerCancel(currentStatus);
  if (!canCancelResult.canCancel) {
    return { success: false, error: canCancelResult.reason };
  }

  const database = getFirebaseDatabase();
  const currentTime = Date.now();

  // Build state, then strip undefined keys — Firebase RTDB rejects `undefined`.
  const cancellationState: CustomerCancellationState = {
    cancelled: true,
    cancelledAt: currentTime,
    initiatedBy: 'CUSTOMER',
    customerId: request.customerId,
    customerName: request.customerName,
    reason: request.reason,
    reasonDetails: request.reasonDetails,
    refundStatus: 'PENDING',
    riderNotified: false,
    riderId: assignedRiderId,
  };

  // Remove keys whose value is undefined (Firebase RTDB does not accept undefined)
  const cleanState = Object.fromEntries(
    Object.entries(cancellationState).filter(([, v]) => v !== undefined)
  );

  try {
    // 1. Write customer cancellation state
    const cancellationRef = ref(database, `customer_cancellations/${request.deliveryId}`);
    await set(cancellationRef, {
      ...cleanState,
      cancelledAt: serverTimestamp(),
    });

    // 2. Update delivery status
    const deliveryRef = ref(database, `deliveries/${request.deliveryId}/status`);
    await set(deliveryRef, DeliveryStatus.CANCELLED);

    // 2.1 Update pending_bookings status if it exists (for rider matching)
    const pendingRef = ref(database, `pending_bookings/${request.deliveryId}`);
    try {
      await update(pendingRef, {
        status: 'CANCELLED',
        cancelled_at: serverTimestamp(),
      });
    } catch (e) {
      console.log('[Cancellation] Pending booking not found or update failed (non-critical):', e);
    }

    // 2.2 Sync to Supabase
    if (supabase) {
      const { error } = await supabase
        .from('deliveries')
        .update({
          status: 'CANCELLED',
          updated_at: new Date().toISOString()
        })
        .eq('id', request.deliveryId);

      if (error) {
        console.error('[Cancellation] Failed to sync to Supabase:', error);
      } else {
        console.log('[Cancellation] Synced cancellation to Supabase:', request.deliveryId);
      }
    }

    // 3. Notify rider if one was assigned
    if (assignedRiderId) {
      const riderNotificationRef = ref(database, `notifications/riders/${assignedRiderId}/${request.deliveryId}`);
      await set(riderNotificationRef, {
        type: 'CUSTOMER_CANCELLED',
        deliveryId: request.deliveryId,
        reason: formatCustomerCancellationReason(request.reason),
        createdAt: serverTimestamp(),
        read: false,
      });

      // Update cancellation state to reflect rider was notified
      await set(ref(database, `customer_cancellations/${request.deliveryId}/riderNotified`), true);
    }

    // 4. Queue refund processing
    const refundRef = ref(database, `refunds/pending/${request.deliveryId}`);
    await set(refundRef, {
      deliveryId: request.deliveryId,
      customerId: request.customerId,
      status: 'PENDING',
      createdAt: serverTimestamp(),
    });

    return {
      success: true,
      refundStatus: 'PENDING',
    };
  } catch (error) {
    console.error('[Customer Cancellation] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Cancellation failed',
    };
  }
}

/**
 * Subscribe to customer cancellation state for a delivery
 */
export function subscribeToCustomerCancellation(
  deliveryId: string,
  callback: (state: CustomerCancellationState | null) => void
): () => void {
  const database = getFirebaseDatabase();
  const cancellationRef = ref(database, `customer_cancellations/${deliveryId}`);

  const listener = onValue(cancellationRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val() as CustomerCancellationState);
    } else {
      callback(null);
    }
  });

  // Return unsubscribe function
  return () => off(cancellationRef);
}
