import * as SecureStore from 'expo-secure-store';
import {
  getSecureItem,
  removeSecureItem,
  setSecureItem,
  isSecureStoreInvalidatedError,
} from './secureStoreService';

const AUTH_KEYS = {
  ACCESS_TOKEN: 'auth_access_token',
  REFRESH_TOKEN: 'auth_refresh_token',
  HASHED_FALLBACK_PIN: 'auth_hashed_fallback_pin',
};

export type AuthSecrets = {
  accessToken: string;
  refreshToken: string;
};

export async function persistAuthSecrets(secrets: AuthSecrets): Promise<void> {
  await Promise.all([
    setSecureItem(AUTH_KEYS.ACCESS_TOKEN, secrets.accessToken),
    setSecureItem(AUTH_KEYS.REFRESH_TOKEN, secrets.refreshToken),
  ]);
}

export async function clearAuthSecrets(): Promise<void> {
  await Promise.all([
    removeSecureItem(AUTH_KEYS.ACCESS_TOKEN),
    removeSecureItem(AUTH_KEYS.REFRESH_TOKEN),
    removeSecureItem(AUTH_KEYS.HASHED_FALLBACK_PIN, {
      keychainService: 'parcel-safe-biometric',
    }),
  ]);
}

export async function persistHashedFallbackPin(pinHash: string): Promise<void> {
  await setSecureItem(AUTH_KEYS.HASHED_FALLBACK_PIN, pinHash, {
    keychainService: 'parcel-safe-biometric',
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    authenticationPrompt: 'Authenticate to use your secure fallback PIN.',
  });
}

export async function getHashedFallbackPin(): Promise<string | null> {
  return getSecureItem(AUTH_KEYS.HASHED_FALLBACK_PIN, {
    keychainService: 'parcel-safe-biometric',
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    authenticationPrompt: 'Authenticate to continue.',
  });
}

export async function validateBiometricBoundSecrets(): Promise<{
  ok: boolean;
  requiresHardRelogin: boolean;
}> {
  try {
    await getHashedFallbackPin();
    return { ok: true, requiresHardRelogin: false };
  } catch (error) {
    if (isSecureStoreInvalidatedError(error)) {
      return { ok: false, requiresHardRelogin: true };
    }
    return { ok: false, requiresHardRelogin: false };
  }
}
