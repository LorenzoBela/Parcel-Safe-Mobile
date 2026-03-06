import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Text, Button, Surface, IconButton, useTheme, Portal, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    CodeField,
    Cursor,
    useBlurOnFulfill,
    useClearByFocusCell,
} from 'react-native-confirmation-code-field';
import { CustomerBleUnlockModal } from '../../components';
import { subscribeToDisplay, subscribeToBoxState, getFirebaseDatabase } from '../../services/firebaseClient';
import { ref, onValue, off, set } from 'firebase/database';
import { supabase } from '../../services/supabaseClient';
import { generateOTP } from '../../utils/tokenUtils';
import { PremiumAlert } from '../../services/PremiumAlertService';

const CELL_COUNT = 6;

export default function OTPScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const { boxId, deliveryId } = route.params || { boxId: 'BOX_001', deliveryId: '' };

    const [otpCode, setOtpCode] = useState('');
    const [boxStatus, setBoxStatus] = useState<string>('UNKNOWN');
    const [deliveryStatus, setDeliveryStatus] = useState<string>('UNKNOWN');
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [showBleModal, setShowBleModal] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    // CodeField props — hooks must be called unconditionally at top level
    const blurRef = useBlurOnFulfill({ value: otpCode, cellCount: CELL_COUNT });
    const [props, getCellOnLayoutHandler] = useClearByFocusCell({
        value: otpCode,
        setValue: setOtpCode,
    });

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
        // Subscribe to Box State (Status only — OTP comes from Supabase)
        const unsubscribe = subscribeToBoxState(boxId, (state) => {
            if (state) {
                setBoxStatus(state.status || 'UNKNOWN');
            }
        });
        return () => unsubscribe();
    }, [boxId]);

    // Subscribe to delivery node from Firebase for real-time status AND OTP updates
    // When ARRIVED is detected, fetch OTP from Supabase. Also picks up regenerated OTP in real-time.
    useEffect(() => {
        if (!deliveryId) return;

        const db = getFirebaseDatabase();
        const deliveryRef = ref(db, `deliveries/${deliveryId}`);

        const unsubscribe = onValue(deliveryRef, async (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            const liveDeliveryStatus = data.status || 'UNKNOWN';
            setDeliveryStatus(liveDeliveryStatus);

            if (liveDeliveryStatus === 'ARRIVED' || liveDeliveryStatus === 'COMPLETED') {
                setBoxStatus('ARRIVED');
            }

            // Real-time OTP sync: pick up OTP changes from Firebase
            // (written by web or mobile regeneration)
            if ((liveDeliveryStatus === 'ARRIVED' || liveDeliveryStatus === 'COMPLETED') && data.otp_code) {
                setOtpCode(data.otp_code);
            } else if (liveDeliveryStatus === 'ARRIVED' || liveDeliveryStatus === 'COMPLETED') {
                // Fallback: fetch from Supabase if Firebase doesn't have it
                await fetchOtpFromSupabase();
            }
        });

        return () => off(deliveryRef);
    }, [deliveryId]);

    /** Fetch OTP from Supabase (the Historian — source of truth for business data) */
    const fetchOtpFromSupabase = useCallback(async () => {
        if (!deliveryId) return;
        try {
            const { data: delivery, error } = await supabase
                .from('deliveries')
                .select('otp_code')
                .eq('id', deliveryId)
                .single();
            if (delivery?.otp_code && !error) {
                setOtpCode(delivery.otp_code);
            }
        } catch (e) {
            console.error('[OTPScreen] Failed to fetch OTP from Supabase:', e);
        }
    }, [deliveryId]);

    /** Generate a new OTP and update Supabase — reflects on both web and mobile */
    const handleRegenerateOtp = useCallback(async () => {
        if (!deliveryId) {
            PremiumAlert.alert('Error', 'No delivery ID available.');
            return;
        }

        PremiumAlert.alert(
            'Generate New Code',
            'This will invalidate the current code and create a new one. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Generate',
                    style: 'destructive',
                    onPress: async () => {
                        setIsRegenerating(true);
                        try {
                            const newOtp = generateOTP();
                            // Write to Supabase (Historian — source of truth)
                            const { error } = await supabase
                                .from('deliveries')
                                .update({
                                    otp_code: newOtp,
                                    updated_at: new Date().toISOString(),
                                })
                                .eq('id', deliveryId);

                            if (error) {
                                console.error('[OTPScreen] Failed to regenerate OTP:', error);
                                PremiumAlert.alert('Error', 'Failed to generate new code. Please try again.');
                            } else {
                                setOtpCode(newOtp);
                                // Write to Firebase (Nervous System — real-time sync to web)
                                try {
                                    const db = getFirebaseDatabase();
                                    const otpRef = ref(db, `deliveries/${deliveryId}/otp_code`);
                                    await set(otpRef, newOtp);
                                } catch (fbErr) {
                                    console.error('[OTPScreen] Failed to sync OTP to Firebase:', fbErr);
                                }
                            }
                        } catch (e) {
                            console.error('[OTPScreen] OTP regeneration exception:', e);
                            PremiumAlert.alert('Error', 'Something went wrong. Please try again.');
                        } finally {
                            setIsRegenerating(false);
                        }
                    },
                },
            ]
        );
    }, [deliveryId]);

    const isArrived = deliveryStatus === 'ARRIVED' || deliveryStatus === 'COMPLETED';

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
                        ? "Enter this code on the Smart Box keypad to unlock and collect your parcel."
                        : "For your security, the code is hidden until the rider arrives at your location."}
                </Text>

                {isArrived ? (
                    <View style={styles.codeContainer}>
                        <CodeField
                            ref={blurRef}
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

                <Surface style={[styles.warningCard, { backgroundColor: isArrived ? (theme.dark ? '#3E2723' : '#FFF3E0') : theme.colors.surfaceVariant }]} elevation={1}>
                    <MaterialCommunityIcons
                        name={isArrived ? "alert-circle-outline" : "information-outline"}
                        size={24}
                        color={isArrived ? (theme.dark ? '#FFAB91' : '#F57C00') : theme.colors.onSurfaceVariant}
                    />
                    <Text variant="bodySmall" style={[styles.warningText, { color: isArrived ? (theme.dark ? '#FFCCBC' : '#E65100') : theme.colors.onSurfaceVariant }]}>
                        {isArrived
                            ? "Never share this code via call or text. Enter it directly on the box keypad only."
                            : "System is monitoring rider location. Code will appear automatically upon arrival."}
                    </Text>
                </Surface>

                {isArrived && (
                    <View style={styles.buttonGroup}>
                        <Button
                            mode="contained"
                            icon="refresh"
                            onPress={handleRegenerateOtp}
                            loading={isRegenerating}
                            disabled={isRegenerating}
                            style={styles.button}
                            contentStyle={{ paddingVertical: 8 }}
                        >
                            Generate New Code
                        </Button>
                    </View>
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
    warningCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        marginBottom: 24,
        width: '100%',
    },
    warningText: {
        flex: 1,
        marginLeft: 12,
    },
    buttonGroup: {
        width: '100%',
        gap: 12,
        marginBottom: 16,
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
