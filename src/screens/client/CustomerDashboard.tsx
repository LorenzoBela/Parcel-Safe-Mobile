import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ImageBackground, StatusBar, Alert, RefreshControl, Share, Animated } from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { Text, Avatar, Portal, Modal, IconButton } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import * as Location from 'expo-location';
import { CustomerHardwareBanner, NetworkStatusBanner } from '../../components';
import { subscribeToDisplay } from '../../services/firebaseClient';
import {
    subscribeToCancellation,
    CancellationState,
    formatCancellationReason
} from '../../services/cancellationService';
import { supabase } from '../../services/supabaseClient';
import useAuthStore from '../../store/authStore';
import { fetchWeather, weatherBackgroundImages, WeatherData } from '../../services/weatherService';
import { useExitAppConfirmation } from '../../hooks/useExitAppConfirmation';
import ExitConfirmationModal from '../../components/modals/ExitConfirmationModal';
import { PremiumAlert } from '../../services/PremiumAlertService';

// ─── Colors ─────────────────────────────────────────────────────────────────────
type StatusBarStyle = 'dark-content' | 'light-content';
type ColorPalette = {
    bg: string; card: string; border: string;
    text: string; textSec: string; textTer: string;
    accent: string; red: string; green: string; orange: string;
    pillBg: string; modalBg: string; statusBar: StatusBarStyle;
};
const lightC: ColorPalette = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', red: '#E11900', green: '#34C759', orange: '#FF9500',
    pillBg: '#F2F2F7', modalBg: 'rgba(0,0,0,0.4)', statusBar: 'dark-content' as const,
};
const darkC: ColorPalette = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', red: '#FF453A', green: '#30D158', orange: '#FFB340',
    pillBg: '#1C1C1E', modalBg: 'rgba(0,0,0,0.7)', statusBar: 'light-content' as const,
};

