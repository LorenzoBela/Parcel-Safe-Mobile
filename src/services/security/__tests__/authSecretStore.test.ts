import * as SecureStore from 'expo-secure-store';
import {
  persistAuthSecrets,
  clearAuthSecrets,
  persistHashedFallbackPin,
  validateBiometricBoundSecrets,
} from '../authSecretStore';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('Auth secret store hardening', () => {
  const setItemAsyncMock = SecureStore.setItemAsync as jest.Mock;
  const getItemAsyncMock = SecureStore.getItemAsync as jest.Mock;
  const deleteItemAsyncMock = SecureStore.deleteItemAsync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('stores only compact auth secrets', async () => {
    await persistAuthSecrets({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(setItemAsyncMock).toHaveBeenCalledTimes(2);
    expect(setItemAsyncMock).toHaveBeenCalledWith('auth_access_token', 'access-token', {});
    expect(setItemAsyncMock).toHaveBeenCalledWith('auth_refresh_token', 'refresh-token', {});
  });

  test('clears all secrets including biometric-bound fallback pin', async () => {
    await clearAuthSecrets();

    expect(deleteItemAsyncMock).toHaveBeenCalledWith('auth_access_token', {});
    expect(deleteItemAsyncMock).toHaveBeenCalledWith('auth_refresh_token', {});
    expect(deleteItemAsyncMock).toHaveBeenCalledWith('auth_hashed_fallback_pin', {
      keychainService: 'parcel-safe-biometric',
    });
  });

  test('returns hard re-login signal when biometric key gets invalidated', async () => {
    getItemAsyncMock.mockRejectedValueOnce(
      new Error('The key has been invalidated and can no longer be used')
    );

    const result = await validateBiometricBoundSecrets();

    expect(result).toEqual({ ok: false, requiresHardRelogin: true });
  });

  test('uses biometric protection options when saving fallback pin hash', async () => {
    await persistHashedFallbackPin('hash-123');

    expect(setItemAsyncMock).toHaveBeenCalledWith(
      'auth_hashed_fallback_pin',
      'hash-123',
      expect.objectContaining({
        keychainService: 'parcel-safe-biometric',
        requireAuthentication: true,
      })
    );
  });
});
