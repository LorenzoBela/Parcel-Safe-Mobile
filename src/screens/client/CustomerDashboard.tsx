import React, { useState, useEffect, useCallback, useRef } from 'react';
import NotificationBell from '../../components/NotificationBell';
import { View, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Alert, RefreshControl, Share, Animated, FlatList, Dimensions } from 'react-native';
import { useEntryAnimation, useStaggerAnimation, usePressScale } from '../../hooks/useEntryAnimation';
import { Text, Avatar, Portal, Modal, IconButton } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
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
import { fetchWeather, WeatherData } from '../../services/weatherService';
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAROUSEL_CARD_WIDTH = SCREEN_WIDTH - 32;

const WEATHER_ANIMATIONS: Record<string, any> = {
    Sunny: require('../../../assets/weather/sunny.json'),
    Cloudy: require('../../../assets/weather/cloudy.json'),
    Rainy: require('../../../assets/weather/rainy.json'),
    Thunder: require('../../../assets/weather/thunder.json'),
    Foggy: require('../../../assets/weather/foggy.json'),
    Snowy: require('../../../assets/weather/snowy.json'),
    ClearNight: require('../../../assets/weather/clear_night.json'),
    CloudyNight: require('../../../assets/weather/cloudy_night.json'),
    RainyNight: require('../../../assets/weather/rainy_night.json'),
    SnowyNight: require('../../../assets/weather/snowy_night.json'),
};

const WEATHER_NIGHT_VARIANTS: Record<string, { key: string; label: string }> = {
    Sunny: { key: 'ClearNight', label: 'Clear Night' },
    Cloudy: { key: 'CloudyNight', label: 'Cloudy Night' },
    Rainy: { key: 'RainyNight', label: 'Rainy Night' },
    Snowy: { key: 'SnowyNight', label: 'Snowy Night' },
};

type WeatherAtmosphere = {
    base: string;
    panel: string;
    chip: string;
    lineSoft: string;
    lineStrong: string;
    sparkle: string;
    accent: string;
};

const WEATHER_STRIPE_POSITIONS = [10, 22, 34, 46, 58, 70, 82];

const WEATHER_SPARKLE_POINTS = [
    { top: 22, left: 18 },
    { top: 36, left: 28 },
    { top: 26, left: 72 },
    { top: 44, left: 80 },
    { top: 64, left: 24 },
    { top: 74, left: 66 },
];

const WEATHER_ATMOSPHERE: Record<string, WeatherAtmosphere> = {
    Sunny: {
        base: '#132844',
        panel: 'rgba(10, 24, 39, 0.9)',
        chip: 'rgba(255, 255, 255, 0.18)',
        lineSoft: 'rgba(255, 232, 173, 0.14)',
        lineStrong: 'rgba(255, 217, 131, 0.34)',
        sparkle: 'rgba(255, 222, 145, 0.42)',
        accent: '#FFD06B',
    },
    Cloudy: {
        base: '#172C41',
        panel: 'rgba(12, 24, 39, 0.9)',
        chip: 'rgba(255, 255, 255, 0.16)',
        lineSoft: 'rgba(185, 211, 238, 0.13)',
        lineStrong: 'rgba(165, 198, 232, 0.32)',
        sparkle: 'rgba(198, 224, 249, 0.35)',
        accent: '#A7D2FF',
    },
    Rainy: {
        base: '#10263B',
        panel: 'rgba(8, 20, 33, 0.9)',
        chip: 'rgba(255, 255, 255, 0.14)',
        lineSoft: 'rgba(132, 185, 241, 0.13)',
        lineStrong: 'rgba(116, 174, 236, 0.3)',
        sparkle: 'rgba(158, 206, 255, 0.28)',
        accent: '#74B8FF',
    },
    Thunder: {
        base: '#211A37',
        panel: 'rgba(16, 12, 31, 0.9)',
        chip: 'rgba(255, 255, 255, 0.14)',
        lineSoft: 'rgba(189, 161, 255, 0.12)',
        lineStrong: 'rgba(255, 205, 122, 0.32)',
        sparkle: 'rgba(255, 214, 138, 0.38)',
        accent: '#FFC86B',
    },
    Foggy: {
        base: '#2A3B4A',
        panel: 'rgba(21, 32, 43, 0.9)',
        chip: 'rgba(255, 255, 255, 0.16)',
        lineSoft: 'rgba(222, 236, 247, 0.12)',
        lineStrong: 'rgba(207, 228, 244, 0.3)',
        sparkle: 'rgba(231, 244, 255, 0.26)',
        accent: '#D6EEFF',
    },
    Snowy: {
        base: '#25405A',
        panel: 'rgba(17, 34, 52, 0.9)',
        chip: 'rgba(255, 255, 255, 0.18)',
        lineSoft: 'rgba(214, 237, 255, 0.13)',
        lineStrong: 'rgba(189, 223, 250, 0.3)',
        sparkle: 'rgba(223, 243, 255, 0.34)',
        accent: '#CFEFFF',
    },
    NightClear: {
        base: '#0D1A2F',
        panel: 'rgba(6, 14, 28, 0.9)',
        chip: 'rgba(255, 255, 255, 0.14)',
        lineSoft: 'rgba(163, 195, 255, 0.11)',
        lineStrong: 'rgba(145, 184, 255, 0.27)',
        sparkle: 'rgba(171, 203, 255, 0.28)',
        accent: '#9FC4FF',
    },
};

