import { supabase } from './supabaseClient';

const API_BASE_URL = (
    process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
    || process.env.EXPO_PUBLIC_API_URL
    || 'https://parcel-safe.vercel.app'
).replace(/\/+$/, '');

export type AdminRole = 'ADMIN' | 'RIDER' | 'CUSTOMER';

export interface AdminUser {
    id: string;
    email: string;
    full_name?: string | null;
    phone_number?: string | null;
    role: AdminRole;
    created_at?: string;
}

export interface AdminSettings {
    maintenance_mode?: boolean;
    max_otp_attempts?: number;
    otp_validity_minutes?: number;
    geofence_radius?: number;
    battery_warning_threshold?: number;
    battery_critical_threshold?: number;
}

export interface TrackingHistorySession {
    id: string;
    date: string;
    boxId?: string;
    dataConsumedBox?: string;
    dataConsumedPhone?: string;
    distanceMeters?: number;
    routePoints?: Array<[number, number]> | null;
    boxRoutePoints?: Array<[number, number]> | null;
    phoneRoutePoints?: Array<[number, number]> | null;
    pairedSeconds?: number;
    sessionSeconds?: number;
    updatedAt?: string;
    box?: {
        id: string;
        hardwareMacAddress?: string | null;
    } | null;
    [key: string]: unknown;
}

export interface SendReceiptPayload {
    deliveryId?: string;
    email: string;
    trackingNumber?: string;
    date?: string;
    distance?: string;
    duration?: string;
    fare?: string;
    customerName?: string;
    senderName?: string;
    senderPhone?: string;
    pickupAddress?: string;
    dropoffAddress?: string;
    pickupPhotoUrl?: string;
    pickupPhotoTime?: string;
    proofPhotoUrl?: string;
    proofPhotoTime?: string;
    websiteUrl?: string;
}

const PROFILE_SELECT = 'id, email, full_name, phone_number, role, created_at';
const ADMIN_ROLE_CACHE_TTL_MS = 60_000;
const DEFAULT_ADMIN_SETTINGS: Required<AdminSettings> = {
    maintenance_mode: false,
    max_otp_attempts: 5,
    otp_validity_minutes: 10,
    geofence_radius: 100,
    battery_warning_threshold: 20,
    battery_critical_threshold: 10,
};

let adminRoleCache: { userId: string; isAdmin: boolean; expiresAt: number } | null = null;

function isUnauthorizedError(error: unknown): boolean {
    return error instanceof Error && /unauthorized/i.test(error.message);
}

function isMissingSystemSettingsTableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();
    return (
        message.includes('pgrst205')
        || message.includes('42p01')
        || (message.includes('system_settings') && message.includes('schema cache'))
        || (message.includes('system_settings') && message.includes('could not find the table'))
        || (message.includes('relation') && message.includes('system_settings') && message.includes('does not exist'))
    );
}

function isSystemSettingsRlsError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();
    return (
        message.includes('system_settings')
        && (
            message.includes('row-level security')
            || message.includes('permission denied')
            || message.includes('violates row-level security policy')
        )
    );
}

function generateClientUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeAdminUser(row: Record<string, any>): AdminUser {
    return {
        id: String(row.id),
        email: String(row.email || ''),
        full_name: row.full_name ?? null,
        phone_number: row.phone_number ?? null,
        role: (row.role || 'CUSTOMER') as AdminRole,
        created_at: row.created_at ?? undefined,
    };
}

function normalizeAdminSettings(rows: Array<{ key: string; value: unknown }>): AdminSettings {
    return rows.reduce<AdminSettings>((acc, row) => {
        (acc as Record<string, unknown>)[row.key] = row.value;
        return acc;
    }, {});
}

