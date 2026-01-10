import React, { useState } from 'react';
import { signInWithGoogle } from '../../services/auth';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Image, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function LoginScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const login = useAuthStore((state: any) => state.login);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [secureTextEntry, setSecureTextEntry] = useState(true);
    const [loading, setLoading] = useState(false);

    const handleLogin = () => {
        if (!email || !password) {
            alert('Please enter both email and password.');
            return;
        }

        setLoading(true);

        // Simulate network delay
        setTimeout(() => {
            let role = 'customer';
            if (email.toLowerCase().includes('admin')) {
                role = 'admin';
            } else if (email.toLowerCase().includes('rider')) {
                role = 'rider';
            }

            const userData = { email, role };
            login(userData);
            setLoading(false);

            if (role === 'customer') {
                navigation.replace('CustomerApp');
            } else if (role === 'rider') {
                navigation.replace('RiderApp');
            } else if (role === 'admin') {
                navigation.replace('AdminApp');
            }
        }, 1000);
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.contentContainer}>
                {/* Logo Section */}
                <View style={styles.logoContainer}>
                    <MaterialCommunityIcons name="package-variant-closed" size={80} color={theme.colors.primary} />
                    <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>
                        Parcel-Safe
                    </Text>
                    <Text variant="bodyMedium" style={styles.subtitle}>
                        Secure Delivery Management
                    </Text>
                </View>

                {/* Input Section */}
                <View style={styles.inputContainer}>
                    <TextInput
                        label="Email Address"
                        value={email}
                        onChangeText={setEmail}
                        mode="outlined"
                        left={<TextInput.Icon icon="email" />}
                        style={styles.input}
                        autoCapitalize="none"
                        keyboardType="email-address"
                    />

                    <TextInput
                        label="Password"
                        value={password}
                        onChangeText={setPassword}
                        mode="outlined"
                        left={<TextInput.Icon icon="lock" />}
                        right={<TextInput.Icon icon={secureTextEntry ? "eye" : "eye-off"} onPress={() => setSecureTextEntry(!secureTextEntry)} />}
                        secureTextEntry={secureTextEntry}
                        style={styles.input}
                    />

                    <TouchableOpacity onPress={() => console.log('Forgot Password')} style={styles.forgotPassword}>
                        <Text variant="bodySmall" style={{ color: theme.colors.primary }}>
                            Forgot Password?
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Button Section */}
                <Button
                    mode="contained"
                    onPress={handleLogin}
                    loading={loading}
                    style={styles.button}
                    contentStyle={styles.buttonContent}
                >
                    Login
                </Button>

                <Button
                    mode="outlined"
                    onPress={async () => {
                        try {
                            setLoading(true);
                            await signInWithGoogle();
                            // In a real app, you would verify the token with your backend here
                            // For now, we'll assume it's a customer or rider based on some logic, or default to customer
                            login({ email: 'google-user@example.com', role: 'customer' });
                            setLoading(false);
                            navigation.replace('CustomerApp');
                        } catch (error) {
                            setLoading(false);
                            console.error(error);
                            alert('Google Sign-In failed');
                        }
                    }}
                    loading={loading}
                    style={[styles.button, { marginTop: 10, borderColor: theme.colors.primary }]}
                    contentStyle={styles.buttonContent}
                    icon="google"
                >
                    Sign in with Google
                </Button>

                <View style={styles.registerContainer}>
                    <Text variant="bodyMedium">Don't have an account? </Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                        <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                            Sign Up
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
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
    inputContainer: {
        marginBottom: 20,
    },
    input: {
        marginBottom: 16,
        backgroundColor: '#fff',
    },
    forgotPassword: {
        alignSelf: 'flex-end',
    },
    button: {
        borderRadius: 8,
        marginTop: 10,
    },
    buttonContent: {
        paddingVertical: 6,
    },
    registerContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
});
