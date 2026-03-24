import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Modal, Portal, Text, TextInput, Button, HelperText, useTheme } from 'react-native-paper';
import { supabase } from '../../services/supabaseClient';

interface PhoneEntryModalProps {
    visible: boolean;
    onDismiss: () => void;
    onSave: (phoneNumber: string) => void;
    riderId: string;
}

export default function PhoneEntryModal({ visible, onDismiss, onSave, riderId }: PhoneEntryModalProps) {
    const theme = useTheme();
    const [phoneNumber, setPhoneNumber] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        // Basic validation: must be reasonably long (PH numbers are usually 11 digits, e.g. 0917...)
        const cleaned = phoneNumber.replace(/\D/g, '');
        if (cleaned.length < 10) {
            setError('Please enter a valid mobile number (e.g., 09171234567)');
            return;
        }

        setLoading(true);
        setError('');

        try {
            if (!riderId) throw new Error('No rider ID provided');

            // Update Supabase profile
            const { error: updateError } = await supabase
                .from('profiles')
                .update({ phone_number: phoneNumber })
                .eq('id', riderId);

            if (updateError) throw updateError;

            // Success
            onSave(phoneNumber);
            setPhoneNumber(''); // Reset for next time if needed
        } catch (err: any) {
            console.error('Failed to update phone number:', err);
            setError(err.message || 'Failed to save phone number. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Portal>
            <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
                <Text variant="headlineSmall" style={styles.title}>Mobile Number Required</Text>
                <Text variant="bodyMedium" style={styles.description}>
                    You must provide a mobile number so customers can contact you during deliveries.
                </Text>

                <TextInput
                    mode="outlined"
                    label="Mobile Number"
                    placeholder="0917 123 4567"
                    value={phoneNumber}
                    onChangeText={(text) => {
                        setPhoneNumber(text);
                        setError('');
                    }}
                    keyboardType="phone-pad"
                    style={styles.input}
                    error={!!error}
                    disabled={loading}
                />

                {error ? <HelperText type="error" visible={true}>{error}</HelperText> : null}

                <View style={styles.actions}>
                    <Button
                        mode="text"
                        onPress={onDismiss}
                        disabled={loading}
                        style={styles.button}
                    >
                        Cancel
                    </Button>
                    <Button
                        mode="contained"
                        onPress={handleSave}
                        loading={loading}
                        disabled={loading || !phoneNumber}
                        style={styles.button}
                    >
                        Save & Continue
                    </Button>
                </View>
            </Modal>
        </Portal>
    );
}

const styles = StyleSheet.create({
    modalContent: {
        margin: 20,
        padding: 24,
        borderRadius: 12,
        elevation: 5,
    },
    title: {
        marginBottom: 8,
        fontFamily: 'Inter_700Bold',
    },
    description: {
        marginBottom: 16,
        opacity: 0.7,
    },
    input: {
        marginBottom: 4,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 16,
        gap: 8,
    },
    button: {
        minWidth: 80,
    }
});
