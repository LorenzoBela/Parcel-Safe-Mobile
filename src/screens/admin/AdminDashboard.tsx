import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Share, StatusBar, Animated, ActivityIndicator } from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { Text, Modal, Portal, TextInput, Chip, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { ActiveDeliverySummary, getDeliveryByIdOrTracking, listActiveDeliveries, listSmartBoxes, markDeliveryComplete, SmartBoxSummary } from '../../services/supabaseClient';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import useAuthStore from '../../store/authStore';
import { BoxPairingState, isPairingActive, subscribeToRiderPairing } from '../../services/boxPairingService';
import * as Location from 'expo-location';
import { fetchWeather, WeatherData } from '../../services/weatherService';
import { NetworkStatusBanner } from '../../components';
import { HardwareByBoxId, subscribeToAllHardware } from '../../services/firebaseClient';
import { useAppTheme } from '../../context/ThemeContext';
import { useExitAppConfirmation } from '../../hooks/useExitAppConfirmation';
import ExitConfirmationModal from '../../components/modals/ExitConfirmationModal';
import { PremiumAlert } from '../../services/PremiumAlertService';
import NotificationBell from '../../components/NotificationBell';
import { reportBatteryDeadIncident } from '../../services/batteryIncidentService';

// ─── Dual-mode Color Palette ────────────────────────────────────────────────────

type StatusBarStyle = 'dark-content' | 'light-content';

type ColorPalette = {
    bg: string; card: string; card2: string; border: string;
    accent: string; textPrimary: string; textSecondary: string; textTertiary: string;
    red: string; green: string; orange: string; modalBg: string;
    statusBar: StatusBarStyle; pillBg: string; chipBg: string; chipSelected: string; qrBg: string;
};

const lightColors: ColorPalette = {
    bg: '#FFFFFF',
    card: '#F6F6F6',
    card2: '#EEEEEE',
    border: '#E5E5EA',
    accent: '#000000',
    textPrimary: '#000000',
    textSecondary: '#6B6B6B',
    textTertiary: '#999999',
    red: '#FF3B30',
    green: '#34C759',
    orange: '#FF9500',
    modalBg: '#FFFFFF',
    statusBar: 'dark-content' as const,
    pillBg: '#F2F2F7',
    chipBg: '#F2F2F7',
    chipSelected: '#E8F0FE',
    qrBg: '#FFFFFF',
};

const darkColors: ColorPalette = {
    bg: '#000000',
    card: '#141414',
    card2: '#1C1C1E',
    border: '#2C2C2E',
    accent: '#FFFFFF',
    textPrimary: '#FFFFFF',
    textSecondary: '#8E8E93',
    textTertiary: '#48484A',
    red: '#FF453A',
    green: '#30D158',
    orange: '#FF9F0A',
    modalBg: '#1C1C1E',
    statusBar: 'light-content' as const,
    pillBg: '#1C1C1E',
    chipBg: '#1C1C1E',
    chipSelected: '#1a2f4a',
    qrBg: '#FFFFFF',
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatRemainingMs(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0m';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

function deriveHardwareStatus(hw: HardwareByBoxId[string] | null): string {
    if (!hw) return 'OFFLINE';
    if (hw.tamper?.detected || hw.tamper?.lockdown) return 'TAMPER';
    if (typeof hw.status === 'string' && hw.status.length > 0) return hw.status.toUpperCase();
    if (hw.gps_fix) return 'ACTIVE';
    if (hw.connection) return 'STANDBY';
    return 'IDLE';
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
    const { showExitModal, setShowExitModal, handleExit } = useExitAppConfirmation();
    const navigation = useNavigation<any>();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkColors : lightColors;

    const [currentTime, setCurrentTime] = useState(dayjs());
    const [overrideModalVisible, setOverrideModalVisible] = useState(false);
    const [pairQrModalVisible, setPairQrModalVisible] = useState(false);
    const [trackingInput, setTrackingInput] = useState('');
    const [reasonInput, setReasonInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [pairBoxId, setPairBoxId] = useState('');
    const [availableBoxes, setAvailableBoxes] = useState<SmartBoxSummary[]>([]);
    const [boxesLoading, setBoxesLoading] = useState(false);
    const [activeDeliveries, setActiveDeliveries] = useState<ActiveDeliverySummary[]>([]);
    const [deliveriesLoading, setDeliveriesLoading] = useState(false);
    const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
    const [selectedDeliveryId, setSelectedDeliveryId] = useState('');
    const [pairMode, setPairMode] = useState<'ONE_TIME' | 'SESSION'>('SESSION');
    const [sessionHours, setSessionHours] = useState(24);
    const [pairToken, setPairToken] = useState('');
    const [hardwareSnapshot, setHardwareSnapshot] = useState<HardwareByBoxId | null>(null);
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

    const selectedDelivery = useMemo(
        () => activeDeliveries.find((delivery) => delivery.id === selectedDeliveryId),
        [activeDeliveries, selectedDeliveryId]
    );

    const loadActiveDeliveries = useCallback(async (showSpinner = true) => {
        if (showSpinner) {
            setDeliveriesLoading(true);
        }
        setDeliveriesError(null);

        try {
            const deliveries = await listActiveDeliveries(30);
            setActiveDeliveries(deliveries);

            if (selectedDeliveryId && !deliveries.some((delivery) => delivery.id === selectedDeliveryId)) {
                setSelectedDeliveryId('');
            }
        } catch (error) {
            console.error('Failed to load active deliveries:', error);
            setDeliveriesError('Unable to load active deliveries. Please try again.');
        } finally {
            if (showSpinner) {
                setDeliveriesLoading(false);
            }
        }
    }, [selectedDeliveryId]);

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
            PremiumAlert.alert('Missing Box ID', 'Enter a box ID to generate a payload.');
            return;
        }
        await Clipboard.setStringAsync(pairingPayload);
        PremiumAlert.alert('Copied', 'Pairing payload copied to clipboard.');
    };

    const sharePairingPayload = async () => {
        if (!pairingPayload) {
            PremiumAlert.alert('Missing Box ID', 'Enter a box ID to generate a payload.');
            return;
        }
        await Share.share({ message: pairingPayload });
    };

    const shareQrImage = async () => {
        if (!pairingPayload || !qrRef.current?.toDataURL) {
            PremiumAlert.alert('QR Not Ready', 'Generate a QR first.');
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

    useEffect(() => {
        const unsubscribe = subscribeToAllHardware((hardware) => {
            setHardwareSnapshot(hardware);
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!overrideModalVisible) return;
        loadActiveDeliveries(true);
    }, [overrideModalVisible, loadActiveDeliveries]);

    useEffect(() => {
        if (!selectedDelivery) return;
        setTrackingInput(selectedDelivery.id);
    }, [selectedDelivery]);

    const handleOverrideDelivery = async () => {
        const lookupValue = selectedDelivery?.id || trackingInput.trim();
        const trimmedReason = reasonInput.trim();

        if (!lookupValue) {
            PremiumAlert.alert('Error', 'Please enter a tracking number or delivery ID');
            return;
        }
        if (trimmedReason.length < 8) {
            PremiumAlert.alert('Error', 'Please provide a meaningful reason (at least 8 characters)');
            return;
        }

        setIsProcessing(true);

        const delivery = await getDeliveryByIdOrTracking(lookupValue);
        if (!delivery) {
            PremiumAlert.alert('Not Found', 'No delivery found with that tracking number');
            setIsProcessing(false);
            return;
        }

        if (delivery.status === 'COMPLETED') {
            PremiumAlert.alert('Already Complete', 'This delivery is already marked as completed');
            setIsProcessing(false);
            return;
        }

        PremiumAlert.alert(
            'Confirm Override',
            `Mark delivery ${delivery.tracking_number} as COMPLETED?\n\nReason: ${trimmedReason}`,
            [
                { text: 'Cancel', style: 'cancel', onPress: () => setIsProcessing(false) },
                {
                    text: 'Confirm',
                    style: 'destructive',
                    onPress: async () => {
                        if (delivery.box_id) {
                            await reportBatteryDeadIncident({
                                boxId: delivery.box_id,
                                deliveryId: delivery.id,
                                stage: 'DROPOFF',
                                note: trimmedReason,
                            });
                        }

                        const success = await markDeliveryComplete(lookupValue, trimmedReason);
                        setIsProcessing(false);
                        setOverrideModalVisible(false);

                        if (success) {
                            PremiumAlert.alert('Success', 'Delivery marked as complete');
                            setTrackingInput('');
                            setReasonInput('');
                            setSelectedDeliveryId('');
                            loadActiveDeliveries(false);
                        } else {
                            PremiumAlert.alert('Error', 'Failed to update delivery. Please try again.');
                        }
                    }
                }
            ]
        );
    };

    // Weather
    const [weather, setWeather] = useState<WeatherData | null>(null);
    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({});
            const data = await fetchWeather(loc.coords.latitude, loc.coords.longitude);
            if (data) setWeather(data);
        })();
    }, []);

    // ─── Hardware Summary ───────────────────────────────────────────────────────
    const hardwareSummary = useMemo(() => {
        const entries = Object.values(hardwareSnapshot ?? {});
        const total = entries.length;
        let tamper = 0;
        let active = 0;
        let offline = 0;
        let gpsLocked = 0;
        let lte = 0;
        let wifi = 0;

        entries.forEach((hw) => {
            const status = deriveHardwareStatus(hw);
            const hasTamper = Boolean(hw?.tamper?.detected || hw?.tamper?.lockdown);
            const conn = (hw?.connection || '').toUpperCase();

            if (hasTamper) tamper += 1;
            if (status === 'ACTIVE' || status === 'IN_TRANSIT') active += 1;
            if (status === 'OFFLINE') offline += 1;
            if (hw?.gps_fix) gpsLocked += 1;
            if (conn.includes('LTE')) lte += 1;
            if (conn.includes('WIFI')) wifi += 1;
        });

        const online = Math.max(total - offline, 0);
        return { total, tamper, active, offline, online, gpsLocked, lte, wifi };
    }, [hardwareSnapshot]);

    // ─── Quick Action Items ─────────────────────────────────────────────────────
    const quickActions = [
        { icon: 'map-marker-radius', label: 'Live Map', onPress: () => navigation.navigate('GlobalMap') },
        { icon: 'alert-octagon', label: 'Alerts', onPress: () => navigation.navigate('TamperAlerts'), badge: hardwareSummary.tamper },
        { icon: 'file-document-outline', label: 'Records', onPress: () => navigation.navigate('AdminRecords') },
        { icon: 'lock-open-variant-outline', label: 'Unlock Box', onPress: () => navigation.navigate('AdminRemoteUnlock') },
        { icon: 'check-circle-outline', label: 'Complete Del.', onPress: () => setOverrideModalVisible(true) },
        { icon: 'qrcode-scan', label: 'Pair QR', onPress: openPairQrModal },
    ];
    const headerAnim = useEntryAnimation(0);
    const metricsAnim = useEntryAnimation(60);
    const hardwareAnim = useEntryAnimation(110);
    const pairingAnim = useEntryAnimation(160);
    const actionsStagger = useStaggerAnimation(6, 45, 170);
    // ─── Render ─────────────────────────────────────────────────────────────────
    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar barStyle={c.statusBar} backgroundColor={c.bg} />

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <Animated.View style={[styles.header, { backgroundColor: c.bg }, headerAnim.style]}>
                <View>
                    <Text style={[styles.greeting, { color: c.textPrimary }]}>Admin Overview</Text>
                    <Text style={[styles.dateLabel, { color: c.textSecondary }]}>
                        {currentTime.format('dddd, MMM D · h:mm A')}
                    </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {weather && (
                        <View style={[styles.weatherPill, { backgroundColor: c.pillBg }]}>
                            <MaterialCommunityIcons name={weather.icon as any} size={16} color={c.textSecondary} />
                            <Text style={[styles.weatherTemp, { color: c.textPrimary }]}>{weather.temp}</Text>
                        </View>
                    )}
                    <NotificationBell color={c.textPrimary} size={22} />
                </View>
            </Animated.View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

                {/* Network banner */}
                <NetworkStatusBanner />

                {/* ── Stat Metrics Row ────────────────────────────────────────── */}
                <Animated.View style={[styles.metricsRow, metricsAnim.style]}>
                    <MetricTile value={hardwareSummary.total} label="Boxes" c={c} />
                    <MetricTile value={hardwareSummary.online} label="Online" c={c} valueColor={c.green} />
                    <MetricTile value={hardwareSummary.tamper} label="Tamper" c={c} valueColor={hardwareSummary.tamper > 0 ? c.red : c.textSecondary} />
                    <MetricTile value={hardwareSummary.offline} label="Offline" c={c} valueColor={hardwareSummary.offline > 0 ? c.orange : c.textSecondary} />
                </Animated.View>

                {/* ── Live Hardware Card ──────────────────────────────────────── */}
                <Animated.View style={hardwareAnim.style}>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: c.textPrimary, marginBottom: 0 }]}>Live Hardware</Text>
                        <TouchableOpacity onPress={() => navigation.navigate('GlobalMap')} style={styles.sectionAction}>
                            <Text style={[styles.sectionActionText, { color: c.accent }]}>Open Map</Text>
                            <MaterialCommunityIcons name="chevron-right" size={16} color={c.accent} />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.chipRow}>
                        <Pill icon="check-decagram" label={`Online ${hardwareSummary.online}`} c={c} />
                        <Pill icon="crosshairs-gps" label={`GPS ${hardwareSummary.gpsLocked}`} c={c} />
                        <Pill icon="antenna" label={`LTE ${hardwareSummary.lte}`} c={c} />
                        <Pill icon="wifi" label={`WiFi ${hardwareSummary.wifi}`} c={c} />
                    </View>
                </View>
                </Animated.View>

                {/* ── Paired Box Status ───────────────────────────────────────── */}
                <Animated.View style={pairingAnim.style}>
                <View style={[styles.pairingCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.pairingTitle, { color: c.textPrimary }]}>Paired Box</Text>
                        {isPaired ? (
                            <>
                                <Text style={[styles.pairingBoxId, { color: c.accent }]}>{pairingState?.box_id}</Text>
                                <Text style={[styles.pairingMeta, { color: c.textSecondary }]}>
                                    {pairingState?.mode === 'ONE_TIME' ? 'One-time' : 'Session'}
                                    {pairingState?.expires_at ? ` · ${formatRemainingMs(pairingState.expires_at - Date.now())} left` : ''}
                                </Text>
                            </>
                        ) : (
                            <Text style={[styles.pairingMeta, { color: c.textSecondary }]}>Not paired</Text>
                        )}
                    </View>
                    <TouchableOpacity style={[styles.pairingBtn, { backgroundColor: c.accent }]} onPress={() => navigation.navigate('PairBox')}>
                        <Text style={[styles.pairingBtnText, { color: c.bg }]}>Pair</Text>
                    </TouchableOpacity>
                </View>
                </Animated.View>

                {/* ── Quick Actions Grid ──────────────────────────────────────── */}
                <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>System Management</Text>
                <View style={styles.actionsGrid}>
                    {quickActions.map((a, i) => (
                        <Animated.View key={i} style={[styles.actionTileWrapper, actionsStagger[i]?.style]}>
                        <TouchableOpacity
                            style={[styles.actionTile, { backgroundColor: c.card, borderColor: c.border }]}
                            onPress={a.onPress}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.actionIconWrap, { backgroundColor: c.card2 }]}>
                                <MaterialCommunityIcons name={a.icon as any} size={22} color={c.textPrimary} />
                                {a.badge && a.badge > 0 ? (
                                    <View style={styles.badge}>
                                        <Text style={styles.badgeText}>{a.badge}</Text>
                                    </View>
                                ) : null}
                            </View>
                            <Text style={[styles.actionLabel, { color: c.textSecondary }]}>{a.label}</Text>
                        </TouchableOpacity>
                        </Animated.View>
                    ))}
                </View>

                {/* ── Recent Alerts ───────────────────────────────────────────── */}
                <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: c.textPrimary, marginBottom: 0 }]}>Recent Alerts</Text>
                    <TouchableOpacity onPress={() => navigation.navigate('TamperAlerts')}>
                        <Text style={[styles.sectionActionText, { color: c.accent }]}>View All</Text>
                    </TouchableOpacity>
                </View>
                <View style={[styles.alertCard, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: c.green }]}>
                    <MaterialCommunityIcons name="shield-check-outline" size={22} color={c.green} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={[styles.alertTitle, { color: c.textPrimary }]}>All Clear</Text>
                        <Text style={[styles.alertSub, { color: c.textSecondary }]}>No recent alerts</Text>
                    </View>
                </View>

                <View style={{ height: 40 }} />
            </ScrollView>

            {/* ── Override Delivery Modal ─────────────────────────────────────── */}
            <Portal>
                <Modal
                    visible={overrideModalVisible}
                    onDismiss={() => setOverrideModalVisible(false)}
                    contentContainerStyle={[styles.modal, { backgroundColor: c.modalBg, borderColor: c.border }]}
                >
                    <Text style={[styles.modalTitle, { color: c.textPrimary }]}>Manual Delivery Override</Text>
                    <Text style={[styles.modalDesc, { color: c.textSecondary }]}>
                        Use when hardware failed but customer received the package.
                    </Text>
                    <View style={styles.deliverySectionHeader}>
                        <Text style={[styles.deliverySectionTitle, { color: c.textSecondary }]}>Active Deliveries</Text>
                        <TouchableOpacity onPress={() => loadActiveDeliveries(false)}>
                            <Text style={[styles.deliveryRefreshText, { color: c.accent }]}>Refresh</Text>
                        </TouchableOpacity>
                    </View>
                    {deliveriesLoading ? (
                        <ActivityIndicator color={c.accent} style={{ marginBottom: 12 }} />
                    ) : deliveriesError ? (
                        <Text style={[styles.deliveryError, { color: c.red }]}>{deliveriesError}</Text>
                    ) : activeDeliveries.length === 0 ? (
                        <Text style={[styles.deliveryEmpty, { color: c.textSecondary }]}>No active deliveries found.</Text>
                    ) : (
                        <ScrollView
                            style={[styles.deliveryList, { borderColor: c.border, backgroundColor: c.card }]}
                            nestedScrollEnabled
                            showsVerticalScrollIndicator={false}
                        >
                            {activeDeliveries.map((delivery) => {
                                const isSelected = selectedDeliveryId === delivery.id;
                                return (
                                    <TouchableOpacity
                                        key={delivery.id}
                                        style={[
                                            styles.deliveryItem,
                                            { borderColor: c.border, backgroundColor: c.card2 },
                                            isSelected && [styles.deliveryItemSelected, { borderColor: c.accent }],
                                        ]}
                                        onPress={() => setSelectedDeliveryId(delivery.id)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[styles.deliveryTracking, { color: c.textPrimary }]}>{delivery.tracking_number}</Text>
                                        <Text style={[styles.deliveryMeta, { color: c.textSecondary }]}>{`${delivery.status} · ${delivery.box_id}`}</Text>
                                        <Text style={[styles.deliveryDate, { color: c.textTertiary }]}>
                                            {dayjs(delivery.created_at).format('MMM D, h:mm A')}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    )}
                    <TextInput
                        label="Tracking Number / Delivery ID"
                        value={trackingInput}
                        onChangeText={setTrackingInput}
                        mode="outlined"
                        style={[styles.modalInput, { backgroundColor: c.card2 }]}
                        outlineColor={c.border}
                        activeOutlineColor={c.accent}
                        textColor={c.textPrimary}
                        theme={{ colors: { onSurfaceVariant: c.textSecondary, surface: c.card2 } }}
                    />
                    <TextInput
                        label="Reason for Override"
                        value={reasonInput}
                        onChangeText={setReasonInput}
                        mode="outlined"
                        multiline
                        numberOfLines={2}
                        placeholder="e.g., Battery died, customer confirmed receipt"
                        placeholderTextColor={c.textTertiary}
                        style={[styles.modalInput, { backgroundColor: c.card2 }]}
                        outlineColor={c.border}
                        activeOutlineColor={c.accent}
                        textColor={c.textPrimary}
                        theme={{ colors: { onSurfaceVariant: c.textSecondary, surface: c.card2 } }}
                    />
                    <Text style={[styles.modalHint, { color: reasonInput.trim().length >= 8 ? c.green : c.textSecondary }]}>
                        Include root cause + customer confirmation (min 8 chars).
                    </Text>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: c.border }]} onPress={() => setOverrideModalVisible(false)}>
                            <Text style={[styles.modalCancelText, { color: c.textPrimary }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.modalConfirmBtn,
                                { backgroundColor: c.accent },
                                (isProcessing || reasonInput.trim().length < 8) && { opacity: 0.5 },
                            ]}
                            onPress={handleOverrideDelivery}
                            disabled={isProcessing || reasonInput.trim().length < 8}
                        >
                            <Text style={[styles.modalConfirmText, { color: c.bg }]}>{isProcessing ? 'Processing…' : 'Complete Delivery'}</Text>
                        </TouchableOpacity>
                    </View>
                </Modal>
            </Portal>

            {/* ── Pair QR Modal ───────────────────────────────────────────────── */}
            <Portal>
                <Modal
                    visible={pairQrModalVisible}
                    onDismiss={() => setPairQrModalVisible(false)}
                    contentContainerStyle={[styles.modal, { backgroundColor: c.modalBg, borderColor: c.border }]}
                >
                    <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ paddingBottom: 8 }}>
                        <Text style={[styles.modalTitle, { color: c.textPrimary }]}>Generate Pairing QR</Text>
                        <Text style={[styles.modalDesc, { color: c.textSecondary }]}>
                            Select a box, choose mode, then share the QR payload.
                        </Text>

                        <Text style={[styles.modalLabel, { color: c.textSecondary }]}>Select Box</Text>
                        <View style={[styles.boxSelect, { borderColor: c.border, backgroundColor: c.card }]}>
                            {boxesLoading ? (
                                <Text style={[styles.boxSelectEmpty, { color: c.textSecondary }]}>Loading boxes…</Text>
                            ) : availableBoxes.length === 0 ? (
                                <>
                                    <Text style={[styles.boxSelectEmpty, { color: c.textSecondary }]}>No boxes found.</Text>
                                    <TextInput
                                        label="Box ID (manual)"
                                        value={pairBoxId}
                                        onChangeText={setPairBoxId}
                                        mode="outlined"
                                        outlineColor={c.border}
                                        activeOutlineColor={c.accent}
                                        textColor={c.textPrimary}
                                        theme={{ colors: { onSurfaceVariant: c.textSecondary, surface: c.card2 } }}
                                    />
                                </>
                            ) : (
                                <ScrollView style={{ flexGrow: 0 }} nestedScrollEnabled contentContainerStyle={styles.chipRow}>
                                    {availableBoxes.map((box) => (
                                        <Chip
                                            key={box.id}
                                            selected={pairBoxId === box.id}
                                            onPress={() => setPairBoxId(box.id)}
                                            style={[styles.darkChip, { backgroundColor: c.chipBg, borderColor: c.border }, pairBoxId === box.id && { borderColor: c.accent, backgroundColor: c.chipSelected }]}
                                            textStyle={{ color: c.textPrimary, fontSize: 12 }}
                                            selectedColor={c.accent}
                                        >
                                            {box.id}
                                        </Chip>
                                    ))}
                                </ScrollView>
                            )}
                        </View>

                        <Text style={[styles.modalLabel, { color: c.textSecondary }]}>Pairing Mode</Text>
                        <View style={styles.chipRow}>
                            <Chip
                                selected={pairMode === 'ONE_TIME'}
                                onPress={() => setPairMode('ONE_TIME')}
                                style={[styles.darkChip, { backgroundColor: c.chipBg, borderColor: c.border }, pairMode === 'ONE_TIME' && { borderColor: c.accent, backgroundColor: c.chipSelected }]}
                                textStyle={{ color: c.textPrimary, fontSize: 12 }}
                                selectedColor={c.accent}
                            >
                                One-time
                            </Chip>
                            <Chip
                                selected={pairMode === 'SESSION'}
                                onPress={() => setPairMode('SESSION')}
                                style={[styles.darkChip, { backgroundColor: c.chipBg, borderColor: c.border }, pairMode === 'SESSION' && { borderColor: c.accent, backgroundColor: c.chipSelected }]}
                                textStyle={{ color: c.textPrimary, fontSize: 12 }}
                                selectedColor={c.accent}
                            >
                                Session
                            </Chip>
                        </View>

                        {pairMode === 'SESSION' && (
                            <View style={{ marginBottom: 8 }}>
                                <Text style={[styles.modalLabel, { color: c.textSecondary }]}>Session Duration</Text>
                                <View style={styles.chipRow}>
                                    {[4, 12, 24, 48].map((hours) => (
                                        <Chip
                                            key={hours}
                                            selected={sessionHours === hours}
                                            onPress={() => setSessionHours(hours)}
                                            style={[styles.darkChip, { backgroundColor: c.chipBg, borderColor: c.border }, sessionHours === hours && { borderColor: c.accent, backgroundColor: c.chipSelected }]}
                                            textStyle={{ color: c.textPrimary, fontSize: 12 }}
                                            selectedColor={c.accent}
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
                                outlineColor={c.border}
                                textColor={c.textPrimary}
                                theme={{ colors: { onSurfaceVariant: c.textSecondary, surface: c.card2 } }}
                            />
                            <TouchableOpacity style={[styles.regenBtn, { borderColor: c.border }]} onPress={() => setPairToken(generatePairToken())}>
                                <Text style={[styles.regenBtnText, { color: c.accent }]}>Regen</Text>
                            </TouchableOpacity>
                        </View>

                        <Divider style={{ backgroundColor: c.border, marginVertical: 16 }} />

                        <View style={styles.qrWrap}>
                            {pairingPayload ? (
                                <View style={[styles.qrInner, { backgroundColor: c.qrBg }]}>
                                    <QRCode
                                        value={pairingPayload}
                                        size={180}
                                        getRef={(ref) => (qrRef.current = ref)}
                                        backgroundColor="#FFFFFF"
                                    />
                                </View>
                            ) : (
                                <Text style={{ color: c.textSecondary }}>Select a box to render QR</Text>
                            )}
                        </View>

                        <TextInput
                            label="QR Payload"
                            value={pairingPayload}
                            mode="outlined"
                            multiline
                            numberOfLines={2}
                            editable={false}
                            style={{ marginBottom: 12 }}
                            outlineColor={c.border}
                            textColor={c.textPrimary}
                            theme={{ colors: { onSurfaceVariant: c.textSecondary, surface: c.card2 } }}
                        />

                        <View style={styles.modalActions}>
                            <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: c.border }]} onPress={copyPairingPayload}>
                                <Text style={[styles.modalCancelText, { color: c.textPrimary }]}>Copy</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: c.border }]} onPress={sharePairingPayload}>
                                <Text style={[styles.modalCancelText, { color: c.textPrimary }]}>Share</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalConfirmBtn, { backgroundColor: c.accent }]} onPress={shareQrImage}>
                                <Text style={[styles.modalConfirmText, { color: c.bg }]}>Share QR</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </Modal>
            </Portal>

            <ExitConfirmationModal
                visible={showExitModal}
                onDismiss={() => setShowExitModal(false)}
                onConfirm={handleExit}
            />
        </View>
    );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

