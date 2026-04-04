import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    ActivityIndicator,
    StyleSheet,
    StatusBar,
    Animated,
    Dimensions,
    Text,
    TouchableOpacity,
} from 'react-native';
import { usePulseAnimation } from '../../hooks/useEntryAnimation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import useAuthStore from '../../store/authStore';
import { supabase } from '../../services/supabaseClient';
import { warmUpLocationServices } from '../../services/gpsWarmupService';
import { useAppTheme } from '../../context/ThemeContext';
import { validateBiometricBoundSecrets } from '../../services/security/authSecretStore';
import { captureHandledError, captureHandledMessage } from '../../services/observability/sentryService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
    light: {
        background: '#FFFFFF',
        surface: '#F6F6F6',
        panel: '#FCFCFC',
        text: '#000000',
        textSecondary: '#6B6B6B',
        border: '#E8E8E8',
        progressBg: '#E8E8E8',
        progressFill: '#000000',
        adBg: '#F6F6F6',
        adBorder: '#E8E8E8',
        orbOne: 'rgba(0,0,0,0.05)',
        orbTwo: 'rgba(0,0,0,0.03)',
    },
    dark: {
        background: '#000000',
        surface: '#1C1C1E',
        panel: '#121214',
        text: '#FFFFFF',
        textSecondary: '#8E8E93',
        border: '#2C2C2E',
        progressBg: '#2C2C2E',
        progressFill: '#FFFFFF',
        adBg: '#1C1C1E',
        adBorder: '#2C2C2E',
        orbOne: 'rgba(255,255,255,0.09)',
        orbTwo: 'rgba(255,255,255,0.05)',
    }
};

const LOAD_STEPS = [
    { label: 'Connecting to server...', progress: 0.15 },
    { label: 'Checking session...', progress: 0.35 },
    { label: 'Loading your account...', progress: 0.60 },
    { label: 'Syncing preferences...', progress: 0.80 },
    { label: 'Almost there...', progress: 0.95 },
];

const ADS = [
    {
        icon: 'package-variant-closed' as const,
        title: 'Smart. Secure. Delivered.',
        body: 'Your parcels stay safe in our GPS-tracked smart box — no more missed deliveries.',
    },
    {
        icon: 'lock-outline' as const,
        title: 'One-Time PIN Access',
        body: 'Every delivery unlocks with a unique OTP so only you can retrieve your package.',
    },
    {
        icon: 'map-marker-path' as const,
        title: 'Real-Time Tracking',
        body: 'Know exactly where your rider is and get notified the moment your box is sealed.',
    },
    {
        icon: 'shield-alert-outline' as const,
        title: 'Tamper Detection',
        body: 'Built-in sensors alert you instantly if anyone tries to tamper with your box.',
    },
];

