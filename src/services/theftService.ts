/**
 * Theft Service - EC-81: Top Box Stolen
 * 
 * Mobile service for theft detection, reporting, and tracking.
 * 
 * Features:
 * - Report theft from rider app
 * - Track stolen box in real-time
 * - Download evidence for insurance claims
 * - Receive theft notifications
 * 
 * Constitution Compliance:
 * - Article 5.2: Uses Firebase RTDB for live context (ephemeral theft tracking)
 * - Article 3.3: Caches theft data offline
 */

import {
    ref,
    onValue,
    off,
    set,
    serverTimestamp,
} from 'firebase/database';
import { getFirebaseDatabase } from './firebaseClient';
import { consolidateLocation } from './locationUtils';
import type { LocationData } from '../types';

// ==================== Types ====================

/**
 * Theft state enum matching hardware states
 */
export type TheftState = 'NORMAL' | 'SUSPICIOUS' | 'STOLEN' | 'LOCKDOWN' | 'RECOVERED';

/**
 * Location history entry for GPS trail
 */
export interface LocationHistoryEntry {
    lat: number;
    lng: number;
    timestamp: number;
}

/**
 * Geofence configuration
 */
export interface GeofenceConfig {
    centerLat: number;
    centerLng: number;
    radiusKm: number;
    configured: boolean;
}

/**
 * Theft status - mirrors Firebase structure at /boxes/{mac_address}/theft_status
 */
export interface TheftStatus {
    state: TheftState;
    is_stolen: boolean;
    reported_by: string;
    reported_at: number;
    last_known_location: {
        lat: number;
        lng: number;
        heading: number;
        speed: number;
    };
    location_history: LocationHistoryEntry[];
    lockdown_active: boolean;
    lockdown_at?: number;
    recovery_photos: string[];
    geofence_breach_at?: number;
    notes?: string;
}

/**
 * Evidence package for insurance/police report
 */
export interface EvidencePackage {
    box_id: string;
    theft_reported_at: number;
    reported_by: string;
    location_history: LocationHistoryEntry[];
    recovery_photos: string[];
    last_known_location: {
        lat: number;
        lng: number;
        heading: number;
        speed: number;
    };
    geofence_breach_at?: number;
    lockdown_at?: number;
    notes?: string;
    generated_at: number;
}

// ==================== Configuration ====================