async function assertCurrentUserIsAdmin(): Promise<void> {
    if (!supabase) {
        throw new Error('Supabase not configured');
    }

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        throw new Error('Unauthorized: no authenticated user.');
    }

    const now = Date.now();
    if (adminRoleCache && adminRoleCache.userId === user.id && adminRoleCache.expiresAt > now) {
        if (!adminRoleCache.isAdmin) {
            throw new Error('Unauthorized: admin access required.');
        }
        return;
    }

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (error) {
        throw new Error(error.message);
    }

    const isAdmin = String(profile?.role || '').toUpperCase() === 'ADMIN';
    adminRoleCache = {
        userId: user.id,
        isAdmin,
        expiresAt: now + ADMIN_ROLE_CACHE_TTL_MS,
    };

    if (!isAdmin) {
        throw new Error('Unauthorized: admin access required.');
    }
}

async function getBearerToken(): Promise<string> {
    if (!supabase) {
        throw new Error('Supabase not configured');
    }

    const {
        data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;
    if (!token) {
        throw new Error('No active session token. Please log in again.');
    }

    return token;
}

async function refreshBearerToken(): Promise<string> {
    if (!supabase) {
        throw new Error('Supabase not configured');
    }

    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
        throw new Error('Session expired. Please log in again.');
    }

    const token = data.session?.access_token;
    if (!token) {
        throw new Error('No active session token. Please log in again.');
    }

    return token;
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const buildHeaders = (token: string): Record<string, string> => {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        };

        const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
        if (anonKey) {
            headers.apikey = anonKey;
        }

        if (init.headers) {
            Object.assign(headers, init.headers as Record<string, string>);
        }

        return headers;
    };

    const doRequest = async (token: string) => fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: buildHeaders(token),
    });

    let token = await getBearerToken();
    let response = await doRequest(token);

    if (response.status === 401) {
        try {
            token = await refreshBearerToken();
            response = await doRequest(token);
        } catch {
            // Keep original unauthorized response handling below.
        }
    }

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = response.status === 401
            ? 'Unauthorized: session expired or account lacks admin access.'
            : (body && (body.error || body.message)) || `Request failed (${response.status})`;
        throw new Error(message);
    }

    return body as T;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
    try {
        return await adminRequest<AdminUser[]>('/api/admin/users', { method: 'GET' });
    } catch (error) {
        if (!isUnauthorizedError(error) || !supabase) {
            throw error;
        }

        await assertCurrentUserIsAdmin();

        const { data, error: fallbackError } = await supabase
            .from('profiles')
            .select(PROFILE_SELECT)
            .order('created_at', { ascending: false });

        if (fallbackError) {
            throw new Error(fallbackError.message);
        }

        return (data || []).map((row) => normalizeAdminUser(row));
    }
}

