/**
 * Supabase Client for Parcel-Safe Mobile App
 * 
 * Provides database access for delivery management and admin functions.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Create client only if credentials are provided with custom fetch options
export const supabase: SupabaseClient | null =
    supabaseUrl && supabaseAnonKey
        ? createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                storage: AsyncStorage,
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,

            },
            global: {
                fetch: async (url, options) => {
                    const urlStr = url.toString();

                    // Normalize headers
                    const headers: Record<string, string> = {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json' // Force correct content type
                    };

                    if (options?.headers) {
                        if (typeof options.headers.forEach === 'function') {
                            options.headers.forEach((value: string, key: string) => {
                                headers[key] = value;
                            });
                        } else {
                            Object.assign(headers, options.headers);
                        }
                    }

                    // Ensure JSON content type (override any charset variants)
                    headers['Content-Type'] = 'application/json';

                    // Handle body: Axios prefers objects for JSON
                    let requestData = options?.body;
                    if (typeof requestData === 'string') {
                        try {
                            requestData = JSON.parse(requestData);
                        } catch (e) {
                            // Keep as string if not valid JSON
                        }
                    }

                    try {
                        const result = await axios({
                            url: urlStr,
                            method: (options?.method as string) || 'GET',
                            headers: headers as any,
                            data: requestData,
                            validateStatus: () => true, // resolve promise for all status codes
                            timeout: 30000,
                        });

                        // Convert axios response to fetch Response
                        const responseBody = typeof result.data === 'object' ? JSON.stringify(result.data) : result.data;
                        const responseHeaders = new Headers();
                        if (result.headers) {
                            Object.entries(result.headers).forEach(([key, value]) => {
                                if (value !== undefined && value !== null) {
                                    responseHeaders.append(key, Array.isArray(value) ? value.join(', ') : String(value));
                                }
                            });
                        }

                        return new Response(responseBody, {
                            status: result.status,
                            statusText: result.statusText,
                            headers: responseHeaders,
                        });
                    } catch (error: any) {
                        console.error('[Supabase] Request Failed:', {
                            url: urlStr,
                            message: error.message,
                            code: error.code,
                            status: error.response?.status
                        });

                        // Fallback to native fetch (in case axios/XHR fails on this device)
                        try {
                            const fallback = await fetch(urlStr, {
                                method: options?.method || 'GET',
                                headers,
                                body: options?.body as any,
                            });
                            return fallback;
                        } catch (fallbackError: any) {
                            console.error('[Supabase] Native fetch failed:', fallbackError?.message || fallbackError);
                        }

                        // Diagnostic: Check if we can reach Google
                        try {
                            console.log('[Diagnostics] Pinging google.com...');
                            await axios.head('https://www.google.com', { timeout: 5000 });
                            console.log('[Diagnostics] Google is reachable. Internet is OK.');
                        } catch (diagError: any) {
                            console.error('[Diagnostics] Google ping failed:', diagError.message);
                            console.error('Possible Causes: No Internet, SSL Date Issue, Emulator Network Blocked.');
                        }

                        throw new TypeError('Network request failed');
                    }
                },
            },
        })
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

/**
 * Get the current authenticated user
 */
export async function getCurrentUser() {
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}
