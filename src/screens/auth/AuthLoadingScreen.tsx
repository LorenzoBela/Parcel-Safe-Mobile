import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    ActivityIndicator,
    StyleSheet,
    useColorScheme,
    StatusBar,
    Animated,
    Dimensions,
    Text,
} from 'react-native';
import { usePulseAnimation } from '../../hooks/useEntryAnimation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import useAuthStore from '../../store/authStore';
import { supabase } from '../../services/supabaseClient';
import { warmUpLocationServices } from '../../services/gpsWarmupService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
    light: {
        background: '#FFFFFF',
        surface: '#F6F6F6',
        text: '#000000',
        textSecondary: '#6B6B6B',
        border: '#E8E8E8',
        progressBg: '#E8E8E8',
        progressFill: '#000000',
        adBg: '#F6F6F6',
        adBorder: '#E8E8E8',
    },
    dark: {
        background: '#000000',
        surface: '#1C1C1E',
        text: '#FFFFFF',
        textSecondary: '#8E8E93',
        border: '#2C2C2E',
        progressBg: '#2C2C2E',
        progressFill: '#FFFFFF',
        adBg: '#1C1C1E',
        adBorder: '#2C2C2E',
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
    const colorScheme = useColorScheme();
    const login = useAuthStore((state: any) => state.login);

    const isDark = colorScheme === 'dark';
    const colors = isDark ? COLORS.dark : COLORS.light;

    const logoPulse = usePulseAnimation(0.5, 800);

    // Progress animation
    const progressAnim = useRef(new Animated.Value(0)).current;
    const [stepIndex, setStepIndex] = useState(0);

    // Ad carousel
    const [adIndex, setAdIndex] = useState(0);
    const adOpacity = useRef(new Animated.Value(1)).current;

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

    useEffect(() => {
        const restoreSession = async () => {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('Session restoration error:', error);
                    navigation.replace('Login');
                    return;
                }

                if (session && session.user) {
                    const { data: profile, error: profileError } = await supabase
                        .from('profiles')
                        .select('role, full_name, phone_number, avatar_url')
                        .eq('id', session.user.id)
                        .maybeSingle();

                    if (profileError) {
                        console.warn('Profile fetch error (likely offline), falling back to session data:', profileError);
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
                        navigation.replace('RoleSelection');
                    });
                } else {
                    navigation.replace('Login');
                }
            } catch (err) {
                console.error('Auth check error:', err);
                navigation.replace('Login');
            }
        };

        restoreSession();
    }, [login, navigation]);

    const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, SCREEN_WIDTH - 64],
    });

    const currentAd = ADS[adIndex];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

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
                        {LOAD_STEPS[stepIndex]?.label ?? 'Loading...'}
                    </Text>
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
        paddingHorizontal: 32,
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
        fontWeight: '700',
        letterSpacing: -0.5,
        marginBottom: 4,
    },
    tagline: {
        fontSize: 13,
        fontWeight: '400',
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
        fontWeight: '600',
        marginBottom: 3,
        letterSpacing: -0.1,
    },
    adBody: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '400',
    },

    // Dots
    adDots: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginBottom: 36,
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
        height: 3,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 12,
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        letterSpacing: 0.1,
    },
});
