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
import { ref, set, serverTimestamp, onValue, off } from 'firebase/database';

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