// ─── Status helpers ─────────────────────────────────────────────────────────────
function formatStatus(status: string): string {
    switch (status) {
        case 'PENDING': return 'Pending';
        case 'ASSIGNED': return 'Assigned';
        case 'PICKED_UP': return 'Picked Up';
        case 'IN_TRANSIT': return 'In Transit';
        case 'ARRIVED': return 'Arrived';
        case 'COMPLETED': return 'Delivered';
        case 'CANCELLED': return 'Cancelled';
        case 'RETURNING': return 'Returning';
        default: return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
}

function statusColor(status: string): string {
    switch (status) {
        case 'COMPLETED':
        case 'RETURNED': return '#34C759';
        case 'IN_TRANSIT':
        case 'ASSIGNED': return '#007AFF';
        case 'ARRIVED': return '#FF9500';
        case 'CANCELLED': return '#8E8E93';
        case 'TAMPERED':
        case 'RETURNING': return '#FF3B30';
        default: return '#8E8E93';
    }
}

// ─── Component ──────────────────────────────────────────────────────────────────
export default function CustomerDashboard() {
    const { showExitModal, setShowExitModal, handleExit } = useExitAppConfirmation();
    const navigation = useNavigation<any>();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [modalVisible, setModalVisible] = useState(false);
    const [shareModalVisible, setShareModalVisible] = useState(false);
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [cancellation, setCancellation] = useState<CancellationState | null>(null);
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lng: number } | null>(null);

    const authedUser = useAuthStore((state: any) => state.user) as any;
    const displayName = authedUser?.fullName || authedUser?.name || authedUser?.email || 'User';
    const avatarUri = authedUser?.photo || null;
    const firstName = displayName.split(' ')[0];

    const [activeDelivery, setActiveDelivery] = useState<{
        id: string; status: string; eta: string; rider: string; location: string; shareToken?: string;
    } | null>(null);
    const activeDeliveryId = activeDelivery?.id || null;

    const [recentActivity, setRecentActivity] = useState<{
        id: number; trackingId: string; type: string; date: string;
        serviceType: string; status: string;
    }[]>([]);

    const insets = useSafeAreaInsets();

    // ─── Share ──────────────────────────────────────────────────────────────
    const handleShare = () => setShareModalVisible(true);
    const performShare = async () => {
        setShareModalVisible(false);
        if (!activeDelivery) return;
        try {
            const token = activeDelivery.shareToken || activeDelivery.id;
            const baseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';
            const shareUrl = `${baseUrl}/track/${token}`;
            await Share.share({ message: `Track your Parcel-Safe delivery here: ${shareUrl}`, url: shareUrl, title: 'Track Parcel' });
        } catch (error: any) { PremiumAlert.alert(error.message); }
    };

    // ─── Clock ──────────────────────────────────────────────────────────────
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(dayjs()), 1000);
        return () => clearInterval(timer);
    }, []);

    // ─── Location ───────────────────────────────────────────────────────────
    const fetchLocation = useCallback(async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setLocationName('Permission denied'); return; }
        try {
            let location = await Location.getCurrentPositionAsync({});
            const { latitude, longitude } = location.coords;
            setDeviceCoords({ lat: latitude, lng: longitude });
            let address = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (address?.length > 0) {
                const { city, region, name } = address[0];
                setLocationName(city ? `${city}, ${region}` : name || 'Unknown Location');
            }
        } catch { setLocationName('Location unavailable'); }
    }, []);

    useEffect(() => { fetchLocation(); }, [fetchLocation]);

    // ─── Weather ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!deviceCoords) return;
        fetchWeather(deviceCoords.lat, deviceCoords.lng).then((data) => { if (data) setWeather(data); });
    }, [deviceCoords]);

    // ─── Active delivery ────────────────────────────────────────────────────
    const fetchActiveDelivery = useCallback(async () => {
        if (!authedUser?.userId) return;
        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, rider:rider_id(full_name)')
                .eq('customer_id', authedUser.userId)
                .in('status', ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED', 'RETURNING'])
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (error && error.code !== 'PGRST116') { setActiveDelivery(null); return; }
            if (data) {
                setActiveDelivery({
                    id: data.id, status: data.status,
                    eta: data.estimated_dropoff_time ? dayjs(data.estimated_dropoff_time).format('h:mm A') : null,
                    rider: data.rider?.full_name || 'Finding a rider...',
                    location: data.status === 'PENDING' ? (data.pickup_address || 'Pickup Point') : (data.dropoff_address || 'Dropoff Point'),
                    shareToken: data.share_token,
                });
            } else { setActiveDelivery(null); }
        } catch { setActiveDelivery(null); }
    }, [authedUser?.userId]);

    useEffect(() => { fetchActiveDelivery(); }, [fetchActiveDelivery]);

    // ─── Recent activity ────────────────────────────────────────────────────
    const fetchRecentActivity = useCallback(async () => {
        if (!authedUser?.userId) return;
        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*')
                .eq('customer_id', authedUser.userId)
                .order('created_at', { ascending: false })
                .limit(3);
            if (error) return;
            if (data) {
                setRecentActivity(data.map((item: any) => ({
                    id: item.id, trackingId: item.tracking_number || item.id,
                    type: 'Delivery', date: dayjs(item.created_at).format('MMM D, YYYY'),
                    serviceType: 'Standard Delivery', status: item.status,
                })));
            }
        } catch { /* silent */ }
    }, [authedUser?.userId]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([fetchLocation(), fetchActiveDelivery(), fetchRecentActivity()]);
        setRefreshing(false);
    }, [fetchLocation, fetchActiveDelivery, fetchRecentActivity]);

    useFocusEffect(useCallback(() => {
        fetchActiveDelivery();
        fetchRecentActivity();
    }, [fetchActiveDelivery, fetchRecentActivity]));

    const getGreeting = () => {
        const h = currentTime.hour();
        if (h < 12) return 'Good Morning';
        if (h < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    const greetAnim = useEntryAnimation(0);
    const deliveryAnim = useEntryAnimation(60);
    const actionsAnim = useEntryAnimation(110);
    const activityAnim = useStaggerAnimation(3, 60, 160);

    // ═══════════════════════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════════════════════

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar barStyle={c.statusBar} />

            {/* ── Weather Banner ─────────────────────────────────────────── */}
            <ImageBackground
                source={{ uri: weather ? (weatherBackgroundImages[weather.condition] || weatherBackgroundImages['Sunny']) : weatherBackgroundImages['Sunny'] }}
                style={[styles.headerBg, { height: 170 + insets.top }]}
                imageStyle={{ borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}
                resizeMode="cover"
            >
                <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
                    <View style={styles.headerRow}>
                        <View style={{ flex: 1 }}>
                            <View style={styles.locRow}>
                                <MaterialCommunityIcons name="map-marker" size={14} color="rgba(255,255,255,0.85)" />
                                <Text style={styles.locText}>{locationName}</Text>
                            </View>
                            <Text style={styles.dateText}>{currentTime.format('dddd, MMMM D')}</Text>
                            <Text style={styles.timeText}>{currentTime.format('h:mm A')}</Text>
                        </View>
                        {weather && (
                            <View style={styles.weatherPill}>
                                <MaterialCommunityIcons name={weather.icon as any} size={26} color="#FFFFFF" />
                                <Text style={styles.weatherTemp}>{weather.temp}</Text>
                                <Text style={styles.weatherCond}>{weather.condition}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </ImageBackground>

            {/* ── Content ────────────────────────────────────────────────── */}
            <ScrollView
                style={{ backgroundColor: c.bg }}
                contentContainerStyle={[styles.scroll, { paddingBottom: 80 + insets.bottom }]}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                {/* Greeting */}
                <Animated.View style={[styles.greetRow, greetAnim.style]}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.greetLabel, { color: c.textSec }]}>{getGreeting()}</Text>
                        <Text style={[styles.greetName, { color: c.text }]}>{firstName}</Text>
                    </View>
                    {avatarUri ? (
                        <Avatar.Image size={46} source={{ uri: avatarUri }} />
                    ) : (
                        <View style={[styles.avatarFallback, { backgroundColor: c.accent }]}>
                            <Text style={[styles.avatarLetter, { color: c.bg }]}>{firstName.charAt(0)}</Text>
                        </View>
                    )}
                </Animated.View>

                {/* Banners */}
                <NetworkStatusBanner />
                <CustomerHardwareBanner displayStatus={displayStatus} />

                {/* Cancellation alert */}
                {cancellation && !cancellation.packageRetrieved && (
                    <TouchableOpacity
                        onPress={() => navigation.navigate('TrackOrder')}
                        activeOpacity={0.8}
                        style={[styles.cancelBanner, { backgroundColor: c.red + '14', borderColor: c.red + '30' }]}
                    >
                        <View style={[styles.cancelIcon, { backgroundColor: c.red }]}>
                            <MaterialCommunityIcons name="alert-circle" size={20} color="#FFFFFF" />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.cancelTitle, { color: c.red }]}>Delivery Cancelled</Text>
                            <Text style={[styles.cancelSub, { color: c.textSec }]}>
                                {formatCancellationReason(cancellation.reason)} • Tap to view
                            </Text>
                        </View>
                        <MaterialCommunityIcons name="chevron-right" size={20} color={c.red} />
                    </TouchableOpacity>
                )}

                {/* ── Active Delivery Card ───────────────────────────────── */}
                <Animated.View style={deliveryAnim.style}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>Active Delivery</Text>
                {activeDelivery ? (
                    <View style={[styles.deliveryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        {/* Header */}
                        <View style={[styles.deliveryHeader, { borderBottomColor: c.border }]}>
                            <View style={styles.deliveryIdRow}>
                                <MaterialCommunityIcons name="package-variant" size={18} color={c.accent} />
                                <Text style={[styles.deliveryId, { color: c.text }]}>
                                    {activeDelivery.id.substring(0, 8).toUpperCase()}
                                </Text>
                            </View>
                            <View style={[styles.statusPill, { backgroundColor: statusColor(activeDelivery.status) + '1A' }]}>
                                <Text style={[styles.statusPillText, { color: statusColor(activeDelivery.status) }]}>
                                    {formatStatus(activeDelivery.status)}
                                </Text>
                            </View>
                        </View>
                        {/* Info rows */}
                        <View style={styles.deliveryBody}>
                            <InfoRow icon="clock-outline" text={activeDelivery.eta ? `Arriving by ${activeDelivery.eta}` : 'Calculating ETA...'} c={c} />
                            <InfoRow icon="map-marker-outline" text={activeDelivery.location} c={c} />
                            <InfoRow icon="motorbike" text={activeDelivery.rider} c={c} />
                        </View>
                        {/* Actions */}
                        <View style={styles.deliveryActions}>
                            <TouchableOpacity
                                style={[styles.primaryBtn, { backgroundColor: c.accent }]}
                                onPress={() => navigation.navigate('TrackOrder', { bookingId: activeDelivery.id })}
                                activeOpacity={0.8}
                            >
                                <MaterialCommunityIcons name="map" size={18} color={c.bg} />
                                <Text style={[styles.primaryBtnText, { color: c.bg }]}>Track Order</Text>
                            </TouchableOpacity>
                            <View style={styles.secondaryBtnRow}>
                                <TouchableOpacity
                                    style={[styles.secondaryBtn, { backgroundColor: c.pillBg, borderColor: c.border }]}
                                    onPress={() => navigation.navigate('OTP', { boxId: activeDelivery.id, deliveryId: activeDelivery.id })}
                                    activeOpacity={0.7}
                                >
                                    <MaterialCommunityIcons name="lock-open-outline" size={16} color={c.text} />
                                    <Text style={[styles.secondaryBtnText, { color: c.text }]}>Unlock</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.secondaryBtn, { backgroundColor: c.pillBg, borderColor: c.border }]}
                                    onPress={handleShare}
                                    activeOpacity={0.7}
                                >
                                    <MaterialCommunityIcons name="share-variant-outline" size={16} color={c.text} />
                                    <Text style={[styles.secondaryBtnText, { color: c.text }]}>Share</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                ) : (
                    <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <MaterialCommunityIcons name="package-variant" size={40} color={c.textTer} />
                        <Text style={[styles.emptyTitle, { color: c.textSec }]}>No active delivery</Text>
                        <Text style={[styles.emptySub, { color: c.textTer }]}>Book a service to get started</Text>
                    </View>
                )}
                </Animated.View>

                {/* ── Book Action ────────────────────────────────────────── */}
                <Animated.View style={actionsAnim.style}>
                <TouchableOpacity
                    style={[styles.bookCard, { backgroundColor: c.accent }]}
                    onPress={() => navigation.navigate('BookService')}
                    activeOpacity={0.85}
                >
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.bookTitle, { color: c.bg }]}>Send a Package</Text>
                        <Text style={[styles.bookSub, { color: c.bg + 'AA' }]}>Fast, secure delivery</Text>
                    </View>
                    <View style={[styles.bookIcon, { backgroundColor: c.bg }]}>
                        <MaterialCommunityIcons name="moped" size={28} color={c.accent} />
                    </View>
                </TouchableOpacity>

                {/* ── Quick Actions ──────────────────────────────────────── */}
                <View style={styles.quickRow}>
                    <QuickAction icon="calculator" label="Rates" c={c} onPress={() => navigation.navigate('Rates')} />
                    <QuickAction icon="history" label="History" c={c} onPress={() => navigation.navigate('DeliveryLog')} />
                    <QuickAction icon="file-document-outline" label="Report" c={c} onPress={() => navigation.navigate('Report')} />
                </View>
                </Animated.View>

                {/* ── Recent Activity ────────────────────────────────────── */}
                <Text style={[styles.sectionTitle, { color: c.text }]}>Recent Activity</Text>
                {recentActivity.length > 0 ? (
                    recentActivity.map((a, idx) => {
                        const sc = statusColor(a.status);
                        const rowAnim = activityAnim[Math.min(idx, activityAnim.length - 1)];
                        return (
                            <Animated.View key={a.id} style={rowAnim.style}>
                            <View style={[styles.activityRow, { backgroundColor: c.card, borderColor: c.border }]}>
                                <View style={[styles.activityDot, { backgroundColor: sc + '22' }]}>
                                    <View style={[styles.activityDotInner, { backgroundColor: sc }]} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.activityId, { color: c.text }]}>{a.trackingId}</Text>
                                    <Text style={[styles.activitySub, { color: c.textSec }]}>{a.serviceType}</Text>
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={[styles.activityStatus, { color: sc }]}>{formatStatus(a.status)}</Text>
                                    <Text style={[styles.activityDate, { color: c.textTer }]}>{a.date}</Text>
                                </View>
                            </View>
                            </Animated.View>
                        );
                    })
                ) : (
                    <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <MaterialCommunityIcons name="history" size={36} color={c.textTer} />
                        <Text style={[styles.emptyTitle, { color: c.textSec }]}>No recent activity</Text>
                    </View>
                )}
            </ScrollView>

            {/* ── Share Warning Modal ────────────────────────────────────── */}
            <Portal>
                <Modal visible={shareModalVisible} onDismiss={() => setShareModalVisible(false)}
                    contentContainerStyle={[styles.modal, { backgroundColor: c.card }]}
                >
                    <View style={{ alignItems: 'center' }}>
                        <View style={[styles.modalIcon, { backgroundColor: c.red + '14' }]}>
                            <MaterialCommunityIcons name="shield-lock-outline" size={40} color={c.red} />
                        </View>
                        <Text style={[styles.modalTitle, { color: c.red }]}>Security Warning</Text>
                        <Text style={[styles.modalBody, { color: c.text }]}>
                            You are about to share a live tracking link.{'\n\n'}
                            <Text style={{ fontWeight: '700' }}>Only share with the intended recipient.</Text>
                            {'\n'}They may be able to unlock the box.
                        </Text>
                        <TouchableOpacity
                            style={[styles.primaryBtn, { backgroundColor: c.accent, width: '100%', marginBottom: 10 }]}
                            onPress={performShare} activeOpacity={0.8}
                        >
                            <Text style={[styles.primaryBtnText, { color: c.bg }]}>I Understand, Share</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.secondaryBtn, { borderColor: c.border, width: '100%' }]}
                            onPress={() => setShareModalVisible(false)} activeOpacity={0.7}
                        >
                            <Text style={[styles.secondaryBtnText, { color: c.textSec }]}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </Modal>
            </Portal>

            {/* ── Proof Modal ────────────────────────────────────────────── */}
            <Portal>
                <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)}
                    contentContainerStyle={[styles.modal, { backgroundColor: c.card }]}
                >
                    <IconButton icon="close" size={22} iconColor={c.textSec} onPress={() => setModalVisible(false)} style={styles.modalClose} />
                    <Text style={[styles.modalTitle, { color: c.text }]}>Delivery Proof</Text>
                    <Text style={{ color: c.textSec }}>No proof image available.</Text>
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
function InfoRow({ icon, text, c }: { icon: string; text: string; c: typeof lightC }) {
    return (
        <View style={styles.infoRow}>
            <MaterialCommunityIcons name={icon as any} size={16} color={c.textSec} />
            <Text style={[styles.infoText, { color: c.text }]} numberOfLines={1}>{text}</Text>
        </View>
    );
}

