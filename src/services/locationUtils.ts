import { LocationData } from "./firebaseClient";

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
    const boxTime = boxLoc?.server_timestamp || boxLoc?.timestamp || 0;
    const phoneTime = phoneLoc?.server_timestamp || phoneLoc?.timestamp || 0;

    const boxFresh = boxLoc && (now - boxTime) <= 30000;
    const phoneFresh = phoneLoc && (now - phoneTime) <= 30000;

    if (boxFresh && phoneFresh && boxLoc && phoneLoc) { // Type narrowed for boxLoc and phoneLoc
        // Both are reporting. 
        // 1. If overlapping (< 30m), average them to reduce jitter
        // 2. If diverging (> 30m), trust the box as primary
        const distKm = calculateDistance(boxLoc.latitude, boxLoc.longitude, phoneLoc.latitude, phoneLoc.longitude);

        if (distKm < 0.03) { // 30 meters
            return {
                ...boxLoc,
                latitude: (boxLoc.latitude + phoneLoc.latitude) / 2,
                longitude: (boxLoc.longitude + phoneLoc.longitude) / 2,
                source: 'consolidated' as any,
                timestamp: Math.max(boxTime, phoneTime),
            };
        } else {
            return boxLoc; // Box is primary
        }
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
