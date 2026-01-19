// DEV_MODE: Set to true to bypass native Google Sign-In (e.g., Expo Go)
// Defaults to false so native modules can run in dev clients/builds
export const DEV_MODE = process.env.EXPO_PUBLIC_DEV_MODE === 'true';

let GoogleSignin: any = null;
let statusCodes: any = null;

try {
  const googleSigninModule = require('@react-native-google-signin/google-signin');
  GoogleSignin = googleSigninModule.GoogleSignin;
  statusCodes = googleSigninModule.statusCodes;
} catch (error) {
  console.warn('Google Sign-In module not available in this runtime');
}

const getSupabaseClient = async () => {
  const { supabase } = await import('./supabaseClient');
  return supabase;
};

// Configure Google Sign-In with the Web Client ID from google-services.json
export const configureGoogleSignIn = () => {
  if (DEV_MODE || !GoogleSignin) {
    console.log('Skipping Google Sign-In configuration');
    return;
  }

  GoogleSignin.configure({
    webClientId:
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
      '535049149934-ne2jfkpgmhm6741fgn3sv4pj1otf1rc5.apps.googleusercontent.com',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    offlineAccess: true,
    scopes: ['profile', 'email'],
  });
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
};

const mapRole = (role?: string | null): AuthRole => {
  const normalized = (role || '').toUpperCase();
  if (normalized === 'ADMIN') return 'admin';
  if (normalized === 'RIDER') return 'rider';
  return 'customer';
};

export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  if (DEV_MODE || !GoogleSignin) {
    throw new Error('Google Sign-In is not available in this runtime. Use a dev client or native build.');
  }

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo?.idToken || userInfo?.data?.idToken;
    const user = userInfo?.user || userInfo?.data?.user;

    if (!idToken) {
      throw new Error('No ID token present!');
    }

    return {
      idToken,
      email: user?.email,
      name: user?.name,
      photo: user?.photo,
    };
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      console.log('User cancelled the login flow');
    } else if (error.code === statusCodes.IN_PROGRESS) {
      console.log('Sign in is in progress');
    } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      console.log('Play services not available or outdated');
    } else {
      console.error('Some other error happened:', error);
    }
    throw error;
  }
};

export const signInWithGoogleAndSyncProfile = async (): Promise<AuthSessionResult> => {
  const googleResult = await signInWithGoogle();
  const supabase = await getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: googleResult.idToken,
  });

  if (authError || !authData?.user) {
    throw authError || new Error('Failed to create Supabase session.');
  }

  const userId = authData.user.id;
  const fullNameFromGoogle = googleResult.name || authData.user.user_metadata?.full_name || undefined;

  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('role, full_name')
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
        full_name: fullNameFromGoogle || authData.user.email || null,
      })
      .select('role, full_name')
      .single();

    if (createError) {
      throw createError;
    }

    profile = createdProfile;
  }

  return {
    ...googleResult,
    userId,
    role: mapRole(profile?.role),
    fullName: profile?.full_name || fullNameFromGoogle,
  };
};

export const signOut = async () => {
  if (DEV_MODE || !GoogleSignin) {
    console.log('Skipping Google Sign-Out');
    return;
  }

  try {
    await GoogleSignin.signOut();
  } catch (error) {
    console.error('Error signing out:', error);
  }
};

// Check if Google Sign-In is available (for UI conditional rendering)
export const isGoogleSignInAvailable = () => !DEV_MODE && GoogleSignin !== null;
