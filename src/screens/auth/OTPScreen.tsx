import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Button, Surface, ProgressBar, IconButton, useTheme, Portal } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    CodeField,
    Cursor,
    useBlurOnFulfill,
    useClearByFocusCell,
} from 'react-native-confirmation-code-field';
import { CustomerBleUnlockModal } from '../../components';
import { subscribeToDisplay, subscribeToBoxState } from '../../services/firebaseClient';

const CELL_COUNT = 6;

export default function OTPScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const { boxId } = route.params || { boxId: 'BOX_001' }; // Default for dev/testing if not passed

    const [otpCode, setOtpCode] = useState('');
    const [boxStatus, setBoxStatus] = useState<string>('UNKNOWN');
    const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [showBleModal, setShowBleModal] = useState(false);

    // CodeField props
    const [props, getCellOnLayoutHandler] = useClearByFocusCell({
        value: otpCode,
        setValue: setOtpCode,
    });

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        // EC-86: Monitor display health
        const unsubscribe = subscribeToDisplay(boxId, (displayState) => {
            if (displayState) {
                setDisplayStatus(displayState.status);
            }
        });
        return () => unsubscribe();
    }, [boxId]);

    useEffect(() => {
        // Subscribe to Box State (Status & OTP)
        // We only show OTP if status === 'ARRIVED' (Photo-First / Geo-Fence Rule)
        const unsubscribe = subscribeToBoxState(boxId, (state) => {
            if (state) {
                setBoxStatus(state.status);
                // Only set the OTP code if the rider has arrived
                if (state.status === 'ARRIVED') {
                    setOtpCode(state.otp_code || '------');
                } else {
                    setOtpCode(''); // Clear it if not arrived (security fallback)
                }
            }
        });
        return () => unsubscribe();
    }, [boxId]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const progress = timeLeft / 300;
    const isArrived = boxStatus === 'ARRIVED';

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <IconButton icon="close" size={24} onPress={() => navigation.goBack()} />
                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Secure Delivery Code</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.content}>
                <Surface style={[styles.iconSurface, { backgroundColor: isArrived ? theme.colors.primaryContainer : theme.colors.surfaceDisabled }]} elevation={4}>
                    <MaterialCommunityIcons
                        name={isArrived ? "shield-check" : "shield-lock"}
                        size={60}
                        color={isArrived ? theme.colors.primary : theme.colors.onSurfaceDisabled}
                    />
                </Surface>

                <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.onSurface }]}>
                    {isArrived ? "Verify Receipt" : "Rider Approaching"}
                </Text>
                <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
                    {isArrived
                        ? "Share this code with your rider ONLY when you have physically received your parcel."
                        : "For your security, the code is hidden until the rider arrives at your location."}
                </Text>

                {isArrived ? (
                    <View style={styles.codeContainer}>
                        <CodeField
                            ref={useBlurOnFulfill({ value: otpCode, cellCount: CELL_COUNT })}
                            {...props}
                            value={otpCode}
                            onChangeText={setOtpCode}
                            cellCount={CELL_COUNT}
                            rootStyle={styles.codeFieldRoot}
                            keyboardType="number-pad"
                            textContentType="oneTimeCode"
                            renderCell={({ index, symbol, isFocused }) => (
                                <View
                                    key={index}
                                    style={[
                                        styles.cell,
                                        { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline },
                                        isFocused && { borderColor: theme.colors.primary, backgroundColor: theme.colors.secondaryContainer },
                                    ]}
                                    onLayout={getCellOnLayoutHandler(index)}>
                                    <Text style={[styles.cellText, { color: theme.colors.onSurface }]}>
                                        {symbol || (isFocused ? <Cursor /> : null)}
                                    </Text>
                                </View>
                            )}
                            editable={false}
                        />
                    </View>
                ) : (
                    <View style={[styles.lockedContainer, { borderColor: theme.colors.outline }]}>
                        <MaterialCommunityIcons name="lock" size={32} color={theme.colors.onSurfaceVariant} />
                        <Text style={[styles.lockedText, { color: theme.colors.onSurfaceVariant }]}>
                            Code Locked
                        </Text>
                    </View>
                )}

                {isArrived && (
                    <View style={styles.timerContainer}>
                        <View style={styles.timerHeader}>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Code expires in</Text>
                            <Text variant="labelLarge" style={{ color: theme.colors.error, fontWeight: 'bold' }}>{formatTime(timeLeft)}</Text>
                        </View>
                        <ProgressBar progress={progress} color={progress < 0.2 ? theme.colors.error : theme.colors.primary} style={styles.progressBar} />
                    </View>
                )}

                <Surface style={[styles.warningCard, { backgroundColor: isArrived ? (theme.dark ? '#3E2723' : '#FFF3E0') : theme.colors.surfaceVariant }]} elevation={1}>
                    <MaterialCommunityIcons
                        name={isArrived ? "alert-circle-outline" : "information-outline"}
                        size={24}
                        color={isArrived ? (theme.dark ? '#FFAB91' : '#F57C00') : theme.colors.onSurfaceVariant}
                    />
                    <Text variant="bodySmall" style={[styles.warningText, { color: isArrived ? (theme.dark ? '#FFCCBC' : '#E65100') : theme.colors.onSurfaceVariant }]}>
                        {isArrived
                            ? "Do not share this code via call or text. This is for face-to-face verification only."
                            : "System is monitoring rider location. Code will appear automatically upon arrival."}
                    </Text>
                </Surface>

                {isArrived && (
                    <Button
                        mode="contained"
                        icon="content-copy"
                        onPress={() => console.log('Copy OTP')}
                        style={styles.button}
                        contentStyle={{ paddingVertical: 8 }}
                    >
                        Copy Code
                    </Button>
                )}

                {/* EC-86: BLE unlock option when display failed AND arrived */}
                {displayStatus === 'FAILED' && isArrived && (
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
                boxId={boxId}
                otpCode={otpCode}
                onClose={() => setShowBleModal(false)}
            />
        </View>
    );
}



const styles = StyleSheet.create({
    container: {
        flex: 1,
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
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellText: {
        fontSize: 24,
        fontWeight: 'bold',
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
        padding: 16,
        borderRadius: 12,
        marginBottom: 32,
        width: '100%',
    },
    warningText: {
        flex: 1,
        marginLeft: 12,
    },
    button: {
        width: '100%',
        borderRadius: 12,
    },
    lockedContainer: {
        width: '100%',
        height: 80,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        marginBottom: 32,
        backgroundColor: 'rgba(0,0,0,0.02)',
    },
    lockedText: {
        fontSize: 18,
        fontWeight: 'bold',
        marginLeft: 12,
    },
});
