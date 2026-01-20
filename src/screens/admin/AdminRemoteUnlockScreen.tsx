import React, { useState } from 'react';
import { View, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, Surface, useTheme, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { triggerAdminOverride } from '../../services/adminOverrideService';
import { getCurrentUser } from '../../services/supabaseClient';

export default function AdminRemoteUnlockScreen() {
    const theme = useTheme();
    const navigation = useNavigation();

    const [boxId, setBoxId] = useState('');
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    const handleUnlock = async () => {
        if (!boxId.trim()) {
            Alert.alert('Error', 'Please enter a Box ID');
            return;
        }
        if (!reason.trim()) {
            Alert.alert('Error', 'Please provide a reason for the override');
            return;
        }

        setIsSubmitting(true);
        setSuccessMessage('');

        try {
            const user = await getCurrentUser();
            const adminId = user?.id || 'admin-unknown';

            // Trigger the override
            await triggerAdminOverride(boxId.trim(), adminId, reason.trim());

            setSuccessMessage(`Unlock command sent to ${boxId.trim()} successfully.`);
            setBoxId('');
            setReason('');

            // Clear success message after 3 seconds or just leave it? 
            // Better leave it so they know it worked.
        } catch (error: any) {
            Alert.alert('Error', `Failed to trigger unlock: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.header}>
                    <IconButton icon="arrow-left" onPress={() => navigation.goBack()} />
                    <Text variant="headlineMedium" style={styles.title}>Remote Box Unlock</Text>
                </View>

                <Surface style={styles.card} elevation={2}>
                    <View style={styles.iconContainer}>
                        <MaterialCommunityIcons name="lock-open-alert" size={48} color={theme.colors.error} />
                    </View>

                    <Text style={styles.warningText}>
                        Warning: This will force the box to unlock immediately.
                        Use only in emergencies or when the user cannot unlock it themselves.
                    </Text>

                    <TextInput
                        label="Box ID / MAC Address"
                        value={boxId}
                        onChangeText={setBoxId}
                        mode="outlined"
                        placeholder="e.g., BOX-001"
                        style={styles.input}
                        autoCapitalize="characters"
                        left={<TextInput.Icon icon="cube-outline" />}
                    />

                    <TextInput
                        label="Reason for Override"
                        value={reason}
                        onChangeText={setReason}
                        mode="outlined"
                        placeholder="e.g., Battery failure, User lockout"
                        multiline
                        numberOfLines={3}
                        style={styles.input}
                    />

                    <Button
                        mode="contained"
                        onPress={handleUnlock}
                        loading={isSubmitting}
                        disabled={isSubmitting}
                        buttonColor={theme.colors.error}
                        style={styles.button}
                        icon="lock-open-variant"
                    >
                        Force Unlock
                    </Button>
                </Surface>

                {successMessage ? (
                    <Surface style={styles.successBanner} elevation={1}>
                        <MaterialCommunityIcons name="check-circle" size={24} color="#4CAF50" />
                        <Text style={styles.successText}>{successMessage}</Text>
                    </Surface>
                ) : null}

            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    content: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    title: {
        fontWeight: 'bold',
        marginLeft: 8,
    },
    card: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
    },
    iconContainer: {
        marginBottom: 16,
        padding: 16,
        backgroundColor: '#FFEBEE',
        borderRadius: 50,
    },
    warningText: {
        textAlign: 'center',
        color: '#666',
        marginBottom: 24,
    },
    input: {
        width: '100%',
        marginBottom: 16,
        backgroundColor: 'white',
    },
    button: {
        width: '100%',
        paddingVertical: 6,
        borderRadius: 8,
    },
    successBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E8F5E9',
        padding: 16,
        borderRadius: 12,
        marginTop: 24,
    },
    successText: {
        marginLeft: 12,
        color: '#2E7D32',
        fontWeight: 'bold',
        flex: 1,
    },
});
