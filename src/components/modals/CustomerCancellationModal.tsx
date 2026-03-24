/**
 * Customer Cancellation Modal
 * 
 * Allows customers to cancel their delivery order before pickup.
 * Shows customer-specific cancellation reasons.
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Modal, Portal, Text, Button, RadioButton, TextInput, useTheme, Surface, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    CustomerCancellationReason,
    formatCustomerCancellationReason
} from '../../services/cancellationService';

interface CustomerCancellationModalProps {
    visible: boolean;
    onDismiss: () => void;
    onSubmit: (reason: CustomerCancellationReason, details: string) => void;
    loading?: boolean;
}

export default function CustomerCancellationModal({
    visible,
    onDismiss,
    onSubmit,
    loading = false
}: CustomerCancellationModalProps) {
    const theme = useTheme();
    const [reason, setReason] = useState<CustomerCancellationReason>(CustomerCancellationReason.CHANGED_MIND);
    const [details, setDetails] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = () => {
        if (reason === CustomerCancellationReason.OTHER && details.trim() === '') {
            setError('Please provide details for your cancellation reason');
            return;
        }
        setError('');
        onSubmit(reason, details);
    };

    const handleDismiss = () => {
        setReason(CustomerCancellationReason.CHANGED_MIND);
        setDetails('');
        setError('');
        onDismiss();
    };

    const reasonOptions = [
        { value: CustomerCancellationReason.CHANGED_MIND, icon: 'thought-bubble' },
        { value: CustomerCancellationReason.ORDERED_BY_MISTAKE, icon: 'alert-circle' },
        { value: CustomerCancellationReason.FOUND_ALTERNATIVE, icon: 'truck-fast' },
        { value: CustomerCancellationReason.PRICE_TOO_HIGH, icon: 'currency-usd' },
        { value: CustomerCancellationReason.TAKING_TOO_LONG, icon: 'clock-alert' },
        { value: CustomerCancellationReason.OTHER, icon: 'dots-horizontal' },
    ];

    return (
        <Portal>
            <Modal
                visible={visible}
                onDismiss={handleDismiss}
                contentContainerStyle={[styles.container, { backgroundColor: theme.colors.surface }]}
            >
                <ScrollView showsVerticalScrollIndicator={false}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Surface style={[styles.iconContainer, { backgroundColor: theme.colors.errorContainer }]} elevation={0}>
                            <MaterialCommunityIcons name="package-variant-remove" size={32} color={theme.colors.error} />
                        </Surface>
                        <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.onSurface }]}>
                            Cancel Order
                        </Text>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                            Please select a reason for cancelling your order
                        </Text>
                    </View>

                    {/* Warning Banner */}
                    <Surface style={[styles.warningBanner, { backgroundColor: theme.dark ? '#1A1500' : '#FFF8E1' }]} elevation={0}>
                        <MaterialCommunityIcons name="information" size={20} color="#F9A825" />
                        <Text variant="bodySmall" style={{ marginLeft: 8, flex: 1, color: theme.colors.onSurface }}>
                            You can only cancel before the package is picked up. A refund will be processed within 3-5 business days.
                        </Text>
                    </Surface>

                    {/* Reason Selection */}
                    <RadioButton.Group onValueChange={(value) => setReason(value as CustomerCancellationReason)} value={reason}>
                        {reasonOptions.map((option) => (
                            <Surface
                                key={option.value}
                                style={[
                                    styles.reasonOption,
                                    {
                                        backgroundColor: reason === option.value
                                            ? theme.colors.primaryContainer
                                            : theme.colors.surfaceVariant,
                                        borderColor: reason === option.value
                                            ? theme.colors.primary
                                            : 'transparent',
                                        overflow: 'hidden', // Required for ripple
                                    }
                                ]}
                                elevation={0}
                            >
                                <TouchableRipple
                                    onPress={() => setReason(option.value)}
                                    style={styles.reasonRipple}
                                >
                                    <View style={styles.reasonContent}>
                                        <RadioButton.Android
                                            value={option.value}
                                            color={theme.colors.primary}
                                            // Pass onPress to RadioButton too or let event bubble?
                                            // RadioButton.Android doesn't accept onPress in the same way when in Group context usually, 
                                            // but checking prop handling. 
                                            // Actually better to just have the ripple handle it.
                                            status={reason === option.value ? 'checked' : 'unchecked'}
                                            onPress={() => setReason(option.value)}
                                        />
                                        <MaterialCommunityIcons
                                            name={option.icon as any}
                                            size={20}
                                            color={reason === option.value ? theme.colors.primary : theme.colors.onSurfaceVariant}
                                            style={{ marginRight: 8 }}
                                        />
                                        <Text
                                            variant="bodyMedium"
                                            style={{
                                                flex: 1,
                                                color: reason === option.value ? theme.colors.primary : theme.colors.onSurface,
                                                fontWeight: reason === option.value ? 'bold' : 'normal',
                                            }}
                                        >
                                            {formatCustomerCancellationReason(option.value)}
                                        </Text>
                                    </View>
                                </TouchableRipple>
                            </Surface>
                        ))}
                    </RadioButton.Group>

                    {/* Details Input (for OTHER reason) */}
                    {reason === CustomerCancellationReason.OTHER && (
                        <TextInput
                            label="Please specify"
                            value={details}
                            onChangeText={(text) => {
                                setDetails(text);
                                if (error) setError('');
                            }}
                            mode="outlined"
                            multiline
                            numberOfLines={3}
                            style={styles.input}
                            error={!!error}
                            placeholder="Tell us why you're cancelling..."
                        />
                    )}

                    {error && (
                        <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>
                            {error}
                        </Text>
                    )}

                    {/* Actions */}
                    <View style={styles.actions}>
                        <Button
                            mode="outlined"
                            onPress={handleDismiss}
                            style={styles.button}
                        >
                            Keep Order
                        </Button>
                        <Button
                            mode="contained"
                            onPress={handleSubmit}
                            loading={loading}
                            disabled={loading}
                            style={styles.button}
                            buttonColor={theme.colors.error}
                        >
                            Cancel Order
                        </Button>
                    </View>
                </ScrollView>
            </Modal>
        </Portal>
    );
}

const styles = StyleSheet.create({
    container: {
        margin: 20,
        borderRadius: 16,
        padding: 24,
        maxHeight: '90%',
    },
    header: {
        alignItems: 'center',
        marginBottom: 20,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontFamily: 'Inter_700Bold',
        marginBottom: 8,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 12,
        borderRadius: 8,
        marginBottom: 20,
    },
    reasonOption: {
        borderRadius: 12,
        marginBottom: 8,
        borderWidth: 2,
        padding: 0, // Reset padding for Ripple
    },
    reasonRipple: {
        padding: 12,
    },
    reasonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    input: {
        marginTop: 12,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 24,
        gap: 12,
    },
    button: {
        flex: 1,
    },
});
