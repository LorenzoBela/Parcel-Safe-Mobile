import { supabase } from './supabaseClient';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
  || process.env.EXPO_PUBLIC_API_URL
  || 'https://parcel-safe.vercel.app'
).replace(/\/+$/, '');

export interface RiderPersonalPinStatus {
  enabled: boolean;
  updatedAt: string | null;
  revealSupported: boolean;
  note: string;
}

export interface RiderUnlockVerificationResult {
  unlockToken: string;
  expiresAt: number;
}

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

async function request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: Record<string, unknown>) {
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
      throw new Error('Personal PIN request timed out. Please check your connection and try again.');
    }
    throw new Error('Could not reach Personal PIN service. Please check your internet connection.');
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = response.headers.get('content-type') || '';
  const responseText = await response.text();
  let data: any = null;
  if (contentType.includes('application/json')) {
    try {
      data = JSON.parse(responseText || '{}');
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const backendMessage = data?.error || data?.message;
    const textMessage = responseText && !contentType.includes('application/json')
      ? responseText.slice(0, 180)
      : '';

    if (response.status === 401) {
      throw new Error('Session expired. Please log in again.');
    }
    if (response.status === 403) {
      throw new Error('Your account is not allowed to manage Personal PIN.');
    }

    throw new Error(backendMessage || textMessage || `Personal PIN request failed (${response.status})`);
  }

  return data;
}

export async function fetchRiderPersonalPinStatus(): Promise<RiderPersonalPinStatus> {
  return request('/api/rider/personal-pin', 'GET');
}

export async function setRiderPersonalPin(boxId: string, pin: string): Promise<void> {
  const sanitizedBoxId = boxId.trim();
  const sanitizedPin = pin.replace(/\D/g, '');

  if (!sanitizedBoxId) {
    throw new Error('Missing box ID. Please pair your box again.');
  }

  if (!/^\d{6}$/.test(sanitizedPin)) {
    throw new Error('PIN must be exactly 6 digits.');
  }

  await request('/api/rider/personal-pin', 'POST', { boxId: sanitizedBoxId, pin: sanitizedPin });
}

export async function resetRiderPersonalPin(boxId: string): Promise<void> {
  const sanitizedBoxId = boxId.trim();
  if (!sanitizedBoxId) {
    throw new Error('Missing box ID. Please pair your box again.');
  }

  await request('/api/rider/personal-pin', 'DELETE', { boxId: sanitizedBoxId });
}

export async function verifyRiderPersonalPinForUnlock(
  boxId: string,
  pin: string
): Promise<RiderUnlockVerificationResult> {
  const sanitizedBoxId = boxId.trim();
  const sanitizedPin = pin.replace(/\D/g, '');

  if (!sanitizedBoxId) {
    throw new Error('Missing box ID. Please pair your box again.');
  }

  if (!/^\d{6}$/.test(sanitizedPin)) {
    throw new Error('PIN must be exactly 6 digits.');
  }

  const data = await request('/api/rider/personal-pin/verify-unlock', 'POST', {
    boxId: sanitizedBoxId,
    pin: sanitizedPin,
  });

  if (!data?.unlockToken || !data?.expiresAt) {
    throw new Error('Unlock authorization failed. Please try again.');
  }

  return {
    unlockToken: String(data.unlockToken),
    expiresAt: Number(data.expiresAt),
  };
}

export async function sendRiderUnlockCommand(boxId: string, unlockToken: string): Promise<void> {
  const sanitizedBoxId = boxId.trim();
  const sanitizedToken = unlockToken.trim();

  if (!sanitizedBoxId) {
    throw new Error('Missing box ID. Please pair your box again.');
  }

  if (!sanitizedToken) {
    throw new Error('Missing unlock authorization token.');
  }

  await request('/api/rider/box-unlock', 'POST', {
    boxId: sanitizedBoxId,
    unlockToken: sanitizedToken,
  });
}
