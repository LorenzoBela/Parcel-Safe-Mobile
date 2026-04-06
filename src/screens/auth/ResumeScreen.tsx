/**
 * ResumeScreen
 *
 * Full-screen branded overlay shown whenever the app returns from the background.
 * Covers the frozen-UI period while the JS bridge flushes queued work (GPS wakeup,
 * token refresh, etc.). Dismisses with a fade-out once the critical resume tasks
 * complete, or after a hard 3-second cap — whichever comes first.
 *
 * Rendered as an absolute overlay in App.js — no navigator push required.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    ActivityIndicator,
    StyleSheet,
    StatusBar,
    Animated,
    Dimensions,
    Text,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { usePulseAnimation } from '../../hooks/useEntryAnimation';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../services/supabaseClient';
import useAuthStore from '../../store/authStore';
import { triggerForegroundResumePipeline } from '../../services/foregroundResumePipelineService';
import { useAppTheme } from '../../context/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Props {
    onReady: () => void;
}

const COLORS = {
    light: {
        background: '#FFFFFF',
        surface: '#F6F6F6',
        text: '#000000',
        textSecondary: '#6B6B6B',
        border: '#E8E8E8',
        progressBg: '#E8E8E8',
        progressFill: '#000000',
    },
    dark: {
        background: '#000000',
        surface: '#1C1C1E',
        text: '#FFFFFF',
        textSecondary: '#8E8E93',
        border: '#2C2C2E',
        progressBg: '#2C2C2E',
        progressFill: '#FFFFFF',
    },
};

const LOAD_STEPS = [
    { label: 'Waking up...', progress: 0.3 },
    { label: 'Checking session...', progress: 0.65 },
    { label: 'Ready!', progress: 1.0 },
];

// Hard cap: dismiss unconditionally after this many ms, even if tasks are still running
const HARD_CAP_MS = 1500;

export default function ResumeScreen({ onReady }: Props) {
    const { isDarkMode: isDark } = useAppTheme();
    const colors = isDark ? COLORS.dark : COLORS.light;

    const logoPulse = usePulseAnimation(0.5, 800);
    const progressAnim = useRef(new Animated.Value(0)).current;
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const [stepIndex, setStepIndex] = useState(0);
    const [softAuthWarning, setSoftAuthWarning] = useState<string | null>(null);
    const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
    const doneRef = useRef(false);
    const offlineRef = useRef(false);

    const dismiss = () => {
        if (doneRef.current) return;
        doneRef.current = true;

        // Snap progress bar to 100%, then fade the whole overlay out
        Animated.timing(progressAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: false,
        }).start(() => {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start(() => onReady());
        });
    };

    const animateProgress = (toValue: number) => {
        Animated.timing(progressAnim, {
            toValue,
            duration: 400,
            useNativeDriver: false,
        }).start();
    };

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state) => {
            const offlineNow = !(state.isConnected && state.isInternetReachable !== false);
            offlineRef.current = offlineNow;
            if (offlineNow) {
                setSoftAuthWarning('Offline mode: resuming with cached data.');
            }
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        // Guarantee we always dismiss, even if something hangs
        const hardCapTimer = setTimeout(dismiss, HARD_CAP_MS);

        const resume = async () => {
            const slowWarningTimer = setTimeout(() => {
                if (!doneRef.current) {
                    setConnectionWarning('Network is slow. Finishing resume safely.');
                }
            }, 900);

            // ── Step 0: Waking up ──────────────────────────────────────────────
            setStepIndex(0);
            animateProgress(LOAD_STEPS[0].progress);

            try {
                const netState = await NetInfo.fetch();
                const offline = !(netState.isConnected && netState.isInternetReachable !== false);
                if (offline) {
                    setConnectionWarning('Offline detected. Restoring from cached state.');
                }
            } catch (_) {
                setConnectionWarning('Network check delayed. Continuing resume.');
            }

            // Kick off resume pipeline stages with deadlines.
            try {
                await Promise.race([
                    triggerForegroundResumePipeline('resume_screen'),
                    new Promise(resolve => setTimeout(resolve, 1200)),
                ]);
            } catch (_) {
                // Pipeline is best-effort, never block UI for it
                if (!offlineRef.current) {
                    setSoftAuthWarning('Resume is taking longer than usual.');
                }
            }

            // ── Step 1: Checking session ───────────────────────────────────────
            setStepIndex(1);
            animateProgress(LOAD_STEPS[1].progress);

            try {
                const cachedAuth = useAuthStore.getState() as any;
                if (cachedAuth?.isAuthenticated && cachedAuth?.user) {
                    // Fast resume path: UI is already hydrated from MMKV.
                    // Refresh token/session in background without blocking unfreeze.
                    setStepIndex(2);
                    setTimeout(() => {
                        if (!supabase) return;
                        supabase.auth.getSession().catch(() => { });
                    }, 0);
                    clearTimeout(hardCapTimer);
                    dismiss();
                    return;
                }

                // Ensure the Supabase token is fresh before returning to the app.
                // The proactive refresh in supabaseClient.ts does the heavy lifting;
                // this is just a quick sanity check capped at 1s.
                if (!supabase) {
                    throw new Error('Supabase client unavailable during resume');
                }
                await Promise.race([
                    supabase.auth.getSession(),
                    new Promise(resolve => setTimeout(resolve, 1000)),
                ]);
            } catch (_) {
                // Non-fatal — app continues normally with cached auth.
                setSoftAuthWarning('Session refresh is delayed. Using cached login.');
            }

            // ── Step 2: Done ───────────────────────────────────────────────────
            setStepIndex(2);
            clearTimeout(slowWarningTimer);
            clearTimeout(hardCapTimer);
            dismiss();
        };

        resume();

        return () => clearTimeout(hardCapTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, SCREEN_WIDTH - 64],
    });

    return (
        <Animated.View
            style={[
                styles.overlay,
                { backgroundColor: colors.background, opacity: fadeAnim },
            ]}
        >
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            {/* Branding */}
            <View style={styles.brandSection}>
                <Animated.View
                    style={[
                        styles.logoBox,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                        logoPulse.style,
                    ]}
                >
                    <MaterialCommunityIcons
                        name="package-variant-closed"
                        size={36}
                        color={colors.text}
                    />
                </Animated.View>
                <Text style={[styles.appName, { color: colors.text }]}>Parcel Safe</Text>
                <Text style={[styles.tagline, { color: colors.textSecondary }]}>
                    Smart Delivery. Zero Hassle.
                </Text>
            </View>

            {/* Progress bar + status label */}
            <View style={styles.progressSection}>
                <View style={[styles.progressTrack, { backgroundColor: colors.progressBg }]}>
                    <Animated.View
                        style={[
                            styles.progressFill,
                            { backgroundColor: colors.progressFill, width: progressWidth },
                        ]}
                    />
                </View>
                <View style={styles.statusRow}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                    <Text style={[styles.statusText, { color: colors.textSecondary }]}>
                        {LOAD_STEPS[stepIndex]?.label ?? 'Loading...'}
                    </Text>
                </View>
                {softAuthWarning && (
                    <Text style={[styles.statusText, { color: colors.textSecondary, marginTop: 6 }]}>
                        {softAuthWarning}
                    </Text>
                )}
                {connectionWarning && (
                    <Text style={[styles.statusText, { color: colors.textSecondary, marginTop: 6 }]}> 
                        {connectionWarning}
                    </Text>
                )}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 9999,
        justifyContent: 'center',
        alignItems: 'center',
    },
    brandSection: {
        alignItems: 'center',
        marginBottom: 48,
    },
    logoBox: {
        width: 72,
        height: 72,
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    appName: {
        fontSize: 22,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    tagline: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
    },
    progressSection: {
        width: SCREEN_WIDTH - 64,
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
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
    },
});
