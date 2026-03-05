import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Share, StatusBar } from 'react-native';
import { Text, Modal, Portal, TextInput, Chip, Divider } from 'react-native-paper';
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
import { NetworkStatusBanner } from '../../components';
import { HardwareByBoxId, subscribeToAllHardware } from '../../services/firebaseClient';
import { useAppTheme } from '../../context/ThemeContext';

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

    useEffect(() => {
        const unsubscribe = subscribeToAllHardware((hardware) => {
            setHardwareSnapshot(hardware);
        });
        return unsubscribe;
    }, []);

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
        { icon: 'file-document-outline', label: 'Records', onPress: () => navigation.navigate('DeliveryRecords') },
        { icon: 'lock-open-variant-outline', label: 'Unlock Box', onPress: () => navigation.navigate('AdminRemoteUnlock') },
        { icon: 'check-circle-outline', label: 'Complete Del.', onPress: () => setOverrideModalVisible(true) },
        { icon: 'qrcode-scan', label: 'Pair QR', onPress: openPairQrModal },
    ];

    // ─── Render ─────────────────────────────────────────────────────────────────
    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar barStyle={c.statusBar} backgroundColor={c.bg} />

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <View style={[styles.header, { backgroundColor: c.bg }]}>
                <View>
                    <Text style={[styles.greeting, { color: c.textPrimary }]}>Admin Overview</Text>
                    <Text style={[styles.dateLabel, { color: c.textSecondary }]}>
                        {currentTime.format('dddd, MMM D · h:mm A')}
                    </Text>
                </View>
                {weather && (
                    <View style={[styles.weatherPill, { backgroundColor: c.pillBg }]}>
                        <MaterialCommunityIcons name={weather.icon as any} size={16} color={c.textSecondary} />
                        <Text style={[styles.weatherTemp, { color: c.textPrimary }]}>{weather.temp}</Text>
                    </View>
                )}
            </View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

                {/* Network banner */}
                <NetworkStatusBanner />

                {/* ── Stat Metrics Row ────────────────────────────────────────── */}
                <View style={styles.metricsRow}>
                    <MetricTile value={hardwareSummary.total} label="Boxes" c={c} />
                    <MetricTile value={hardwareSummary.online} label="Online" c={c} valueColor={c.green} />
                    <MetricTile value={hardwareSummary.tamper} label="Tamper" c={c} valueColor={hardwareSummary.tamper > 0 ? c.red : c.textSecondary} />
                    <MetricTile value={hardwareSummary.offline} label="Offline" c={c} valueColor={hardwareSummary.offline > 0 ? c.orange : c.textSecondary} />
                </View>

                {/* ── Live Hardware Card ──────────────────────────────────────── */}
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

                {/* ── Paired Box Status ───────────────────────────────────────── */}
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
                        <Text style={styles.pairingBtnText}>Pair</Text>
                    </TouchableOpacity>
                </View>

                {/* ── Quick Actions Grid ──────────────────────────────────────── */}
                <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>System Management</Text>
                <View style={styles.actionsGrid}>
                    {quickActions.map((a, i) => (
                        <TouchableOpacity
                            key={i}
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
                    ))}
                </View>

                {/* ── Push Test Button ────────────────────────────────────────── */}
                <TouchableOpacity
                    style={[styles.pushTestBtn, { borderColor: c.border }]}
                    activeOpacity={0.7}
                    onPress={async () => {
                        try {
                            const baseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || process.env.EXPO_PUBLIC_API_URL || 'https://parcel-safe.vercel.app';
                            await fetch(`${baseUrl}/api/notifications/promo`, { method: 'POST' });
                            Alert.alert('Sent', 'Test push notification triggered!');
                        } catch (e: any) {
                            Alert.alert('Error', `Failed: ${e.message}`);
                        }
                    }}
                >
                    <MaterialCommunityIcons name="bell-ring-outline" size={18} color={c.accent} />
                    <Text style={[styles.pushTestLabel, { color: c.accent }]}>Send Push Test</Text>
                </TouchableOpacity>

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
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: c.border }]} onPress={() => setOverrideModalVisible(false)}>
                            <Text style={[styles.modalCancelText, { color: c.textPrimary }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.modalConfirmBtn, { backgroundColor: c.accent }, isProcessing && { opacity: 0.5 }]}
                            onPress={handleOverrideDelivery}
                            disabled={isProcessing}
                        >
                            <Text style={styles.modalConfirmText}>{isProcessing ? 'Processing…' : 'Complete Delivery'}</Text>
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
                                <Text style={styles.modalConfirmText}>Share QR</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </Modal>
            </Portal>
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
        fontWeight: '700',
        letterSpacing: -0.4,
    },
    dateLabel: {
        fontSize: 13,
        marginTop: 4,
        fontWeight: '500',
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
        fontWeight: '600',
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
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    metricLabel: {
        fontSize: 11,
        fontWeight: '600',
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
        fontWeight: '700',
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
        fontWeight: '600',
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
        fontWeight: '500',
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
        fontWeight: '700',
    },
    pairingBoxId: {
        fontSize: 14,
        fontWeight: '600',
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
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 14,
    },

    // Actions Grid
    actionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    actionTile: {
        width: '31%',
        borderRadius: 14,
        paddingVertical: 20,
        alignItems: 'center',
        marginBottom: 12,
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
        fontWeight: '600',
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
        fontWeight: '700',
    },

    // Push test
    pushTestBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 24,
    },
    pushTestLabel: {
        fontSize: 14,
        fontWeight: '600',
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
        fontWeight: '700',
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
        fontWeight: '700',
        marginBottom: 8,
    },
    modalDesc: {
        fontSize: 13,
        marginBottom: 20,
        lineHeight: 18,
    },
    modalLabel: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    modalInput: {
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
        fontWeight: '600',
        fontSize: 14,
    },
    modalConfirmBtn: {
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 10,
    },
    modalConfirmText: {
        color: '#FFFFFF',
        fontWeight: '700',
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
        fontWeight: '600',
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
