import React, { useRef, useState, useEffect } from 'react';
import dayjs from 'dayjs';
import * as Location from 'expo-location';
import { fetchWeather, WeatherData } from '../../services/weatherService';
import {
    View,
    StyleSheet,
    Pressable,
    Animated,
    Image,
    StatusBar,
    Platform,
    ActivityIndicator,
    Modal,
    TouchableOpacity,
} from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, TextInput } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { signOut } from '../../services/auth';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import { PremiumAlert } from '../../services/PremiumAlertService';
import { authenticateBiometricForSensitiveAction } from '../../services/biometricAuthService';
import { sessionService } from '../../services/sessionService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    fetchDashboardPinStatus,
    PersonalPinApiError,
    setDashboardPin,
    verifyDashboardPin,
} from '../../services/personalPinService';

// Uber-inspired minimalist colors
const COLORS = {
    light: {
        background: '#FFFFFF',
        surface: '#F6F6F6',
        text: '#000000',
        textSecondary: '#6B6B6B',
        border: '#E8E8E8',
        accent: '#000000',
    },
    dark: {
        background: '#000000',
        surface: '#1C1C1E',
        text: '#FFFFFF',
        textSecondary: '#8E8E93',
        border: '#2C2C2E',
        accent: '#FFFFFF',
    }
};

// Dashboard option configurations
const DASHBOARD_OPTIONS = {
    admin: {
        id: 'AdminApp',
        title: 'Admin',
        subtitle: 'Global map, alerts & audits',
        icon: 'shield-check-outline' as const,
    },
    rider: {
        id: 'RiderApp',
        title: 'Rider',
        subtitle: 'Deliveries, routes & controls',
        icon: 'motorbike' as const,
    },
    customer: {
        id: 'CustomerApp',
        title: 'Customer',
        subtitle: 'Track packages & history',
        icon: 'package-variant' as const,
    },
};

const DASHBOARD_PIN_LOCAL_LOCKOUT_KEY_PREFIX = 'parcelSafe:dashboardPinLockoutUntil:';
const DASHBOARD_PIN_MAX_ATTEMPTS = 5;
const DASHBOARD_PIN_LOCKOUT_MS = 30 * 1000;

type DashboardTarget = 'RiderApp' | 'AdminApp';
type AppTarget = DashboardTarget | 'CustomerApp';