export default function AuthLoadingScreen() {
    const navigation = useNavigation<any>();
    const { isDarkMode: isDark } = useAppTheme();
    const login = useAuthStore((state: any) => state.login);

    const colors = isDark ? COLORS.dark : COLORS.light;

    const logoPulse = usePulseAnimation(0.5, 800);

    // Progress animation
    const progressAnim = useRef(new Animated.Value(0)).current;
    const [stepIndex, setStepIndex] = useState(0);
    const [authError, setAuthError] = useState<string | null>(null);
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);
    const [isOffline, setIsOffline] = useState(false);
    const [authAttempt, setAuthAttempt] = useState(0);
    const didNavigateRef = useRef(false);

    // Ad carousel
    const [adIndex, setAdIndex] = useState(0);
    const adOpacity = useRef(new Animated.Value(1)).current;
    const floatAnim = useRef(new Animated.Value(0)).current;

    // Animate progress through load steps
    useEffect(() => {
        let stepIdx = 0;
        const advanceStep = () => {
            if (stepIdx >= LOAD_STEPS.length) return;
            const step = LOAD_STEPS[stepIdx];
            setStepIndex(stepIdx);
            Animated.timing(progressAnim, {
                toValue: step.progress,
                duration: 600,
                useNativeDriver: false,
            }).start();
            stepIdx++;
        };

        advanceStep(); // immediate first step
        const interval = setInterval(() => {
            if (stepIdx < LOAD_STEPS.length) {
                advanceStep();
            } else {
                clearInterval(interval);
            }
        }, 900);

        return () => clearInterval(interval);
    }, []);

    // GPS Warmup — fire as early as possible so the radio is hot by the time
    // the rider reaches RiderDashboard. Runs in parallel with session restore.
    useEffect(() => {
        warmUpLocationServices();
    }, []);

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state) => {
            setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
        });
        return () => unsubscribe();
    }, []);

    // Cycle ads with fade transition
    useEffect(() => {
        const interval = setInterval(() => {
            Animated.timing(adOpacity, {
                toValue: 0,
                duration: 350,
                useNativeDriver: true,
            }).start(() => {
                setAdIndex((prev) => (prev + 1) % ADS.length);
                Animated.timing(adOpacity, {
                    toValue: 1,
                    duration: 350,
                    useNativeDriver: true,
                }).start();
            });
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    // Ambient floating background motion
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, {
                    toValue: 1,
                    duration: 3000,
                    useNativeDriver: true,
                }),
                Animated.timing(floatAnim, {
                    toValue: 0,
                    duration: 3000,
                    useNativeDriver: true,
                }),
            ])
        );

        loop.start();
        return () => loop.stop();
    }, [floatAnim]);

    const safeReplace = (route: 'Login' | 'RoleSelection') => {
        if (didNavigateRef.current) return;
        didNavigateRef.current = true;
        captureHandledMessage('auth_loading_navigation_replace', { route }, 'info');
        navigation.replace(route);
    };

    const withTimeout = async <T,>(promise: PromiseLike<T>, label: string, timeoutMs = 10000): Promise<T> => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`${label} timed out`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        }
    };

    useEffect(() => {
        let cancelled = false;
        const watchdogMs = 15000;

        const restoreSession = async () => {
            setIsCheckingAuth(true);
            setAuthError(null);

            const watchdog = setTimeout(() => {
                if (cancelled || didNavigateRef.current) return;
                setIsCheckingAuth(false);
                setAuthError(isOffline ? 'No internet connection. Please reconnect and try again.' : 'Session check is taking longer than expected.');
                captureHandledMessage('auth_loading_watchdog_triggered', { offline: String(isOffline) }, 'warning');
            }, watchdogMs);

            try {
                const biometricBinding = await validateBiometricBoundSecrets();
                if (biometricBinding.requiresHardRelogin) {
                    console.warn('[AuthLoading] Biometric-bound key invalidated. Forcing hard re-login.');
                    captureHandledMessage('auth_loading_hard_relogin_biometric_binding', {}, 'warning');
                    try {
                        await supabase.auth.signOut();
                    } catch {
                        // Ignore signOut errors and continue to Login.
                    }
                    safeReplace('Login');
                    return;
                }

                // ── Fast path: MMKV-hydrated state ──────────────────────────
                // If Zustand already has user data (restored from MMKV on disk),
                // skip the network call and go straight to the dashboard.
                // The Supabase token is refreshed silently in the background
                // by the AppState listener in supabaseClient.ts.
                const cachedState = useAuthStore.getState() as any;
                if (cachedState.user && cachedState.role) {
                    console.log('[AuthLoading] Fast path: state hydrated from MMKV, skipping network');
                    Animated.timing(progressAnim, {
                        toValue: 1,
                        duration: 200,
                        useNativeDriver: false,
                    }).start(() => {
                        if (!cancelled) {
                            safeReplace('RoleSelection');
                        }
                    });

                    // Fire-and-forget: silently refresh profile in background
                    // so any server-side role changes take effect next launch
                    (async () => {
                        try {
                            const { data: { session } } = await withTimeout(supabase.auth.getSession(), 'Background session refresh');
                            if (session?.user) {
                                const { data: profile } = await withTimeout(supabase
                                    .from('profiles')
                                    .select('role, full_name, phone_number, avatar_url')
                                    .eq('id', session.user.id)
                                    .maybeSingle(), 'Background profile refresh');
                                if (profile) {
                                    const rawRole = profile.role || session.user.user_metadata?.role || 'CUSTOMER';
                                    const role = typeof rawRole === 'string' ? rawRole.toLowerCase() : 'customer';
                                    login({
                                        userId: session.user.id,
                                        email: session.user.email,
                                        name: profile.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name,
                                        photo: profile.avatar_url || session.user.user_metadata?.avatar_url,
                                        role,
                                        fullName: profile.full_name || session.user.user_metadata?.full_name,
                                        phone: profile.phone_number,
                                    });
                                }
                            }
                        } catch (_) {
                            // Non-fatal background refresh
                            captureHandledMessage('auth_loading_background_refresh_failed', {}, 'info');
                        }
                    })();

                    return;
                }

                // ── Slow path: no cached state, fetch from network ──────────
                const { data: { session }, error } = await withTimeout(supabase.auth.getSession(), 'Session restoration');

                if (error) {
                    console.error('Session restoration error:', error);
                    setAuthError(isOffline ? 'No internet connection. Please reconnect and try again.' : 'Could not restore your session.');
                    captureHandledError(error, { module: 'auth-loading', phase: 'session-restore' });
                    setIsCheckingAuth(false);
                    return;
                }

                if (session && session.user) {
                    const { data: profile, error: profileError } = await withTimeout(supabase
                        .from('profiles')
                        .select('role, full_name, phone_number, avatar_url')
                        .eq('id', session.user.id)
                        .maybeSingle(), 'Profile restoration');

                    if (profileError) {
                        console.warn('Profile fetch error (likely offline), falling back to session data:', profileError);
                        captureHandledMessage('auth_loading_profile_fetch_warning', { offline: String(isOffline) }, 'warning');
                    }

                    const rawRole = profile?.role || session.user.user_metadata?.role || 'CUSTOMER';
                    const role = typeof rawRole === 'string' ? rawRole.toLowerCase() : 'customer';

                    login({
                        userId: session.user.id,
                        email: session.user.email,
                        name: profile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name,
                        photo: profile?.avatar_url || session.user.user_metadata?.avatar_url,
                        role: role,
                        fullName: profile?.full_name || session.user.user_metadata?.full_name,
                        phone: profile?.phone_number
                    });

                    // Complete progress bar before navigating
                    Animated.timing(progressAnim, {
                        toValue: 1,
                        duration: 400,
                        useNativeDriver: false,
                    }).start(() => {
                        // Always go to RoleSelection so the user can pick their dashboard
                        if (!cancelled) {
                            safeReplace('RoleSelection');
                        }
                    });
                } else {
                    safeReplace('Login');
                }
            } catch (err) {
                console.error('Auth check error:', err);
                setAuthError(isOffline ? 'No internet connection. Please reconnect and try again.' : 'Unable to finish startup checks.');
                captureHandledError(err, { module: 'auth-loading', phase: 'restore-session-catch', offline: String(isOffline) });
                setIsCheckingAuth(false);
            } finally {
                clearTimeout(watchdog);
            }
        };

        restoreSession();

        return () => {
            cancelled = true;
        };
    }, [authAttempt, login, navigation, progressAnim]);

    const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, SCREEN_WIDTH - 64],
    });

    const currentAd = ADS[adIndex];
    const orbOneTranslateY = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -14],
    });
    const orbTwoTranslateY = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 10],
    });

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            <Animated.View
                pointerEvents="none"
                style={[
                    styles.backgroundOrb,
                    styles.orbOne,
                    {
                        backgroundColor: colors.orbOne,
                        transform: [{ translateY: orbOneTranslateY }],
                    },
                ]}
            />
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.backgroundOrb,
                    styles.orbTwo,
                    {
                        backgroundColor: colors.orbTwo,
                        transform: [{ translateY: orbTwoTranslateY }],
                    },
                ]}
            />

            <View style={[styles.mainCard, { backgroundColor: colors.panel, borderColor: colors.border }]}>

            {/* Logo / Branding */}
            <View style={styles.brandSection}>
                <Animated.View style={[styles.logoBox, { backgroundColor: colors.surface, borderColor: colors.border }, logoPulse.style]}>
                    <MaterialCommunityIcons name="package-variant-closed" size={36} color={colors.text} />
                </Animated.View>
                <Text style={[styles.appName, { color: colors.text }]}>Parcel Safe</Text>
                <Text style={[styles.tagline, { color: colors.textSecondary }]}>
                    Smart Delivery. Zero Hassle.
                </Text>
            </View>

            {/* Ad Banner */}
            <Animated.View
                style={[
                    styles.adCard,
                    { backgroundColor: colors.adBg, borderColor: colors.adBorder, opacity: adOpacity }
                ]}
            >
                <View style={[styles.adIconWrap, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <MaterialCommunityIcons name={currentAd.icon} size={22} color={colors.text} />
                </View>
                <View style={styles.adTextWrap}>
                    <Text style={[styles.adTitle, { color: colors.text }]}>{currentAd.title}</Text>
                    <Text style={[styles.adBody, { color: colors.textSecondary }]}>{currentAd.body}</Text>
                </View>
            </Animated.View>

            {/* Ad dots */}
            <View style={styles.adDots}>
                {ADS.map((_, i) => (
                    <View
                        key={i}
                        style={[
                            styles.dot,
                            {
                                backgroundColor: i === adIndex ? colors.text : colors.progressBg,
                                width: i === adIndex ? 16 : 6,
                            }
                        ]}
                    />
                ))}
            </View>

            {/* Progress Section */}
            <View style={styles.progressSection}>
                <View style={[styles.progressTrack, { backgroundColor: colors.progressBg }]}>
                    <Animated.View
                        style={[
                            styles.progressFill,
                            { backgroundColor: colors.progressFill, width: progressWidth }
                        ]}
                    />
                </View>
                <View style={styles.statusRow}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                    <Text style={[styles.statusText, { color: colors.textSecondary }]}>
                        {authError || LOAD_STEPS[stepIndex]?.label || 'Loading...'}
                    </Text>
                </View>

                {isOffline && !didNavigateRef.current && (
                    <View style={[styles.offlineBadge, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                        <MaterialCommunityIcons name="wifi-off" size={14} color={colors.textSecondary} />
                        <Text style={[styles.offlineBadgeText, { color: colors.textSecondary }]}>No internet connection detected</Text>
                    </View>
                )}

                {!!authError && !didNavigateRef.current && (
                    <View style={styles.recoveryRow}>
                        <TouchableOpacity
                            style={[styles.recoveryButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
                            onPress={() => {
                                captureHandledMessage('auth_loading_retry_pressed', { offline: String(isOffline) }, 'info');
                                setStepIndex(0);
                                progressAnim.setValue(0);
                                setAuthAttempt((prev) => prev + 1);
                            }}
                            disabled={isCheckingAuth}
                        >
                            <Text style={[styles.recoveryButtonText, { color: colors.text }]}>Try Again</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.recoveryButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
                            onPress={() => safeReplace('Login')}
                            disabled={isCheckingAuth}
                        >
                            <Text style={[styles.recoveryButtonText, { color: colors.text }]}>Go to Login</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    mainCard: {
        width: '100%',
        borderWidth: 1,
        borderRadius: 24,
        paddingHorizontal: 20,
        paddingVertical: 28,
    },
    backgroundOrb: {
        position: 'absolute',
        borderRadius: 999,
    },
    orbOne: {
        width: 240,
        height: 240,
        top: 80,
        right: -70,
    },
    orbTwo: {
        width: 180,
        height: 180,
        bottom: 110,
        left: -55,
    },

    // Brand
    brandSection: {
        alignItems: 'center',
        marginBottom: 40,
    },
    logoBox: {
        width: 72,
        height: 72,
        borderRadius: 20,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14,
    },
    appName: {
        fontSize: 26,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.5,
        marginBottom: 4,
    },
    tagline: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
        letterSpacing: 0.1,
    },

    // Ad card
    adCard: {
        width: '100%',
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 12,
        minHeight: 82,
    },
    adIconWrap: {
        width: 40,
        height: 40,
        borderRadius: 10,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    adTextWrap: {
        flex: 1,
    },
    adTitle: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 3,
        letterSpacing: -0.1,
    },
    adBody: {
        fontSize: 12,
        lineHeight: 17,
        fontFamily: 'Inter_400Regular',
    },

    // Dots
    adDots: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginBottom: 28,
    },
    dot: {
        height: 6,
        borderRadius: 3,
    },

    // Progress
    progressSection: {
        width: '100%',
        alignItems: 'center',
    },
    progressTrack: {
        width: '100%',
        height: 5,
        borderRadius: 999,
        overflow: 'hidden',
        marginBottom: 14,
    },
    progressFill: {
        height: '100%',
        borderRadius: 999,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    offlineBadge: {
        marginTop: 12,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    offlineBadgeText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    recoveryRow: {
        marginTop: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
    },
    recoveryButton: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    recoveryButtonText: {
        fontSize: 13,
        fontWeight: '700',
    },
    statusText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        letterSpacing: 0.1,
    },
});
