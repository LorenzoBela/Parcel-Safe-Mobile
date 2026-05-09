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
    avatar_url?: string | null;
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

export interface AdminAnalyticsKpis {
    totalDeliveries: number;
    completedDeliveries: number;
    cancelledDeliveries: number;
    activeDeliveries: number;
    revenue: number;
    cancellationRate: number;
    averageCompletionMinutes: number | null;
    onTimeRate: number | null;
    onTimeDeliveries: number;
    onTimeSampleSize: number;
    distanceKm: number;
    trips: number;
    pairedHours: number;
    sessionHours: number;
}

export interface AdminAnalyticsTrendPoint {
    date: string;
    deliveries: number;
    completed: number;
    cancelled: number;
    revenue: number;
    distanceKm: number;
    trips: number;
}

export interface AdminAnalyticsStatusBucket {
    status: string;
    count: number;
}

export interface AdminAnalyticsLeaderboardEntry {
    rank: number;
    riderId: string;
    riderName: string;
    riderEmail: string | null;
    completedDeliveries: number;
    revenue: number;
    averageCompletionMinutes: number | null;
}

export interface AdminAnalyticsDetailRow {
    id: string;
    trackingNumber: string;
    status: string;
    estimatedFare: number | null;
    createdAt: string;
    deliveredAt: string | null;
    boxId: string | null;
    riderId: string | null;
    recipientName: string | null;
    pickupAddress: string | null;
    dropoffAddress: string | null;
    rider: {
        id: string;
        fullName: string | null;
        email: string;
    } | null;
    customer: {
        id: string;
        fullName: string | null;
        email: string;
    } | null;
}

export interface AdminAnalyticsResponse {
    generatedAt?: string;
    filters?: {
        fromDate: string;
        toDate: string;
        dayCount: number;
        statuses: string[];
        riderIds: string[];
        boxIds: string[];
        query: string;
        page: number;
        pageSize: number;
    };
    kpis: AdminAnalyticsKpis;
    statusBreakdown: AdminAnalyticsStatusBucket[];
    trend: AdminAnalyticsTrendPoint[];
    leaderboard: AdminAnalyticsLeaderboardEntry[];
    details: {
        rows: AdminAnalyticsDetailRow[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    };
}

export interface AdminAnalyticsQuery {
    fromDate?: string;
    toDate?: string;
    days?: number;
    statuses?: string[];
    riderIds?: string[];
    boxIds?: string[];
    q?: string;
    page?: number;
    pageSize?: number;
    leaderboardLimit?: number;
}

const PROFILE_SELECT = 'id, email, full_name, phone_number, role, avatar_url, created_at';
const ADMIN_ROLE_CACHE_TTL_MS = 60_000;
const DEFAULT_ADMIN_SETTINGS: Required<AdminSettings> = {
    maintenance_mode: false,
    max_otp_attempts: 5,
    otp_validity_minutes: 10,
    geofence_radius: 100,
    battery_warning_threshold: 20,
    battery_critical_threshold: 10,
};
const DEFAULT_ADMIN_ANALYTICS_DAYS = 30;
const MAX_ADMIN_ANALYTICS_LOOKBACK_DAYS = 180;
const DEFAULT_ADMIN_ANALYTICS_PAGE_SIZE = 20;
const MAX_ADMIN_ANALYTICS_PAGE_SIZE = 100;
const DEFAULT_ADMIN_ANALYTICS_LEADERBOARD_LIMIT = 10;
const MAX_ADMIN_ANALYTICS_LEADERBOARD_LIMIT = 50;
const ANALYTICS_STATUS_ORDER = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'TAMPERED', 'CANCELLED'] as const;

let adminRoleCache: { userId: string; isAdmin: boolean; expiresAt: number } | null = null;

function isUnauthorizedError(error: unknown): boolean {
    return error instanceof Error && /unauthorized/i.test(error.message);
}

function isNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();
    return message.includes('404') || message.includes('not found');
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function toPhDateKey(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function normalizeDateKey(value?: string): string | null {
    if (!value) {
        return null;
    }

    const normalized = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return null;
    }

    const parsed = new Date(`${normalized}T00:00:00+08:00`);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return normalized;
}

function phDateStart(dateKey: string): Date {
    return new Date(`${dateKey}T00:00:00+08:00`);
}

function phDateEnd(dateKey: string): Date {
    return new Date(`${dateKey}T23:59:59.999+08:00`);
}

function toNumeric(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toDateKeyFromIso(value: unknown): string | null {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return toPhDateKey(parsed);
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
        avatar_url: row.avatar_url ?? null,
        created_at: row.created_at ?? undefined,
    };
}