export default function RoleSelectionScreen() {
    const navigation = useNavigation<any>();
    const { isDarkMode: isDark } = useAppTheme();
    const { role, user, logout } = useAuthStore((state: any) => state);
    const userId = user?.userId;
    const isPrivilegedRole = role === 'admin' || role === 'rider';

    const [currentTime, setCurrentTime] = useState(dayjs());
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [locationName, setLocationName] = useState<string | null>(null);
    const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
    const [loadingPhase, setLoadingPhase] = useState<'idle' | 'authorizing' | 'registering' | 'routing'>('idle');

    const [showDashboardPinModal, setShowDashboardPinModal] = useState(false);
    const [showSetPinModal, setShowSetPinModal] = useState(false);
    const [pinTargetApp, setPinTargetApp] = useState<DashboardTarget | null>(null);
    const [pinFallbackMessage, setPinFallbackMessage] = useState<string | null>(null);
    const [hasDashboardPin, setHasDashboardPin] = useState<boolean | null>(null);
    const [dashboardPinStatusLoading, setDashboardPinStatusLoading] = useState(false);

    const [dashboardPin, setDashboardPin] = useState('');
    const [showDashboardPin, setShowDashboardPin] = useState(false);
    const [pinSubmitting, setPinSubmitting] = useState(false);

    const [newDashboardPin, setNewDashboardPin] = useState('');
    const [confirmDashboardPin, setConfirmDashboardPin] = useState('');
    const [showNewDashboardPin, setShowNewDashboardPin] = useState(false);
    const [showConfirmDashboardPin, setShowConfirmDashboardPin] = useState(false);
    const [saveDashboardPinSubmitting, setSaveDashboardPinSubmitting] = useState(false);

    const [localLockoutUntil, setLocalLockoutUntil] = useState(0);
    const [lockoutCountdownMs, setLockoutCountdownMs] = useState(0);

    const actionLockRef = useRef(false);
    const failedDashboardPinAttemptsRef = useRef(0);
    const progressAnim = useRef(new Animated.Value(0)).current;
    const lockoutStorageKey = userId ? `${DASHBOARD_PIN_LOCAL_LOCKOUT_KEY_PREFIX}${userId}` : null;

    const sanitizePinInput = (value: string) => value.replace(/\D/g, '').slice(0, 6);

    const clearLocalLockout = async () => {
        failedDashboardPinAttemptsRef.current = 0;
        setLocalLockoutUntil(0);
        setLockoutCountdownMs(0);
        if (lockoutStorageKey) {
            await AsyncStorage.removeItem(lockoutStorageKey).catch(() => undefined);
        }
    };

    const applyLocalLockout = async (expiresAtMs: number) => {
        failedDashboardPinAttemptsRef.current = 0;
        setLocalLockoutUntil(expiresAtMs);
        const nextCountdown = Math.max(0, expiresAtMs - Date.now());
        setLockoutCountdownMs(nextCountdown);
        if (lockoutStorageKey) {
            await AsyncStorage.setItem(lockoutStorageKey, String(expiresAtMs)).catch(() => undefined);
        }
    };

    const openDashboardPinModal = (targetApp: DashboardTarget, fallbackMessage: string) => {
        setLoadingPhase('idle');
        setPinTargetApp(targetApp);
        setPinFallbackMessage(fallbackMessage);
        setDashboardPin('');
        setShowDashboardPin(false);
        setShowSetPinModal(false);
        setShowDashboardPinModal(true);
    };

    const openSetPinModal = (targetApp: DashboardTarget | null, fallbackMessage?: string) => {
        setLoadingPhase('idle');
        setPinTargetApp(targetApp);
        setPinFallbackMessage(fallbackMessage ?? null);
        setNewDashboardPin('');
        setConfirmDashboardPin('');
        setShowNewDashboardPin(false);
        setShowConfirmDashboardPin(false);
        setShowDashboardPinModal(false);
        setShowSetPinModal(true);
    };

    const navigateToTargetApp = async (targetApp: AppTarget) => {
        if (targetApp === 'RiderApp') {
            setLoadingPhase('registering');
            if (userId) {
                try {
                    await sessionService.registerSession(
                        userId,
                        Platform.OS === 'ios' ? 'ios' : 'android',
                        '1.0.1'
                    );
                } catch (error) {
                    console.warn('[RoleSelection] Failed to register rider session:', error);
                }
            }
            setLoadingPhase('routing');
            navigation.replace('RiderLoading');
            return;
        }

        setLoadingPhase('routing');
        navigation.replace(targetApp);
    };

    // Live clock
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(dayjs()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Weather & Location
    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            try {
                let location = await Location.getCurrentPositionAsync({});
                
                let address = await Location.reverseGeocodeAsync({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude
                });
                if (address && address.length > 0) {
                    const { city, region, name } = address[0];
                    setLocationName(city ? `${city}, ${region}` : name || 'Unknown Location');
                }

                const data = await fetchWeather(location.coords.latitude, location.coords.longitude);
                if (data) setWeather(data);
            } catch {
                // Ignore gracefully
            }
        })();
    }, []);

    useEffect(() => {
        if (loadingPhase === 'idle' && !isSwitchingAccount) {
            progressAnim.stopAnimation();
            progressAnim.setValue(0);
            return;
        }

        progressAnim.setValue(0);
        const loopAnim = Animated.loop(
            Animated.sequence([
                Animated.timing(progressAnim, {
                    toValue: 0.92,
                    duration: 1200,
                    useNativeDriver: false,
                }),
                Animated.timing(progressAnim, {
                    toValue: 0.2,
                    duration: 0,
                    useNativeDriver: false,
                }),
            ])
        );
        loopAnim.start();

        return () => {
            loopAnim.stop();
            progressAnim.stopAnimation();
            progressAnim.setValue(0);
        };
    }, [loadingPhase, isSwitchingAccount, progressAnim]);

    useEffect(() => {
        return () => {
            actionLockRef.current = false;
        };
    }, []);

    useEffect(() => {
        let mounted = true;

        if (!lockoutStorageKey) {
            setLocalLockoutUntil(0);
            setLockoutCountdownMs(0);
            failedDashboardPinAttemptsRef.current = 0;
            return;
        }

        AsyncStorage.getItem(lockoutStorageKey)
            .then((value) => {
                if (!mounted || !value) return;
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed <= Date.now()) {
                    AsyncStorage.removeItem(lockoutStorageKey).catch(() => undefined);
                    return;
                }
                setLocalLockoutUntil(parsed);
                setLockoutCountdownMs(Math.max(0, parsed - Date.now()));
            })
            .catch(() => undefined);

        return () => {
            mounted = false;
        };
    }, [lockoutStorageKey]);

    useEffect(() => {
        if (!localLockoutUntil || localLockoutUntil <= Date.now()) {
            setLockoutCountdownMs(0);
            return;
        }

        const timer = setInterval(() => {
            const remainingMs = Math.max(0, localLockoutUntil - Date.now());
            setLockoutCountdownMs(remainingMs);
            if (remainingMs <= 0) {
                clearLocalLockout().catch(() => undefined);
            }
        }, 250);

        return () => clearInterval(timer);
    }, [localLockoutUntil]);

    useEffect(() => {
        if (!user || !role) {
            navigation.replace('Login');
        }
    }, [navigation, role, user]);

    useEffect(() => {
        let mounted = true;

        if (!isPrivilegedRole) {
            setHasDashboardPin(null);
            setDashboardPinStatusLoading(false);
            return;
        }

        setDashboardPinStatusLoading(true);
        fetchDashboardPinStatus()
            .then((status) => {
                if (!mounted) return;
                setHasDashboardPin(Boolean(status.enabled));
            })
            .catch(() => {
                if (!mounted) return;
                setHasDashboardPin(null);
            })
            .finally(() => {
                if (!mounted) return;
                setDashboardPinStatusLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [isPrivilegedRole, userId]);

    const colors = isDark ? COLORS.dark : COLORS.light;
    const isBusy = isSwitchingAccount || loadingPhase !== 'idle';
    const interactionDisabled = isBusy || pinSubmitting || saveDashboardPinSubmitting;
    const canSetDashboardPin = isPrivilegedRole && hasDashboardPin === false;
    const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['8%', '100%'],
    });
    const lockoutSeconds = Math.max(0, Math.ceil(lockoutCountdownMs / 1000));

    const loadingLabel = isSwitchingAccount
        ? 'Switching account...'
        : loadingPhase === 'authorizing'
            ? 'Authorizing fingerprint...'
            : loadingPhase === 'registering'
                ? 'Starting rider session...'
                : 'Opening dashboard...';

    const handleNavigation = async (targetApp: AppTarget) => {
        if (actionLockRef.current || isSwitchingAccount) return;

        actionLockRef.current = true;
        let didNavigate = false;

        try {
            const requiresStepUp = targetApp === 'RiderApp' || targetApp === 'AdminApp';
            if (requiresStepUp) {
                setLoadingPhase('authorizing');
                const authResult = await authenticateBiometricForSensitiveAction('Authorize dashboard access');
                if (!authResult.success) {
                    if (hasDashboardPin === false) {
                        openSetPinModal(targetApp as DashboardTarget, authResult.message);
                    } else {
                        // Immediate fallback keeps the transition premium and avoids spinner linger.
                        openDashboardPinModal(targetApp as DashboardTarget, authResult.message);
                    }
                    return;
                }
            }

            await navigateToTargetApp(targetApp);
            didNavigate = true;
        } finally {
            actionLockRef.current = false;
            if (!didNavigate) {
                setLoadingPhase('idle');
            }
        }
    };

    const registerLocalFailedPinAttempt = async () => {
        failedDashboardPinAttemptsRef.current += 1;
        const remainingAttempts = DASHBOARD_PIN_MAX_ATTEMPTS - failedDashboardPinAttemptsRef.current;

        if (failedDashboardPinAttemptsRef.current >= DASHBOARD_PIN_MAX_ATTEMPTS) {
            await applyLocalLockout(Date.now() + DASHBOARD_PIN_LOCKOUT_MS);
            return { remainingAttempts: 0, lockoutApplied: true };
        }

        return { remainingAttempts, lockoutApplied: false };
    };

    const handleSubmitDashboardPin = async () => {
        if (actionLockRef.current || pinSubmitting) return;
        if (!pinTargetApp) return;

        if (lockoutSeconds > 0) {
            PremiumAlert.alert('Too Many Attempts', `Try again in ${lockoutSeconds}s.`);
            return;
        }

        const sanitizedPin = sanitizePinInput(dashboardPin);
        if (!/^\d{6}$/.test(sanitizedPin)) {
            PremiumAlert.alert('Invalid PIN', 'Enter your 6-digit Rider PIN to continue.');
            return;
        }

        actionLockRef.current = true;
        try {
            setPinSubmitting(true);
            await verifyDashboardPin(sanitizedPin);
            await clearLocalLockout();
            setShowDashboardPinModal(false);
            await navigateToTargetApp(pinTargetApp);
        } catch (error: any) {
            const apiCode = typeof error?.code === 'string' ? error.code : null;
            if (apiCode === 'PIN_NOT_SET') {
                setHasDashboardPin(false);
                openSetPinModal(pinTargetApp, pinFallbackMessage || undefined);
                return;
            }

            if (apiCode === 'AUTH_EXPIRED') {
                PremiumAlert.alert('Session Expired', 'Please sign in again to continue.');
                navigation.replace('Login');
                return;
            }

            if (apiCode === 'LOCKED_OUT' || apiCode === 'TOO_MANY_ATTEMPTS') {
                const retryAfterSeconds = Number((error as PersonalPinApiError)?.retryAfterSeconds || 30);
                await applyLocalLockout(Date.now() + retryAfterSeconds * 1000);
                PremiumAlert.alert('Too Many Attempts', `PIN entry is locked. Try again in ${retryAfterSeconds}s.`);
                return;
            }

            const { remainingAttempts, lockoutApplied } = await registerLocalFailedPinAttempt();
            if (lockoutApplied) {
                PremiumAlert.alert('Too Many Attempts', 'PIN entry is locked for 30 seconds.');
                return;
            }

            if (apiCode === 'INVALID_PIN') {
                PremiumAlert.alert('Incorrect PIN', `Please try again (${remainingAttempts} attempts left).`);
                return;
            }

            PremiumAlert.alert('Verification Failed', error?.message || 'Could not verify Rider PIN. Please try again.');
        } finally {
            setPinSubmitting(false);
            actionLockRef.current = false;
        }
    };

    const handleSaveDashboardPin = async () => {
        if (actionLockRef.current || saveDashboardPinSubmitting) return;

        const sanitizedNew = sanitizePinInput(newDashboardPin);
        const sanitizedConfirm = sanitizePinInput(confirmDashboardPin);

        if (!/^\d{6}$/.test(sanitizedNew)) {
            PremiumAlert.alert('Invalid PIN', 'Rider PIN must be exactly 6 digits.');
            return;
        }

        if (sanitizedNew !== sanitizedConfirm) {
            PremiumAlert.alert('PIN Mismatch', 'PIN confirmation does not match.');
            return;
        }

        actionLockRef.current = true;
        try {
            setSaveDashboardPinSubmitting(true);
            await setDashboardPin(sanitizedNew);
            setHasDashboardPin(true);
            await clearLocalLockout();
            setShowSetPinModal(false);

            if (pinTargetApp) {
                PremiumAlert.alert('PIN Saved', 'Rider PIN saved. Opening dashboard...');
                await navigateToTargetApp(pinTargetApp);
                return;
            }

            PremiumAlert.alert('PIN Saved', 'Your Rider PIN has been updated.');
        } catch (error: any) {
            const apiCode = typeof error?.code === 'string' ? error.code : null;
            if (apiCode === 'AUTH_EXPIRED') {
                PremiumAlert.alert('Session Expired', 'Please sign in again to continue.');
                navigation.replace('Login');
                return;
            }
            PremiumAlert.alert('Save Failed', error?.message || 'Could not save your Rider PIN.');
        } finally {
            setSaveDashboardPinSubmitting(false);
            actionLockRef.current = false;
        }
    };

    const handleSwitchAccount = async () => {
        if (actionLockRef.current || isSwitchingAccount) return;

        actionLockRef.current = true;

        try {
            setIsSwitchingAccount(true);
            setLoadingPhase('routing');
            await signOut();
            logout();
        } catch (error) {
            console.error('Switch account failed:', error);
        } finally {
            navigation.replace('Login');
            setIsSwitchingAccount(false);
            setLoadingPhase('idle');
            actionLockRef.current = false;
        }
    };

    const isAdmin = role === 'admin';
    const isRider = role === 'rider';

    // Get first name only for cleaner display
    const firstName = user?.name?.split(' ')[0] || 'there';

    const headerAnim = useEntryAnimation(0);
    const cardAnims = useStaggerAnimation(3, 60, 80);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            {/* Header Section */}
            <Animated.View style={[styles.header, headerAnim.style]}>
                <View style={styles.headerTopRow}>
                    <View style={styles.avatarContainer}>
                        {user?.photo ? (
                            <Image
                                source={{ uri: user.photo }}
                                style={styles.avatar}
                            />
                        ) : (
                            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.surface }]}>
                                <MaterialCommunityIcons
                                    name="account"
                                    size={32}
                                    color={colors.textSecondary}
                                />
                            </View>
                        )}
                    </View>

                    {/* Right-Aligned Minimalist Info Widget */}
                    <View style={styles.rightWidget}>
                        <Text style={[styles.timeText, { color: colors.text }]}>{currentTime.format('h:mm A')}</Text>
                        <Text style={[styles.dateText, { color: colors.textSecondary }]}>{currentTime.format('dddd, MMM D')}</Text>
                        
                        {locationName && (
                            <View style={styles.locationRow}>
                                <MaterialCommunityIcons name="map-marker-outline" size={12} color={colors.textSecondary} />
                                <Text style={[styles.locationText, { color: colors.textSecondary }]}>{locationName}</Text>
                            </View>
                        )}

                        {weather && (
                            <View style={styles.weatherRow}>
                                <MaterialCommunityIcons name={weather.icon as any} size={14} color={colors.textSecondary} />
                                <Text style={[styles.weatherText, { color: colors.textSecondary }]}>{weather.temp} • {weather.condition}</Text>
                            </View>
                        )}
                    </View>
                </View>

                <Text style={[styles.greeting, { color: colors.textSecondary }]}>
                    Welcome back,
                </Text>
                <Text style={[styles.name, { color: colors.text }]}>
                    {firstName}
                </Text>
            </Animated.View>

            {/* Dashboard Selection */}
            <View style={styles.content}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                    Choose dashboard
                </Text>

                <View style={styles.optionsContainer}>
                    {/* Admin - Only for Admins */}
                    {isAdmin && (
                        <Animated.View style={cardAnims[0].style}>
                            <DashboardCard
                                {...DASHBOARD_OPTIONS.admin}
                                colors={colors}
                                onPress={() => handleNavigation('AdminApp')}
                                disabled={interactionDisabled}
                            />
                        </Animated.View>
                    )}

                    {/* Rider - For Admins and Riders */}
                    {(isAdmin || isRider) && (
                        <Animated.View style={cardAnims[1].style}>
                            <DashboardCard
                                {...DASHBOARD_OPTIONS.rider}
                                colors={colors}
                                onPress={() => handleNavigation('RiderApp')}
                                disabled={interactionDisabled}
                            />
                        </Animated.View>
                    )}

                    {/* Customer - For Everyone */}
                    <Animated.View style={cardAnims[2].style}>
                        <DashboardCard
                            {...DASHBOARD_OPTIONS.customer}
                            colors={colors}
                            onPress={() => handleNavigation('CustomerApp')}
                            disabled={interactionDisabled}
                        />
                    </Animated.View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
                {canSetDashboardPin && !dashboardPinStatusLoading && (
                    <Pressable
                        onPress={() => openSetPinModal(null)}
                        disabled={interactionDisabled}
                        style={({ pressed }) => [
                            styles.setPinButton,
                            {
                                borderColor: colors.border,
                                backgroundColor: pressed ? colors.surface : 'transparent',
                                opacity: interactionDisabled ? 0.6 : 1,
                            },
                        ]}
                    >
                        <MaterialCommunityIcons
                            name="shield-key-outline"
                            size={16}
                            color={colors.textSecondary}
                        />
                        <Text style={[styles.setPinText, { color: colors.textSecondary }]}>Set Rider PIN</Text>
                    </Pressable>
                )}

                <Pressable
                    onPress={handleSwitchAccount}
                    disabled={interactionDisabled}
                    style={({ pressed }) => [
                        styles.switchAccountButton,
                        {
                            borderColor: colors.border,
                            backgroundColor: pressed ? colors.surface : 'transparent',
                            opacity: interactionDisabled ? 0.6 : 1,
                        },
                    ]}
                >
                    <MaterialCommunityIcons
                        name="account-switch-outline"
                        size={16}
                        color={colors.textSecondary}
                    />
                    <Text style={[styles.switchAccountText, { color: colors.textSecondary }]}>
                        {isSwitchingAccount ? 'Switching...' : 'Switch account'}
                    </Text>
                </Pressable>

                <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                    Parcel Safe
                </Text>
            </View>

            {isBusy && (
                <View
                    style={[
                        styles.progressOverlay,
                        {
                            backgroundColor: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.70)',
                        },
                    ]}
                    pointerEvents="auto"
                >
                    <View
                        style={[
                            styles.progressCard,
                            { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                    >
                        <View style={styles.progressHeader}>
                            <ActivityIndicator size="small" color={colors.text} />
                            <Text style={[styles.progressLabel, { color: colors.text }]}>{loadingLabel}</Text>
                        </View>

                        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                            <Animated.View
                                style={[
                                    styles.progressFill,
                                    { width: progressWidth, backgroundColor: colors.accent },
                                ]}
                            />
                        </View>
                    </View>
                </View>
            )}

            <Modal
                visible={showDashboardPinModal}
                transparent
                animationType="slide"
                onRequestClose={() => {
                    if (!pinSubmitting) {
                        setShowDashboardPinModal(false);
                        setPinTargetApp(null);
                    }
                }}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}> 
                            <View style={styles.modalTitleRow}>
                                <MaterialCommunityIcons name="shield-lock-outline" size={18} color={colors.text} />
                                <Text style={[styles.modalTitle, { color: colors.text }]}>Authorize Dashboard</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    if (!pinSubmitting) {
                                        setShowDashboardPinModal(false);
                                        setPinTargetApp(null);
                                    }
                                }}
                                disabled={pinSubmitting}
                                hitSlop={12}
                            >
                                <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.modalBody}>
                            <Text style={[styles.modalDescription, { color: colors.textSecondary }]}> 
                                {pinFallbackMessage || 'Use your Rider PIN to continue to this dashboard.'}
                            </Text>

                            {lockoutSeconds > 0 && (
                                <View style={[styles.lockoutPill, { backgroundColor: colors.background, borderColor: colors.border }]}> 
                                    <MaterialCommunityIcons name="timer-sand" size={14} color={colors.textSecondary} />
                                    <Text style={[styles.lockoutPillText, { color: colors.textSecondary }]}>Try again in {lockoutSeconds}s</Text>
                                </View>
                            )}

                            <TextInput
                                mode="outlined"
                                label="Rider PIN"
                                value={dashboardPin}
                                onChangeText={(value) => setDashboardPin(sanitizePinInput(value))}
                                keyboardType="number-pad"
                                secureTextEntry={!showDashboardPin}
                                maxLength={6}
                                right={
                                    <TextInput.Icon
                                        icon={showDashboardPin ? 'eye-off' : 'eye'}
                                        onPress={() => setShowDashboardPin((prev) => !prev)}
                                        forceTextInputFocus={false}
                                    />
                                }
                            />
                        </View>

                        <View style={[styles.modalFooter, { borderTopColor: colors.border }]}> 
                            {canSetDashboardPin && (
                                <TouchableOpacity
                                    activeOpacity={0.7}
                                    onPress={() => {
                                        if (!pinSubmitting) {
                                            openSetPinModal(pinTargetApp, pinFallbackMessage || undefined);
                                        }
                                    }}
                                    disabled={pinSubmitting}
                                    style={[styles.modalAction, { backgroundColor: colors.background, borderColor: colors.border, opacity: pinSubmitting ? 0.6 : 1 }]}
                                >
                                    <Text style={[styles.modalActionText, { color: colors.text }]}>Set PIN</Text>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={handleSubmitDashboardPin}
                                disabled={pinSubmitting || lockoutSeconds > 0 || dashboardPin.length !== 6}
                                style={[
                                    styles.modalAction,
                                    styles.modalActionPrimary,
                                    {
                                        backgroundColor: colors.accent,
                                        opacity: (pinSubmitting || lockoutSeconds > 0 || dashboardPin.length !== 6) ? 0.35 : 1,
                                    },
                                ]}
                            >
                                {pinSubmitting && <ActivityIndicator size={14} color={colors.background} />}
                                <Text style={[styles.modalActionPrimaryText, { color: colors.background }]}>Continue</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showSetPinModal}
                transparent
                animationType="slide"
                onRequestClose={() => {
                    if (!saveDashboardPinSubmitting) {
                        setShowSetPinModal(false);
                        setPinTargetApp(null);
                    }
                }}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}> 
                            <View style={styles.modalTitleRow}>
                                <MaterialCommunityIcons name="shield-key-outline" size={18} color={colors.text} />
                                <Text style={[styles.modalTitle, { color: colors.text }]}>Set Rider PIN</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    if (!saveDashboardPinSubmitting) {
                                        setShowSetPinModal(false);
                                        setPinTargetApp(null);
                                    }
                                }}
                                disabled={saveDashboardPinSubmitting}
                                hitSlop={12}
                            >
                                <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.modalBody}>
                            <Text style={[styles.modalDescription, { color: colors.textSecondary }]}> 
                                This 6-digit Rider PIN is used as your fallback dashboard authorization.
                            </Text>
                            <TextInput
                                mode="outlined"
                                label="New Rider PIN"
                                value={newDashboardPin}
                                onChangeText={(value) => setNewDashboardPin(sanitizePinInput(value))}
                                keyboardType="number-pad"
                                secureTextEntry={!showNewDashboardPin}
                                maxLength={6}
                                right={
                                    <TextInput.Icon
                                        icon={showNewDashboardPin ? 'eye-off' : 'eye'}
                                        onPress={() => setShowNewDashboardPin((prev) => !prev)}
                                        forceTextInputFocus={false}
                                    />
                                }
                                style={styles.modalInputSpacing}
                            />
                            <TextInput
                                mode="outlined"
                                label="Confirm Rider PIN"
                                value={confirmDashboardPin}
                                onChangeText={(value) => setConfirmDashboardPin(sanitizePinInput(value))}
                                keyboardType="number-pad"
                                secureTextEntry={!showConfirmDashboardPin}
                                maxLength={6}
                                right={
                                    <TextInput.Icon
                                        icon={showConfirmDashboardPin ? 'eye-off' : 'eye'}
                                        onPress={() => setShowConfirmDashboardPin((prev) => !prev)}
                                        forceTextInputFocus={false}
                                    />
                                }
                            />
                        </View>

                        <View style={[styles.modalFooter, { borderTopColor: colors.border }]}> 
                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={() => {
                                    if (!saveDashboardPinSubmitting) {
                                        setShowSetPinModal(false);
                                        setPinTargetApp(null);
                                    }
                                }}
                                disabled={saveDashboardPinSubmitting}
                                style={[styles.modalAction, { backgroundColor: colors.background, borderColor: colors.border, opacity: saveDashboardPinSubmitting ? 0.6 : 1 }]}
                            >
                                <Text style={[styles.modalActionText, { color: colors.text }]}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={handleSaveDashboardPin}
                                disabled={saveDashboardPinSubmitting || newDashboardPin.length !== 6 || confirmDashboardPin.length !== 6}
                                style={[
                                    styles.modalAction,
                                    styles.modalActionPrimary,
                                    {
                                        backgroundColor: colors.accent,
                                        opacity: (saveDashboardPinSubmitting || newDashboardPin.length !== 6 || confirmDashboardPin.length !== 6) ? 0.35 : 1,
                                    },
                                ]}
                            >
                                {saveDashboardPinSubmitting && <ActivityIndicator size={14} color={colors.background} />}
                                <Text style={[styles.modalActionPrimaryText, { color: colors.background }]}>Save PIN</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