function QuickAction({ icon, label, onPress, c }: { icon: string; label: string; onPress: () => void; c: typeof lightC }) {
    return (
        <TouchableOpacity style={styles.quickItem} onPress={onPress} activeOpacity={0.7}>
            <View style={[styles.quickIcon, { backgroundColor: c.pillBg, borderColor: c.border }]}>
                <MaterialCommunityIcons name={icon as any} size={22} color={c.accent} />
            </View>
            <Text style={[styles.quickLabel, { color: c.textSec }]}>{label}</Text>
        </TouchableOpacity>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1 },
    // Header
    headerBg: { justifyContent: 'flex-end' },
    headerOverlay: {
        flex: 1, justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: 20,
        backgroundColor: 'rgba(0,0,0,0.15)', borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    locRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
    locText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginLeft: 4 },
    dateText: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' },
    timeText: { color: '#FFFFFF', fontSize: 30, fontWeight: '800' },
    weatherPill: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', padding: 8, borderRadius: 14 },
    weatherTemp: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    weatherCond: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
    // Scroll
    scroll: { paddingHorizontal: 16, paddingTop: 16 },
    // Greeting
    greetRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
    greetLabel: { fontSize: 14 },
    greetName: { fontSize: 26, fontWeight: '800' },
    avatarFallback: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    avatarLetter: { fontSize: 20, fontWeight: '700' },
    // Cancellation
    cancelBanner: {
        flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
        borderWidth: 1, marginBottom: 16,
    },
    cancelIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    cancelTitle: { fontSize: 14, fontWeight: '700' },
    cancelSub: { fontSize: 12, marginTop: 1 },
    // Section
    sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10, marginTop: 6 },
    // Delivery card
    deliveryCard: { borderRadius: 16, borderWidth: 1, marginBottom: 20, overflow: 'hidden' },
    deliveryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
    deliveryIdRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    deliveryId: { fontSize: 14, fontWeight: '700' },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    statusPillText: { fontSize: 12, fontWeight: '700' },
    deliveryBody: { padding: 14, gap: 8 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    infoText: { fontSize: 14 },
    deliveryActions: { padding: 14, paddingTop: 0, gap: 10 },
    primaryBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 14, borderRadius: 14, gap: 8,
    },
    primaryBtnText: { fontSize: 15, fontWeight: '700' },
    secondaryBtnRow: { flexDirection: 'row', gap: 10 },
    secondaryBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 12, borderRadius: 12, borderWidth: 1, gap: 6,
    },
    secondaryBtnText: { fontSize: 13, fontWeight: '600' },
    // Empty
    emptyCard: {
        alignItems: 'center', padding: 28, borderRadius: 16, borderWidth: 1, marginBottom: 20,
    },
    emptyTitle: { fontSize: 15, fontWeight: '600', marginTop: 10 },
    emptySub: { fontSize: 13, marginTop: 3 },
    // Book card
    bookCard: {
        flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 16, marginBottom: 20,
    },
    bookTitle: { fontSize: 18, fontWeight: '800' },
    bookSub: { fontSize: 13, marginTop: 2 },
    bookIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    // Quick actions
    quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
    quickItem: { alignItems: 'center', width: '30%' },
    quickIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 6 },
    quickLabel: { fontSize: 12, fontWeight: '500' },
    // Activity
    activityRow: {
        flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
        borderWidth: 1, marginBottom: 10, gap: 12,
    },
    activityDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    activityDotInner: { width: 10, height: 10, borderRadius: 5 },
    activityId: { fontSize: 14, fontWeight: '600' },
    activitySub: { fontSize: 12, marginTop: 1 },
    activityStatus: { fontSize: 12, fontWeight: '700' },
    activityDate: { fontSize: 11, marginTop: 1 },
    // Modal
    modal: { padding: 24, margin: 24, borderRadius: 20, alignItems: 'center' },
    modalIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
    modalBody: { textAlign: 'center', lineHeight: 22, marginBottom: 20, fontSize: 14 },
    modalClose: { position: 'absolute', right: 0, top: 0 },
});
