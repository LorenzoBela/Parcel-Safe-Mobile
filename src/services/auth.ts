// DEV_MODE: Set to true to bypass native Google Sign-In (e.g., Expo Go)
// Defaults to false so native modules can run in dev clients/builds
export const DEV_MODE = process.env.EXPO_PUBLIC_DEV_MODE === 'true';

let GoogleSignin: any = null;
let statusCodes: any = null;
let isErrorWithCode: any = null;
let isSuccessResponse: any = null;
let isNoSavedCredentialFoundResponse: any = null;

try {
  const googleSigninModule = require('@react-native-google-signin/google-signin');
  GoogleSignin = googleSigninModule.GoogleSignin;
  statusCodes = googleSigninModule.statusCodes;
  isErrorWithCode = googleSigninModule.isErrorWithCode;
  isSuccessResponse = googleSigninModule.isSuccessResponse;
  isNoSavedCredentialFoundResponse = googleSigninModule.isNoSavedCredentialFoundResponse;
} catch (error) {
  console.warn('Google Sign-In module not available in this runtime');
}

let GoogleAuth: any = null;
try {
  GoogleAuth = require('react-native-google-auth').GoogleAuth;
} catch (error) {
  console.warn('New Google Auth module not available in this runtime');
}

import { GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from 'firebase/auth';
import { initializeFirebase, getFirebaseAuth } from './firebaseClient';

const getSupabaseClient = async () => {
  const { supabase } = await import('./supabaseClient');
  return supabase;
};

// Configure Google Sign-In with the Web Client ID from google-services.json
export const configureGoogleSignIn = () => {
  if (DEV_MODE || !GoogleAuth) {
    console.log('Skipping Google Sign-In configuration');
    return;
  }

  GoogleAuth.configure({
    webClientId:
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
      '535049149934-ne2jfkpgmhm6741fgn3sv4pj1otf1rc5.apps.googleusercontent.com',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  }).catch((e: any) => console.warn('Failed to configure Google Auth', e));
};

export type GoogleSignInResult = {
  idToken: string;
  email?: string;
  name?: string;
  photo?: string;
};

export type AuthRole = 'customer' | 'rider' | 'admin';

export type AuthSessionResult = GoogleSignInResult & {
  userId: string;
  role: AuthRole;
  fullName?: string;
  phone?: string;
};

const mapRole = (role?: string | null): AuthRole => {
  const normalized = (role || '').toUpperCase();
  if (normalized === 'ADMIN') return 'admin';
  if (normalized === 'RIDER') return 'rider';
  return 'customer';
};

/**
 * Extracts GoogleSignInResult from a successful One Tap response.
 */
const extractResult = (data: any): GoogleSignInResult => {
  const idToken = data?.idToken;
  if (!idToken) {
    throw new Error('No ID token present in sign-in response!');
  }
  return {
    idToken,
    email: data?.user?.email,
    name: data?.user?.name,
    photo: data?.user?.photo,
  };
};

/**
 * Silent sign-in — re-uses existing Google session without showing the account picker.
 * Uses getTokens() to obtain a fresh idToken from the cached credential.
 * Throws if no cached session exists (caller should fall back to interactive signIn).
 */
export const signInWithGoogleSilently = async (): Promise<GoogleSignInResult> => {
  if (DEV_MODE || !GoogleAuth) {
    throw new Error('Google Sign-In is not available in this runtime.');
  }

  try {
    // Get the current cached user info
    const user = await GoogleAuth.getCurrentUser();
    if (!user) {
      throw new Error('No cached Google session found.');
    }

    // Refresh or fetch a fresh idToken from the existing session
    const tokens = await GoogleAuth.getTokens();
    if (!tokens?.idToken) {
      throw new Error('Failed to retrieve token from cached session.');
    }

    return {
      idToken: tokens.idToken,
      email: user.email,
      name: user.name || undefined,
      photo: user.photo || undefined,
    };
  } catch (error: any) {
    console.log('[AuthFlow] Silent sign-in failed, will require interactive flow:', error?.message);
    throw error;
  }
};

/**
 * Google Sign-In flow (v16 handles Credential Manager natively under the hood)
 */
export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  if (DEV_MODE || !GoogleAuth) {
    throw new Error('Google Sign-In is not available in this runtime. Use a dev client or native build.');
  }

  try {
    const response = await GoogleAuth.signIn();

    if (response.type === 'success') {
      return {
        idToken: response.data.idToken,
        email: response.data.user.email,
        name: response.data.user.name || undefined,
        photo: response.data.user.photo || undefined,
      };
    } else if (response.type === 'cancelled') {
        throw new Error('Sign-in cancelled.');
    } else if (response.type === 'noSavedCredentialFound') {
        throw new Error('No saved Google credentials found. Please sign in to Google on your device.');
    }

    throw new Error('Sign-in returned unexpected response.');
  } catch (error: any) {
    if (error?.code === 'SIGN_IN_CANCELLED') {
      console.warn('Google Sign-in cancelled');
    } else if (error?.code === 'PLAY_SERVICES_NOT_AVAILABLE') {
      console.error('Play Services not available or outdated');
    } else {
      console.error('Google Sign-In error:', error?.code, error?.message || error);
    }
    throw error;
  }
};

