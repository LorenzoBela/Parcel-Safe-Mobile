import React, { useState, useRef } from 'react';
import { signInWithGoogleAndSyncProfile, isGoogleSignInAvailable } from '../../services/auth';
import {
    View,
    StyleSheet,
    Pressable,
    Animated,
    useColorScheme,
    StatusBar,
    ActivityIndicator,
    Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PremiumAlert } from '../../services/PremiumAlertService';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';

// Uber-inspired minimalist colors (matching RoleSelectionScreen)
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

export default function LoginScreen() {
    const navigation = useNavigation<any>();
    const colorScheme = useColorScheme();
    const login = useAuthStore((state: any) => state.login);
    const googleSignInAvailable = isGoogleSignInAvailable();

    const [loading, setLoading] = useState(false);

    const isDark = colorScheme === 'dark';
    const colors = isDark ? COLORS.dark : COLORS.light;

    const branding = useEntryAnimation(0);
    const welcome = useEntryAnimation(80);
    const bottom = useEntryAnimation(160);

    const handleGoogleSignIn = async () => {
        try {
            setLoading(true);
            // console.log('Initiating Google Sign-In...');
            const result = await signInWithGoogleAndSyncProfile();
            // console.log('Sign-in successful:', result.email, result.role);

            login(result);

            const role = result.role;
            if (role === 'customer') {
                navigation.replace('CustomerApp');
            } else {
                // Riders and Admins go to Role Selection
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

            PremiumAlert.alert(
                'Authentication Error',
                errorMessage,
                [
                    { text: 'OK', style: 'default' }
                ]
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            {/* Main Content */}
            <View style={styles.content}>
                {/* Branding Section */}
                <Animated.View style={[styles.brandingSection, branding.style]}>
                    <View style={[styles.logoContainer, { backgroundColor: colors.surface }]}>
                        <MaterialCommunityIcons
                            name="package-variant-closed"
                            size={40}
                            color={colors.text}
                        />
                    </View>

                    <Text style={[styles.appName, { color: colors.text }]}>
                        Parcel Safe
                    </Text>

                    <Text style={[styles.tagline, { color: colors.textSecondary }]}>
                        Secure delivery management
                    </Text>
                </Animated.View>

                {/* Welcome Section */}
                <Animated.View style={[styles.welcomeSection, welcome.style]}>
                    <Text style={[styles.welcomeTitle, { color: colors.text }]}>
                        Get started
                    </Text>
                    <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>
                        Sign in to track, manage, and secure your deliveries
                    </Text>
                </Animated.View>
            </View>

            {/* Bottom Section */}
            <Animated.View style={[styles.bottomSection, bottom.style]}>
                {/* Google Sign-In Button */}
                <GoogleSignInButton
                    onPress={handleGoogleSignIn}
                    loading={loading}
                    disabled={!googleSignInAvailable || loading}
                    colors={colors}
                />

                {!googleSignInAvailable && (
                    <Text style={[styles.warningText, { color: colors.textSecondary }]}>
                        Google Sign-In requires a development build
                    </Text>
                )}

                {/* Terms */}
                <Text style={[styles.termsText, { color: colors.textSecondary }]}>
                    By continuing, you agree to our Terms of Service and Privacy Policy
                </Text>
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
        Animated.spring(scaleAnim, {
            toValue: 0.98,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const handlePressOut = () => {
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
                    styles.googleButton,
                    {
                        backgroundColor: colors.text,
                        opacity: disabled ? 0.5 : 1,
                        transform: [{ scale: scaleAnim }]
                    }
                ]}
            >
                {loading ? (
                    <ActivityIndicator size="small" color={colors.background} />
                ) : (
                    <>
                        <View style={[styles.googleIconContainer, { backgroundColor: colors.background }]}>
                            <MaterialCommunityIcons
                                name="google"
                                size={20}
                                color={colors.text}
                            />
                        </View>
                        <Text style={[styles.googleButtonText, { color: colors.background }]}>
                            Continue with Google
                        </Text>
                    </>
                )}
            </Animated.View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    brandingSection: {
        alignItems: 'center',
        marginBottom: 48,
    },
    logoContainer: {
        width: 80,
        height: 80,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    appName: {
        fontSize: 28,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    tagline: {
        fontSize: 15,
        fontWeight: '400',
        marginTop: 6,
        letterSpacing: 0.2,
    },
    welcomeSection: {
        alignItems: 'center',
    },
    welcomeTitle: {
        fontSize: 24,
        fontWeight: '600',
        letterSpacing: -0.3,
    },
    welcomeSubtitle: {
        fontSize: 15,
        fontWeight: '400',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 22,
        paddingHorizontal: 20,
    },
    bottomSection: {
        paddingHorizontal: 24,
        paddingBottom: 40,
    },
    googleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 14,
        minHeight: 56,
    },
    googleIconContainer: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    googleButtonText: {
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    warningText: {
        fontSize: 13,
        textAlign: 'center',
        marginTop: 12,
    },
    termsText: {
        fontSize: 12,
        textAlign: 'center',
        marginTop: 24,
        lineHeight: 18,
        paddingHorizontal: 20,
    },
});
