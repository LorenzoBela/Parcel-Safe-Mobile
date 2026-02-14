import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Share } from 'react-native';
import { Text, Card, Avatar, Button, Surface, IconButton, Modal, Portal, TextInput, Chip, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { getDeliveryByIdOrTracking, listSmartBoxes, markDeliveryComplete, SmartBoxSummary } from '../../services/supabaseClient';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import useAuthStore from '../../store/authStore';
import { BoxPairingState, isPairingActive, subscribeToRiderPairing } from '../../services/boxPairingService';
import * as Location from 'expo-location';
import { fetchWeather, WeatherData } from '../../services/weatherService';

function formatRemainingMs(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0m';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

export default function AdminDashboard() {
    const navigation = useNavigation<any>();
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [overrideModalVisible, setOverrideModalVisible] = useState(false);
    const [pairQrModalVisible, setPairQrModalVisible] = useState(false);
    const [trackingInput, setTrackingInput] = useState('');
    const [reasonInput, setReasonInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [pairBoxId, setPairBoxId] = useState('');
    const [availableBoxes, setAvailableBoxes] = useState<SmartBoxSummary[]>([]);
    const [boxesLoading, setBoxesLoading] = useState(false);
    const [pairMode, setPairMode] = useState<'ONE_TIME' | 'SESSION'>('SESSION');
    const [sessionHours, setSessionHours] = useState(24);
    const [pairToken, setPairToken] = useState('');
    const qrRef = useRef<any>(null);

    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const [pairingState, setPairingState] = useState<BoxPairingState | null>(null);
    const isPaired = isPairingActive(pairingState);

    useEffect(() => {
        if (!authedUserId) return;
        const unsubscribe = subscribeToRiderPairing(authedUserId, (state) => {
            setPairingState(state);
        });
        return unsubscribe;
    }, [authedUserId]);

    const pairingPayload = useMemo(() => {
        if (!pairBoxId.trim()) return '';
        const params = new URLSearchParams({
            boxId: pairBoxId.trim(),
            token: pairToken,
            mode: pairMode,
        });
        if (pairMode === 'SESSION') {
            params.set('sessionHours', String(sessionHours));
        }
        return `parcelsafe://pair?${params.toString()}`;
    }, [pairBoxId, pairMode, pairToken, sessionHours]);

    const generatePairToken = () => {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            return crypto.randomUUID();
        }
        return Math.random().toString(36).slice(2, 10);
    };

    const openPairQrModal = async () => {
        setPairToken(generatePairToken());
        setPairMode('SESSION');
        setSessionHours(24);
        setPairQrModalVisible(true);

        setBoxesLoading(true);
        try {
            const boxes = await listSmartBoxes();
            setAvailableBoxes(boxes);

            // Match web UX (QR is generated for a known box): auto-pick a box so QR renders immediately.
            if (!pairBoxId.trim() && boxes.length > 0) {
                setPairBoxId(boxes[0].id);
            }
        } catch (e) {
            setAvailableBoxes([]);
        } finally {
            setBoxesLoading(false);
        }
    };

    const copyPairingPayload = async () => {
        if (!pairingPayload) {
            Alert.alert('Missing Box ID', 'Enter a box ID to generate a payload.');
            return;
        }
        await Clipboard.setStringAsync(pairingPayload);
        Alert.alert('Copied', 'Pairing payload copied to clipboard.');
    };

    const sharePairingPayload = async () => {
        if (!pairingPayload) {
            Alert.alert('Missing Box ID', 'Enter a box ID to generate a payload.');
            return;
        }
        await Share.share({ message: pairingPayload });
    };

    const shareQrImage = async () => {
        if (!pairingPayload || !qrRef.current?.toDataURL) {
            Alert.alert('QR Not Ready', 'Generate a QR first.');
            return;
        }

        qrRef.current.toDataURL(async (data: string) => {
            try {
                const fileUri = `${FileSystem.cacheDirectory}pairing-qr-${pairBoxId || 'box'}.png`;
                await FileSystem.writeAsStringAsync(fileUri, data, { encoding: FileSystem.EncodingType.Base64 });
                await Share.share({ url: fileUri, message: pairingPayload });
            } catch (error) {
                await Share.share({ message: pairingPayload });
            }
        });
    };

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(dayjs());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    // EC-03: Handle manual delivery completion
    const handleOverrideDelivery = async () => {
        if (!trackingInput.trim()) {
            Alert.alert('Error', 'Please enter a tracking number or delivery ID');
            return;
        }
        if (!reasonInput.trim()) {
            Alert.alert('Error', 'Please provide a reason for manual completion');
            return;
        }

        setIsProcessing(true);

        // First verify the delivery exists
        const delivery = await getDeliveryByIdOrTracking(trackingInput.trim());
        if (!delivery) {
            Alert.alert('Not Found', 'No delivery found with that tracking number');
            setIsProcessing(false);
            return;
        }

        if (delivery.status === 'COMPLETED') {
            Alert.alert('Already Complete', 'This delivery is already marked as completed');
            setIsProcessing(false);
            return;
        }

        // Confirm before proceeding
        Alert.alert(
            'Confirm Override',
            `Mark delivery ${delivery.tracking_number} as COMPLETED?\n\nReason: ${reasonInput}`,
            [
                { text: 'Cancel', style: 'cancel', onPress: () => setIsProcessing(false) },
                {
                    text: 'Confirm',
                    style: 'destructive',
                    onPress: async () => {
                        const success = await markDeliveryComplete(trackingInput.trim(), reasonInput.trim());
                        setIsProcessing(false);
                        setOverrideModalVisible(false);

                        if (success) {
                            Alert.alert('Success', 'Delivery marked as complete');
                            setTrackingInput('');
                            setReasonInput('');
                        } else {
                            Alert.alert('Error', 'Failed to update delivery. Please try again.');
                        }
                    }
                }
            ]
        );
    };

    // Live weather state
    const [weather, setWeather] = useState<WeatherData | null>(null);

    // Fetch device location and weather
    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({});
            const data = await fetchWeather(loc.coords.latitude, loc.coords.longitude);
            if (data) setWeather(data);
        })();
    }, []);

    const stats = [
        { label: 'Total Deliveries', value: '--', icon: 'truck-check', color: '#4CAF50' },
        { label: 'Tamper Events', value: '--', icon: 'alert-circle', color: '#F44336' },
        { label: 'Active Riders', value: '--', icon: 'motorbike', color: '#2196F3' },
        { label: 'Open Cases', value: '--', icon: 'folder-open', color: '#FF9800' },
    ];

    const StatCard = ({ label, value, icon, color }) => (
        <Surface style={styles.statCard} elevation={2}>
            <View style={[styles.statIcon, { backgroundColor: color + '20' }]}>
                <MaterialCommunityIcons name={icon} size={24} color={color} />
            </View>
            <Text variant="headlineSmall" style={{ fontWeight: 'bold', marginTop: 8 }}>{value}</Text>
            <Text variant="bodySmall" style={{ color: '#666' }}>{label}</Text>
        </Surface>
    );

    return (
        <View style={styles.container}>
            {/* Attractive Header */}
            <View style={styles.headerBackground}>
                <View style={styles.headerContent}>
                    <View>
                        <Text style={styles.dateText}>{currentTime.format('dddd, MMMM D')}</Text>
                        <Text style={styles.timeText}>{currentTime.format('h:mm A')}</Text>
                    </View>
                    {weather && (
                        <View style={styles.weatherContainer}>
                            <MaterialCommunityIcons name={weather.icon as any} size={30} color="white" />
                            <Text style={styles.weatherText}>{weather.temp}</Text>
                            <Text style={styles.weatherCondition}>{weather.condition}</Text>
                        </View>
                    )}
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>

                <View style={styles.header}>
                    <Text variant="headlineMedium" style={styles.headerTitle}>Admin Overview</Text>
                    <IconButton icon="refresh" size={24} onPress={() => console.log('Refresh')} />
                </View>

                <Surface style={styles.pairingBanner} elevation={1}>
                    <View style={{ flex: 1 }}>
                        <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>Paired Box</Text>
                        {isPaired ? (
                            <>
                                <Text variant="bodyMedium" style={{ marginTop: 2 }}>
                                    {pairingState?.box_id}
                                </Text>
                                <Text variant="bodySmall" style={{ color: '#666', marginTop: 2 }}>
                                    {pairingState?.mode === 'ONE_TIME' ? 'One-time' : 'Session'}
                                    {pairingState?.expires_at ? ` • ${formatRemainingMs(pairingState.expires_at - Date.now())} left` : ''}
                                </Text>
                            </>
                        ) : (
                            <Text variant="bodySmall" style={{ color: '#666', marginTop: 2 }}>
                                Not paired
                            </Text>
                        )}
                    </View>
                    <Button mode="outlined" onPress={() => navigation.navigate('PairBox')}>
                        Pair
                    </Button>
                </Surface>

                {/* Stats Grid */}
                <View style={styles.statsGrid}>
                    {stats.map((stat, index) => (
                        <StatCard key={index} {...stat} />
                    ))}
                </View>

                {/* Quick Links */}
                <Text variant="titleMedium" style={styles.sectionTitle}>System Management</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickLinksScroll}>
                    <Button
                        mode="contained"
                        icon="map"
                        style={[styles.quickLinkBtn, { backgroundColor: '#3F51B5' }]}
                        onPress={() => navigation.navigate('GlobalMap')}
                    >
                        Live Map
                    </Button>
                    <Button
                        mode="contained"
                        icon="alert"
                        style={[styles.quickLinkBtn, { backgroundColor: '#F44336' }]}
                        onPress={() => navigation.navigate('TamperAlerts')}
                    >
                        Alerts
                    </Button>
                    <Button
                        mode="contained"
                        icon="file-document"
                        style={[styles.quickLinkBtn, { backgroundColor: '#607D8B' }]}
                        onPress={() => navigation.navigate('DeliveryRecords')}
                    >
                        Records
                    </Button>
                    <Button
                        mode="contained"
                        icon="lock-open-alert"
                        style={[styles.quickLinkBtn, { backgroundColor: '#FF5722' }]}
                        onPress={() => navigation.navigate('AdminRemoteUnlock')}
                    >
                        Unlock Box
                    </Button>
                    <Button
                        mode="contained"
                        icon="checkbox-marked-circle-outline"
                        style={[styles.quickLinkBtn, { backgroundColor: '#FF9800' }]}
                        onPress={() => setOverrideModalVisible(true)}
                    >
                        Complete Del.
                    </Button>
                    <Button
                        mode="contained"
                        icon="qrcode"
                        style={[styles.quickLinkBtn, { backgroundColor: '#1D4ED8' }]}
                        onPress={openPairQrModal}
                    >
                        Pair QR
                    </Button>
                </ScrollView>

                {/* EC-03: Override Delivery Modal */}
                <Portal>
                    <Modal
                        visible={overrideModalVisible}
                        onDismiss={() => setOverrideModalVisible(false)}
                        contentContainerStyle={styles.modalContainer}
                    >
                        <Text variant="titleLarge" style={{ fontWeight: 'bold', marginBottom: 16 }}>
                            Manual Delivery Override
                        </Text>
                        <Text variant="bodyMedium" style={{ color: '#666', marginBottom: 16 }}>
                            Use this when box battery died or hardware failed but customer received package.
                        </Text>
                        <TextInput
                            label="Tracking Number / Delivery ID"
                            value={trackingInput}
                            onChangeText={setTrackingInput}
                            mode="outlined"
                            style={{ marginBottom: 12 }}
                        />
                        <TextInput
                            label="Reason for Override"
                            value={reasonInput}
                            onChangeText={setReasonInput}
                            mode="outlined"
                            multiline
                            numberOfLines={2}
                            placeholder="e.g., Battery died, customer confirmed receipt"
                            style={{ marginBottom: 20 }}
                        />
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                            <Button
                                mode="outlined"
                                onPress={() => setOverrideModalVisible(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                onPress={handleOverrideDelivery}
                                loading={isProcessing}
                                disabled={isProcessing}
                                buttonColor="#FF9800"
                            >
                                Complete Delivery
                            </Button>
                        </View>
                    </Modal>
                </Portal>

                {/* Pair QR Modal */}
                <Portal>
                    <Modal
                        visible={pairQrModalVisible}
                        onDismiss={() => setPairQrModalVisible(false)}
                        contentContainerStyle={styles.modalContainer}
                    >
                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            nestedScrollEnabled
                            contentContainerStyle={{ paddingBottom: 8 }}
                        >
                            <Text variant="titleLarge" style={{ fontWeight: 'bold', marginBottom: 12 }}>
                                Generate Pairing QR
                            </Text>
                            <Text variant="bodySmall" style={{ color: '#666', marginBottom: 16 }}>
                                Select a box, choose one-time or session mode, then share or copy the QR payload.
                            </Text>

                            <Text variant="bodySmall" style={{ marginBottom: 8 }}>Select Box</Text>
                            <View style={styles.boxSelectContainer}>
                                {boxesLoading ? (
                                    <Text variant="bodySmall" style={{ color: '#666' }}>Loading boxes…</Text>
                                ) : availableBoxes.length === 0 ? (
                                    <>
                                        <Text variant="bodySmall" style={{ color: '#666', marginBottom: 8 }}>No boxes found.</Text>
                                        <TextInput
                                            label="Box ID (manual)"
                                            value={pairBoxId}
                                            onChangeText={setPairBoxId}
                                            mode="outlined"
                                        />
                                    </>
                                ) : (
                                    <ScrollView
                                        style={styles.boxSelectScroll}
                                        contentContainerStyle={styles.boxSelectContent}
                                        nestedScrollEnabled
                                    >
                                        {availableBoxes.map((box) => (
                                            <Chip
                                                key={box.id}
                                                selected={pairBoxId === box.id}
                                                onPress={() => setPairBoxId(box.id)}
                                                style={styles.boxChip}
                                            >
                                                {box.id}
                                            </Chip>
                                        ))}
                                    </ScrollView>
                                )}
                            </View>

                            <Text variant="bodySmall" style={{ marginBottom: 8 }}>Pairing Mode</Text>
                            <View style={styles.modeRow}>
                                <Chip
                                    selected={pairMode === 'ONE_TIME'}
                                    onPress={() => setPairMode('ONE_TIME')}
                                    style={styles.modeChip}
                                >
                                    One-time
                                </Chip>
                                <Chip
                                    selected={pairMode === 'SESSION'}
                                    onPress={() => setPairMode('SESSION')}
                                    style={styles.modeChip}
                                >
                                    Session
                                </Chip>
                            </View>

                            {pairMode === 'SESSION' && (
                                <View style={{ marginBottom: 8 }}>
                                    <Text variant="bodySmall" style={{ marginBottom: 8 }}>Session Duration</Text>
                                    <View style={styles.modeRow}>
                                        {[4, 12, 24, 48].map((hours) => (
                                            <Chip
                                                key={hours}
                                                selected={sessionHours === hours}
                                                onPress={() => setSessionHours(hours)}
                                                style={styles.modeChip}
                                            >
                                                {hours}h
                                            </Chip>
                                        ))}
                                    </View>
                                </View>
                            )}

                            <View style={styles.tokenRow}>
                                <TextInput
                                    label="Pair Token"
                                    value={pairToken}
                                    mode="outlined"
                                    style={{ flex: 1 }}
                                    editable={false}
                                />
                                <Button mode="outlined" onPress={() => setPairToken(generatePairToken())}>
                                    Regenerate
                                </Button>
                            </View>

                            <Divider style={{ marginVertical: 16 }} />

                            <View style={styles.qrContainer}>
                                {pairingPayload ? (
                                    <QRCode
                                        value={pairingPayload}
                                        size={200}
                                        getRef={(ref) => (qrRef.current = ref)}
                                    />
                                ) : (
                                    <Text style={{ color: '#666' }}>Select a box to render QR</Text>
                                )}
                            </View>

                            <TextInput
                                label="QR Payload"
                                value={pairingPayload}
                                mode="outlined"
                                multiline
                                numberOfLines={3}
                                editable={false}
                                style={{ marginBottom: 12 }}
                            />

                            <View style={styles.modalActionsRow}>
                                <Button mode="outlined" onPress={copyPairingPayload}>Copy Payload</Button>
                                <Button mode="outlined" onPress={sharePairingPayload}>Share Payload</Button>
                                <Button mode="contained" onPress={shareQrImage}>Share QR</Button>
                            </View>
                        </ScrollView>
                    </Modal>
                </Portal>

                {/* Recent Alerts List */}
                <View style={styles.alertsHeader}>
                    <Text variant="titleMedium" style={styles.sectionTitle}>Recent Alerts</Text>
                    <Button mode="text" compact onPress={() => navigation.navigate('TamperAlerts')}>View All</Button>
                </View>

                <Surface style={styles.alertItem} elevation={1}>
                    <View style={styles.alertLeft}>
                        <MaterialCommunityIcons name="shield-check-outline" size={24} color="#4CAF50" style={styles.alertIcon} />
                        <View>
                            <Text variant="titleSmall" style={{ color: '#4CAF50' }}>All Clear</Text>
                            <Text variant="bodySmall">No recent alerts</Text>
                        </View>
                    </View>
                </Surface>

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    pairingBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderRadius: 12,
        marginBottom: 16,
        backgroundColor: 'white',
    },
    headerBackground: {
        backgroundColor: '#F44336',
        paddingTop: 50,
        paddingBottom: 20,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        elevation: 4,
    },
    headerContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    dateText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 14,
        fontWeight: 'bold',
    },
    timeText: {
        color: 'white',
        fontSize: 32,
        fontWeight: 'bold',
    },
    weatherContainer: {
        alignItems: 'center',
    },
    weatherText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    weatherCondition: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 12,
    },
    scrollContent: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    headerTitle: {
        fontWeight: 'bold',
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    statCard: {
        width: '48%',
        padding: 16,
        backgroundColor: 'white',
        borderRadius: 16,
        marginBottom: 16,
    },
    statIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
    },
    quickLinksScroll: {
        marginBottom: 24,
    },
    quickLinkBtn: {
        marginRight: 12,
        borderRadius: 20,
    },
    alertsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    alertItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 10,
        borderLeftWidth: 4,
        borderLeftColor: '#F44336',
    },
    alertLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    alertIcon: {
        marginRight: 12,
    },
    boxSelectContainer: {
        borderWidth: 1,
        borderColor: '#DDD',
        borderRadius: 8,
        padding: 8,
        marginBottom: 12,
        maxHeight: 140,
    },
    boxSelectScroll: {
        flexGrow: 0,
    },
    boxSelectContent: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    boxChip: {
        marginRight: 0,
        marginBottom: 0,
    },
    modalContainer: {
        backgroundColor: 'white',
        padding: 24,
        margin: 20,
        borderRadius: 16,
        maxHeight: '90%',
    },
    modeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 12,
    },
    modeChip: {
        marginRight: 8,
        marginBottom: 8,
    },
    tokenRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 8,
    },
    qrContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        marginBottom: 12,
    },
    modalActionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 8,
    },
});
