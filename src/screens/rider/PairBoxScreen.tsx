import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, Surface, Text, useTheme } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    PairingMode,
    PairingQrPayload,
    pairBoxWithRider,
    parsePairingQr,
} from '../../services/boxPairingService';

const DEMO_RIDER_ID = 'RIDER_001';
const SESSION_OPTIONS = [4, 12, 24];

export default function PairBoxScreen() {
    const theme = useTheme();
    const [permission, requestPermission] = useCameraPermissions();
    const [scannedPayload, setScannedPayload] = useState<PairingQrPayload | null>(null);
    const [scanLocked, setScanLocked] = useState(false);
    const [mode, setMode] = useState<PairingMode>('SESSION');
    const [sessionHours, setSessionHours] = useState<number>(24);
    const [isPairing, setIsPairing] = useState(false);

    const canScan = permission?.granted && !scanLocked && !isPairing;

    const derivedMode = useMemo<PairingMode>(() => {
        return scannedPayload?.mode ?? mode;
    }, [mode, scannedPayload?.mode]);

    const derivedSessionHours = useMemo<number>(() => {
        return scannedPayload?.sessionHours ?? sessionHours;
    }, [scannedPayload?.sessionHours, sessionHours]);

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
            setScanLocked(true);
        },
        [scanLocked]
    );

    const handlePair = useCallback(async () => {
        if (!scannedPayload?.boxId) {
            return;
        }

        try {
            setIsPairing(true);
            await pairBoxWithRider({
                boxId: scannedPayload.boxId,
                riderId: DEMO_RIDER_ID,
                mode: derivedMode,
                pairToken: scannedPayload.token,
                sessionHours: derivedMode === 'SESSION' ? derivedSessionHours : undefined,
            });
            Alert.alert('Paired', `Box ${scannedPayload.boxId} is now linked to your rider account.`);
        } catch (error) {
            Alert.alert('Pairing Failed', 'Please try scanning again.');
        } finally {
            setIsPairing(false);
        }
    }, [derivedMode, derivedSessionHours, scannedPayload?.boxId, scannedPayload?.token]);

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
        <View style={styles.container}>
            <Surface style={styles.header} elevation={2}>
                <Text variant="titleLarge" style={{ fontWeight: 'bold' }}>Pair a Smart Box</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Scan the QR on the box to link it to your rider account.
                </Text>
            </Surface>

            <Card style={styles.scannerCard} mode="elevated">
                <CameraView
                    style={styles.camera}
                    onBarcodeScanned={canScan ? handleBarcode : undefined}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                />
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
                            }}
                        >
                            Scan Again
                        </Button>
                        <Button
                            mode="contained"
                            loading={isPairing}
                            disabled={isPairing}
                            onPress={handlePair}
                        >
                            Pair Box
                        </Button>
                    </Card.Actions>
                </Card>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
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
    camera: {
        height: 280,
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
});
