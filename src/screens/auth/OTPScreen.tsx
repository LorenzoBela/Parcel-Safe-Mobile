import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Button, Surface, ProgressBar, IconButton, useTheme, Portal } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    CodeField,
    Cursor,
    useBlurOnFulfill,
    useClearByFocusCell,
} from 'react-native-confirmation-code-field';
import { CustomerBleUnlockModal } from '../../components';
import { subscribeToDisplay } from '../../services/firebaseClient';

const CELL_COUNT = 6;

export default function OTPScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [value, setValue] = useState('123456'); // Mock OTP
    const [props, getCellOnLayoutHandler] = useClearByFocusCell({
        value,
        setValue,
    });
    const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [showBleModal, setShowBleModal] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        // EC-86: Monitor display health
        const unsubscribe = subscribeToDisplay('BOX_001', (displayState) => {
            if (displayState) {
                setDisplayStatus(displayState.status);
            }
        });
        return () => unsubscribe();
    }, []);

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const progress = timeLeft / 300;

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <IconButton icon="close" size={24} onPress={() => navigation.goBack()} />
                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Secure Delivery Code</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.content}>
                <Surface style={styles.iconSurface} elevation={4}>
                    <MaterialCommunityIcons name="shield-check" size={60} color={theme.colors.primary} />
                </Surface>

                <Text variant="headlineSmall" style={styles.title}>Verify Receipt</Text>
                <Text variant="bodyMedium" style={styles.subtitle}>
                    Share this code with your rider ONLY when you have physically received your parcel.
                </Text>

                <View style={styles.codeContainer}>
                    <CodeField
                        ref={useBlurOnFulfill({ value, cellCount: CELL_COUNT })}
                        {...props}
                        value={value}
                        onChangeText={setValue}
                        cellCount={CELL_COUNT}
                        rootStyle={styles.codeFieldRoot}
                        keyboardType="number-pad"
                        textContentType="oneTimeCode"
                        renderCell={({ index, symbol, isFocused }) => (
                            <View
                                key={index}
                                style={[styles.cell, isFocused && styles.focusCell]}
                                onLayout={getCellOnLayoutHandler(index)}>
                                <Text style={styles.cellText}>
                                    {symbol || (isFocused ? <Cursor /> : null)}
                                </Text>
                            </View>
                        )}
                        editable={false}
                    />
                </View>

                <View style={styles.timerContainer}>
                    <View style={styles.timerHeader}>
                        <Text variant="bodySmall" style={{ color: '#666' }}>Code expires in</Text>
                        <Text variant="labelLarge" style={{ color: theme.colors.error, fontWeight: 'bold' }}>{formatTime(timeLeft)}</Text>
                    </View>
                    <ProgressBar progress={progress} color={progress < 0.2 ? theme.colors.error : theme.colors.primary} style={styles.progressBar} />
                </View>

                <Surface style={styles.warningCard} elevation={1}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={24} color="#F57C00" />
                    <Text variant="bodySmall" style={styles.warningText}>
                        Do not share this code via call or text. This is for face-to-face verification only.
                    </Text>
                </Surface>

                <Button
                    mode="contained"
                    icon="content-copy"
                    onPress={() => console.log('Copy OTP')}
                    style={styles.button}
                    contentStyle={{ paddingVertical: 8 }}
                >
                    Copy Code
                </Button>

                {/* EC-86: BLE unlock option when display failed */}
                {displayStatus === 'FAILED' && (
                    <Button
                        mode="outlined"
                        icon="bluetooth"
                        onPress={() => setShowBleModal(true)}
                        style={[styles.button, { marginTop: 12 }]}
                        contentStyle={{ paddingVertical: 8 }}
                    >
                        Unlock with Bluetooth
                    </Button>
                )}
            </View>

            {/* EC-86: BLE unlock modal */}
            <CustomerBleUnlockModal
                visible={showBleModal}
                boxId="BOX_001"
                otpCode={value}
                onClose={() => setShowBleModal(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 50,
        paddingHorizontal: 10,
        paddingBottom: 10,
    },
    content: {
        flex: 1,
        padding: 24,
        alignItems: 'center',
    },
    iconSurface: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontWeight: 'bold',
        marginBottom: 12,
    },
    subtitle: {
        textAlign: 'center',
        color: '#666',
        marginBottom: 32,
        paddingHorizontal: 20,
    },
    codeContainer: {
        width: '100%',
        marginBottom: 32,
    },
    codeFieldRoot: {
        justifyContent: 'space-between',
    },
    cell: {
        width: 45,
        height: 55,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F9F9F9',
    },
    focusCell: {
        borderColor: '#2196F3',
        backgroundColor: '#E3F2FD',
        borderWidth: 2,
    },
    cellText: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
    },
    timerContainer: {
        width: '100%',
        marginBottom: 32,
    },
    timerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    progressBar: {
        height: 8,
        borderRadius: 4,
        backgroundColor: '#F0F0F0',
    },
    warningCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF3E0',
        padding: 16,
        borderRadius: 12,
        marginBottom: 32,
        width: '100%',
    },
    warningText: {
        flex: 1,
        marginLeft: 12,
        color: '#E65100',
    },
    button: {
        width: '100%',
        borderRadius: 12,
    },
});
