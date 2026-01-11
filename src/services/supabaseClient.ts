/**
 * Supabase Client for Parcel-Safe Mobile App
 * 
 * Provides database access for delivery management and admin functions.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Create client only if credentials are provided
export const supabase: SupabaseClient | null =
    supabaseUrl && supabaseAnonKey
        ? createClient(supabaseUrl, supabaseAnonKey)
        : null;

// ==================== Types ====================

export interface Delivery {
    id: string;
    tracking_number: string;
    rider_id: string;
    customer_id: string;
    box_id: string;
    pickup_lat: number;
    pickup_lng: number;
    pickup_address: string;
    pickup_time?: string;
    dropoff_lat: number;
    dropoff_lng: number;
    dropoff_address: string;
    otp_code: string;
    rider_name?: string;
    rider_phone?: string;
    share_token: string;
    status: 'PENDING' | 'IN_TRANSIT' | 'ARRIVED' | 'COMPLETED' | 'TAMPERED';
    proof_photo_url?: string;
    manual_completion_reason?: string;
    manual_completion_at?: string;
    created_at: string;
}

// ==================== EC-03: ADMIN FALLBACK FUNCTIONS ====================

/**
 * Mark a delivery as complete manually (admin fallback)
 * Used when box battery dies or other hardware failures prevent normal completion
 */
export async function markDeliveryComplete(
    deliveryId: string,
    reason: string
): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('deliveries')
        .update({
            status: 'COMPLETED',
            manual_completion_reason: reason,
            manual_completion_at: new Date().toISOString(),
        })
        .or(`id.eq.${deliveryId},tracking_number.eq.${deliveryId}`);

    if (error) {
        console.error('Failed to mark delivery complete:', error.message);
        return false;
    }

    return true;
}

/**
 * Get delivery by ID or tracking number (for admin lookup)
 */
export async function getDeliveryByIdOrTracking(
    idOrTracking: string
): Promise<Delivery | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('deliveries')
        .select('*')
        .or(`id.eq.${idOrTracking},tracking_number.eq.${idOrTracking}`)
        .single();

    if (error || !data) return null;
    return data as Delivery;
}
