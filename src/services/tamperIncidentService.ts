import { supabase } from './supabaseClient';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
  || process.env.EXPO_PUBLIC_API_URL
  || 'https://parcel-safe.vercel.app'
).replace(/\/+$/, '');

type RiderDisposition = 'HARDWARE_DAMAGED' | 'ACCIDENTAL_TRIGGER';

export type RiderTamperIncident = {
  id: string;
  status: 'OPEN' | 'PENDING_REVIEW' | 'CLOSED';
  delivery_id: string | null;
  box_id: string | null;
  rider_disposition: RiderDisposition | null;
  rider_note: string | null;
  rider_photo_url: string | null;
  detected_at: string;
};

async function getAccessToken(): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
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

async function request<T>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Tamper incident request timed out. Please try again.');
    }
    throw new Error('Could not reach tamper incident service. Please check your connection.');
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Session expired. Please log in again.');
    }
    throw new Error(data?.error || `Tamper incident request failed (${response.status})`);
  }

  return data as T;
}

export async function fetchActiveTamperIncident(params: {
  boxId?: string;
  deliveryId?: string;
}): Promise<RiderTamperIncident | null> {
  const query = new URLSearchParams();
  if (params.boxId) query.set('boxId', params.boxId);
  if (params.deliveryId) query.set('deliveryId', params.deliveryId);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const data = await request<{ incident: RiderTamperIncident | null }>(`/api/rider/tamper-incidents/active${suffix}`, 'GET');
  return data.incident || null;
}

export async function submitRiderTamperEvidence(
  incidentId: string,
  payload: {
    riderDisposition: RiderDisposition;
    riderNote?: string;
    riderPhotoUrl?: string;
  }
): Promise<void> {
  await request(`/api/rider/tamper-incidents/${incidentId}/evidence`, 'POST', payload);
}
