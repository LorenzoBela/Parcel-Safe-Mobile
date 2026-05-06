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

export const consolidateLocation = (boxLoc: LocationData | null, phoneLoc: LocationData | null): LocationData | null => {
    if (!boxLoc && !phoneLoc) return null;

    const now = Date.now();
    let boxTime = boxLoc?.server_timestamp || boxLoc?.timestamp || 0;
    let phoneTime = phoneLoc?.server_timestamp || phoneLoc?.timestamp || 0;

    // Normalize to milliseconds if they are in seconds.
    if (boxTime > 0 && boxTime < 1e12) boxTime *= 1000;
    if (phoneTime > 0 && phoneTime < 1e12) phoneTime *= 1000;

    const boxFresh = boxLoc && (now - boxTime) <= 30000;
    const phoneFresh = phoneLoc && (now - phoneTime) <= 30000;

    if (phoneFresh) return phoneLoc;
    if (boxFresh) return boxLoc;

    // Both are stale. Fast fallback to whoever last spoke.
    if (boxTime >= phoneTime) {
        return boxLoc || phoneLoc;
    }
    return phoneLoc || boxLoc;
};