export async function createAdminUser(payload: Pick<AdminUser, 'email' | 'full_name' | 'role'>): Promise<AdminUser> {
    try {
        const result = await adminRequest<{ user: AdminUser }>('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return result.user;
    } catch (error) {
        if (!isUnauthorizedError(error) || !supabase) {
            throw error;
        }

        await assertCurrentUserIsAdmin();

        const { data, error: fallbackError } = await supabase
            .from('profiles')
            .insert({
                id: generateClientUuid(),
                email: payload.email,
                full_name: payload.full_name || null,
                role: payload.role,
            })
            .select(PROFILE_SELECT)
            .single();

        if (fallbackError || !data) {
            throw new Error(fallbackError?.message || 'Failed to create user');
        }

        return normalizeAdminUser(data);
    }
}

export async function updateAdminUser(payload: Pick<AdminUser, 'id' | 'full_name' | 'phone_number' | 'role'>): Promise<AdminUser> {
    try {
        const result = await adminRequest<{ user: AdminUser }>('/api/admin/users', {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        return result.user;
    } catch (error) {
        if (!isUnauthorizedError(error) || !supabase) {
            throw error;
        }

        await assertCurrentUserIsAdmin();

        const { data, error: fallbackError } = await supabase
            .from('profiles')
            .update({
                full_name: payload.full_name || null,
                phone_number: payload.phone_number || null,
                role: payload.role,
            })
            .eq('id', payload.id)
            .select(PROFILE_SELECT)
            .single();

        if (fallbackError || !data) {
            throw new Error(fallbackError?.message || 'Failed to update user');
        }

        return normalizeAdminUser(data);
    }
}

export async function deleteAdminUser(id: string): Promise<void> {
    try {
        await adminRequest('/api/admin/users', {
            method: 'DELETE',
            body: JSON.stringify({ id }),
        });
    } catch (error) {
        if (!isUnauthorizedError(error) || !supabase) {
            throw error;
        }

        await assertCurrentUserIsAdmin();

        const { error: fallbackError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', id);

        if (fallbackError) {
            throw new Error(fallbackError.message);
        }
    }
}

export async function getAdminSettings(): Promise<AdminSettings> {
    try {
        const settings = await adminRequest<AdminSettings>('/api/admin/settings', { method: 'GET' });
        return { ...DEFAULT_ADMIN_SETTINGS, ...(settings || {}) };
    } catch (error) {
        if (isSystemSettingsRlsError(error)) {
            throw new Error('Settings table exists but access is blocked by RLS policies. Apply web/supabase/2026-04-06_system_settings_policies.sql (or web/supabase/policies.sql) and retry.');
        }

        if (isMissingSystemSettingsTableError(error)) {
            return { ...DEFAULT_ADMIN_SETTINGS };
        }

        if (!isUnauthorizedError(error) || !supabase) {
            throw error;
        }

        await assertCurrentUserIsAdmin();

        const { data, error: fallbackError } = await supabase
            .from('system_settings')
            .select('key, value');

        if (fallbackError) {
            if (isSystemSettingsRlsError(new Error(fallbackError.message))) {
                throw new Error('Settings table exists but access is blocked by RLS policies. Apply web/supabase/2026-04-06_system_settings_policies.sql (or web/supabase/policies.sql) and retry.');
            }
            if (isMissingSystemSettingsTableError(new Error(fallbackError.message))) {
                return { ...DEFAULT_ADMIN_SETTINGS };
            }
            throw new Error(fallbackError.message);
        }

        const normalized = normalizeAdminSettings((data || []) as Array<{ key: string; value: unknown }>);
        return { ...DEFAULT_ADMIN_SETTINGS, ...normalized };
    }
}

export async function saveAdminSettings(settings: AdminSettings): Promise<void> {
    try {
        await adminRequest('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify(settings),
        });
    } catch (error) {
        if (isSystemSettingsRlsError(error)) {
            throw new Error('Settings table exists but access is blocked by RLS policies. Apply web/supabase/2026-04-06_system_settings_policies.sql (or web/supabase/policies.sql) and retry.');
        }

        if (isMissingSystemSettingsTableError(error)) {
            throw new Error('Settings storage table is missing. Apply web/supabase/2026-04-06_system_settings.sql and retry.');
        }

        if (!isUnauthorizedError(error) || !supabase) {
            throw error;
        }

        await assertCurrentUserIsAdmin();

        const rows = Object.entries(settings)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => ({
                key,
                value,
                updated_at: new Date().toISOString(),
            }));

        if (rows.length === 0) {
            return;
        }

        const { error: fallbackError } = await supabase
            .from('system_settings')
            .upsert(rows, { onConflict: 'key' });

        if (fallbackError) {
            if (isSystemSettingsRlsError(new Error(fallbackError.message))) {
                throw new Error('Settings table exists but access is blocked by RLS policies. Apply web/supabase/2026-04-06_system_settings_policies.sql (or web/supabase/policies.sql) and retry.');
            }
            if (isMissingSystemSettingsTableError(new Error(fallbackError.message))) {
                throw new Error('Settings storage table is missing. Apply web/supabase/2026-04-06_system_settings.sql and retry.');
            }
            throw new Error(fallbackError.message);
        }
    }
}

export async function sendAdminReceipt(payload: SendReceiptPayload): Promise<void> {
    await adminRequest('/api/send-receipt', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function listTrackingHistorySessions(days = 30): Promise<TrackingHistorySession[]> {
    const result = await adminRequest<{ sessions?: TrackingHistorySession[] }>(`/api/tracking-session/history?days=${days}`, {
        method: 'GET',
    });
    return Array.isArray(result.sessions) ? result.sessions : [];
}