interface DashboardCardProps {
    id: string;
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    colors: typeof COLORS.light;
    onPress: () => void;
    disabled?: boolean;
}

const DashboardCard = ({ title, subtitle, icon, colors, onPress, disabled = false }: DashboardCardProps) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        if (disabled) return;
        Animated.spring(scaleAnim, {
            toValue: 0.98,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const handlePressOut = () => {
        if (disabled) return;
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    return (
        <Pressable
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={disabled}
        >
            <Animated.View
                style={[
                    styles.card,
                    {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        opacity: disabled ? 0.55 : 1,
                        transform: [{ scale: scaleAnim }]
                    }
                ]}
            >
                <View style={styles.cardContent}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.background }]}>
                        <MaterialCommunityIcons
                            name={icon}
                            size={26}
                            color={colors.text}
                        />
                    </View>

                    <View style={styles.cardText}>
                        <Text style={[styles.cardTitle, { color: colors.text }]}>
                            {title}
                        </Text>
                        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                            {subtitle}
                        </Text>
                    </View>
                </View>

                <MaterialCommunityIcons
                    name="chevron-right"
                    size={24}
                    color={colors.textSecondary}
                />
            </Animated.View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 24,
        paddingTop: 40,
        paddingBottom: 32,
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    rightWidget: {
        alignItems: 'flex-end',
        justifyContent: 'flex-start',
        paddingTop: 4,
    },
    timeText: {
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.5,
    },
    dateText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        marginTop: 2,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        gap: 2,
    },
    locationText: {
        fontSize: 10,
        fontFamily: 'Inter_500Medium',
    },
    weatherRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        gap: 4,
    },
    weatherText: {
        fontSize: 11,
        fontFamily: 'Inter_500Medium',
    },
    avatarContainer: {
        marginBottom: 24,
    },
    avatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
    },
    avatarPlaceholder: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    greeting: {
        fontSize: 16,
        fontFamily: 'Inter_400Regular',
        letterSpacing: 0.2,
    },
    name: {
        fontSize: 34,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -1,
        marginTop: 4,
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
    },
    sectionTitle: {
        fontSize: 12,
        fontFamily: 'JetBrainsMono_700Bold',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 16,
    },
    optionsContainer: {
        gap: 12,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    cardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconContainer: {
        width: 52,
        height: 52,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    cardText: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 18,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: -0.2,
    },
    cardSubtitle: {
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        marginTop: 2,
    },
    footer: {
        paddingVertical: 24,
        alignItems: 'center',
    },
    setPinButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 8,
    },
    setPinText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    switchAccountButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 12,
    },
    switchAccountText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    progressOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    progressCard: {
        width: '100%',
        maxWidth: 360,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    progressHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
    },
    progressLabel: {
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    progressTrack: {
        height: 4,
        width: '100%',
        borderRadius: 999,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 999,
    },
    footerText: {
        fontSize: 12,
        fontFamily: 'JetBrainsMono_500Medium',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    modalOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    modalCard: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderWidth: 1,
    },
    modalHeader: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    modalTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    modalTitle: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    modalBody: {
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    modalDescription: {
        fontSize: 13,
        lineHeight: 18,
        fontFamily: 'Inter_400Regular',
        marginBottom: 14,
    },
    modalInputSpacing: {
        marginBottom: 12,
    },
    lockoutPill: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginBottom: 12,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    lockoutPillText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    modalFooter: {
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 24,
        borderTopWidth: 1,
        flexDirection: 'row',
        gap: 10,
    },
    modalAction: {
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    modalActionPrimary: {
        borderWidth: 0,
    },
    modalActionText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    modalActionPrimaryText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
});
