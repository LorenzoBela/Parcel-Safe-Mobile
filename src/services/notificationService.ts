/**
 * In-App Notification Service
 *
 * Wraps the Next.js web API endpoints for in-app notification management:
 *   GET  /api/notifications/list   – Fetch notifications + unread count
 *   POST /api/notifications/read   – Mark one/all as read
 *   POST /api/notifications/clear  – Delete one/all notifications
 */

import { getPromoHistory } from './scheduledPromoService';
import { supabase } from './supabaseClient';

const API_BASE_URL =
    process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppNotification {
    id: string;
    userId: string;
    title: string;
    message: string;
    type: string;
    category: NotificationCategory;
    read: boolean;
    createdAt: string;
    deliveryId?: string | null;
    source?: 'server' | 'local-promo';
}

export type NotificationCategory = 'ORDER_UPDATES' | 'ADS' | 'OTHER';

export interface NotificationListResponse {
    notifications: AppNotification[];
    unreadCount: number;
}

interface RawNotification {
    id: string;
    userId: string;
    title: string;
    message?: string;
    body?: string;
    type: string;
    category?: string;
    read: boolean;
    createdAt: string;
    deliveryId?: string | null;
}

export function categorizeNotificationType(type: string): NotificationCategory {
    switch (type) {
        case 'ORDER_ACCEPTED':
        case 'PARCEL_PICKED_UP':
        case 'RIDER_EN_ROUTE':
        case 'RIDER_ARRIVED':
        case 'DELIVERY_COMPLETED':
            return 'ORDER_UPDATES';
        case 'PROMO':
            return 'ADS';
        default:
            return 'OTHER';
    }
}

function normalizeNotification(raw: RawNotification): AppNotification {
    const category: NotificationCategory =
        raw.category === 'ORDER_UPDATES' || raw.category === 'ADS' || raw.category === 'OTHER'
            ? raw.category
            : categorizeNotificationType(raw.type);

    return {
        id: raw.id,
        userId: raw.userId,
        title: raw.title,
        message: raw.message || raw.body || '',
        type: raw.type,
        category,
        read: raw.read,
        createdAt: raw.createdAt,
        deliveryId: raw.deliveryId ?? null,
        source: 'server',
    };
}

function mergeAndSortNotifications(serverNotifs: AppNotification[], localPromoNotifs: AppNotification[]): AppNotification[] {
    const merged = [...serverNotifs, ...localPromoNotifs];

    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return merged;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function jsonPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const headers = await getAuthHeaders(true);
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`[NotificationService] ${path} failed (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
}

async function getAccessToken(): Promise<string> {
    if (!supabase) {
        throw new Error('[NotificationService] Supabase client is unavailable.');
    }

    const {
        data: { session },
        error,
    } = await supabase.auth.getSession();

    if (error || !session?.access_token) {
        throw new Error('[NotificationService] Not authenticated.');
    }

    return session.access_token;
}

async function getAuthHeaders(withJsonContentType: boolean): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return withJsonContentType
        ? {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
        : {
            Authorization: `Bearer ${token}`,
        };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fetch notifications for a user.
 */
export async function fetchNotifications(
    userId: string,
    limit = 30,
): Promise<NotificationListResponse> {
    const url = `${API_BASE_URL}/api/notifications/list?userId=${encodeURIComponent(userId)}&limit=${limit}`;
    const headers = await getAuthHeaders(false);
    const response = await fetch(url, { headers });

    if (!response.ok) {
        throw new Error(`[NotificationService] list failed (${response.status})`);
    }

    const data = await response.json() as {
        notifications: RawNotification[];
        unreadCount: number;
    };

    const serverNotifications = (data.notifications || []).map(normalizeNotification);

    const promoHistory = await getPromoHistory(limit);
    const localPromoNotifications: AppNotification[] = promoHistory.map((promo) => ({
        id: promo.id,
        userId,
        title: promo.title,
        message: promo.body,
        type: 'PROMO',
        category: 'ADS',
        read: Boolean(promo.read),
        createdAt: promo.createdAt,
        deliveryId: null,
        source: 'local-promo',
    }));

    const notifications = mergeAndSortNotifications(serverNotifications, localPromoNotifications);
    const unreadCount = notifications.filter((notification) => !notification.read).length;

    return {
        unreadCount,
        notifications,
    };
}

/**
 * Mark a single notification as read, or mark all as read for a user.
 */
export async function markNotificationsRead(
    opts: { notificationId: string } | { userId: string; all: true },
): Promise<void> {
    await jsonPost('/api/notifications/read', opts as Record<string, unknown>);
}

/**
 * Clear (delete) a single notification, or all notifications for a user.
 */
export async function clearNotifications(
    opts: { notificationId: string } | { userId: string; all: true },
): Promise<void> {
    await jsonPost('/api/notifications/clear', opts as Record<string, unknown>);
}
