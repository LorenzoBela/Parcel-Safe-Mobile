import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, Surface, Text, useTheme } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import useAuthStore from '../../store/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    BoxPairingState,
    PairingMode,
    PairingQrPayload,
    isPairingActive,
    pairBoxWithRider,
    parsePairingQr,
    revokePairing,
    subscribeToRiderPairing,
    startPairingExpirationMonitor,
    stopPairingExpirationMonitor,
    getPairingRemainingMs,
    formatRemainingTime,
} from '../../services/boxPairingService';
import { stopBackgroundLocation } from '../../services/backgroundLocationService';

const SESSION_OPTIONS = [4, 12, 24, 48];
const PAIRED_BOX_CACHE_KEY_PREFIX = 'parcelSafe:lastPairedBoxId:';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseUTCString } from '../../utils/date';

export default function PairBoxScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const authedRole = useAuthStore((state: any) => state.role) as string | null;
    const [permission, requestPermission] = useCameraPermissions();
    const [scannedPayload, setScannedPayload] = useState<PairingQrPayload | null>(null);
    const [scanLocked, setScanLocked] = useState(false);
    const [mode, setMode] = useState<PairingMode>('SESSION');
    const [sessionHours, setSessionHours] = useState<number>(24);
    const [isPairing, setIsPairing] = useState(false);
    const [pairingState, setPairingState] = useState<BoxPairingState | null>(null);
    const [remainingMs, setRemainingMs] = useState<number | null>(null);
    const [expirationWarning, setExpirationWarning] = useState(false);

    const canScan = permission?.granted && !scanLocked && !isPairing;

    const derivedMode = mode;
    const derivedSessionHours = sessionHours;

    useEffect(() => {
        if (!authedUserId) {
            setPairingState(null);
            return;
        }
        const unsubscribe = subscribeToRiderPairing(authedUserId, (state) => {
            setPairingState(state);
        });
        return unsubscribe;
    }, [authedUserId]);

    // Start background expiration monitor when rider is authenticated.
    useEffect(() => {
        if (!authedUserId) return;

        startPairingExpirationMonitor(authedUserId, (event) => {
            if (event.type === 'EXPIRED') {
                setExpirationWarning(false);
                Alert.alert(
                    'Session Expired',
                    `Your pairing with Box ${event.boxId} has expired and has been automatically removed.`,
                );
            } else if (event.type === 'WARNING') {
                setExpirationWarning(true);
            }
        });

        return () => stopPairingExpirationMonitor();
    }, [authedUserId]);

    // Update countdown timer every 30 seconds.
    useEffect(() => {
        const update = () => setRemainingMs(getPairingRemainingMs(pairingState));
        update();
        const interval = setInterval(update, 30_000);
        return () => clearInterval(interval);
    }, [pairingState]);

    const isScannedBoxPairedToMe = useMemo(() => {
        if (!scannedPayload?.boxId) return false;
        if (!isPairingActive(pairingState)) return false;
        return pairingState?.box_id === scannedPayload.boxId;
    }, [pairingState, scannedPayload?.boxId]);

    const handleBarcode = useCallback(
        ({ data }: { data: string }) => {
            if (scanLocked) {
                return;
            }

            const parsed = parsePairingQr(data);
            if (!parsed?.boxId) {
                Alert.alert('Invalid QR', 'Unable to read a box ID from this code.');
                return;
            }

            setScannedPayload(parsed);

            // Cache boxId early so other screens have a fallback pointer even before pairing is confirmed.
            if (authedUserId) {
                AsyncStorage.setItem(`${PAIRED_BOX_CACHE_KEY_PREFIX}${authedUserId}`, parsed.boxId).catch(() => undefined);
            }

            // Seed the UI from the QR once, but allow the user to override after scan.
            if (parsed.mode) {
                setMode(parsed.mode);
            }
            if (typeof parsed.sessionHours === 'number' && Number.isFinite(parsed.sessionHours) && parsed.sessionHours > 0) {
                setSessionHours(parsed.sessionHours);
            }
            setScanLocked(true);
        },
        [authedUserId, scanLocked]
    );

    const handlePair = useCallback(async () => {
        if (!scannedPayload?.boxId) {
            return;
        }

        if (!authedUserId) {
            Alert.alert('Not Logged In', 'Please log in to pair a box.');
            return;
        }

        // Allow riders and admins to pair (customers should not be able to claim hardware).
        if (authedRole && authedRole === 'customer') {
            Alert.alert('Wrong Account', 'Please log in with a rider or admin account to pair a box.');
            return;
        }

        try {
            setIsPairing(true);
            await pairBoxWithRider({
                boxId: scannedPayload.boxId,
                riderId: authedUserId,
                mode: derivedMode,
                pairToken: scannedPayload.token,
                sessionHours: derivedMode === 'SESSION' ? derivedSessionHours : undefined,
            });
            Alert.alert('Paired', `Box ${scannedPayload.boxId} is now linked to your account.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Please try scanning again.';
            Alert.alert('Pairing Failed', message);
        } finally {
            setIsPairing(false);
        }
    }, [authedRole, authedUserId, derivedMode, derivedSessionHours, scannedPayload?.boxId, scannedPayload?.token]);

    const handleUnpair = useCallback(async () => {
        const boxIdToUnpair = scannedPayload?.boxId || pairingState?.box_id;
        if (!boxIdToUnpair || !authedUserId) return;

        Alert.alert(
            'Unpair Box',
            `Unpair Box ${boxIdToUnpair} from your account?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Unpair',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setIsPairing(true);
                            await revokePairing(boxIdToUnpair, authedUserId);
                            await AsyncStorage.removeItem(`${PAIRED_BOX_CACHE_KEY_PREFIX}${authedUserId}`);
                            stopBackgroundLocation();
                            setScannedPayload(null);
                            setScanLocked(false);
                            Alert.alert('Unpaired', `Box ${boxIdToUnpair} is no longer linked to your account.`);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : 'Please try again.';
                            Alert.alert('Unpair Failed', message);
                        } finally {
                            setIsPairing(false);
                        }
                    },
                },
            ]
        );
    }, [authedUserId, scannedPayload?.boxId, pairingState?.box_id]);

    if (!permission) {
        return (
            <View style={styles.centered}>
                <Text>Requesting camera permission...</Text>
            </View>
        );
    }

    if (!permission.granted) {
        return (
            <View style={styles.centered}>
                <MaterialCommunityIcons name="qrcode-scan" size={48} color={theme.colors.primary} />
                <Text style={{ marginTop: 12 }}>Camera permission is required to scan box QR codes.</Text>
                <Button mode="contained" style={{ marginTop: 16 }} onPress={requestPermission}>
                    Enable Camera
                </Button>
            </View>
        );
    }

    return (
        <View style={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>
            <Surface style={styles.header} elevation={2}>
                <Text variant="titleLarge" style={{ fontWeight: 'bold' }}>Pair a Smart Box</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Scan the QR on the box to link it to your account.
                </Text>
            </Surface>

            {/* Show current pairing status if already paired */}
            {isPairingActive(pairingState) && !scannedPayload && (
                <Card style={styles.payloadCard} mode="elevated">
                    <Card.Content>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <MaterialCommunityIcons name="link-variant" size={24} color={theme.colors.primary} />
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', marginLeft: 8 }}>
                                Currently Paired
                            </Text>
                        </View>
                        <Text style={{ marginTop: 8 }}>Box ID: {pairingState.box_id}</Text>
                        <Text style={{ marginTop: 4, color: theme.colors.onSurfaceVariant }}>
                            Mode: {pairingState.mode === 'ONE_TIME' ? 'One-time' : 'Session'}
                        </Text>
                        {pairingState.mode === 'SESSION' && pairingState.expires_at && (
                            <>
                                <Text style={{ marginTop: 4, color: theme.colors.onSurfaceVariant }}>
                                    Expires: {parseUTCString(pairingState.expires_at).toLocaleString('en-US', { timeZone: 'Asia/Manila' })}
                                </Text>
                                <View style={[
                                    styles.countdownRow,
                                    expirationWarning && { backgroundColor: '#FEF3C7' },
                                ]}>
                                    <MaterialCommunityIcons
                                        name={expirationWarning ? 'clock-alert-outline' : 'clock-outline'}
                                        size={18}
                                        color={expirationWarning ? '#D97706' : theme.colors.onSurfaceVariant}
                                    />
                                    <Text style={{
                                        marginLeft: 6,
                                        fontWeight: expirationWarning ? 'bold' : 'normal',
                                        color: expirationWarning ? '#D97706' : theme.colors.onSurfaceVariant,
                                    }}>
                                        {remainingMs !== null && remainingMs > 0
                                            ? `Time remaining: ${formatRemainingTime(remainingMs)}`
                                            : 'Session expired'}
                                    </Text>
                                </View>
                                {expirationWarning && (
                                    <Text style={{ marginTop: 4, color: '#D97706', fontSize: 12 }}>
                                        Your session is expiring soon. The box will auto-unpair when time runs out.
                                    </Text>
                                )}
                            </>
                        )}
                    </Card.Content>
                    <Card.Actions style={{ justifyContent: 'flex-end', padding: 16 }}>
                        <Button
                            mode="outlined"
                            style={{ borderColor: theme.colors.error }}
                            textColor={theme.colors.error}
                            disabled={isPairing}
                            loading={isPairing}
                            onPress={handleUnpair}
                        >
                            Unpair Box
                        </Button>
                    </Card.Actions>
                </Card>
            )}

            {/* Only show scanner if not paired or if they want to pair a different box */}
            {(!isPairingActive(pairingState) || scannedPayload) && (
                <>
                    <Card style={styles.scannerCard} mode="elevated">
                        <View style={styles.cameraContainer}>
                            <CameraView
                                style={styles.camera}
                                onBarcodeScanned={canScan ? handleBarcode : undefined}
                                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                            />
                            {/* Visual guide only */}
                            <View pointerEvents="none" style={styles.qrGuide} />
                        </View>
                        {!canScan && (
                            <View style={styles.cameraOverlay}>
                                <Text style={{ color: 'white' }}>Scan paused</Text>
                            </View>
                        )}
                    </Card>

                    {scannedPayload && (
                        <Card style={styles.payloadCard} mode="elevated">
                            <Card.Content>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Scan Result</Text>
                                <Text style={{ marginTop: 8 }}>Box ID: {scannedPayload.boxId}</Text>
                                {scannedPayload.token && (
                                    <Text style={{ marginTop: 4, color: theme.colors.onSurfaceVariant }}>
                                        Token: {scannedPayload.token.slice(0, 6)}•••
                                    </Text>
                                )}

                                <Divider style={{ marginVertical: 12 }} />

                                <Text variant="titleSmall" style={{ marginBottom: 8 }}>Pairing Mode</Text>
                                <View style={styles.modeRow}>
                                    <Chip
                                        selected={derivedMode === 'ONE_TIME'}
                                        onPress={() => setMode('ONE_TIME')}
                                        style={styles.modeChip}
                                    >
                                        One-time
                                    </Chip>
                                    <Chip
                                        selected={derivedMode === 'SESSION'}
                                        onPress={() => setMode('SESSION')}
                                        style={styles.modeChip}
                                    >
                                        Session
                                    </Chip>
                                </View>

                                {derivedMode === 'SESSION' && (
                                    <>
                                        <Text variant="titleSmall" style={{ marginTop: 12 }}>Session Duration</Text>
                                        <View style={styles.modeRow}>
                                            {SESSION_OPTIONS.map((hours) => (
                                                <Chip
                                                    key={hours}
                                                    selected={derivedSessionHours === hours}
                                                    onPress={() => setSessionHours(hours)}
                                                    style={styles.modeChip}
                                                >
                                                    {hours}h
                                                </Chip>
                                            ))}
                                        </View>
                                    </>
                                )}
                            </Card.Content>
                            <Card.Actions style={{ justifyContent: 'space-between', padding: 16 }}>
                                <Button
                                    mode="outlined"
                                    onPress={() => {
                                        setScannedPayload(null);
                                        setScanLocked(false);
                                        setMode('SESSION');
                                        setSessionHours(24);
                                    }}
                                >
                                    Scan Again
                                </Button>
                                {isScannedBoxPairedToMe ? (
                                    <Button
                                        mode="outlined"
                                        disabled={isPairing}
                                        onPress={handleUnpair}
                                    >
                                        Unpair
                                    </Button>
                                ) : (
                                    <Button
                                        mode="contained"
                                        loading={isPairing}
                                        disabled={isPairing}
                                        onPress={handlePair}
                                    >
                                        Pair Box
                                    </Button>
                                )}
                            </Card.Actions>
                        </Card>
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    header: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    scannerCard: {
        overflow: 'hidden',
        borderRadius: 16,
        marginBottom: 16,
    },
    cameraContainer: {
        position: 'relative',
    },
    camera: {
        height: 280,
    },
    qrGuide: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 200,
        height: 200,
        marginLeft: -100,
        marginTop: -100,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.9)',
        borderRadius: 12,
    },
    cameraOverlay: {
        position: 'absolute',
        bottom: 12,
        left: 12,
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
    },
    payloadCard: {
        borderRadius: 16,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    modeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    modeChip: {
        marginRight: 8,
        marginBottom: 8,
    },
    countdownRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
    },
});
