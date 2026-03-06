import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Chip, Divider, Text, useTheme } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
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
import { useAppTheme } from '../../context/ThemeContext';
import { PremiumAlert } from '../../services/PremiumAlertService';

const lightC = {
    bg: '#F7F7F8', card: '#FFFFFF', text: '#111111', textSec: '#6B6B6B', textTer: '#9E9E9E',
    accent: '#111111', accentText: '#FFFFFF', border: '#E5E5E5', divider: '#F0F0F0',
    search: '#F2F2F3', greenBg: '#F0FFF0', greenText: '#2E7D32',
    redBg: '#FFF0F0', redText: '#D32F2F', orangeBg: '#FFF8E1', orangeText: '#E65100',
    blueBg: '#EEF4FF', blueText: '#1565C0',
};
const darkC = {
    bg: '#0D0D0D', card: '#1A1A1A', text: '#F5F5F5', textSec: '#A0A0A0', textTer: '#666666',
    accent: '#FFFFFF', accentText: '#000000', border: '#2A2A2A', divider: '#222222',
    search: '#1E1E1E', greenBg: '#0D2818', greenText: '#66BB6A',
    redBg: '#2C1616', redText: '#FF6B6B', orangeBg: '#2C2010', orangeText: '#FFB74D',
    blueBg: '#162040', blueText: '#64B5F6',
};

