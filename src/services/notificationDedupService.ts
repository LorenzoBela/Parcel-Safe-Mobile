import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIF_DEDUP_KEY = 'notif_processed_ids_v1';
const MAX_ITEMS = 200;
const TTL_MS = 24 * 60 * 60 * 1000;

type DedupRecord = Record<string, number>;

function buildNotificationKey(message: any): string {
    const data = message?.data || {};
    const type = String(data.type || '').toUpperCase();

    // Promo campaigns can be sent more than once with different messageIds
    // (e.g., duplicate backend fanout or multiple valid device tokens). Use
    // campaign slot/content key to suppress duplicate tray notifications.
    if (type === 'PROMO' || type === 'PROMO_SCHEDULED') {
        const campaignSlot = String(data.campaignSlot || '').trim();
        const title = String(data.title || message?.notification?.title || '').trim();
        const body = String(data.body || message?.notification?.body || '').trim();
        const sentTime = Number(message?.sentTime || data.sentTime || Date.now());
        const slotBucket = campaignSlot || String(Math.floor(sentTime / (2 * 60 * 60 * 1000)));
        return `promo:${slotBucket}:${title}:${body}`;
    }

    const explicitId = message?.messageId || message?.message_id || data.messageId || data.id;
    if (explicitId) return `id:${String(explicitId)}`;

    const fallbackType = String(data.type || 'unknown');
    const deliveryId = String(data.deliveryId || data.delivery_id || data.orderId || data.bookingId || 'none');
    const sentTime = Number(message?.sentTime || data.sentTime || Date.now());
    return `fallback:${fallbackType}:${deliveryId}:${Math.floor(sentTime / 15000)}`;
}

async function loadMap(): Promise<DedupRecord> {
    try {
        const raw = await AsyncStorage.getItem(NOTIF_DEDUP_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

async function saveMap(map: DedupRecord): Promise<void> {
    try {
        await AsyncStorage.setItem(NOTIF_DEDUP_KEY, JSON.stringify(map));
    } catch {
        // Best-effort dedup persistence only.
    }
}

function cleanup(map: DedupRecord, now: number): DedupRecord {
    const entries = Object.entries(map)
        .filter(([, ts]) => now - Number(ts) <= TTL_MS)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, MAX_ITEMS);
    return Object.fromEntries(entries);
}

export async function shouldProcessNotification(message: any): Promise<boolean> {
    const now = Date.now();
    const key = buildNotificationKey(message);
    const map = cleanup(await loadMap(), now);

    if (map[key]) {
        return false;
    }

    map[key] = now;
    await saveMap(map);
    return true;
}
