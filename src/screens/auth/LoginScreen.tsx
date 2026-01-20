import React, { useState } from 'react';
import { signInWithGoogleAndSyncProfile, isGoogleSignInAvailable } from '../../services/auth';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function LoginScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const login = useAuthStore((state: any) => state.login);
    const googleSignInAvailable = isGoogleSignInAvailable();

    const [loading, setLoading] = useState(false);

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.container, { backgroundColor: theme.colors.background }]}
        >
            <View style={styles.contentContainer}>
                {/* Logo Section */}
                <View style={styles.logoContainer}>
                    <MaterialCommunityIcons name="package-variant-closed" size={80} color={theme.colors.primary} />
                    <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>
                        Parcel-Safe
                    </Text>
                    <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
                        Secure Delivery Management
                    </Text>
                </View>

                {/* Google Sign-In */}
                <Button
                    mode="outlined"
                    onPress={async () => {
                        try {
                            setLoading(true);
                            console.log('Initiating Google Sign-In...');
                            const result = await signInWithGoogleAndSyncProfile();
                            console.log('Sign-in successful:', result.email, result.role);

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
                            alert(`Login failed: ${error.message}`);
                        } finally {
                            setLoading(false);
                        }
                    }}
                    loading={loading}
                    disabled={!googleSignInAvailable}
                    style={[styles.button, { marginTop: 10, borderColor: theme.colors.primary }]}
                    contentStyle={styles.buttonContent}
                    icon="google"
                >
                    Sign in with Google
                </Button>

                {!googleSignInAvailable && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6, textAlign: 'center' }}>
                        Google Sign-In is not available in this runtime. Use a dev client or native build.
                    </Text>

                )}

                {/* Dev Login Fallback */}
                {(!googleSignInAvailable || __DEV__) && (
                    <Button
                        mode="text"
                        onPress={() => navigation.navigate('DevRoleSelection')}
                        style={{ marginTop: 20 }}
                        textColor={theme.colors.secondary}
                    >
                        Dev Login
                    </Button>
                )}
            </View>
        </KeyboardAvoidingView >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    contentContainer: {
        flex: 1,
        justifyContent: 'center',
        padding: 24,
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: 40,
    },
    title: {
        fontWeight: 'bold',
        marginTop: 10,
    },
    subtitle: {
        color: '#666',
        marginTop: 5,
    },
    button: {
        borderRadius: 8,
        marginTop: 10,
    },
    buttonContent: {
        paddingVertical: 6,
    },
});
