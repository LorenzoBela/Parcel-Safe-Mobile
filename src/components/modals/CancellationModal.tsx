import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Modal, Portal, Text, Button, TextInput, RadioButton, useTheme, HelperText } from 'react-native-paper';
import { CancellationReason, formatCancellationReason, CancellationRequest } from '../../services/cancellationService';

interface CancellationModalProps {
    visible: boolean;
    onDismiss: () => void;
    onSubmit: (reason: CancellationReason, details: string) => void;
    loading?: boolean;
}

export default function CancellationModal({ visible, onDismiss, onSubmit, loading }: CancellationModalProps) {
    const theme = useTheme();
    const [reason, setReason] = useState<CancellationReason>(CancellationReason.CUSTOMER_UNAVAILABLE);
    const [details, setDetails] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = () => {
        if (reason === CancellationReason.OTHER && !details.trim()) {
            setError('Please provide details for the "Other" reason.');
            return;
        }
        setError('');
        onSubmit(reason, details);
    };

    const handleDismiss = () => {
        setReason(CancellationReason.CUSTOMER_UNAVAILABLE);
        setDetails('');
        setError('');
        onDismiss();
    };

    const reasons = Object.values(CancellationReason);

    return (
        <Portal>
            <Modal visible={visible} onDismiss={handleDismiss} contentContainerStyle={[styles.container, { backgroundColor: theme.colors.surface }]}>
                <Text variant="headlineSmall" style={styles.title}>Cancel Delivery</Text>
                <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
                    Please select a reason for cancellation. This will be recorded and the sender will be notified.
                </Text>

                <ScrollView style={{ maxHeight: 300 }}>
                    <RadioButton.Group onValueChange={value => setReason(value as CancellationReason)} value={reason}>
                        {reasons.map((r) => (
                            <RadioButton.Item
                                key={r}
                                label={formatCancellationReason(r)}
                                value={r}
                                labelStyle={{ fontSize: 14 }}
                                color={theme.colors.error}
                            />
                        ))}
                    </RadioButton.Group>
                </ScrollView>

                <TextInput
                    mode="outlined"
                    label="Additional Details"
                    placeholder="Optional (Required for 'Other')"
                    value={details}
                    onChangeText={setDetails}
                    multiline
                    numberOfLines={3}
                    style={styles.input}
                    error={!!error}
                />
                {!!error && <HelperText type="error">{error}</HelperText>}

                <View style={styles.actions}>
                    <Button mode="text" onPress={handleDismiss} style={{ marginRight: 8 }} disabled={loading}>
                        Dismiss
                    </Button>
                    <Button
                        mode="contained"
                        onPress={handleSubmit}
                        loading={loading}
                        disabled={loading}
                        buttonColor={theme.colors.error}
                    >
                        Confirm Cancellation
                    </Button>
                </View>
            </Modal>
        </Portal>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 20,
        margin: 20,
        borderRadius: 8,
    },
    title: {
        marginBottom: 10,
        fontFamily: 'Inter_700Bold',
    },
    input: {
        marginTop: 10,
        marginBottom: 5,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 20,
    },
});
