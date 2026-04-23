import React, { useState, useRef, useEffect } from 'react';
import { signInWithGoogleAndSyncProfile, isGoogleSignInAvailable } from '../../services/auth';
import {
    View,
    StyleSheet,
    Pressable,
    Animated,
    useColorScheme,
    StatusBar,
    ActivityIndicator,
    Linking,
    Platform,
    Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PremiumAlert } from '../../services/PremiumAlertService';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Last Account Persistence ─────────────────────────────────────────────────
const LAST_ACCOUNT_KEY = 'parcel-safe:last-logged-account';

interface LastAccount {
    name: string;
    email: string;
    photo?: string;
}

const getLastAccount = async (): Promise<LastAccount | null> => {
    try {
        const raw = await AsyncStorage.getItem(LAST_ACCOUNT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const saveLastAccount = async (account: LastAccount): Promise<void> => {
    try {
        await AsyncStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account));
    } catch (e) {
        console.warn('Failed to persist last account:', e);
    }
};

const COLORS = {
    light: {
        background: '#FAFAFA',
        surface: '#FFFFFF',
        text: '#09090B',
        textSecondary: '#52525B',
        textTertiary: '#A1A1AA',
        border: '#E4E4E7',
        accent: '#09090B',
    },
    dark: {
        background: '#000000',
        surface: '#09090B',
        text: '#FFFFFF',
        textSecondary: '#A1A1AA',
        textTertiary: '#52525B',
        border: '#27272A',
        accent: '#FFFFFF',
    }
};

export default function LoginScreen() {
    const navigation = useNavigation<any>();
    const colorScheme = useColorScheme();
    const login = useAuthStore((state: any) => state.login);
    const googleSignInAvailable = isGoogleSignInAvailable();

    const [loading, setLoading] = useState(false);
    const [lastAccount, setLastAccount] = useState<LastAccount | null>(null);

    const isDark = colorScheme === 'dark';
    const colors = isDark ? COLORS.dark : COLORS.light;

    // Load last logged-in account from storage on mount
    useEffect(() => {
        getLastAccount().then(setLastAccount);
    }, []);

    const branding = useEntryAnimation(0);
    const welcome = useEntryAnimation(150);
    const accountCard = useEntryAnimation(250);
    const bottom = useEntryAnimation(lastAccount ? 400 : 300);

    const handleGoogleSignIn = async (options?: { silent?: boolean }) => {
        try {
            setLoading(true);

            // --- PERMISSIONS CHECK: Foreground Location ---
            let { status: fgStatus } = await Location.getForegroundPermissionsAsync();
            if (fgStatus !== 'granted') {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                    setLoading(false);
                    PremiumAlert.alert('Location Required', 'Parcel Safe needs your location to match you with nearby orders and track deliveries.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Open Settings', onPress: () => Linking.openSettings() }
                    ]);
                    return;
                }
            }

            // --- PERMISSIONS CHECK: Background Location ---
            let { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
            if (bgStatus !== 'granted') {
                const { status } = await Location.requestBackgroundPermissionsAsync();
                if (status !== 'granted') {
                    setLoading(false);
                    PremiumAlert.alert('Background Location Required', 'To ensure customer security, Parcel Safe must track your location even when the app is minimized during a delivery. Please select "Allow all the time".', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Open Settings', onPress: () => Linking.openSettings() }
                    ]);
                    return;
                }
            }

            // --- PERMISSIONS CHECK: Notifications ---
            let { status: notifStatus } = await Notifications.getPermissionsAsync();
            if (notifStatus !== 'granted') {
                const { status } = await Notifications.requestPermissionsAsync();
                if (status !== 'granted') {
                    setLoading(false);
                    PremiumAlert.alert('Notifications Required', 'Parcel Safe needs to send you critical alerts for new orders, customer messages, and security incidents.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Open Settings', onPress: () => Linking.openSettings() }
                    ]);
                    return;
                }
            }

            const result = await signInWithGoogleAndSyncProfile({ silent: options?.silent });

            // Persist the last account for next login screen visit
            if (result.name || result.email) {
                await saveLastAccount({
                    name: result.fullName || result.name || '',
                    email: result.email || '',
                    photo: result.photo,
                });
            }

            login(result);

            const role = result.role;
            if (role === 'customer') {
                navigation.replace('CustomerApp');
            } else {
                navigation.replace('RoleSelection');
            }
        } catch (error: any) {
            console.error('Login failed:', error);
            let errorMessage = 'Login failed. Please try again.';
            if (error?.message?.includes('Network request failed') ||
                error?.message?.includes('timeout') ||
                error?.code === 'NETWORK_ERROR') {
                errorMessage = 'Network connection failed. Please check your internet connection and try again.';
            } else if (error?.message?.includes('cancelled')) {
                errorMessage = 'Sign-in was cancelled.';
            } else if (error?.message) {
                errorMessage = `Login failed: ${error.message}`;
            }

            PremiumAlert.alert('Authentication Error', errorMessage, [{ text: 'OK', style: 'default' }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.content}>
                {/* Branding Section */}
                <Animated.View style={[styles.brandingSection, branding.style]}>
                    <View style={[styles.logoContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                        <MaterialCommunityIcons name="package-variant-closed" size={36} color={colors.text} />
                    </View>
                    <Text style={[styles.appName, { color: colors.text }]}>PARCEL SAFE</Text>
                    <View style={[styles.divider, { backgroundColor: colors.text }]} />
                    <Text style={[styles.tagline, { color: colors.textSecondary }]}>
                        SECURE DELIVERY PROTOCOL
                    </Text>
                </Animated.View>

                {/* Welcome Section */}
                <Animated.View style={[styles.welcomeSection, welcome.style]}>
                    <Text style={[styles.welcomeTitle, { color: colors.text }]}>
                        {lastAccount ? 'Welcome Back' : 'Authentication'}
                    </Text>
                    <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>
                        {lastAccount
                            ? 'Tap below to resume your secure session.'
                            : 'Initialize secure session to track, manage, and verify logistics.'}
                    </Text>
                </Animated.View>

                {/* Last Account Card — tappable for quick re-auth */}
                {lastAccount && (
                    <Pressable
                        onPress={() => handleGoogleSignIn({ silent: true })}
                        disabled={!googleSignInAvailable || loading}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                    >
                        <Animated.View style={[styles.lastAccountCard, accountCard.style, {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                        }]}>
                            <LastAccountAvatar
                                name={lastAccount.name}
                                photo={lastAccount.photo}
                                colors={colors}
                            />
                            <View style={styles.lastAccountInfo}>
                                <Text style={[styles.lastAccountName, { color: colors.text }]} numberOfLines={1}>
                                    {lastAccount.name}
                                </Text>
                                <Text style={[styles.lastAccountEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                                    {lastAccount.email}
                                </Text>
                            </View>
                            <View style={[styles.lastAccountBadge, { backgroundColor: isDark ? '#1A1A1A' : '#F4F4F5' }]}>
                                <MaterialCommunityIcons
                                    name={loading ? 'loading' : 'chevron-right'}
                                    size={16}
                                    color={colors.textSecondary}
                                />
                            </View>
                        </Animated.View>
                    </Pressable>
                )}
            </View>

            {/* Bottom Section */}
            <Animated.View style={[styles.bottomSection, bottom.style]}>
                <GoogleSignInButton
                    onPress={handleGoogleSignIn}
                    loading={loading}
                    disabled={!googleSignInAvailable || loading}
                    colors={colors}
                />

                {!googleSignInAvailable && (
                    <Text style={[styles.warningText, { color: colors.textTertiary }]}>
                        Google Sign-In requires a development build
                    </Text>
                )}

                {/* Terms */}
                <View style={styles.termsContainer}>
                    <Text style={[styles.termsText, { color: colors.textSecondary }]}>
                        By authenticating, you agree to the{' '}
                    </Text>
                    <View style={styles.termsLinkContainer}>
                        <Text 
                            style={[styles.termsLink, { color: colors.text }]} 
                            onPress={() => navigation.navigate('TermsOfService')}
                        >
                            Terms of Service
                        </Text>
                        <Text style={[styles.termsText, { color: colors.textSecondary }]}> & </Text>
                        <Text 
                            style={[styles.termsLink, { color: colors.text }]} 
                            onPress={() => navigation.navigate('PrivacyPolicy')}
                        >
                            Privacy Policy
                        </Text>
                    </View>
                </View>
            </Animated.View>
        </SafeAreaView>
    );
}

interface GoogleSignInButtonProps {
    onPress: () => void;
    loading: boolean;
    disabled: boolean;
    colors: typeof COLORS.light;
}

const GoogleSignInButton = ({ onPress, loading, disabled, colors }: GoogleSignInButtonProps) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        if (disabled) return;
        Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
    };

    const handlePressOut = () => {
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
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
                    styles.googleButton,
                    {
                        backgroundColor: colors.text,
                        borderColor: colors.border,
                        borderWidth: 1,
                        opacity: disabled ? 0.6 : 1,
                        transform: [{ scale: scaleAnim }],
                        shadowColor: colors.text,
                        shadowOffset: { width: 0, height: 8 },
                        shadowOpacity: 0.15,
                        shadowRadius: 16,
                        elevation: 4,
                    }
                ]}
            >
                {loading ? (
                    <ActivityIndicator size="small" color={colors.background} />
                ) : (
                    <>
                        <View style={[styles.googleIconContainer, { backgroundColor: colors.background }]}>
                            <MaterialCommunityIcons name="google" size={18} color={colors.text} />
                        </View>
                        <Text style={[styles.googleButtonText, { color: colors.background }]}>
                            Authenticate with Google
                        </Text>
                    </>
                )}
            </Animated.View>
        </Pressable>
    );
};