function normalizeAdminSettings(rows: Array<{ key: string; value: unknown }>): AdminSettings {
    return rows.reduce<AdminSettings>((acc, row) => {
        (acc as Record<string, unknown>)[row.key] = row.value;
        return acc;
    }, {});
}

async function hydrateMissingAvatarUrls(users: AdminUser[]): Promise<AdminUser[]> {
    if (!supabase || users.length === 0) {
        return users;
    }

    const missingAvatarIds = users
        .filter((user) => !user.avatar_url)
        .map((user) => user.id)
        .filter(Boolean);

    if (missingAvatarIds.length === 0) {
        return users;
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('id, avatar_url')
        .in('id', missingAvatarIds);

    if (error || !data) {
        return users;
    }

    const avatarById = new Map<string, string | null>(
        data.map((row: Record<string, any>) => [String(row.id), row.avatar_url ?? null]),
    );

    return users.map((user) => {
        if (!avatarById.has(user.id)) {
            return user;
        }

        return {
            ...user,
            avatar_url: avatarById.get(user.id) ?? null,
        };
    });
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
        const users = await adminRequest<AdminUser[]>('/api/admin/users', { method: 'GET' });
        return await hydrateMissingAvatarUrls(users || []);
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

export type AdminStolenBoxAction = 'MARK_STOLEN' | 'LOCKDOWN' | 'LIFT_LOCKDOWN' | 'CLEAR_STOLEN_RESTORE';

export async function updateAdminStolenBox(
    boxId: string,
    action: AdminStolenBoxAction,
    note?: string,
): Promise<{ success: boolean; boxId: string; state: string }> {
    return adminRequest<{ success: boolean; boxId: string; state: string }>('/api/admin/stolen-boxes', {
        method: 'PATCH',
        body: JSON.stringify({ boxId, action, note }),
    });
}

async function getAdminAnalyticsReportFallback(query: AdminAnalyticsQuery = {}): Promise<AdminAnalyticsResponse> {
    if (!supabase) {
        throw new Error('Supabase not configured');
    }

    await assertCurrentUserIsAdmin();

    const now = new Date();
    const requestedDays = clampNumber(
        typeof query.days === 'number' ? query.days : DEFAULT_ADMIN_ANALYTICS_DAYS,
        1,
        MAX_ADMIN_ANALYTICS_LOOKBACK_DAYS,
    );

    let fromDate = normalizeDateKey(query.fromDate);
    let toDate = normalizeDateKey(query.toDate);

    if (!toDate) {
        toDate = toPhDateKey(now);
    }

    if (!fromDate) {
        const computedStart = new Date(now);
        computedStart.setDate(computedStart.getDate() - (requestedDays - 1));
        fromDate = toPhDateKey(computedStart);
    }

    if (fromDate > toDate) {
        const oldFrom = fromDate;
        fromDate = toDate;
        toDate = oldFrom;
    }

    let startAt = phDateStart(fromDate);
    const endAt = phDateEnd(toDate);
    let dayCount = Math.floor((endAt.getTime() - startAt.getTime()) / 86_400_000) + 1;

    if (dayCount > MAX_ADMIN_ANALYTICS_LOOKBACK_DAYS) {
        const cappedStart = new Date(endAt);
        cappedStart.setDate(cappedStart.getDate() - (MAX_ADMIN_ANALYTICS_LOOKBACK_DAYS - 1));
        fromDate = toPhDateKey(cappedStart);
        startAt = phDateStart(fromDate);
        dayCount = MAX_ADMIN_ANALYTICS_LOOKBACK_DAYS;
    }

    const statuses = (query.statuses || [])
        .map((status) => String(status || '').toUpperCase())
        .filter((status): status is string => ANALYTICS_STATUS_ORDER.some((allowed) => allowed === status));

    const riderIds = (query.riderIds || []).map((value) => String(value)).filter(Boolean);
    const boxIds = (query.boxIds || []).map((value) => String(value)).filter(Boolean);
    const searchTerm = String(query.q || '').trim().toLowerCase();

    const requestedPage = Math.max(1, Number(query.page || 1));
    const pageSize = clampNumber(
        Number(query.pageSize || DEFAULT_ADMIN_ANALYTICS_PAGE_SIZE),
        1,
        MAX_ADMIN_ANALYTICS_PAGE_SIZE,
    );
    const leaderboardLimit = clampNumber(
        Number(query.leaderboardLimit || DEFAULT_ADMIN_ANALYTICS_LEADERBOARD_LIMIT),
        1,
        MAX_ADMIN_ANALYTICS_LEADERBOARD_LIMIT,
    );

    let deliveryQuery = supabase
        .from('deliveries')
        .select('id, tracking_number, status, estimated_fare, created_at, delivered_at, picked_up_at, accepted_at, estimated_dropoff_time, rider_id, box_id, recipient_name, pickup_address, dropoff_address, customer_id')
        .gte('created_at', startAt.toISOString())
        .lte('created_at', endAt.toISOString())
        .order('created_at', { ascending: false })
        .range(0, 1999);

    if (statuses.length > 0) {
        deliveryQuery = deliveryQuery.in('status', statuses);
    }

    if (riderIds.length > 0) {
        deliveryQuery = deliveryQuery.in('rider_id', riderIds);
    }

    if (boxIds.length > 0) {
        deliveryQuery = deliveryQuery.in('box_id', boxIds);
    }

    const { data: deliveryRowsRaw, error: deliveryError } = await deliveryQuery;
    if (deliveryError) {
        throw new Error(deliveryError.message);
    }

    const deliveryRows = (deliveryRowsRaw || []) as Array<Record<string, any>>;

    const filteredDeliveries = deliveryRows.filter((row) => {
        if (!searchTerm) {
            return true;
        }

        const haystack = [
            row.id,
            row.tracking_number,
            row.recipient_name,
            row.pickup_address,
            row.dropoff_address,
        ]
            .map((value) => String(value || '').toLowerCase());

        return haystack.some((value) => value.includes(searchTerm));
    });

    const profileIds = Array.from(new Set(
        filteredDeliveries
            .flatMap((row) => [row.rider_id, row.customer_id])
            .filter(Boolean)
            .map((value) => String(value)),
    ));

    const profileById = new Map<string, { id: string; full_name: string | null; email: string }>();
    if (profileIds.length > 0) {
        const { data: profilesRaw } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', profileIds);

        for (const profile of profilesRaw || []) {
            profileById.set(String(profile.id), {
                id: String(profile.id),
                full_name: profile.full_name ?? null,
                email: String(profile.email || ''),
            });
        }
    }

    let trackingQuery = supabase
        .from('tracking_sessions')
        .select('date, distance_meters, paired_seconds, session_seconds, box_id')
        .gte('date', fromDate)
        .lte('date', toDate)
        .range(0, 3999);

    if (boxIds.length > 0) {
        trackingQuery = trackingQuery.in('box_id', boxIds);
    }

    const { data: trackingRowsRaw, error: trackingError } = await trackingQuery;
    if (trackingError) {
        throw new Error(trackingError.message);
    }

    const trackingRows = (trackingRowsRaw || []) as Array<Record<string, any>>;

    const trendKeys: string[] = [];
    const trendMap = new Map<string, AdminAnalyticsTrendPoint>();

    const cursor = new Date(startAt);
    while (cursor <= endAt) {
        const key = toPhDateKey(cursor);
        trendKeys.push(key);
        trendMap.set(key, {
            date: key,
            deliveries: 0,
            completed: 0,
            cancelled: 0,
            revenue: 0,
            distanceKm: 0,
            trips: 0,
        });
        cursor.setDate(cursor.getDate() + 1);
    }

    const statusCounts = new Map<string, number>();
    const completedRows: Array<Record<string, any>> = [];
    const cancelledRows: Array<Record<string, any>> = [];
    const completionMinutes: number[] = [];
    let completedRevenue = 0;
    let onTimeDeliveries = 0;
    let onTimeSampleSize = 0;

    for (const row of filteredDeliveries) {
        const status = String(row.status || '').toUpperCase();
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1);

        const createdKey = toDateKeyFromIso(row.created_at);
        if (createdKey && trendMap.has(createdKey)) {
            const bucket = trendMap.get(createdKey)!;
            bucket.deliveries += 1;

            if (status === 'COMPLETED') {
                bucket.completed += 1;
                bucket.revenue += toNumeric(row.estimated_fare);
            }

            if (status === 'CANCELLED') {
                bucket.cancelled += 1;
            }
        }

        if (status === 'COMPLETED') {
            completedRows.push(row);
            completedRevenue += toNumeric(row.estimated_fare);

            const deliveredAt = row.delivered_at ? new Date(String(row.delivered_at)) : null;
            const startRaw = row.picked_up_at || row.accepted_at || row.created_at;
            const startAtDate = startRaw ? new Date(String(startRaw)) : null;

            if (deliveredAt && startAtDate && !Number.isNaN(deliveredAt.getTime()) && !Number.isNaN(startAtDate.getTime())) {
                const minutes = (deliveredAt.getTime() - startAtDate.getTime()) / 60_000;
                if (Number.isFinite(minutes) && minutes >= 0) {
                    completionMinutes.push(minutes);
                }
            }

            if (row.estimated_dropoff_time && deliveredAt && !Number.isNaN(deliveredAt.getTime())) {
                const estimatedDropoff = new Date(String(row.estimated_dropoff_time));
                if (!Number.isNaN(estimatedDropoff.getTime())) {
                    onTimeSampleSize += 1;
                    if (deliveredAt.getTime() <= estimatedDropoff.getTime()) {
                        onTimeDeliveries += 1;
                    }
                }
            }
        }

        if (status === 'CANCELLED') {
            cancelledRows.push(row);
        }
    }

    let totalDistanceMeters = 0;
    let totalPairedSeconds = 0;
    let totalSessionSeconds = 0;
    let totalTrips = 0;

    for (const row of trackingRows) {
        const dateKey = normalizeDateKey(String(row.date || '')) || toDateKeyFromIso(row.date) || '';
        const distanceMeters = toNumeric(row.distance_meters);
        const pairedSeconds = toNumeric(row.paired_seconds);
        const sessionSeconds = toNumeric(row.session_seconds);

        totalDistanceMeters += distanceMeters;
        totalPairedSeconds += pairedSeconds;
        totalSessionSeconds += sessionSeconds;
        totalTrips += 1;

        if (trendMap.has(dateKey)) {
            const bucket = trendMap.get(dateKey)!;
            bucket.distanceKm += distanceMeters / 1000;
            bucket.trips += 1;
        }
    }

    const leaderboardAccumulator = new Map<string, {
        riderId: string;
        completedDeliveries: number;
        revenue: number;
        totalCompletionMinutes: number;
        completionSamples: number;
    }>();

    for (const row of completedRows) {
        const riderId = row.rider_id ? String(row.rider_id) : '';
        if (!riderId) {
            continue;
        }

        const existing = leaderboardAccumulator.get(riderId) || {
            riderId,
            completedDeliveries: 0,
            revenue: 0,
            totalCompletionMinutes: 0,
            completionSamples: 0,
        };

        existing.completedDeliveries += 1;
        existing.revenue += toNumeric(row.estimated_fare);

        const deliveredAt = row.delivered_at ? new Date(String(row.delivered_at)) : null;
        const startRaw = row.picked_up_at || row.accepted_at || row.created_at;
        const startAtDate = startRaw ? new Date(String(startRaw)) : null;

        if (deliveredAt && startAtDate && !Number.isNaN(deliveredAt.getTime()) && !Number.isNaN(startAtDate.getTime())) {
            const minutes = (deliveredAt.getTime() - startAtDate.getTime()) / 60_000;
            if (Number.isFinite(minutes) && minutes >= 0) {
                existing.totalCompletionMinutes += minutes;
                existing.completionSamples += 1;
            }
        }

        leaderboardAccumulator.set(riderId, existing);
    }

    const leaderboard = Array.from(leaderboardAccumulator.values())
        .sort((a, b) => {
            if (b.completedDeliveries !== a.completedDeliveries) {
                return b.completedDeliveries - a.completedDeliveries;
            }
            return b.revenue - a.revenue;
        })
        .slice(0, leaderboardLimit)
        .map((entry, index) => {
            const profile = profileById.get(entry.riderId);
            return {
                rank: index + 1,
                riderId: entry.riderId,
                riderName: profile?.full_name || profile?.email || 'Unknown Rider',
                riderEmail: profile?.email || null,
                completedDeliveries: entry.completedDeliveries,
                revenue: roundTo(entry.revenue, 2),
                averageCompletionMinutes: entry.completionSamples > 0
                    ? roundTo(entry.totalCompletionMinutes / entry.completionSamples, 1)
                    : null,
            } as AdminAnalyticsLeaderboardEntry;
        });

    const sortedDetails = [...filteredDeliveries].sort((a, b) => {
        const bTime = new Date(String(b.created_at || 0)).getTime();
        const aTime = new Date(String(a.created_at || 0)).getTime();
        return bTime - aTime;
    });

    const detailsTotal = sortedDetails.length;
    const totalPages = Math.max(1, Math.ceil(detailsTotal / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const pageStart = (page - 1) * pageSize;
    const pageRows = sortedDetails.slice(pageStart, pageStart + pageSize);

    const detailsRows: AdminAnalyticsDetailRow[] = pageRows.map((row) => {
        const rider = row.rider_id ? profileById.get(String(row.rider_id)) : null;
        const customer = row.customer_id ? profileById.get(String(row.customer_id)) : null;

        return {
            id: String(row.id),
            trackingNumber: String(row.tracking_number || ''),
            status: String(row.status || 'UNKNOWN'),
            estimatedFare: row.estimated_fare == null ? null : toNumeric(row.estimated_fare),
            createdAt: String(row.created_at || ''),
            deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
            boxId: row.box_id ? String(row.box_id) : null,
            riderId: row.rider_id ? String(row.rider_id) : null,
            recipientName: row.recipient_name ? String(row.recipient_name) : null,
            pickupAddress: row.pickup_address ? String(row.pickup_address) : null,
            dropoffAddress: row.dropoff_address ? String(row.dropoff_address) : null,
            rider: rider ? {
                id: rider.id,
                fullName: rider.full_name,
                email: rider.email,
            } : null,
            customer: customer ? {
                id: customer.id,
                fullName: customer.full_name,
                email: customer.email,
            } : null,
        };
    });

    const totalDeliveries = filteredDeliveries.length;
    const completedDeliveries = completedRows.length;
    const cancelledDeliveries = cancelledRows.length;
    const activeDeliveries = totalDeliveries - completedDeliveries - cancelledDeliveries;

    const statusBreakdown: AdminAnalyticsStatusBucket[] = ANALYTICS_STATUS_ORDER.map((status) => ({
        status,
        count: statusCounts.get(status) || 0,
    }));

    const trend = trendKeys.map((key) => {
        const item = trendMap.get(key)!;
        return {
            ...item,
            revenue: roundTo(item.revenue, 2),
            distanceKm: roundTo(item.distanceKm, 2),
        };
    });

    const averageCompletionMinutes = completionMinutes.length > 0
        ? roundTo(completionMinutes.reduce((acc, value) => acc + value, 0) / completionMinutes.length, 1)
        : null;

    const onTimeRate = onTimeSampleSize > 0
        ? roundTo((onTimeDeliveries / onTimeSampleSize) * 100, 2)
        : null;

    return {
        generatedAt: new Date().toISOString(),
        filters: {
            fromDate,
            toDate,
            dayCount,
            statuses,
            riderIds,
            boxIds,
            query: searchTerm,
            page,
            pageSize,
        },
        kpis: {
            totalDeliveries,
            completedDeliveries,
            cancelledDeliveries,
            activeDeliveries,
            revenue: roundTo(completedRevenue, 2),
            cancellationRate: totalDeliveries > 0 ? roundTo((cancelledDeliveries / totalDeliveries) * 100, 2) : 0,
            averageCompletionMinutes,
            onTimeRate,
            onTimeDeliveries,
            onTimeSampleSize,
            distanceKm: roundTo(totalDistanceMeters / 1000, 2),
            trips: totalTrips,
            pairedHours: roundTo(totalPairedSeconds / 3600, 2),
            sessionHours: roundTo(totalSessionSeconds / 3600, 2),
        },
        statusBreakdown,
        trend,
        leaderboard,
        details: {
            rows: detailsRows,
            total: detailsTotal,
            page,
            pageSize,
            totalPages,
        },
    };
}

export async function getAdminAnalyticsReport(query: AdminAnalyticsQuery = {}): Promise<AdminAnalyticsResponse> {
    const params = new URLSearchParams();

    if (query.fromDate) params.set('fromDate', query.fromDate);
    if (query.toDate) params.set('toDate', query.toDate);
    if (typeof query.days === 'number') params.set('days', String(query.days));
    if (Array.isArray(query.statuses) && query.statuses.length > 0) params.set('statuses', query.statuses.join(','));
    if (Array.isArray(query.riderIds) && query.riderIds.length > 0) params.set('riderIds', query.riderIds.join(','));
    if (Array.isArray(query.boxIds) && query.boxIds.length > 0) params.set('boxIds', query.boxIds.join(','));
    if (query.q) params.set('q', query.q);
    if (typeof query.page === 'number') params.set('page', String(query.page));
    if (typeof query.pageSize === 'number') params.set('pageSize', String(query.pageSize));
    if (typeof query.leaderboardLimit === 'number') params.set('leaderboardLimit', String(query.leaderboardLimit));

    const suffix = params.toString() ? `?${params.toString()}` : '';
    try {
        return await adminRequest<AdminAnalyticsResponse>(`/api/admin/analytics${suffix}`, { method: 'GET' });
    } catch (error) {
        const shouldFallback = Boolean(supabase) && (isNotFoundError(error) || isUnauthorizedError(error));
        if (!shouldFallback) {
            throw error;
        }

        return getAdminAnalyticsReportFallback(query);
    }
}
