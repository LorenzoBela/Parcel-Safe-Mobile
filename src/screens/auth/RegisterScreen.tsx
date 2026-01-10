import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function RegisterScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [secureTextEntry, setSecureTextEntry] = useState(true);
    const [confirmSecureTextEntry, setConfirmSecureTextEntry] = useState(true);
    const [loading, setLoading] = useState(false);

    const handleRegister = () => {
        if (!name || !email || !password || !confirmPassword) {
            alert('Please fill in all fields.');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match.');
            return;
        }

        setLoading(true);

        // Simulate network delay
        setTimeout(() => {
            console.log('Registered:', { name, email });
            setLoading(false);
            alert('Account created successfully! Please login.');
            navigation.navigate('Login');
        }, 1000);
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <ScrollView contentContainerStyle={styles.contentContainer}>
                {/* Logo Section */}
                <View style={styles.logoContainer}>
                    <MaterialCommunityIcons name="account-plus" size={80} color={theme.colors.primary} />
                    <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>
                        Join Parcel-Safe
                    </Text>
                    <Text variant="bodyMedium" style={styles.subtitle}>
                        Create your account
                    </Text>
                </View>

                {/* Input Section */}
                <View style={styles.inputContainer}>
                    <TextInput
                        label="Full Name"
                        value={name}
                        onChangeText={setName}
                        mode="outlined"
                        left={<TextInput.Icon icon="account" />}
                        style={styles.input}
                    />

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

                    <TextInput
                        label="Confirm Password"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        mode="outlined"
                        left={<TextInput.Icon icon="lock-check" />}
                        right={<TextInput.Icon icon={confirmSecureTextEntry ? "eye" : "eye-off"} onPress={() => setConfirmSecureTextEntry(!confirmSecureTextEntry)} />}
                        secureTextEntry={confirmSecureTextEntry}
                        style={styles.input}
                    />
                </View>

                {/* Button Section */}
                <Button
                    mode="contained"
                    onPress={handleRegister}
                    loading={loading}
                    style={styles.button}
                    contentStyle={styles.buttonContent}
                >
                    Register
                </Button>

                <View style={styles.loginContainer}>
                    <Text variant="bodyMedium">Already have an account? </Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                        <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                            Login
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    contentContainer: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 24,
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: 30,
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
    button: {
        borderRadius: 8,
        marginTop: 10,
    },
    buttonContent: {
        paddingVertical: 6,
    },
    loginContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
        marginBottom: 20,
    },
});
