import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { ActivityIndicator, Text, TextInput, IconButton, ProgressBar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { triggerAdminOverride } from '../../services/adminOverrideService';
import { getCurrentUser, listSmartBoxes, SmartBoxSummary } from '../../services/supabaseClient';
import { useAppTheme } from '../../context/ThemeContext';
import { PremiumAlert } from '../../services/PremiumAlertService';
import { authenticateBiometricForSensitiveAction } from '../../services/biometricAuthService';

const lightC = {
    bg: '#FFFFFF', card: '#F6F6F6', card2: '#EEEEEE', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#999999',
    accent: '#000000', red: '#FF3B30', green: '#34C759',
    warnBg: '#FEF2F2', successBg: '#F0FDF4',
};
const darkC = {
    bg: '#000000', card: '#141414', card2: '#1C1C1E', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#48484A',
    accent: '#FFFFFF', red: '#FF453A', green: '#30D158',
    warnBg: '#2A1515', successBg: '#152A15',
};

export default function AdminRemoteUnlockScreen() {
    const navigation = useNavigation();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;

    const [boxes, setBoxes] = useState<SmartBoxSummary[]>([]);
    const [selectedBoxId, setSelectedBoxId] = useState('');
    const [manualBoxId, setManualBoxId] = useState('');
    const [reason, setReason] = useState('');
    const [isLoadingBoxes, setIsLoadingBoxes] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAuthorizing, setIsAuthorizing] = useState(false);
    const [unlockProgress, setUnlockProgress] = useState(0);
    const [unlockProgressLabel, setUnlockProgressLabel] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const unlockActionLockRef = useRef(false);

    const activeBoxes = useMemo(() => {
        return boxes.filter((box) => box.status === 'IN_TRANSIT' || Boolean(box.current_rider_id));
    }, [boxes]);

    const selectedBox = useMemo(() => {
        return boxes.find((box) => box.id === selectedBoxId) || null;
    }, [boxes, selectedBoxId]);

    const resolvedTargetBox = useMemo(() => {
        const selectedTarget = selectedBox?.hardware_mac_address || selectedBox?.id || '';
        if (selectedTarget) return selectedTarget;
        return manualBoxId.trim();
    }, [selectedBox, manualBoxId]);

    const fetchBoxes = useCallback(async () => {
        setIsLoadingBoxes(true);
        setLoadError('');

        try {
            const data = await listSmartBoxes();
            setBoxes(data);

            if (selectedBoxId && !data.some((box) => box.id === selectedBoxId)) {
                setSelectedBoxId('');
            }
        } catch {
            setLoadError('Failed to load boxes. Pull to refresh or enter Box ID manually.');
        } finally {
            setIsLoadingBoxes(false);
        }
    }, [selectedBoxId]);

    useEffect(() => {
        fetchBoxes();
    }, [fetchBoxes]);

    const resetUnlockProgress = () => {
        setUnlockProgress(0);
        setUnlockProgressLabel('');
    };

    const handleUnlock = async () => {
        if (unlockActionLockRef.current || isSubmitting || isAuthorizing) {
            return;
        }

        if (!resolvedTargetBox) {
            PremiumAlert.alert('Error', 'Select a box or enter a Box ID/MAC address');
            return;
        }
        if (!reason.trim()) {
            PremiumAlert.alert('Error', 'Please provide a reason for the override');
            return;
        }

        unlockActionLockRef.current = true;

        try {
            try {
                setIsAuthorizing(true);
                setUnlockProgress(0.25);
                setUnlockProgressLabel('Waiting for biometric/device credential...');

                const authResult = await authenticateBiometricForSensitiveAction('Authorize remote unlock');
                if (!authResult.success) {
                    PremiumAlert.alert('Authorization Required', `${'message' in authResult ? authResult.message : 'Authorization failed.'} Remote unlock was canceled.`);
                    resetUnlockProgress();
                    return;
                }
            } finally {
                setIsAuthorizing(false);
            }

            setIsSubmitting(true);
            setSuccessMessage('');
            setUnlockProgress(0.65);
            setUnlockProgressLabel('Sending override command to box...');

            try {
                const user = await getCurrentUser();
                const adminId = user?.id || 'admin-unknown';
                const clientRequestId = `admin_unlock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                await triggerAdminOverride(resolvedTargetBox, adminId, reason.trim(), clientRequestId);

                setUnlockProgress(1);
                setUnlockProgressLabel('Command sent. Awaiting device acknowledgment...');

                setSuccessMessage(`Unlock command sent to ${resolvedTargetBox} successfully.`);
                PremiumAlert.alert('Success', `Unlock command sent to ${resolvedTargetBox} successfully.`);
                setManualBoxId('');
                setSelectedBoxId('');
                setReason('');
                fetchBoxes();
                setTimeout(() => {
                    resetUnlockProgress();
                }, 1200);
            } catch (error: any) {
                PremiumAlert.alert('Error', `Failed to trigger unlock: ${error.message}`);
                resetUnlockProgress();
            } finally {
                setIsSubmitting(false);
            }
        } finally {
            unlockActionLockRef.current = false;
        }
    };

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[{ flex: 1 }, screenAnim.style]}>
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: c.bg }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.header}>
                    <IconButton icon="arrow-left" iconColor={c.text} onPress={() => navigation.goBack()} />
                    <Text style={[styles.title, { color: c.text }]}>Remote Box Unlock</Text>
                </View>

                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                    {/* Warning icon */}
                    <View style={[styles.iconContainer, { backgroundColor: c.warnBg }]}>
                        <MaterialCommunityIcons name="lock-open-alert" size={40} color={c.red} />
                    </View>

                    <Text style={[styles.warningText, { color: c.textSec }]}>
                        Warning: This will force the box to unlock immediately.
                        Use only in emergencies or when the user cannot unlock it themselves.
                    </Text>

                    <View style={styles.sectionRow}>
                        <Text style={[styles.sectionTitle, { color: c.text }]}>Active Boxes (from DB)</Text>
                        <TouchableOpacity
                            onPress={fetchBoxes}
                            disabled={isLoadingBoxes}
                            style={[styles.refreshButton, { borderColor: c.border, backgroundColor: c.card2 }]}
                        >
                            <MaterialCommunityIcons name="refresh" size={16} color={c.textSec} />
                            <Text style={[styles.refreshButtonText, { color: c.textSec }]}>
                                {isLoadingBoxes ? 'Loading...' : 'Refresh'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {isLoadingBoxes ? (
                        <View style={styles.loadingWrap}>
                            <ActivityIndicator size="small" color={c.textSec} />
                            <Text style={[styles.loadingText, { color: c.textSec }]}>Fetching boxes...</Text>
                        </View>
                    ) : null}

                    {loadError ? (
                        <View style={[styles.errorBanner, { backgroundColor: c.warnBg, borderColor: c.border }]}>
                            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={c.red} />
                            <Text style={[styles.errorText, { color: c.textSec }]}>{loadError}</Text>
                        </View>
                    ) : null}

                    <View style={styles.boxListWrap}>
                        {activeBoxes.length === 0 ? (
                            <Text style={[styles.emptyText, { color: c.textSec }]}>No active boxes right now.</Text>
                        ) : (
                            activeBoxes.map((box) => {
                                const target = box.hardware_mac_address || box.id;
                                const selected = box.id === selectedBoxId;
                                return (
                                    <TouchableOpacity
                                        key={box.id}
                                        onPress={() => {
                                            setSelectedBoxId(box.id);
                                            setManualBoxId('');
                                        }}
                                        activeOpacity={0.85}
                                        style={[
                                            styles.boxItem,
                                            {
                                                backgroundColor: selected ? c.warnBg : c.card2,
                                                borderColor: selected ? c.red : c.border,
                                            },
                                        ]}
                                    >
                                        <View style={styles.boxItemMain}>
                                            <MaterialCommunityIcons
                                                name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                                                size={18}
                                                color={selected ? c.red : c.textTer}
                                            />
                                            <View style={styles.boxTextWrap}>
                                                <Text style={[styles.boxTitle, { color: c.text }]}>{target}</Text>
                                                <Text style={[styles.boxMeta, { color: c.textSec }]}>status: {box.status || 'UNKNOWN'}</Text>
                                            </View>
                                        </View>
                                        {box.current_rider_id ? (
                                            <View style={[styles.activePill, { backgroundColor: isDarkMode ? '#1F3A2A' : '#DCFCE7' }]}>
                                                <Text style={[styles.activePillText, { color: c.green }]}>Assigned</Text>
                                            </View>
                                        ) : null}
                                    </TouchableOpacity>
                                );
                            })
                        )}
                    </View>

                    <TextInput
                        label="Manual Box ID / MAC (Fallback)"
                        value={manualBoxId}
                        onChangeText={(value) => {
                            setManualBoxId(value);
                            if (value.trim()) {
                                setSelectedBoxId('');
                            }
                        }}
                        mode="outlined"
                        placeholder="e.g., BOX-001"
                        style={[styles.input, { backgroundColor: c.card2 }]}
                        autoCapitalize="characters"
                        left={<TextInput.Icon icon="cube-outline" />}
                        outlineColor={c.border}
                        activeOutlineColor={c.accent}
                        textColor={c.text}
                        theme={{ colors: { onSurfaceVariant: c.textSec, surface: c.card2 } }}
                    />

                    <TextInput
                        label="Reason for Override"
                        value={reason}
                        onChangeText={setReason}
                        mode="outlined"
                        placeholder="e.g., Battery failure, User lockout"
                        placeholderTextColor={c.textTer}
                        multiline
                        numberOfLines={3}
                        style={[styles.input, { backgroundColor: c.card2 }]}
                        outlineColor={c.border}
                        activeOutlineColor={c.accent}
                        textColor={c.text}
                        theme={{ colors: { onSurfaceVariant: c.textSec, surface: c.card2 } }}
                    />

                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: c.red }, (isSubmitting || isAuthorizing) && { opacity: 0.5 }]}
                        onPress={handleUnlock}
                        disabled={isSubmitting || isAuthorizing || !resolvedTargetBox}
                        activeOpacity={0.7}
                    >
                        <MaterialCommunityIcons name="lock-open-variant" size={18} color="#FFF" />
                        <Text style={styles.buttonText}>
                            {isAuthorizing ? 'Authorizing…' : isSubmitting ? 'Unlocking…' : 'Force Unlock'}
                        </Text>
                    </TouchableOpacity>

                    {(isAuthorizing || isSubmitting || unlockProgress > 0) && (
                        <View style={styles.progressWrap}>
                            <Text style={[styles.progressText, { color: c.textSec }]}>
                                {unlockProgressLabel || 'Processing...'}
                            </Text>
                            <ProgressBar
                                progress={unlockProgress}
                                color={c.red}
                                style={[styles.progressBar, { backgroundColor: c.card2 }]}
                            />
                        </View>
                    )}
                </View>

                {successMessage ? (
                    <View style={[styles.successBanner, { backgroundColor: c.successBg, borderColor: isDarkMode ? '#1A3A1A' : '#BBF7D0' }]}>
                        <MaterialCommunityIcons name="check-circle" size={22} color={c.green} />
                        <Text style={[styles.successText, { color: c.green }]}>{successMessage}</Text>
                    </View>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 20 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 30,
    },
    title: {
        fontSize: 22,
        fontFamily: 'Inter_700Bold',
        marginLeft: 4,
        letterSpacing: -0.3,
    },
    card: {
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        borderWidth: 1,
    },
    iconContainer: {
        marginBottom: 16,
        padding: 16,
        borderRadius: 50,
    },
    warningText: {
        textAlign: 'center',
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 24,
    },
    sectionRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    refreshButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    refreshButtonText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    loadingWrap: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 8,
    },
    loadingText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    errorBanner: {
        width: '100%',
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    errorText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 16,
    },
    boxListWrap: {
        width: '100%',
        marginBottom: 14,
        gap: 8,
    },
    emptyText: {
        fontSize: 12,
        fontStyle: 'italic',
    },
    boxItem: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    boxItemMain: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 8,
    },
    boxTextWrap: {
        flex: 1,
    },
    boxTitle: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
    },
    boxMeta: {
        marginTop: 2,
        fontSize: 11,
        fontFamily: 'Inter_500Medium',
    },
    activePill: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    activePillText: {
        fontSize: 10,
        fontFamily: 'Inter_700Bold',
    },
    input: {
        width: '100%',
        marginBottom: 16,
    },
    button: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
    },
    buttonText: {
        color: '#FFFFFF',
        fontFamily: 'Inter_700Bold',
        fontSize: 15,
    },
    progressWrap: {
        width: '100%',
        marginTop: 12,
    },
    progressText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        marginBottom: 6,
    },
    progressBar: {
        height: 6,
        borderRadius: 6,
    },
    successBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 14,
        marginTop: 24,
        borderWidth: 1,
    },
    successText: {
        marginLeft: 12,
        fontFamily: 'Inter_700Bold',
        flex: 1,
        fontSize: 14,
    },
});
