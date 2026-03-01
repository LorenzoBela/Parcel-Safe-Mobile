import type { LocationData } from "../types";

// Haversine formula
export const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371; // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Merge distance thresholds (metres)
const MERGE_THRESHOLD_M = 50;   // blend up to this distance
const DISCARD_THRESHOLD_M = 150; // beyond this the sources have definitely diverged

export const consolidateLocation = (boxLoc: LocationData | null, phoneLoc: LocationData | null): LocationData | null => {
    if (!boxLoc && !phoneLoc) return null;

    const now = Date.now();
    let boxTime = boxLoc?.server_timestamp || boxLoc?.timestamp || 0;
    let phoneTime = phoneLoc?.server_timestamp || phoneLoc?.timestamp || 0;

    // Normalize to milliseconds if they are in seconds
    if (boxTime > 0 && boxTime < 1e12) boxTime *= 1000;
    if (phoneTime > 0 && phoneTime < 1e12) phoneTime *= 1000;

    const boxFresh = boxLoc && (now - boxTime) <= 30000;
    const phoneFresh = phoneLoc && (now - phoneTime) <= 30000;

    if (boxFresh && phoneFresh) {
        const distM = calculateDistance(boxLoc.latitude, boxLoc.longitude, phoneLoc.latitude, phoneLoc.longitude) * 1000;

        // Sources have diverged beyond recovery — one GPS is clearly wrong, trust the hardware
        if (distM > DISCARD_THRESHOLD_M) {
            return { ...boxLoc, timestamp: boxTime };
        }

        // Accuracy-weighted blend using inverse-variance weighting (1/σ²).
        // Box: use HDOP×5 as CEP proxy when no explicit accuracy field.
        // Phone: use the accuracy field reported by the OS location API.
        const boxAccM: number = boxLoc.accuracy ?? (boxLoc.hdop != null ? boxLoc.hdop * 5 : 10);
        const phoneAccM: number = phoneLoc.accuracy ?? 20;

        // Phone blend weight fades linearly to 0 as divergence approaches DISCARD_THRESHOLD_M
        const distanceFade = distM <= MERGE_THRESHOLD_M
            ? 1
            : 1 - (distM - MERGE_THRESHOLD_M) / (DISCARD_THRESHOLD_M - MERGE_THRESHOLD_M);

        const wBox = 1 / (boxAccM * boxAccM);
        const wPhone = (1 / (phoneAccM * phoneAccM)) * distanceFade;
        const wTotal = wBox + wPhone;

        return {
            ...boxLoc,
            latitude: (boxLoc.latitude * wBox + phoneLoc.latitude * wPhone) / wTotal,
            longitude: (boxLoc.longitude * wBox + phoneLoc.longitude * wPhone) / wTotal,
            accuracy: 1 / Math.sqrt(wTotal),
            source: 'consolidated' as any,
            timestamp: Math.max(boxTime, phoneTime),
        };
    }

    if (boxFresh) return boxLoc;
    if (phoneFresh) return phoneLoc;

    // Both are stale. Fast fallback to whoever last spoke
    if (boxTime >= phoneTime) {
        return boxLoc || phoneLoc;
    } else {
        return phoneLoc || boxLoc;
    }
};
