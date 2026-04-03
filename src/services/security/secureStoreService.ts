import * as SecureStore from 'expo-secure-store';

const SECURESTORE_MAX_BYTES = 2048;

export class SecureStoreSizeError extends Error {
  constructor(key: string, size: number) {
    super(
      `SecureStore value too large for key '${key}' (${size} bytes). Keep entries under ${SECURESTORE_MAX_BYTES} bytes.`
    );
    this.name = 'SecureStoreSizeError';
  }
}

export class SecureStoreInvalidatedError extends Error {
  constructor(key: string) {
    super(`SecureStore key '${key}' is invalidated and requires full re-authentication.`);
    this.name = 'SecureStoreInvalidatedError';
  }
}

function getByteLength(value: string): number {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

function isInvalidatedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('key has been invalidated') ||
    normalized.includes('key permanently invalidated') ||
    normalized.includes('authentication failed') ||
    normalized.includes('user not authenticated')
  );
}

export function isSecureStoreInvalidatedError(error: unknown): boolean {
  if (error instanceof SecureStoreInvalidatedError) return true;
  if (error instanceof Error) {
    return isInvalidatedMessage(error.message);
  }
  return false;
}

export async function setSecureItem(
  key: string,
  value: string,
  options: SecureStore.SecureStoreOptions = {}
): Promise<void> {
  const size = getByteLength(value);
  if (size > SECURESTORE_MAX_BYTES) {
    throw new SecureStoreSizeError(key, size);
  }

  await SecureStore.setItemAsync(key, value, options);
}

export async function getSecureItem(
  key: string,
  options: SecureStore.SecureStoreOptions = {}
): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, options);
  } catch (error) {
    if (error instanceof Error && isInvalidatedMessage(error.message)) {
      throw new SecureStoreInvalidatedError(key);
    }
    throw error;
  }
}

export async function removeSecureItem(
  key: string,
  options: SecureStore.SecureStoreOptions = {}
): Promise<void> {
  await SecureStore.deleteItemAsync(key, options);
}