// ─── Last Account Avatar ──────────────────────────────────────────────────────
// Shows profile photo with graceful fallback to monogram initials.
interface LastAccountAvatarProps {
    name: string;
    photo?: string;
    colors: typeof COLORS.light;
}

const LastAccountAvatar = ({ name, photo, colors }: LastAccountAvatarProps) => {
    const [imageError, setImageError] = useState(false);

    const initials = name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('');

    if (photo && !imageError) {
        return (
            <Image
                source={{ uri: photo }}
                style={styles.lastAccountAvatar}
                onError={() => setImageError(true)}
            />
        );
    }

    return (
        <View style={[styles.lastAccountAvatar, styles.lastAccountAvatarFallback, {
            backgroundColor: colors.accent,
        }]}>
            <Text style={[styles.lastAccountInitials, { color: colors.background }]}>
                {initials || '?'}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    brandingSection: {
        alignItems: 'center',
        marginBottom: 64,
    },
    logoContainer: {
        width: 72,
        height: 72,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    appName: {
        fontSize: 32,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -1.5,
        textTransform: 'uppercase',
    },
    divider: {
        width: 40,
        height: 2,
        marginTop: 16,
        marginBottom: 16,
    },
    tagline: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    welcomeSection: { alignItems: 'center' },
    welcomeTitle: {
        fontSize: 24,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: -0.5,
        marginBottom: 12,
    },
    welcomeSubtitle: {
        fontSize: 15,
        fontFamily: 'Inter_400Regular',
        textAlign: 'center',
        lineHeight: 24,
        paddingHorizontal: 16,
    },
    // ─── Last Account Card ────────────────────────────────────────────
    lastAccountCard: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 32,
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderRadius: 16,
        borderWidth: 1,
        alignSelf: 'center',
        width: '100%',
    },
    lastAccountAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
    },
    lastAccountAvatarFallback: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    lastAccountInitials: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.5,
    },
    lastAccountInfo: {
        flex: 1,
        marginLeft: 16,
        marginRight: 12,
    },
    lastAccountName: {
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: -0.3,
        marginBottom: 2,
    },
    lastAccountEmail: {
        fontSize: 12,
        fontFamily: 'Inter_400Regular',
        letterSpacing: 0,
    },
    lastAccountBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomSection: {
        paddingHorizontal: 32,
        paddingBottom: 48,
    },
    googleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
        minHeight: 60,
    },
    googleIconContainer: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    googleButtonText: {
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 0,
    },
    warningText: {
        fontSize: 12,
        textAlign: 'center',
        marginTop: 16,
        fontFamily: 'Inter_400Regular',
    },
    termsContainer: {
        marginTop: 32,
        alignItems: 'center',
    },
    termsLinkContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 4,
    },
    termsText: {
        fontSize: 12,
        fontFamily: 'Inter_400Regular',
        lineHeight: 18,
    },
    termsLink: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
        textDecorationLine: 'underline',
        lineHeight: 18,
    },
});