export const THEFT_CONFIG = {
    /** Default geofence radius in km */
    DEFAULT_GEOFENCE_RADIUS_KM: 50,
    /** Maximum location history entries */
    LOCATION_HISTORY_MAX: 288,
    /** Photo burst default count */
    PHOTO_BURST_DEFAULT_COUNT: 5,
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const normalizeLocationSource = (value: unknown, fallback: LocationData['source']): LocationData['source'] => {
    if (
        value === 'box'
        || value === 'phone'
        || value === 'phone_background'
        || value === 'phone_foreground'
        || value === 'consolidated'
    ) {
        return value;
    }
    return fallback;
};

const normalizeLocationEntry = (raw: any, fallbackSource: LocationData['source']): LocationData | null => {
    const latitude = toFiniteNumberOrNull(raw?.latitude ?? raw?.lat);
    const longitude = toFiniteNumberOrNull(raw?.longitude ?? raw?.lng);
    if (latitude == null || longitude == null) return null;

    return {
        ...raw,
        latitude,
        longitude,
        source: normalizeLocationSource(raw?.source, fallbackSource),
    } as LocationData;
};

const getPreferredLocationFromRaw = (raw: any): LocationData | null => {
    if (!raw) return null;

    if (raw.box != null || raw.phone != null) {
        const boxLoc = raw.box ? normalizeLocationEntry(raw.box, 'box') : null;
        const phoneLoc = raw.phone ? normalizeLocationEntry(raw.phone, 'phone_background') : null;
        return consolidateLocation(boxLoc, phoneLoc) ?? boxLoc ?? phoneLoc;
    }

    return normalizeLocationEntry(raw, 'box');
};

// ==================== Theft Status Functions ====================

/**
 * Subscribe to theft status updates (EC-81)
 * Use in rider app to monitor box theft status
 */
export function subscribeToTheftStatus(
    boxId: string,
    callback: (status: TheftStatus | null) => void
): () => void {
    if (!boxId) {
        callback(null);
        return () => { };
    }

    const db = getFirebaseDatabase();
    const theftRef = ref(db, `boxes/${boxId}/theft_status`);

    const unsubscribe = onValue(
        theftRef,
        (snapshot) => {
            const data = snapshot.val();
            callback(data as TheftStatus | null);
        },
        (error) => {
            console.warn('[EC-81] Theft status subscription failed:', error);
            callback(null);
        }
    );

    return unsubscribe;
}

/**
 * Get theft status once
 */
export async function getTheftStatus(boxId: string): Promise<TheftStatus | null> {
    const db = getFirebaseDatabase();
    return new Promise((resolve) => {
        const theftRef = ref(db, `boxes/${boxId}/theft_status`);
        onValue(theftRef, (snapshot) => {
            resolve(snapshot.val() as TheftStatus | null);
        }, { onlyOnce: true });
    });
}

/**
 * Report theft from rider app (EC-81)
 * This triggers admin review and activates theft tracking
 */
export async function reportTheft(
    boxId: string,
    riderUid: string,
    notes?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getFirebaseDatabase();
        const theftRef = ref(db, `boxes/${boxId}/theft_status`);

        // Get current location if available
        const locationRef = ref(db, `locations/${boxId}`);
        const rawSnap = await new Promise<any>((resolve) => {
            onValue(locationRef, (snapshot) => {
                resolve(snapshot.val());
            }, { onlyOnce: true });
        });
        const currentLocation = getPreferredLocationFromRaw(rawSnap);

        await set(theftRef, {
            state: 'STOLEN',
            is_stolen: true,
            reported_by: riderUid,
            reported_at: serverTimestamp(),
            last_known_location: {
                lat: currentLocation?.latitude || 0,
                lng: currentLocation?.longitude || 0,
                heading: currentLocation?.heading || 0,
                speed: currentLocation?.speed || 0,
            },
            location_history: [],
            lockdown_active: false,
            recovery_photos: [],
            notes: notes || 'Reported by rider via mobile app',
        });

        console.log(`[EC-81] Theft reported for box ${boxId} by rider ${riderUid}`);
        return { success: true };
    } catch (error) {
        console.error('[EC-81] Failed to report theft:', error);
        return { success: false, error: 'Failed to report theft. Please try again.' };
    }
}

// ==================== Location Tracking ====================

/**
 * Subscribe to real-time box location for stolen box tracking
 * Use in "Track My Box" feature
 */
