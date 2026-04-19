import { supabase } from './supabaseClient';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
  || process.env.EXPO_PUBLIC_API_URL
  || 'https://parcel-safe.vercel.app'
).replace(/\/+$/, '');

type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  retryAfterSeconds?: number;
};

export class PersonalPinApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, code?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'PersonalPinApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

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

export interface DashboardPinStatus {
  enabled: boolean;
  updatedAt: string | null;
  revealSupported: boolean;
  note: string;
}

export type RiderBiometricMethod = 'face' | 'fingerprint' | 'iris' | 'unknown';

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
  let data: ApiErrorPayload | any = null;
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
      throw new PersonalPinApiError('Session expired. Please log in again.', response.status, data?.code, data?.retryAfterSeconds);
    }
    if (response.status === 403) {
      throw new PersonalPinApiError('Your account is not allowed to manage Personal PIN.', response.status, data?.code, data?.retryAfterSeconds);
    }

    throw new PersonalPinApiError(
      backendMessage || textMessage || `Personal PIN request failed (${response.status})`,
      response.status,
      data?.code,
      data?.retryAfterSeconds
    );
  }

  return data;
}

export async function fetchRiderPersonalPinStatus(): Promise<RiderPersonalPinStatus> {
  return request('/api/rider/personal-pin', 'GET');
}

export async function fetchDashboardPinStatus(): Promise<DashboardPinStatus> {
  return request('/api/auth/dashboard-pin-status', 'GET');
}

export async function setDashboardPin(pin: string): Promise<void> {
  const sanitizedPin = pin.replace(/\D/g, '');

  if (!/^\d{6}$/.test(sanitizedPin)) {
    throw new Error('PIN must be exactly 6 digits.');
  }

  await request('/api/auth/set-dashboard-pin', 'POST', { pin: sanitizedPin });
}

export async function verifyDashboardPin(pin: string): Promise<void> {
  const sanitizedPin = pin.replace(/\D/g, '');

  if (!/^\d{6}$/.test(sanitizedPin)) {
    throw new Error('PIN must be exactly 6 digits.');
  }

  await request('/api/auth/verify-dashboard-pin', 'POST', { pin: sanitizedPin });
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
  pin: string,
  clientRequestId?: string
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
    ...(clientRequestId ? { clientRequestId } : {}),
  });

  if (!data?.unlockToken || !data?.expiresAt) {
    throw new Error('Unlock authorization failed. Please try again.');
  }

  return {
    unlockToken: String(data.unlockToken),
    expiresAt: Number(data.expiresAt),
  };
}

export async function verifyRiderBiometricForUnlock(
  boxId: string,
  biometricMethod: RiderBiometricMethod,
  clientRequestId?: string
): Promise<RiderUnlockVerificationResult> {
  const sanitizedBoxId = boxId.trim();

  if (!sanitizedBoxId) {
    throw new Error('Missing box ID. Please pair your box again.');
  }

  let data: any;
  try {
    data = await request('/api/rider/personal-pin/verify-unlock-biometric', 'POST', {
      boxId: sanitizedBoxId,
      biometricConfirmed: true,
      biometricMethod,
      ...(clientRequestId ? { clientRequestId } : {}),
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    const htmlResponse = message.includes('<!DOCTYPE html>') || message.includes('<html');
    if (htmlResponse) {
      throw new Error('Biometric authorization service is unavailable. Please use Personal PIN for now.');
    }
    throw error;
  }

  if (!data?.unlockToken || !data?.expiresAt) {
    throw new Error('Unlock authorization failed. Please try again.');
  }

  return {
    unlockToken: String(data.unlockToken),
    expiresAt: Number(data.expiresAt),
  };
}

export async function sendRiderUnlockCommand(
  boxId: string,
  unlockToken: string,
  clientRequestId?: string
): Promise<void> {
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
    ...(clientRequestId ? { clientRequestId } : {}),
  });
}
