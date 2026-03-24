/**
 * CustomerBleUnlockModal Component
 * 
 * EC-86: Customer-friendly BLE unlock flow when display fails.
 * Simplified version with clear, non-technical language.
 * 
 * Usage:
 * ```tsx
 * <CustomerBleUnlockModal
 *   visible={showModal}
 *   boxId="BOX_001"
 *   otpCode="123456"
 *   onClose={() => setShowModal(false)}
 * />
 * ```
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Modal, Portal, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface CustomerBleUnlockModalProps {
    visible: boolean;
    boxId: string;
    otpCode: string;
    onClose: () => void;
}

type UnlockState = 'idle' | 'connecting' | 'unlocking' | 'success' | 'error';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface ModalContent {
    icon: IconName;
    iconColor: string;
    title: string;
    message: string;
    showButton: boolean;
    buttonText?: string;
    buttonAction?: () => void;
}

export default function CustomerBleUnlockModal({
    visible,
    boxId,
    otpCode,
    onClose,
}: CustomerBleUnlockModalProps) {
    const [state, setState] = useState<UnlockState>('idle');
    const [errorMessage, setErrorMessage] = useState<string>('');

    const handleUnlock = async () => {
        try {
            setState('connecting');
            // TODO: Implement actual BLE connection
            // For now, simulate the process
            await new Promise(resolve => setTimeout(resolve, 2000));

            setState('unlocking');
            await new Promise(resolve => setTimeout(resolve, 2000));

            setState('success');
        } catch (error) {
            setState('error');
            setErrorMessage(error instanceof Error ? error.message : 'Failed to unlock via Bluetooth');
        }
    };

    const handleClose = () => {
        setState('idle');
        setErrorMessage('');
        onClose();
    };

    const getContent = (): ModalContent => {
        switch (state) {
            case 'idle':
                return {
                    icon: 'bluetooth',
                    iconColor: '#1976D2',
                    title: 'Unlock with Bluetooth',
                    message: 'Make sure Bluetooth is enabled on your phone, then tap "Unlock" below.',
                    showButton: true,
                    buttonText: 'Unlock',
                    buttonAction: handleUnlock,
                };

            case 'connecting':
                return {
                    icon: 'bluetooth-connect',
                    iconColor: '#1976D2',
                    title: 'Connecting...',
                    message: 'Connecting to your delivery box via Bluetooth',
                    showButton: false,
                };

            case 'unlocking':
                return {
                    icon: 'lock-open',
                    iconColor: '#1976D2',
                    title: 'Unlocking...',
                    message: 'Sending unlock command securely',
                    showButton: false,
                };

            case 'success':
                return {
                    icon: 'check-circle',
                    iconColor: '#4caf50',
                    title: 'Success!',
                    message: 'You can now open the box.',
                    showButton: true,
                    buttonText: 'Done',
                    buttonAction: handleClose,
                };

            case 'error':
                return {
                    icon: 'alert-circle',
                    iconColor: '#ef4444',
                    title: 'Connection Failed',
                    message: errorMessage || 'Could not connect to the box. Please try again or use the keypad.',
                    showButton: true,
                    buttonText: 'Retry',
                    buttonAction: handleUnlock,
                };
        }
    };

    const content = getContent();

    return (
        <Portal>
            <Modal
                visible={visible}
                onDismiss={state === 'success' || state === 'error' ? handleClose : undefined}
                contentContainerStyle={styles.modal}
            >
                <View style={styles.content}>
                    <MaterialCommunityIcons name={content.icon} size={64} color={content.iconColor} style={styles.icon} />

                    <Text style={styles.title}>{content.title}</Text>
                    <Text style={styles.message}>{content.message}</Text>

                    {(state === 'connecting' || state === 'unlocking') && (
                        <ActivityIndicator size="large" color="#1976D2" style={styles.spinner} />
                    )}

                    {content.showButton && (
                        <View style={styles.buttonContainer}>
                            <Button
                                mode="contained"
                                onPress={content.buttonAction}
                                style={styles.button}
                                contentStyle={styles.buttonContent}
                            >
                                {content.buttonText}
                            </Button>
                            {state !== 'success' && (
                                <Button
                                    mode="outlined"
                                    onPress={handleClose}
                                    style={styles.button}
                                >
                                    Cancel
                                </Button>
                            )}
                        </View>
                    )}
                </View>
            </Modal>
        </Portal>
    );
}

const styles = StyleSheet.create({
    modal: {
        backgroundColor: 'white',
        marginHorizontal: 24,
        borderRadius: 12,
        maxWidth: 400,
        alignSelf: 'center',
    },
    content: {
        padding: 24,
        alignItems: 'center',
    },
    icon: {
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 8,
        textAlign: 'center',
    },
    message: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    spinner: {
        marginVertical: 16,
    },
    buttonContainer: {
        width: '100%',
        gap: 12,
    },
    button: {
        width: '100%',
    },
    buttonContent: {
        paddingVertical: 8,
    },
});
