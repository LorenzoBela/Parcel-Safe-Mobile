/**
 * In-App Notification Service
 *
 * Wraps the Next.js web API endpoints for in-app notification management:
 *   GET  /api/notifications/list   – Fetch notifications + unread count
 *   POST /api/notifications/read   – Mark one/all as read
 *   POST /api/notifications/clear  – Delete one/all notifications
 */

const API_BASE_URL =
    process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppNotification {
    id: string;
    userId: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    createdAt: string;
    deliveryId?: string | null;
}

export interface NotificationListResponse {
    notifications: AppNotification[];
    unreadCount: number;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function jsonPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`[NotificationService] ${path} failed (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
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
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`[NotificationService] list failed (${response.status})`);
    }

    return response.json() as Promise<NotificationListResponse>;
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