export function subscribeToBoxLocation(
    boxId: string,
    callback: (location: { lat: number; lng: number; heading: number; speed: number } | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const locationRef = ref(db, `locations/${boxId}`);

    const unsubscribe = onValue(locationRef, (snapshot) => {
        const raw = snapshot.val();
        if (!raw) { callback(null); return; }
        const data = getPreferredLocationFromRaw(raw);
        if (data) {
            callback({
                lat: data.latitude,
                lng: data.longitude,
                heading: data.heading || 0,
                speed: data.speed || 0,
            });
        } else {
            callback(null);
        }
    });

    return () => off(locationRef);
}

/**
 * Get location history for stolen box
 */
export async function getLocationHistory(
    boxId: string,
    hours: number = 24
): Promise<LocationHistoryEntry[]> {
    const theftStatus = await getTheftStatus(boxId);
    if (!theftStatus?.location_history) {
        return [];
    }

    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    return theftStatus.location_history.filter(entry => entry.timestamp >= cutoffTime);
}

// ==================== Evidence Functions ====================

/**
 * Generate evidence package for insurance claim
 */
export async function generateEvidencePackage(boxId: string): Promise<EvidencePackage | null> {
    const theftStatus = await getTheftStatus(boxId);
    if (!theftStatus) {
        return null;
    }

    return {
        box_id: boxId,
        theft_reported_at: theftStatus.reported_at,
        reported_by: theftStatus.reported_by,
        location_history: theftStatus.location_history || [],
        recovery_photos: theftStatus.recovery_photos || [],
        last_known_location: theftStatus.last_known_location,
        geofence_breach_at: theftStatus.geofence_breach_at,
        lockdown_at: theftStatus.lockdown_at,
        notes: theftStatus.notes,
        generated_at: Date.now(),
    };
}

/**
 * Format evidence package as text for sharing
 */
export function formatEvidenceAsText(evidence: EvidencePackage): string {
    const lines: string[] = [
        '=== THEFT EVIDENCE REPORT ===',
        '',
        `Box ID: ${evidence.box_id}`,
        `Reported At: ${new Date(evidence.theft_reported_at).toISOString()}`,
        `Reported By: ${evidence.reported_by}`,
        '',
        '--- Last Known Location ---',
        `Latitude: ${evidence.last_known_location.lat}`,
        `Longitude: ${evidence.last_known_location.lng}`,
        `Heading: ${evidence.last_known_location.heading}°`,
        `Speed: ${evidence.last_known_location.speed} m/s`,
        '',
    ];

    if (evidence.geofence_breach_at) {
        lines.push(`Geofence Breach At: ${new Date(evidence.geofence_breach_at).toISOString()}`);
    }

    if (evidence.lockdown_at) {
        lines.push(`Lockdown Activated At: ${new Date(evidence.lockdown_at).toISOString()}`);
    }

    lines.push('');
    lines.push('--- Location History ---');
    evidence.location_history.forEach((entry, index) => {
        lines.push(`${index + 1}. (${entry.lat}, ${entry.lng}) at ${new Date(entry.timestamp).toISOString()}`);
    });

    lines.push('');
    lines.push(`Report Generated: ${new Date(evidence.generated_at).toISOString()}`);
    lines.push('');
    lines.push(`Total GPS Points: ${evidence.location_history.length}`);
    lines.push(`Recovery Photos: ${evidence.recovery_photos.length}`);

    if (evidence.notes) {
        lines.push('');
        lines.push('--- Notes ---');
        lines.push(evidence.notes);
    }

    return lines.join('\n');
}

// ==================== Geofence Functions ====================

/**
 * Calculate Haversine distance between two GPS coordinates
 * @returns Distance in kilometers
 */
export function calculateHaversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Check if location is within geofence
 */
export function isWithinGeofence(
    lat: number,
    lng: number,
    centerLat: number,
    centerLng: number,
    radiusKm: number
): boolean {
    const distance = calculateHaversineDistance(lat, lng, centerLat, centerLng);
    return distance <= radiusKm;
}

/**
 * Get geofence configuration for box
 */
export async function getGeofence(boxId: string): Promise<GeofenceConfig | null> {
    const db = getFirebaseDatabase();
    return new Promise((resolve) => {
        const geofenceRef = ref(db, `boxes/${boxId}/geofence`);
        onValue(geofenceRef, (snapshot) => {
            resolve(snapshot.val() as GeofenceConfig | null);
        }, { onlyOnce: true });
    });
}

// ==================== Helper Functions ====================

/**
 * Get theft severity for UI display
 */
export function getTheftSeverity(status: TheftStatus | null): 'ACTIVE' | 'INVESTIGATING' | 'RECOVERED' | 'NONE' {
    if (!status || !status.is_stolen) {
        return 'NONE';
    }

    if (status.lockdown_active || status.state === 'LOCKDOWN') {
        return 'ACTIVE';
    }

    if (status.state === 'RECOVERED') {
        return 'RECOVERED';
    }

    return 'INVESTIGATING';
}

/**
 * Get severity color for UI
 */
export function getTheftSeverityColor(severity: ReturnType<typeof getTheftSeverity>): string {
    switch (severity) {
        case 'ACTIVE':
            return '#DC2626'; // Red
        case 'INVESTIGATING':
            return '#F59E0B'; // Amber
        case 'RECOVERED':
            return '#10B981'; // Green
        case 'NONE':
        default:
            return '#6B7280'; // Gray
    }
}

/**
 * Format theft state for display
 */
export function formatTheftState(state: TheftState): string {
    switch (state) {
        case 'NORMAL':
            return 'Normal';
        case 'SUSPICIOUS':
            return 'Suspicious Activity';
        case 'STOLEN':
            return 'Stolen';
        case 'LOCKDOWN':
            return 'Lockdown Active';
        case 'RECOVERED':
            return 'Recovered';
        default:
            return 'Unknown';
    }
}

/**
 * Check if box can be reported as stolen
 * (Must not already be in STOLEN or LOCKDOWN state)
 */
export function canReportTheft(status: TheftStatus | null): boolean {
    if (!status) {
        return true; // No status = can report
    }

    return status.state === 'NORMAL' || status.state === 'SUSPICIOUS';
}

/**
 * Check if rider can track stolen box
 * (Must be in STOLEN or LOCKDOWN state)
 */
export function canTrackStolenBox(status: TheftStatus | null): boolean {
    if (!status) {
        return false;
    }

    return status.is_stolen && (status.state === 'STOLEN' || status.state === 'LOCKDOWN');
}
