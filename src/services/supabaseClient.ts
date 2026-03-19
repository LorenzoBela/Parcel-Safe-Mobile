/**
 * Supabase Client for Parcel-Safe Mobile App
 * 
 * Provides database access for delivery management and admin functions.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import { AppState, AppStateStatus } from 'react-native';

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
                            timeout: 10000,
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

// ==================== Proactive Session Refresh ====================
// When the app returns from background after 10+ minutes, the Supabase JWT
// is likely expired. The SDK's autoRefreshToken pauses while backgrounded,
// so we proactively kick a refresh the moment the app becomes active.
// This eliminates the 20-30s delay caused by lazy token refresh blocking
// the first API call on resume.

let _lastBackgroundedAt = 0;
const MIN_BACKGROUND_FOR_REFRESH_MS = 60_000; // Only refresh if backgrounded > 1 min

if (supabase) {
    let _prevAppState: AppStateStatus = AppState.currentState;

    AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (nextState === 'background' || nextState === 'inactive') {
            if (_prevAppState === 'active') {
                _lastBackgroundedAt = Date.now();
            }
        } else if (nextState === 'active' && _prevAppState !== 'active') {
            const backgroundDuration = _lastBackgroundedAt > 0
                ? Date.now() - _lastBackgroundedAt
                : Infinity; // First launch or unknown — always refresh

            if (backgroundDuration >= MIN_BACKGROUND_FOR_REFRESH_MS) {
                console.log(`[Supabase] App resumed after ${Math.round(backgroundDuration / 1000)}s — proactive session refresh`);
                // Fire-and-forget: refresh the token in the background.
                // This warms the HTTP connection and refreshes the JWT so
                // subsequent API calls are instant instead of blocking.
                supabase.auth.getSession().catch((err) => {
                    console.warn('[Supabase] Proactive session refresh failed (non-fatal):', err?.message);
                });
            }
        }
        _prevAppState = nextState;
    });
}

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
    pickup_photo_url?: string;
    manual_completion_reason?: string;
    manual_completion_at?: string;
    created_at: string;
    sender_name?: string;
    sender_phone?: string;
    recipient_name?: string;
    recipient_phone?: string;
    delivery_notes?: string;
}

export interface SmartBoxSummary {
    id: string;
    hardware_mac_address?: string | null;
    current_rider_id?: string | null;
    status?: 'IDLE' | 'IN_TRANSIT' | 'MAINTENANCE' | string | null;
}

export interface ActiveDeliverySummary {
    id: string;
    tracking_number: string;
    status: 'PENDING' | 'IN_TRANSIT' | 'ARRIVED';
    box_id: string;
    created_at: string;
}

export interface AdminDeliveryRecord {
    id: string;
    tracking_number: string;
    status: string;
    rider_id: string;
    customer_id: string;
    created_at: string;
    updated_at: string;
    delivered_at?: string | null;
    estimated_fare?: number | null;
    pickup_address?: string | null;
    dropoff_address?: string | null;
    pickup_lat?: number | null;
    pickup_lng?: number | null;
    dropoff_lat?: number | null;
    dropoff_lng?: number | null;
    proof_of_delivery_url?: string | null;
    pickup_photo_url?: string | null;
    distance?: number | null;
    distance_text?: string | null;
    profiles?: { full_name?: string | null } | null;
    rider_profile?: { full_name?: string | null } | null;
}

export interface ListAdminDeliveryRecordsParams {
    page: number;
    pageSize?: number;
    search?: string;
    status?: string[];
    fromDate?: string;
    toDate?: string;
}

export interface ListAdminDeliveryRecordsResult {
    data: AdminDeliveryRecord[];
    hasMore: boolean;
    error?: string;
}

export async function listActiveDeliveries(limit = 30): Promise<ActiveDeliverySummary[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('deliveries')
        .select('id, tracking_number, status, box_id, created_at')
        .in('status', ['PENDING', 'IN_TRANSIT', 'ARRIVED'])
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error || !data) {
        console.error('Failed to list active deliveries:', error?.message);
        return [];
    }

    return data as ActiveDeliverySummary[];
}

export async function listAdminDeliveryRecords({
    page,
    pageSize = 50,
    search,
    status,
    fromDate,
    toDate,
}: ListAdminDeliveryRecordsParams): Promise<ListAdminDeliveryRecordsResult> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return { data: [], hasMore: false, error: 'Supabase not configured' };
    }

    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, Math.min(pageSize, 200));
    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;

    let query = supabase
        .from('deliveries')
        .select(
            '*, profiles:customer_id(full_name), rider_profile:profiles!deliveries_rider_id_fkey(full_name)',
            { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(from, to);

    if (status && status.length > 0) {
        query = query.in('status', status);
    }

    if (fromDate) {
        query = query.gte('created_at', fromDate);
    }

    if (toDate) {
        query = query.lte('created_at', toDate);
    }

    if (search && search.trim()) {
        const term = search.trim().replace(/,/g, '');
        query = query.or(`tracking_number.ilike.%${term}%,id.ilike.%${term}%`);
    }

    const { data, error, count } = await query;

    if (error || !data) {
        console.error('Failed to list admin delivery records:', error?.message);
        return {
            data: [],
            hasMore: false,
            error: error?.message || 'Failed to load admin delivery records',
        };
    }

    const rows = data as AdminDeliveryRecord[];
    const hasMore = typeof count === 'number' ? to + 1 < count : rows.length === safePageSize;

    return {
        data: rows,
        hasMore,
    };
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

/**
 * List registered smart boxes (Admin pairing QR selection)
 * Mirrors the web admin hardware dashboard source: public.smart_boxes
 */
export async function listSmartBoxes(): Promise<SmartBoxSummary[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('smart_boxes')
        .select('id, hardware_mac_address, current_rider_id, status')
        .order('hardware_mac_address');

    if (error || !data) {
        console.error('Failed to list smart boxes:', error?.message);
        return [];
    }

    return data as SmartBoxSummary[];
}

/**
 * Assign/unassign a smart box to a user in Supabase.
 *
 * Web UI shows "Unassigned" based on smart_boxes.current_rider_id, so we update it here as best-effort.
 * Note: RLS may block this for non-admin roles; failures are returned as false.
 */
export async function setSmartBoxAssignedUser(boxId: string, userId: string | null): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    if (!boxId?.trim()) {
        return false;
    }

    const normalizedBoxId = boxId.trim();

    // 1) Try primary key match (most common)
    const primary = await supabase
        .from('smart_boxes')
        // column name in DB is snake_case
        .update({ current_rider_id: userId })
        .eq('id', normalizedBoxId)
        .select('id');

    if (primary.error) {
        console.warn('Failed to update smart_boxes assignment (by id):', primary.error.message);
        return false;
    }

    if (Array.isArray(primary.data) && primary.data.length > 0) {
        return true;
    }

    // 2) Fallback: some environments store the Firebase key (MAC) in hardware_mac_address while id is different.
    const fallback = await supabase
        .from('smart_boxes')
        .update({ current_rider_id: userId })
        .eq('hardware_mac_address', normalizedBoxId)
        .select('id');

    if (fallback.error) {
        console.warn('Failed to update smart_boxes assignment (by hardware_mac_address):', fallback.error.message);
        return false;
    }

    return Array.isArray(fallback.data) && fallback.data.length > 0;
}
