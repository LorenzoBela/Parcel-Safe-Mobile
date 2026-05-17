import * as LocalAuthentication from 'expo-local-authentication';
import type { RiderBiometricMethod } from './personalPinService';

let biometricInProgress = false;

type BiometricAuthFailure = {
  success: false;
  reason:
    | 'not-supported'
    | 'not-enrolled'
    | 'user-cancel'
    | 'system-cancel'
    | 'lockout'
    | 'authentication-failed'
    | 'unknown-error';
  message: string;
};

export type BiometricAuthResult =
  | { success: true; method: RiderBiometricMethod }
  | BiometricAuthFailure;

function mapTypesToMethod(types: LocalAuthentication.AuthenticationType[]): RiderBiometricMethod {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return 'face';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return 'fingerprint';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return 'iris';
  }
  return 'unknown';
}

function mapLocalAuthError(error?: string): BiometricAuthFailure {
  if (error === 'not_available') {
    return {
      success: false,
      reason: 'not-supported',
      message: 'Biometric authentication is not available on this device. Use your Personal PIN.',
    };
  }
  if (error === 'not_enrolled') {
    return {
      success: false,
      reason: 'not-enrolled',
      message: 'No biometrics are enrolled on this phone. Use your Personal PIN.',
    };
  }
  if (error === 'user_cancel') {
    return {
      success: false,
      reason: 'user-cancel',
      message: 'Biometric prompt canceled. Use your Personal PIN to continue.',
    };
  }
  if (error === 'system_cancel' || error === 'app_cancel') {
    return {
      success: false,
      reason: 'system-cancel',
      message: 'Biometric prompt was interrupted. Use your Personal PIN to continue.',
    };
  }
  if (error === 'authentication_failed' || error === 'timeout' || error === 'unable_to_process') {
    return {
      success: false,
      reason: 'authentication-failed',
      message: 'Biometric was not recognized. Use your Personal PIN to continue.',
    };
  }
  if (error === 'lockout' || error === 'passcode_not_set') {
    return {
      success: false,
      reason: 'lockout',
      message: 'Biometric unlock is temporarily unavailable. Use your Personal PIN.',
    };
  }
  return {
    success: false,
    reason: 'unknown-error',
    message: 'Biometric verification failed. Use your Personal PIN to continue.',
  };
}

export async function authenticateBiometricForUnlock(): Promise<BiometricAuthResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) {
    return {
      success: false,
      reason: 'not-supported',
      message: 'This device does not support biometric authentication. Use your Personal PIN.',
    };
  }

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) {
    return {
      success: false,
      reason: 'not-enrolled',
      message: 'No biometrics are enrolled on this phone. Use your Personal PIN.',
    };
  }

  if (biometricInProgress) {
    return {
      success: false,
      reason: 'system-cancel',
      message: 'Biometric authentication already in progress. Please wait.',
    };
  }

  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
  const method = mapTypesToMethod(supportedTypes);

  biometricInProgress = true;
  try {
    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authorize unlock',
      fallbackLabel: 'Use device passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });

    if (authResult.success) {
      return { success: true, method };
    }

    return mapLocalAuthError('error' in authResult ? authResult.error : undefined);
  } finally {
    biometricInProgress = false;
  }
}

export async function authenticateBiometricForSensitiveAction(
  promptMessage: string
): Promise<{ success: true } | { success: false; reason: BiometricAuthFailure['reason']; message: string }> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) {
    return {
      success: false,
      reason: 'not-supported',
      message: 'This device does not support biometric authentication.',
    };
  }

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) {
    return {
      success: false,
      reason: 'not-enrolled',
      message: 'No biometrics are enrolled on this phone.',
    };
  }

  if (biometricInProgress) {
    return {
      success: false,
      reason: 'system-cancel',
      message: 'Biometric authentication already in progress. Please wait.',
    };
  }

  biometricInProgress = true;
  try {
    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use device passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });

    if (authResult.success) {
      return { success: true };
    }

    const mapped = mapLocalAuthError('error' in authResult ? authResult.error : undefined);
    return {
      success: false,
      reason: mapped.reason,
      message: mapped.message.replace('Use your Personal PIN.', 'Use your Rider PIN and try again.'),
    };
  } finally {
    biometricInProgress = false;
  }
}