type MetricTileProps = { value: number; label: string; c: typeof lightColors; valueColor?: string };

function MetricTile({ value, label, c, valueColor }: MetricTileProps) {
    return (
        <View style={[styles.metricTile, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.metricValue, { color: valueColor || c.textPrimary }]}>{value}</Text>
            <Text style={[styles.metricLabel, { color: c.textSecondary }]}>{label}</Text>
        </View>
    );
}

type PillProps = { icon: string; label: string; c: typeof lightColors };

function Pill({ icon, label, c }: PillProps) {
    return (
        <View style={[styles.pill, { backgroundColor: c.pillBg }]}>
            <MaterialCommunityIcons name={icon as any} size={14} color={c.textSecondary} />
            <Text style={[styles.pillText, { color: c.textSecondary }]}>{label}</Text>
        </View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 54,
        paddingBottom: 16,
        paddingHorizontal: 20,
    },
    greeting: {
        fontSize: 26,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.4,
    },
    dateLabel: {
        fontSize: 13,
        marginTop: 4,
        fontFamily: 'Inter_500Medium',
    },
    weatherPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
    },
    weatherTemp: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },

    scroll: {
        paddingHorizontal: 20,
        paddingTop: 4,
    },

    // Metrics Row
    metricsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
        marginTop: 8,
    },
    metricTile: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 16,
        borderRadius: 14,
        marginHorizontal: 4,
        borderWidth: 1,
    },
    metricValue: {
        fontSize: 28,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.5,
    },
    metricLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        marginTop: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },

    // Sections
    section: {
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 17,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.2,
        marginBottom: 12,
    },
    sectionAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    sectionActionText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },

    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
    },
    pillText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },

    // Pairing Card
    pairingCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 14,
        padding: 16,
        marginBottom: 24,
        borderWidth: 1,
    },
    pairingTitle: {
        fontSize: 15,
        fontFamily: 'Inter_700Bold',
    },
    pairingBoxId: {
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
        marginTop: 2,
    },
    pairingMeta: {
        fontSize: 12,
        marginTop: 2,
    },
    pairingBtn: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
    },
    pairingBtnText: {
        fontFamily: 'Inter_700Bold',
        fontSize: 14,
    },

    // Actions Grid
    actionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    actionTileWrapper: {
        width: '31%',
        marginBottom: 12,
    },
    actionTile: {
        width: '100%',
        borderRadius: 14,
        paddingVertical: 20,
        alignItems: 'center',
        borderWidth: 1,
    },
    actionIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    actionLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: '#FF453A',
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontFamily: 'Inter_700Bold',
    },

    // Alerts
    alertCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderLeftWidth: 3,
    },
    alertTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    alertSub: {
        fontSize: 12,
        marginTop: 2,
    },

    // Modal
    modal: {
        padding: 24,
        margin: 20,
        borderRadius: 20,
        maxHeight: '90%',
        borderWidth: 1,
    },
    modalTitle: {
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
        marginBottom: 8,
    },
    modalDesc: {
        fontSize: 13,
        marginBottom: 20,
        lineHeight: 18,
    },
    modalLabel: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    modalInput: {
        marginBottom: 12,
    },
    modalHint: {
        fontSize: 12,
        marginTop: -4,
        marginBottom: 10,
        fontFamily: 'Inter_500Medium',
    },
    deliverySectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    deliverySectionTitle: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    deliveryRefreshText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    deliveryList: {
        maxHeight: 180,
        borderWidth: 1,
        borderRadius: 12,
        padding: 8,
        marginBottom: 12,
    },
    deliveryItem: {
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        marginBottom: 8,
    },
    deliveryItemSelected: {
        borderWidth: 2,
    },
    deliveryTracking: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
        marginBottom: 2,
    },
    deliveryMeta: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    deliveryDate: {
        fontSize: 11,
        marginTop: 2,
    },
    deliveryError: {
        fontSize: 12,
        marginBottom: 12,
    },
    deliveryEmpty: {
        fontSize: 12,
        marginBottom: 12,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
        marginTop: 8,
    },
    modalCancelBtn: {
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
    },
    modalCancelText: {
        fontFamily: 'Inter_600SemiBold',
        fontSize: 14,
    },
    modalConfirmBtn: {
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 10,
    },
    modalConfirmText: {
        fontFamily: 'Inter_700Bold',
        fontSize: 14,
    },

    // Box select in modal
    boxSelect: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 10,
        marginBottom: 16,
        maxHeight: 140,
    },
    boxSelectEmpty: {
        fontSize: 13,
        marginBottom: 8,
    },

    // Chips
    darkChip: {
        borderWidth: 1,
        marginRight: 8,
        marginBottom: 8,
    },

    tokenRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 8,
    },
    regenBtn: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
    },
    regenBtnText: {
        fontFamily: 'Inter_600SemiBold',
        fontSize: 13,
    },
    qrWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
    },
    qrInner: {
        padding: 12,
        borderRadius: 12,
    },
});
