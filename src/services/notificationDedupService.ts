import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIF_DEDUP_KEY = 'notif_processed_ids_v1';
const MAX_ITEMS = 200;
const TTL_MS = 24 * 60 * 60 * 1000;

type DedupRecord = Record<string, number>;

function buildNotificationKey(message: any): string {
    const data = message?.data || {};
    const explicitId = message?.messageId || message?.message_id || data.messageId || data.id;
    if (explicitId) return `id:${String(explicitId)}`;

    const type = String(data.type || 'unknown');
    const deliveryId = String(data.deliveryId || data.delivery_id || data.orderId || data.bookingId || 'none');
    const sentTime = Number(message?.sentTime || data.sentTime || Date.now());
    return `fallback:${type}:${deliveryId}:${Math.floor(sentTime / 15000)}`;
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