// ─── Promo Carousel Data ────────────────────────────────────────────────────────
const PROMO_SLIDES = [
    {
        id: '1',
        icon: 'gift-outline' as const,
        headline: 'Refer a Friend',
        subtitle: 'Share the love — earn free deliveries for every referral.',
        cta: 'Learn More',
    },
    {
        id: '2',
        icon: 'lightning-bolt' as const,
        headline: 'Try Premium Delivery',
        subtitle: 'Priority handling & real-time photo proof for your parcels.',
        cta: 'Upgrade Now',
    },
    {
        id: '3',
        icon: 'star-outline' as const,
        headline: 'Rate Your Experience',
        subtitle: 'Your feedback helps us improve Parcel-Safe for everyone.',
        cta: 'Rate Us',
    },
    {
        id: '4',
        icon: 'shield-check-outline' as const,
        headline: 'Safety First',
        subtitle: 'Your package is always photographed before unlock for security.',
        cta: 'See How',
    },
];

const ACTIVE_DELIVERY_STATUSES = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED', 'RETURNING', 'TAMPERED'];

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
        case 'RETURNED': return 'Returned';
        case 'TAMPERED': return 'Security Hold';
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
    const [totalDeliveries, setTotalDeliveries] = useState(0);
    const [completedDeliveries, setCompletedDeliveries] = useState(0);
    const [inTransitDeliveries, setInTransitDeliveries] = useState(0);

    // Carousel state
    const [activeSlide, setActiveSlide] = useState(0);
    const flatListRef = useRef<FlatList>(null);
    const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
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
                .in('status', ACTIVE_DELIVERY_STATUSES)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (error && error.code !== 'PGRST116') { setActiveDelivery(null); return; }
            if (data) {
                setActiveDelivery({
                    id: data.id, status: data.status,
                    eta: data.estimated_dropoff_time ? dayjs(data.estimated_dropoff_time).format('h:mm A') : null,
                    rider: data.rider?.full_name || 'Finding a rider...',
                    location: ['RETURNING', 'TAMPERED'].includes(data.status)
                        ? (data.pickup_address || 'Return destination')
                        : data.status === 'PENDING'
                            ? (data.pickup_address || 'Pickup Point')
                            : (data.dropoff_address || 'Dropoff Point'),
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

    // ─── Delivery stats ─────────────────────────────────────────────────────
    const fetchDeliveryStats = useCallback(async () => {
        if (!authedUser?.userId) return;
        try {
            const { count: total } = await supabase
                .from('deliveries')
                .select('*', { count: 'exact', head: true })
                .eq('customer_id', authedUser.userId);
            setTotalDeliveries(total ?? 0);

            const { count: completed } = await supabase
                .from('deliveries')
                .select('*', { count: 'exact', head: true })
                .eq('customer_id', authedUser.userId)
                .in('status', ['COMPLETED', 'RETURNED']);
            setCompletedDeliveries(completed ?? 0);

            const { count: inTransit } = await supabase
                .from('deliveries')
                .select('*', { count: 'exact', head: true })
                .eq('customer_id', authedUser.userId)
                .in('status', ACTIVE_DELIVERY_STATUSES);
            setInTransitDeliveries(inTransit ?? 0);
        } catch { /* silent */ }
    }, [authedUser?.userId]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([fetchLocation(), fetchActiveDelivery(), fetchRecentActivity(), fetchDeliveryStats()]);
        setRefreshing(false);
    }, [fetchLocation, fetchActiveDelivery, fetchRecentActivity, fetchDeliveryStats]);

    useFocusEffect(useCallback(() => {
        fetchActiveDelivery();
        fetchRecentActivity();
        fetchDeliveryStats();
    }, [fetchActiveDelivery, fetchRecentActivity, fetchDeliveryStats]));

    const getGreeting = () => {
        const h = currentTime.hour();
        if (h < 12) return 'Good Morning';
        if (h < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    const greetAnim = useEntryAnimation(0);
    const statsAnim = useEntryAnimation(40);
    const deliveryAnim = useEntryAnimation(80);
    const actionsAnim = useEntryAnimation(130);
    const activityAnim = useStaggerAnimation(3, 60, 180);
    const carouselAnim = useEntryAnimation(360);
    const trackBtnScale = usePressScale();
    const weatherCondition = weather?.condition || 'Sunny';
    const isNightTime = currentTime.hour() >= 18 || currentTime.hour() < 6;
    const nightVariant = isNightTime ? WEATHER_NIGHT_VARIANTS[weatherCondition] : undefined;
    const isNightVariant = Boolean(nightVariant);
    const weatherDisplayCondition = nightVariant?.label || weatherCondition;
    const weatherAnimationKey = nightVariant?.key || weatherCondition;
    const weatherAnimation = WEATHER_ANIMATIONS[weatherAnimationKey] || WEATHER_ANIMATIONS.Sunny;
    const isSunnyAnimation = weatherAnimationKey === 'Sunny' || weatherAnimationKey === 'ClearNight';
    const weatherAtmosphere = isNightVariant
        ? WEATHER_ATMOSPHERE.NightClear
        : (WEATHER_ATMOSPHERE[weatherCondition] || WEATHER_ATMOSPHERE.Sunny);
    const weatherScrimColor = isNightVariant ? 'rgba(2, 8, 18, 0.22)' : 'rgba(2, 8, 18, 0.14)';
    const weatherTemp = weather?.temp || '--°';
    const weatherLowTemp = weather?.lowTemp || '--°';
    const weatherHighTemp = weather?.highTemp || '--°';
    const weatherHeatIndex = weather?.heatIndex || '--°';
    const weatherRainChance = weather?.rainChance || '--%';
    const numericTemp = Number.parseInt(weatherTemp, 10);
    const numericLow = Number.parseInt(weatherLowTemp, 10);
    const numericHigh = Number.parseInt(weatherHighTemp, 10);
    const numericHeat = Number.parseInt(weatherHeatIndex, 10);
    const numericRain = Number.parseInt(weatherRainChance, 10);
    const hasRainInsight = Number.isFinite(numericRain);
    const hasHeatInsight = Number.isFinite(numericHeat);
    const hasRangeInsight = Number.isFinite(numericLow) && Number.isFinite(numericHigh);
    const weatherInsight = hasHeatInsight && hasRainInsight
        ? `Feels ${weatherHeatIndex} • Rain ${weatherRainChance}`
        : hasHeatInsight
            ? `Feels like ${weatherHeatIndex}`
            : hasRainInsight
                ? `Rain ${weatherRainChance}`
            : hasRangeInsight
                ? `H ${weatherHighTemp} • L ${weatherLowTemp}`
                : '';

    // ─── Carousel auto-scroll ───────────────────────────────────────────────
    useEffect(() => {
        autoScrollTimer.current = setInterval(() => {
            setActiveSlide((prev) => {
                const next = (prev + 1) % PROMO_SLIDES.length;
                flatListRef.current?.scrollToIndex({ index: next, animated: true });
                return next;
            });
        }, 4000);
        return () => {
            if (autoScrollTimer.current) clearInterval(autoScrollTimer.current);
        };
    }, []);

    const handleCarouselScrollEnd = useCallback((e: any) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / CAROUSEL_CARD_WIDTH);
        setActiveSlide(idx);
    }, []);

    // ═══════════════════════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════════════════════

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar barStyle="light-content" />

            {/* ── Animated Weather Atmosphere ─────────────────────────────── */}
            <View style={styles.headerShell}>
                <View style={[styles.atmosphereBase, { backgroundColor: weatherAtmosphere.base, paddingTop: insets.top + 8 }]}> 
                    <View style={[styles.atmosphereFrame, { borderColor: weatherAtmosphere.lineSoft }]} />
                    <View style={[styles.atmosphereCornerTopLeft, { borderColor: weatherAtmosphere.lineStrong }]} />
                    <View style={[styles.atmosphereCornerBottomRight, { borderColor: weatherAtmosphere.lineStrong }]} />
                    <View style={[styles.atmosphereArcOuter, { borderColor: weatherAtmosphere.lineStrong }]} />
                    <View style={[styles.atmosphereArcInner, { borderColor: weatherAtmosphere.lineSoft }]} />
                    {WEATHER_STRIPE_POSITIONS.map((left) => (
                        <View
                            key={`stripe-${left}`}
                            style={[
                                styles.atmosphereStripe,
                                { left: `${left}%`, backgroundColor: weatherAtmosphere.lineSoft },
                            ]}
                        />
                    ))}
                    {WEATHER_SPARKLE_POINTS.map((point, idx) => (
                        <View
                            key={`spark-${idx}`}
                            style={[
                                styles.atmosphereSparkle,
                                {
                                    top: `${point.top}%`,
                                    left: `${point.left}%`,
                                    backgroundColor: weatherAtmosphere.sparkle,
                                },
                            ]}
                        />
                    ))}
                    <View style={[styles.atmosphereScrim, { backgroundColor: weatherScrimColor }]} />

                    <View style={styles.headerMetaRow}>
                        <View style={[styles.locationChip, { backgroundColor: weatherAtmosphere.chip }]}> 
                            <MaterialCommunityIcons name="map-marker-radius" size={14} color="rgba(255,255,255,0.92)" />
                            <Text style={styles.locationChipText} numberOfLines={1}>{locationName}</Text>
                        </View>
                        <View style={[styles.iconBox, { backgroundColor: weatherAtmosphere.chip, borderColor: 'rgba(255,255,255,0.28)' }]}> 
                            <NotificationBell color="#FFFFFF" size={20} compact />
                        </View>
                    </View>

                    <View style={[styles.weatherHeroCard, { backgroundColor: weatherAtmosphere.panel }]}> 
                        <View style={styles.weatherHeroTopRow}>
                            <Text style={styles.heroDate}>{currentTime.format('dddd, MMM D')}</Text>
                        </View>

                        <View style={styles.weatherHeroBody}>
                            <View style={styles.heroTempColumn}>
                                <Text style={styles.heroCondition}>{weatherDisplayCondition}</Text>
                                <Text style={styles.heroTemp}>{weatherTemp}</Text>
                                {weatherInsight ? (
                                    <Text style={styles.heroInsightText}>{weatherInsight}</Text>
                                ) : null}
                            </View>

                            <View style={styles.heroAnimationWrap}>
                                <LottieView
                                    source={weatherAnimation}
                                    autoPlay
                                    loop
                                    resizeMode="contain"
                                    style={[styles.heroAnimation, isSunnyAnimation && styles.heroAnimationSunny]}
                                />
                            </View>
                        </View>
                    </View>
                </View>
            </View>

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
                            <Animated.View style={trackBtnScale.style}>
                            <TouchableOpacity
                                style={[styles.primaryBtn, { backgroundColor: c.accent }]}
                                onPress={() => navigation.navigate('TrackOrder', { bookingId: activeDelivery.id })}
                                onPressIn={trackBtnScale.onPressIn}
                                onPressOut={trackBtnScale.onPressOut}
                                activeOpacity={0.8}
                            >
                                <MaterialCommunityIcons name="map" size={18} color={c.bg} />
                                <Text style={[styles.primaryBtnText, { color: c.bg }]}>Track Order</Text>
                            </TouchableOpacity>
                            </Animated.View>
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
                        <View style={[styles.emptyIconWrap, { backgroundColor: c.accent + '08' }]}>
                            <MaterialCommunityIcons name="package-variant" size={32} color={c.textTer} />
                        </View>
                        <Text style={[styles.emptyTitle, { color: c.textSec }]}>No active delivery</Text>
                        <Text style={[styles.emptySub, { color: c.textTer }]}>Tap Send a Package below to book your first delivery</Text>
                    </View>
                )}
                </Animated.View>

                {/* ── Book Action ────────────────────────────────────────── */}
                <Animated.View style={actionsAnim.style}>
                <TouchableOpacity
                    style={[styles.bookCard, { backgroundColor: isDarkMode ? c.pillBg : c.accent }]}
                    onPress={() => navigation.navigate('BookService')}
                    activeOpacity={0.85}
                >
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.bookTitle, { color: isDarkMode ? c.text : c.bg }]}>Send a Package</Text>
                        <Text style={[styles.bookSub, { color: isDarkMode ? c.textSec : (c.bg + 'AA') }]}>Fast, secure delivery</Text>
                    </View>
                    <View style={[styles.bookIcon, { backgroundColor: isDarkMode ? c.bg : c.bg }]}>
                        <MaterialCommunityIcons name="moped" size={28} color={isDarkMode ? c.text : c.accent} />
                    </View>
                </TouchableOpacity>

                {/* ── Quick Actions ──────────────────────────────────────── */}
                <View style={[styles.gridRow, { marginBottom: 12 }]}>
                    <QuickAction icon="calculator" label="Rates" c={c} onPress={() => navigation.navigate('Rates')} />
                    <QuickAction icon="history" label="History" c={c} onPress={() => navigation.navigate('DeliveryLog')} />
                    <QuickAction icon="file-document-outline" label="Report" c={c} onPress={() => navigation.navigate('Report')} />
                </View>
                </Animated.View>

                {/* ── Stats Strip ──────────────────────────────────────── */}
                <Animated.View style={[styles.gridRow, statsAnim.style, { marginBottom: 24 }]}>
                    <View style={[styles.gridItem, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.statValue, { color: c.text }]}>{totalDeliveries}</Text>
                        <Text style={[styles.statLabel, { color: c.textTer }]}>TOTAL</Text>
                    </View>
                    <View style={[styles.gridItem, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.statValue, { color: c.text }]}>{completedDeliveries}</Text>
                        <Text style={[styles.statLabel, { color: c.textTer }]}>COMPLETED</Text>
                    </View>
                    <View style={[styles.gridItem, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.statValue, { color: c.text }]}>{inTransitDeliveries}</Text>
                        <Text style={[styles.statLabel, { color: c.textTer }]}>ACTIVE</Text>
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
                        <View style={[styles.emptyIconWrap, { backgroundColor: c.accent + '08' }]}>
                            <MaterialCommunityIcons name="history" size={28} color={c.textTer} />
                        </View>
                        <Text style={[styles.emptyTitle, { color: c.textSec }]}>No recent activity</Text>
                        <Text style={[styles.emptySub, { color: c.textTer }]}>Your delivery history will appear here</Text>
                    </View>
                )}

                {/* ── Promo Carousel ────────────────────────────────────────── */}
                <Animated.View style={carouselAnim.style}>
                    <Text style={[styles.sectionTitle, { color: c.text }]}>For You</Text>
                    <FlatList
                        ref={flatListRef}
                        data={PROMO_SLIDES}
                        keyExtractor={(item) => item.id}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        snapToInterval={CAROUSEL_CARD_WIDTH + 8}
                        decelerationRate="fast"
                        contentContainerStyle={{ paddingHorizontal: 0 }}
                        onMomentumScrollEnd={handleCarouselScrollEnd}
                        renderItem={({ item }) => (
                            <TouchableOpacity activeOpacity={0.8} onPress={() => {
                                if (item.id === '1') {
                                    PremiumAlert.alert('Refer a Friend', 'Your referral code is: PARCEL2026. Share it to earn free deliveries!', [{ text: 'Share Code', style: 'default' }], undefined, 'account-multiple-plus', c.accent);
                                } else if (item.id === '2') {
                                    PremiumAlert.alert('Premium Delivery', 'Upgrade to Premium for real-time photo proof and priority handling.', [{ text: 'Upgrade Now', style: 'default' }], undefined, 'star', '#F59E0B');
                                } else if (item.id === '3') {
                                    PremiumAlert.alert('Rate Us', 'We appreciate your feedback! Keep enjoying Parcel-Safe.', [{ text: 'Rate Now', style: 'default' }], undefined, 'star-circle', c.accent);
                                } else if (item.id === '4') {
                                    PremiumAlert.alert('Safety First', 'Learn more about our tamper-proof technology and secure OTP process on our website.', [{ text: 'Learn More', style: 'default' }], undefined, 'shield-check', '#10B981');
                                }
                            }}>
                                <View style={[styles.promoCard, { backgroundColor: c.card, borderColor: c.border, width: CAROUSEL_CARD_WIDTH }]}>
                                    <View style={[styles.promoIconWrap, { backgroundColor: c.accent + '10' }]}>
                                        <MaterialCommunityIcons name={item.icon as any} size={28} color={c.accent} />
                                    </View>
                                    <View style={styles.promoText}>
                                        <Text style={[styles.promoHeadline, { color: c.text }]}>{item.headline}</Text>
                                        <Text style={[styles.promoSub, { color: c.textSec }]} numberOfLines={2}>{item.subtitle}</Text>
                                    </View>
                                    <View style={[styles.promoCta, { backgroundColor: c.accent + '0D' }]}>
                                        <Text style={[styles.promoCtaText, { color: c.accent }]}>{item.cta}</Text>
                                        <MaterialCommunityIcons name="arrow-right" size={14} color={c.accent} />
                                    </View>
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                    <View style={styles.dotsRow}>
                        {PROMO_SLIDES.map((_, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.dot,
                                    {
                                        backgroundColor: i === activeSlide ? c.accent : c.border,
                                        width: i === activeSlide ? 18 : 6,
                                    },
                                ]}
                            />
                        ))}
                    </View>
                </Animated.View>
            </ScrollView>

            {/* ── Share Warning Modal ────────────────────────────────────── */}
            <Portal>
                <Modal visible={shareModalVisible} onDismiss={() => setShareModalVisible(false)}
                    contentContainerStyle={[styles.modal, { backgroundColor: c.card }]}
                >
                    <View style={{ alignItems: 'center', width: '100%' }}>
                        <View style={[styles.modalIcon, { backgroundColor: c.red + '14' }]}>
                            <MaterialCommunityIcons name="shield-lock-outline" size={40} color={c.red} />
                        </View>
                        <Text style={[styles.modalTitle, { color: c.red }]}>Security Warning</Text>
                        <Text style={[styles.modalBody, { color: c.text }]}>
                            You are about to share a live tracking link.{'\n\n'}
                            <Text style={{ fontFamily: 'Inter_700Bold' }}>Only share with the intended recipient.</Text>
                            {'\n'}They may be able to unlock the box.
                        </Text>
                        <TouchableOpacity
                            style={[styles.primaryBtn, { backgroundColor: c.accent, width: '100%', marginBottom: 10 }]}
                            onPress={performShare} activeOpacity={0.8}
                        >
                            <Text style={[styles.primaryBtnText, { color: c.bg }]}>I Understand, Share</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.secondaryBtn, { borderColor: c.border, width: '100%', flex: 0 }]}
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
        <TouchableOpacity style={[styles.gridItem, { backgroundColor: c.card, borderColor: c.border }]} onPress={onPress} activeOpacity={0.7}>
            <MaterialCommunityIcons name={icon as any} size={22} color={c.text} style={{ marginBottom: 2 }} />
            <Text style={[styles.quickLabel, { color: c.textSec }]}>{label}</Text>
        </TouchableOpacity>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1 },
    // Header
    headerShell: {
        paddingHorizontal: 8,
        paddingBottom: 4,
    },
    atmosphereBase: {
        minHeight: 186,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        paddingHorizontal: 12,
        paddingBottom: 8,
        overflow: 'hidden',
    },
    atmosphereFrame: {
        position: 'absolute',
        top: 6,
        left: 6,
        right: 6,
        bottom: 6,
        borderRadius: 18,
        borderWidth: 1,
    },
    atmosphereCornerTopLeft: {
        position: 'absolute',
        width: 26,
        height: 26,
        top: 12,
        left: 12,
        borderTopWidth: 1,
        borderLeftWidth: 1,
    },
    atmosphereCornerBottomRight: {
        position: 'absolute',
        width: 26,
        height: 26,
        right: 12,
        bottom: 12,
        borderBottomWidth: 1,
        borderRightWidth: 1,
    },
    atmosphereArcOuter: {
        position: 'absolute',
        width: 180,
        height: 180,
        borderRadius: 90,
        top: -122,
        right: -56,
        borderWidth: 1,
    },
    atmosphereArcInner: {
        position: 'absolute',
        width: 138,
        height: 138,
        borderRadius: 69,
        top: -101,
        right: -36,
        borderWidth: 1,
    },
    atmosphereStripe: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 1,
    },
    atmosphereSparkle: {
        position: 'absolute',
        width: 3,
        height: 3,
        borderRadius: 1.5,
    },
    atmosphereScrim: {
        ...StyleSheet.absoluteFillObject,
    },
    headerMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    locationChip: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '78%',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
        gap: 4,
    },
    locationChipText: {
        color: 'rgba(255,255,255,0.96)',
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    iconBox: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 5,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
    },
    weatherHeroCard: {
        borderRadius: 16,
        padding: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.26)',
        overflow: 'hidden',
    },
    weatherHeroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    heroDate: {
        color: 'rgba(255,255,255,0.94)',
        fontSize: 10,
        fontFamily: 'Inter_600SemiBold',
    },
    weatherHeroBody: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    heroTempColumn: {
        flex: 1,
        paddingRight: 2,
    },
    heroCondition: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 10,
        fontFamily: 'Inter_600SemiBold',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 1,
    },
    heroTemp: {
        color: '#FFFFFF',
        fontSize: 32,
        lineHeight: 34,
        fontFamily: 'SpaceGrotesk_700Bold',
        letterSpacing: -1.2,
    },
    heroInsightText: {
        marginTop: 4,
        color: 'rgba(255,255,255,0.9)',
        fontSize: 10,
        fontFamily: 'Inter_600SemiBold',
    },
    heroAnimationWrap: {
        width: 110,
        height: 94,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroAnimation: {
        width: 110,
        height: 94,
        alignSelf: 'center',
    },
    heroAnimationSunny: {
        transform: [{ scale: 1.22 }, { translateY: -4 }],
    },
    // Scroll
    scroll: { paddingHorizontal: 16, paddingTop: 16 },
    // Greeting
    greetRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
    greetLabel: { fontSize: 14 },
    greetName: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -1 },
    avatarFallback: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    avatarLetter: { fontSize: 20, fontFamily: 'Inter_700Bold' },
    // Cancellation
    cancelBanner: {
        flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
        borderWidth: 1, marginBottom: 16,
    },
    cancelIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    cancelTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
    cancelSub: { fontSize: 12, marginTop: 1 },
    // Section
    sectionTitle: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginTop: 6 },
    // Delivery card
    deliveryCard: { borderRadius: 16, borderWidth: 1, marginBottom: 20, overflow: 'hidden' },
    deliveryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
    deliveryIdRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    deliveryId: { fontSize: 14, fontFamily: 'Inter_700Bold' },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    statusPillText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
    deliveryBody: { padding: 14, gap: 8 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    infoText: { fontSize: 14 },
    deliveryActions: { padding: 14, paddingTop: 0, gap: 10 },
    primaryBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 14, borderRadius: 14, gap: 8,
    },
    primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    secondaryBtnRow: { flexDirection: 'row', gap: 10 },
    secondaryBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 12, borderRadius: 12, borderWidth: 1, gap: 6,
    },
    secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
    // Grid (Stats & Quick Actions)
    gridRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        marginBottom: 12, gap: 8,
    },
    gridItem: {
        flex: 1, alignItems: 'center', paddingVertical: 14,
        borderRadius: 14, borderWidth: 1, gap: 2,
    },
    // Stats specifics
    statValue: { fontSize: 22, fontFamily: 'JetBrainsMono_700Bold' },
    statLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, textTransform: 'uppercase' },
    // Empty
    emptyCard: {
        alignItems: 'center', padding: 28, borderRadius: 16, borderWidth: 1, marginBottom: 20,
    },
    emptyIconWrap: {
        width: 56, height: 56, borderRadius: 28,
        alignItems: 'center', justifyContent: 'center', marginBottom: 4,
    },
    emptyTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
    emptySub: { fontSize: 13, marginTop: 3, textAlign: 'center', paddingHorizontal: 20 },
    // Carousel
    promoCard: {
        borderRadius: 16, borderWidth: 1, padding: 18,
        marginRight: 8, overflow: 'hidden',
    },
    promoIconWrap: {
        width: 48, height: 48, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    promoText: { marginBottom: 14 },
    promoHeadline: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 4 },
    promoSub: { fontSize: 13, lineHeight: 18 },
    promoCta: {
        flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
        gap: 4, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    },
    promoCtaText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
    dotsRow: {
        flexDirection: 'row', justifyContent: 'center',
        alignItems: 'center', marginTop: 12, gap: 5, marginBottom: 10,
    },
    dot: {
        height: 6, borderRadius: 3,
    },
    // Book card
    bookCard: {
        flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 16, marginBottom: 20,
    },
    bookTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
    bookSub: { fontSize: 13, marginTop: 2 },
    bookIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    // Quick actions specifics
    quickLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    // Activity
    activityRow: {
        flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
        borderWidth: 1, marginBottom: 10, gap: 12,
    },
    activityDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    activityDotInner: { width: 10, height: 10, borderRadius: 5 },
    activityId: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
    activitySub: { fontSize: 12, marginTop: 1 },
    activityStatus: { fontSize: 12, fontFamily: 'Inter_700Bold' },
    activityDate: { fontSize: 11, marginTop: 1 },
    // Modal
    modal: { padding: 24, margin: 24, borderRadius: 20, alignItems: 'center' },
    modalIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 12 },
    modalBody: { textAlign: 'center', lineHeight: 22, marginBottom: 20, fontSize: 14 },
    modalClose: { position: 'absolute', right: 0, top: 0 },
});
