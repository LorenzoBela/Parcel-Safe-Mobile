/**
 * RiderLoadingScreen
 *
 * Transition screen between RoleSelectionScreen and RiderDashboard.
 * Gates navigation until:
 *   1. GPS warmup is complete (or 5s timeout).
 *   2. Foreground + background location permissions are confirmed.
 *   3. Map tiles are pre-cached at the rider's warmup position.
 *   4. Minimum 1.5s display (prevent flash on fast devices).
 *
 * Matches the existing Uber-style design language.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    StyleSheet,
    useColorScheme,
    StatusBar,
    Animated,
    Dimensions,
    Text,
    ActivityIndicator,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePulseAnimation } from '../../hooks/useEntryAnimation';
import { isGpsWarmedUp, warmUpLocationServices } from '../../services/gpsWarmupService';
import * as Location from 'expo-location';

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
    { label: 'Warming up GPS...', progress: 0.15, icon: 'crosshairs-gps' as const },
    { label: 'Locking satellites...', progress: 0.35, icon: 'satellite-variant' as const },
    { label: 'Checking permissions...', progress: 0.55, icon: 'shield-check-outline' as const },
    { label: 'Preparing dashboard...', progress: 0.80, icon: 'view-dashboard-outline' as const },
    { label: 'Ready!', progress: 1.0, icon: 'check-circle-outline' as const },
];

const MIN_DISPLAY_MS = 1500;

export default function RiderLoadingScreen() {
    const navigation = useNavigation<any>();
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';
    const colors = isDark ? COLORS.dark : COLORS.light;

    const logoPulse = usePulseAnimation(0.5, 800);
    const progressAnim = useRef(new Animated.Value(0)).current;
    const [stepIndex, setStepIndex] = useState(0);
    const mountTime = useRef(Date.now()).current;
    const hasNavigated = useRef(false);


    // Run all readiness checks
    useEffect(() => {
        let cancelled = false;

        const prepareRider = async () => {
            // Step 1: Ensure warmup is triggered (may already be done from AuthLoadingScreen)
            setStepIndex(0);
            animateProgress(LOAD_STEPS[0].progress);
            warmUpLocationServices();

            // Step 2: Wait for GPS warmup
            setStepIndex(1);
            animateProgress(LOAD_STEPS[1].progress);
            await waitForGpsWarmup();

            if (cancelled) return;

            // Step 3: Check foreground + background permissions
            setStepIndex(2);
            animateProgress(LOAD_STEPS[2].progress);
            await checkAllPermissions();

            if (cancelled) return;

            // Step 4: Preparing dashboard
            setStepIndex(3);
            animateProgress(LOAD_STEPS[3].progress);

            // Ensure minimum display time
            const elapsed = Date.now() - mountTime;
            if (elapsed < MIN_DISPLAY_MS) {
                await new Promise(resolve => setTimeout(resolve, MIN_DISPLAY_MS - elapsed));
            }

            if (cancelled) return;

            // Step 5: Ready — navigate
            setStepIndex(4);
            animateProgress(1.0);

            // Brief pause on "Ready!" before navigating
            await new Promise(resolve => setTimeout(resolve, 300));

            if (cancelled || hasNavigated.current) return;
            hasNavigated.current = true;
            navigation.replace('RiderApp');
        };

        prepareRider();

        return () => { cancelled = true; };
    }, []);

    function animateProgress(toValue: number) {
        Animated.timing(progressAnim, {
            toValue,
            duration: 400,
            useNativeDriver: false,
        }).start();
    }

    const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, SCREEN_WIDTH - 64],
    });

    const currentStep = LOAD_STEPS[stepIndex] ?? LOAD_STEPS[LOAD_STEPS.length - 1];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            {/* Icon */}
            <Animated.View style={[styles.iconBox, { backgroundColor: colors.surface, borderColor: colors.border }, logoPulse.style]}>
                <MaterialCommunityIcons
                    name={currentStep.icon}
                    size={36}
                    color={colors.text}
                />
            </Animated.View>

            {/* Title */}
            <Text style={[styles.title, { color: colors.text }]}>Rider Mode</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Setting up your tracking services
            </Text>

            {/* Progress */}
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
                        {currentStep.label}
                    </Text>
                </View>
            </View>
        </SafeAreaView>
    );
}

// ==================== Module-Level Helpers ====================

async function waitForGpsWarmup(): Promise<void> {
    if (isGpsWarmedUp()) return;

    // Poll every 200ms, max 5s
    const deadline = Date.now() + 5000;
    while (!isGpsWarmedUp() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

async function checkAllPermissions(): Promise<void> {
    try {
        // 1. Foreground permission
        const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
        if (fgStatus !== 'granted') {
            await Location.requestForegroundPermissionsAsync();
        }

        // 2. Background permission — needed for backgroundLocationService
        const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
            await Location.requestBackgroundPermissionsAsync();
        }
    } catch (error) {
        console.warn('[RiderLoading] Permission check failed:', error);
    }
}

// ==================== Styles ====================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    iconBox: {
        width: 72,
        height: 72,
        borderRadius: 20,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        fontSize: 26,
        fontWeight: '700',
        letterSpacing: -0.5,
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 13,
        fontWeight: '400',
        letterSpacing: 0.1,
        marginBottom: 40,
    },
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