export default function PairBoxScreen() {
    const theme = useTheme();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
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
    const [driftWarning, setDriftWarning] = useState(false);
    const [driftDistanceKm, setDriftDistanceKm] = useState<string | null>(null);

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

    useEffect(() => {
        if (!authedUserId) return;

        startPairingExpirationMonitor(authedUserId, (event) => {
            if (event.type === 'EXPIRED') {
                setExpirationWarning(false);
                setDriftWarning(false);
                PremiumAlert.alert(
                    'Session Expired',
                    `Your pairing with Box ${event.boxId} has expired and has been automatically removed.`,
                );
            } else if (event.type === 'WARNING') {
                setExpirationWarning(true);
            } else if (event.type === 'DRIFT_EXPIRED') {
                setDriftWarning(false);
                setExpirationWarning(false);
                const distKm = event.distanceMeters
                    ? `${(event.distanceMeters / 1000).toFixed(1)} km`
                    : 'far';
                PremiumAlert.alert(
                    'Pairing Removed — Too Far',
                    `Your pairing with Box ${event.boxId} was automatically removed because you and the box are ${distKm} apart.`,
                );
            } else if (event.type === 'DRIFT_WARNING') {
                setDriftWarning(true);
                if (event.distanceMeters) {
                    setDriftDistanceKm((event.distanceMeters / 1000).toFixed(1));
                }
            }
        });

        return () => stopPairingExpirationMonitor();
    }, [authedUserId]);

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
            if (scanLocked) return;

            const parsed = parsePairingQr(data);
            if (!parsed?.boxId) {
                PremiumAlert.alert('Invalid QR', 'Unable to read a box ID from this code.');
                return;
            }

            setScannedPayload(parsed);

            if (authedUserId) {
                AsyncStorage.setItem(`${PAIRED_BOX_CACHE_KEY_PREFIX}${authedUserId}`, parsed.boxId).catch(() => undefined);
            }

            if (parsed.mode) setMode(parsed.mode);
            if (typeof parsed.sessionHours === 'number' && Number.isFinite(parsed.sessionHours) && parsed.sessionHours > 0) {
                setSessionHours(parsed.sessionHours);
            }
            setScanLocked(true);
        },
        [authedUserId, scanLocked]
    );

    const handlePair = useCallback(async () => {
        if (!scannedPayload?.boxId) return;

        if (!authedUserId) {
            PremiumAlert.alert('Not Logged In', 'Please log in to pair a box.');
            return;
        }

        if (authedRole && authedRole === 'customer') {
            PremiumAlert.alert('Wrong Account', 'Please log in with a rider or admin account to pair a box.');
            return;
        }

        try {
            setIsPairing(true);

            // Get rider's current GPS for proximity check
            // Admin accounts bypass the proximity check
            let riderLocation: { latitude: number; longitude: number } | undefined;
            const isAdmin = authedRole === 'admin';

            if (!isAdmin) {
                try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status === 'granted') {
                        const position = await Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.Balanced,
                        });
                        riderLocation = {
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                        };
                    }
                } catch {
                    // If location fails, proceed without proximity check
                    console.warn('[PairBox] Could not get rider location for proximity check');
                }
            }

            await pairBoxWithRider({
                boxId: scannedPayload.boxId,
                riderId: authedUserId,
                mode: derivedMode,
                pairToken: scannedPayload.token,
                sessionHours: derivedMode === 'SESSION' ? derivedSessionHours : undefined,
                riderLocation,
                skipProximityCheck: isAdmin,
            });
            setDriftWarning(false);
            PremiumAlert.alert('Paired', `Box ${scannedPayload.boxId} is now linked to your account.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Please try scanning again.';
            PremiumAlert.alert('Pairing Failed', message);
        } finally {
            setIsPairing(false);
        }
    }, [authedRole, authedUserId, derivedMode, derivedSessionHours, scannedPayload?.boxId, scannedPayload?.token]);

    const handleUnpair = useCallback(async () => {
        const boxIdToUnpair = scannedPayload?.boxId || pairingState?.box_id;
        if (!boxIdToUnpair || !authedUserId) return;

        PremiumAlert.alert(
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
                            PremiumAlert.alert('Unpaired', `Box ${boxIdToUnpair} is no longer linked to your account.`);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : 'Please try again.';
                            PremiumAlert.alert('Unpair Failed', message);
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
            <View style={[styles.centered, { backgroundColor: c.bg }]}>
                <Text style={{ color: c.textSec }}>Requesting camera permission...</Text>
            </View>
        );
    }

    if (!permission.granted) {
        return (
            <View style={[styles.centered, { backgroundColor: c.bg }]}>
                <MaterialCommunityIcons name="qrcode-scan" size={48} color={c.accent} />
                <Text style={{ marginTop: 12, color: c.textSec }}>Camera permission is required to scan box QR codes.</Text>
                <Button mode="contained" style={{ marginTop: 16 }} buttonColor={c.accent} textColor={c.accentText} onPress={requestPermission}>
                    Enable Camera
                </Button>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.header, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
                <Text variant="titleLarge" style={{ fontWeight: 'bold', color: c.text }}>Pair a Smart Box</Text>
                <Text variant="bodySmall" style={{ color: c.textSec }}>
                    Scan the QR on the box to link it to your account.
                </Text>
            </View>

            {/* Drift Warning Banner */}
            {driftWarning && isPairingActive(pairingState) && (
                <View style={[styles.driftBanner, { backgroundColor: c.orangeBg, borderColor: c.orangeText }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MaterialCommunityIcons name="map-marker-alert-outline" size={20} color={c.orangeText} />
                        <Text style={{ marginLeft: 8, fontWeight: 'bold', color: c.orangeText, flex: 1 }}>
                            Far from your box{driftDistanceKm ? ` (${driftDistanceKm} km away)` : ''}
                        </Text>
                    </View>
                    <Text style={{ marginTop: 4, fontSize: 12, color: c.orangeText }}>
                        You appear to be far from your paired box. If this continues, the pairing will be automatically removed.
                    </Text>
                </View>
            )}

            {/* Show current pairing status if already paired */}
            {isPairingActive(pairingState) && !scannedPayload && (
                <View style={[styles.payloadCard, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
                    <View style={{ padding: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <MaterialCommunityIcons name="link-variant" size={24} color={c.greenText} />
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', marginLeft: 8, color: c.text }}>
                                Currently Paired
                            </Text>
                        </View>
                        <Text style={{ marginTop: 8, color: c.text }}>Box ID: {pairingState.box_id}</Text>
                        <Text style={{ marginTop: 4, color: c.textSec }}>
                            Mode: {pairingState.mode === 'ONE_TIME' ? 'One-time' : 'Session'}
                        </Text>
                        {pairingState.mode === 'SESSION' && pairingState.expires_at && (
                            <>
                                <Text style={{ marginTop: 4, color: c.textSec }}>
                                    Expires: {parseUTCString(pairingState.expires_at).toLocaleString('en-US', { timeZone: 'Asia/Manila' })}
                                </Text>
                                <View style={[
                                    styles.countdownRow,
                                    { backgroundColor: expirationWarning ? c.orangeBg : c.search },
                                ]}>
                                    <MaterialCommunityIcons
                                        name={expirationWarning ? 'clock-alert-outline' : 'clock-outline'}
                                        size={18}
                                        color={expirationWarning ? c.orangeText : c.textSec}
                                    />
                                    <Text style={{
                                        marginLeft: 6,
                                        fontWeight: expirationWarning ? 'bold' : 'normal',
                                        color: expirationWarning ? c.orangeText : c.textSec,
                                    }}>
                                        {remainingMs !== null && remainingMs > 0
                                            ? `Time remaining: ${formatRemainingTime(remainingMs)}`
                                            : 'Session expired'}
                                    </Text>
                                </View>
                                {expirationWarning && (
                                    <Text style={{ marginTop: 4, color: c.orangeText, fontSize: 12 }}>
                                        Your session is expiring soon. The box will auto-unpair when time runs out.
                                    </Text>
                                )}
                            </>
                        )}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 16 }}>
                        <Button
                            mode="outlined"
                            style={{ borderColor: c.redText }}
                            textColor={c.redText}
                            disabled={isPairing}
                            loading={isPairing}
                            onPress={handleUnpair}
                        >
                            Unpair Box
                        </Button>
                    </View>
                </View>
            )}

            {/* Only show scanner if not paired or if they want to pair a different box */}
            {(!isPairingActive(pairingState) || scannedPayload) && (
                <>
                    <View style={[styles.scannerCard, { borderWidth: 1, borderColor: c.border }]}>
                        <View style={styles.cameraContainer}>
                            <CameraView
                                style={styles.camera}
                                onBarcodeScanned={canScan ? handleBarcode : undefined}
                                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                            />
                            <View pointerEvents="none" style={styles.qrGuide} />
                        </View>
                        {!canScan && (
                            <View style={styles.cameraOverlay}>
                                <Text style={{ color: 'white' }}>Scan paused</Text>
                            </View>
                        )}
                    </View>

                    {scannedPayload && (
                        <View style={[styles.payloadCard, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
                            <View style={{ padding: 16 }}>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.text }}>Scan Result</Text>
                                <Text style={{ marginTop: 8, color: c.text }}>Box ID: {scannedPayload.boxId}</Text>
                                {scannedPayload.token && (
                                    <Text style={{ marginTop: 4, color: c.textSec }}>
                                        Token: {scannedPayload.token.slice(0, 6)}•••
                                    </Text>
                                )}

                                <View style={{ height: 1, backgroundColor: c.divider, marginVertical: 12 }} />

                                <Text variant="titleSmall" style={{ marginBottom: 8, color: c.text }}>Pairing Mode</Text>
                                <View style={styles.modeRow}>
                                    <Chip
                                        selected={derivedMode === 'ONE_TIME'}
                                        onPress={() => setMode('ONE_TIME')}
                                        style={[styles.modeChip, { backgroundColor: derivedMode === 'ONE_TIME' ? c.accent : c.search, borderWidth: 1, borderColor: derivedMode === 'ONE_TIME' ? c.accent : c.border }]}
                                        textStyle={{ color: derivedMode === 'ONE_TIME' ? c.accentText : c.text }}
                                        showSelectedCheck={false}
                                    >
                                        One-time
                                    </Chip>
                                    <Chip
                                        selected={derivedMode === 'SESSION'}
                                        onPress={() => setMode('SESSION')}
                                        style={[styles.modeChip, { backgroundColor: derivedMode === 'SESSION' ? c.accent : c.search, borderWidth: 1, borderColor: derivedMode === 'SESSION' ? c.accent : c.border }]}
                                        textStyle={{ color: derivedMode === 'SESSION' ? c.accentText : c.text }}
                                        showSelectedCheck={false}
                                    >
                                        Session
                                    </Chip>
                                </View>

                                {derivedMode === 'SESSION' && (
                                    <>
                                        <Text variant="titleSmall" style={{ marginTop: 12, color: c.text }}>Session Duration</Text>
                                        <View style={styles.modeRow}>
                                            {SESSION_OPTIONS.map((hours) => (
                                                <Chip
                                                    key={hours}
                                                    selected={derivedSessionHours === hours}
                                                    onPress={() => setSessionHours(hours)}
                                                    style={[styles.modeChip, { backgroundColor: derivedSessionHours === hours ? c.accent : c.search, borderWidth: 1, borderColor: derivedSessionHours === hours ? c.accent : c.border }]}
                                                    textStyle={{ color: derivedSessionHours === hours ? c.accentText : c.text }}
                                                    showSelectedCheck={false}
                                                >
                                                    {hours}h
                                                </Chip>
                                            ))}
                                        </View>
                                    </>
                                )}
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16 }}>
                                <Button
                                    mode="outlined"
                                    style={{ borderColor: c.border }}
                                    textColor={c.text}
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
                                        style={{ borderColor: c.redText }}
                                        textColor={c.redText}
                                        disabled={isPairing}
                                        onPress={handleUnpair}
                                    >
                                        Unpair
                                    </Button>
                                ) : (
                                    <Button
                                        mode="contained"
                                        buttonColor={c.accent}
                                        textColor={c.accentText}
                                        loading={isPairing}
                                        disabled={isPairing}
                                        onPress={handlePair}
                                    >
                                        Pair Box
                                    </Button>
                                )}
                            </View>
                        </View>
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 20,
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
        marginTop: 4,
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
    },
    driftBanner: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
    },
});