import { AppState } from 'react-native';

export const signInWithGoogleAndSyncProfile = async (
  options?: { silent?: boolean }
): Promise<AuthSessionResult> => {
  let googleResult: GoogleSignInResult;

  if (options?.silent) {
    try {
      googleResult = await signInWithGoogleSilently();
      console.log('[AuthFlow] Silent sign-in succeeded, skipping account picker.');
    } catch {
      console.log('[AuthFlow] Silent sign-in unavailable, falling back to interactive flow.');
      googleResult = await signInWithGoogle();
    }
  } else {
    googleResult = await signInWithGoogle();
  }

  // Wait for app to be active to ensure network is ready (fix for "Network request failed" when backgrounded)
  if (AppState.currentState !== 'active') {
    console.log('Waiting for app to become active before Supabase auth...');
    await new Promise<void>((resolve) => {
      const subscription = AppState.addEventListener('change', (nextAppState) => {
        if (nextAppState === 'active') {
          subscription.remove();
          resolve();
        }
      });
    });
    console.log('App is active, proceeding...');
  }

  // Authenticate with Firebase using the Google ID Token
  try {
    console.log('[AuthFlow] Starting Firebase Auth. calling getFirebaseAuth()');
    // Ensure Firebase is initialized before using getAuth()
    const auth = getFirebaseAuth();

    if (!auth) {
      console.error('[AuthFlow] getFirebaseAuth() returned null/undefined!');
    } else {
      console.log('[AuthFlow] auth object retrieved. Keys:', Object.keys(auth).join(', '));
    }

    console.log('[AuthFlow] Creating Google credentials and signing in');
    const credential = GoogleAuthProvider.credential(googleResult.idToken);
    await signInWithCredential(auth, credential);
    console.log('[AuthFlow] Firebase authentication successful!');

  } catch (firebaseError) {
    console.error('[AuthFlow] Firebase authentication failed:', firebaseError);
    // Continue - we don't want to block Supabase login if Firebase fails, 
    // but the rider dashboard might show session expired.
  }

  const supabase = await getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  // Retry logic for network failures
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Auth attempt ${attempt}/3...`);

      const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: googleResult.idToken,
      });

      if (authError || !authData?.user) {
        throw authError || new Error('Failed to create Supabase session.');
      }

      const userId = authData.user.id;
      const fullNameFromGoogle = googleResult.name || authData.user.user_metadata?.full_name || undefined;
      const emailFromGoogle = googleResult.email || authData.user.email;
      const photoFromGoogle = googleResult.photo || authData.user.user_metadata?.avatar_url || authData.user.user_metadata?.picture;

      const { data: existingProfile, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name, phone_number')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      let profile = existingProfile;

      if (!profile) {
        const { data: createdProfile, error: createError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            role: 'CUSTOMER',
            full_name: fullNameFromGoogle || emailFromGoogle || null,
            email: emailFromGoogle,
            avatar_url: photoFromGoogle,
            updated_at: new Date().toISOString(),
          })
          .select('role, full_name, phone_number')
          .single();

        if (createError) {
          throw createError;
        }

        profile = createdProfile;
      } else if (photoFromGoogle) {
        // Update avatar_url for existing users if they don't have one or if it changed
        await supabase
          .from('profiles')
          .update({
            avatar_url: photoFromGoogle,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
      }

      console.log('Authentication successful!');
      return {
        ...googleResult,
        userId,
        role: mapRole(profile?.role),
        fullName: profile?.full_name || fullNameFromGoogle,
        phone: profile?.phone_number || undefined,
      };
    } catch (error: any) {
      lastError = error;
      const isNetworkError =
        error?.message?.includes('Network request failed') ||
        error?.message?.includes('timeout') ||
        error?.message?.includes('fetch') ||
        error?.code === 'NETWORK_ERROR';

      if (isNetworkError && attempt < 3) {
        console.log(`Network error on attempt ${attempt}, retrying in ${attempt * 1000}ms...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('Authentication failed after 3 attempts');
};

export const signOut = async () => {
  if (DEV_MODE || !GoogleAuth) {
    console.log('Skipping Google Sign-Out');
    return;
  }

  try {
    await GoogleAuth.signOut();
    // Ensure Firebase is initialized before using getAuth()
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
  } catch (error) {
    console.error('Error signing out:', error);
  }
};

// Check if Google Sign-In is available (for UI conditional rendering)
export const isGoogleSignInAvailable = () => !DEV_MODE && GoogleAuth !== null;
