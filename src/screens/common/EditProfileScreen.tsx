import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, useTheme, Surface, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';

export default function EditProfileScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form Fields
    const [fullName, setFullName] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [homeAddress, setHomeAddress] = useState('');

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) throw new Error('No user logged in');

            const { data, error } = await supabase!
                .from('profiles')
                .select('full_name, phone_number, home_address')
                .eq('id', user.id)
                .single();

            if (error) throw error;

            if (data) {
                setFullName(data.full_name || '');
                setPhoneNumber(data.phone_number || '');
                setHomeAddress(data.home_address || '');
            }
        } catch (error: any) {
            console.error('Error fetching profile:', error);
            Alert.alert('Error', 'Failed to load profile data.');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) throw new Error('No user logged in');

            const updates = {
                id: user.id,
                full_name: fullName,
                phone_number: phoneNumber,
                home_address: homeAddress,
                updated_at: new Date().toISOString(),
            };

            const { error } = await supabase!
                .from('profiles')
                .upsert(updates);

            if (error) throw error;

            Alert.alert('Success', 'Profile updated successfully!');
            navigation.goBack();

        } catch (error: any) {
            console.error('Error updating profile:', error);
            Alert.alert('Error', error.message || 'Failed to update profile.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.header}>
                    <Text variant="headlineMedium" style={{ color: theme.colors.onBackground, fontWeight: 'bold' }}>
                        Edit Profile
                    </Text>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                        Keep your details up to date for smooth deliveries.
                    </Text>
                </View>

                <Surface style={[styles.formContainer, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <TextInput
                        label="Full Name"
                        value={fullName}
                        onChangeText={setFullName}
                        mode="outlined"
                        style={styles.input}
                        disabled={loading}
                        left={<TextInput.Icon icon="account" />}
                    />

                    <TextInput
                        label="Phone Number"
                        value={phoneNumber}
                        onChangeText={setPhoneNumber}
                        mode="outlined"
                        keyboardType="phone-pad"
                        style={styles.input}
                        disabled={loading}
                        left={<TextInput.Icon icon="phone" />}
                        placeholder="+63 9xx xxx xxxx"
                    />

                    <TextInput
                        label="Home Address"
                        value={homeAddress}
                        onChangeText={setHomeAddress}
                        mode="outlined"
                        style={[styles.input, styles.textArea]}
                        disabled={loading}
                        multiline
                        numberOfLines={3}
                        left={<TextInput.Icon icon="map-marker" />}
                    />
                </Surface>

                <View style={styles.actionContainer}>
                    <Button
                        mode="contained"
                        onPress={handleSave}
                        loading={saving}
                        disabled={loading || saving}
                        style={styles.saveButton}
                        contentStyle={{ paddingVertical: 8 }}
                    >
                        Save Changes
                    </Button>

                    <Button
                        mode="outlined"
                        onPress={() => navigation.goBack()}
                        disabled={saving}
                        style={styles.cancelButton}
                    >
                        Cancel
                    </Button>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 20,
        flexGrow: 1,
    },
    header: {
        marginBottom: 24,
    },
    formContainer: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 24,
    },
    input: {
        marginBottom: 16,
        backgroundColor: 'transparent',
    },
    textArea: {
        minHeight: 80, // Ensure visual height for multiline
    },
    actionContainer: {
        marginBottom: 20,
    },
    saveButton: {
        marginBottom: 12,
        borderRadius: 8,
    },
    cancelButton: {
        borderRadius: 8,
        borderWidth: 1,
    },
});
