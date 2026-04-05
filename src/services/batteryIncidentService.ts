import { supabase } from './supabaseClient';

const API_BASE_URL = (
    process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
    || process.env.EXPO_PUBLIC_API_URL
    || 'https://parcel-safe.vercel.app'
).replace(/\/+$/, '');

export type BatteryIncidentStage = 'PICKUP' | 'DROPOFF';

interface ReportBatteryIncidentInput {
    boxId: string;
    deliveryId?: string;
    stage: BatteryIncidentStage;
    note?: string;
}

export async function reportBatteryDeadIncident(input: ReportBatteryIncidentInput): Promise<boolean> {
    if (!input.boxId?.trim()) {
        console.warn('[BatteryIncident] boxId is required');
        return false;
    }

    if (!supabase) {
        console.warn('[BatteryIncident] Supabase not configured');
        return false;
    }

    try {
        const {
            data: { session },
        } = await supabase.auth.getSession();

        const token = session?.access_token;
        if (!token) {
            console.warn('[BatteryIncident] Missing session token');
            return false;
        }

        const response = await fetch(`${API_BASE_URL}/api/incidents/battery-dead`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-incident-key': process.env.EXPO_PUBLIC_INCIDENT_REPORT_KEY || '',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                ...input,
                source: 'mobile',
                eventEpochMs: Date.now(),
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.warn('[BatteryIncident] Report failed:', response.status, text);
            return false;
        }

        return true;
    } catch (error) {
        console.warn('[BatteryIncident] Report error:', error);
        return false;
    }
}