import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View, Animated, StyleSheet, ScrollView, RefreshControl,
    TouchableOpacity, StatusBar, FlatList, Dimensions,
} from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { Text, Avatar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { PremiumAlert } from '../../services/PremiumAlertService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAROUSEL_CARD_WIDTH = SCREEN_WIDTH - 32;

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF',
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

// ─── Info Row ───────────────────────────────────────────────────────────────────
function InfoRow({ icon, label, value, onPress, c }: {
    icon: string; label: string; value: string;
    onPress?: () => void; c: typeof light;
}) {
    const Wrapper = onPress ? TouchableOpacity : View;
    return (
        <Wrapper
            onPress={onPress}
            activeOpacity={0.6}
            style={[styles.row, { borderBottomColor: c.border }]}
        >
            <View style={[styles.rowIcon, { backgroundColor: c.accent + '10' }]}>
                <MaterialCommunityIcons name={icon as any} size={18} color={c.accent} />
            </View>
            <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: c.textSec }]}>{label}</Text>
                <Text style={[styles.rowValue, { color: c.text }]} numberOfLines={2}>{value}</Text>
            </View>
            {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} /> : null}
        </Wrapper>
    );
}

// ─── Stat Pill ──────────────────────────────────────────────────────────────────
function StatPill({ icon, label, value, c }: {
    icon: string; label: string; value: string; c: typeof light;
}) {
    return (
        <View style={[styles.statItem, { backgroundColor: c.card, borderColor: c.border }]}>
            <MaterialCommunityIcons name={icon as any} size={18} color={c.accent} />
            <Text style={[styles.statValue, { color: c.text }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: c.textTer }]}>{label}</Text>
        </View>
    );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
    const navigation = useNavigation<any>();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const [profile, setProfile] = useState<any>(null);
    const [defaultAddress, setDefaultAddress] = useState<string>('Not set');
    const [deliveryCount, setDeliveryCount] = useState<number>(0);
    const [completedCount, setCompletedCount] = useState<number>(0);
    const [savedAddressCount, setSavedAddressCount] = useState<number>(0);
    const [refreshing, setRefreshing] = useState(false);
    const insets = useSafeAreaInsets();

    // Carousel state
    const [activeSlide, setActiveSlide] = useState(0);
    const flatListRef = useRef<FlatList>(null);
    const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const extractAddressString = (val: any): string => {
        if (!val) return 'Not set';
        let current = val;
        if (typeof current === 'string') {
            try {
                current = JSON.parse(current);
            } catch {
                return current;
            }
        }
        if (current && typeof current === 'object' && current.address) {
            return typeof current.address === 'string' ? current.address : String(current.address);
        }
        return typeof val === 'string' ? val : String(val);
    };

    const fetchProfile = async () => {
        const { data: { user } } = await supabase!.auth.getUser();
        if (user) {
            const { data } = await supabase!
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();
            setProfile(data);

            if (data?.saved_addresses) {
                try {
                    const addresses = typeof data.saved_addresses === 'string'
                        ? JSON.parse(data.saved_addresses)
                        : data.saved_addresses;
                    if (Array.isArray(addresses)) {
                        const def = addresses.find((a: any) => a.isDefault);
                        setDefaultAddress(def ? extractAddressString(def.address) : extractAddressString(data.home_address));
                        setSavedAddressCount(addresses.length);
                    }
                } catch {
                    setDefaultAddress(extractAddressString(data.home_address));
                }
            } else {
                setDefaultAddress(extractAddressString(data?.home_address));
            }

            // Fetch delivery counts
            const { count: total } = await supabase!
                .from('deliveries')
                .select('*', { count: 'exact', head: true })
                .eq('customer_id', user.id);
            setDeliveryCount(total ?? 0);

            const { count: completed } = await supabase!
                .from('deliveries')
                .select('*', { count: 'exact', head: true })
                .eq('customer_id', user.id)
                .eq('status', 'COMPLETED');
            setCompletedCount(completed ?? 0);
        }
    };

    useFocusEffect(useCallback(() => { fetchProfile(); }, []));

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchProfile();
        setRefreshing(false);
    }, []);

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

    const handleScrollEnd = useCallback((e: any) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / CAROUSEL_CARD_WIDTH);
        setActiveSlide(idx);
    }, []);

    // ─── Animations ─────────────────────────────────────────────────────────
    const heroAnim = useEntryAnimation(0);
    const statsAnim = useEntryAnimation(80);
    const sectionAnims = useStaggerAnimation(2, 80, 160);
    const carouselAnim = useEntryAnimation(320);

    // ─── Derived display values ─────────────────────────────────────────────
    const roleName = profile?.role
        ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1).toLowerCase()
        : 'Customer';
    const memberSince = profile?.created_at
        ? dayjs(profile.created_at).format('MMM YYYY')
        : '—';

    return (
        <Animated.View style={[{ flex: 1 }, heroAnim.style]}>
        <ScrollView
            style={[styles.container, { backgroundColor: c.bg }]}
            contentContainerStyle={{ paddingBottom: insets.bottom + 60, paddingTop: insets.top }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            showsVerticalScrollIndicator={false}
        >
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

            {/* ── Hero Section ──────────────────────────────────────────── */}
            <View style={[styles.heroBanner, { backgroundColor: c.card }]}>
                <View style={styles.heroContent}>
                    {/* Avatar */}
                    <View style={styles.avatarContainer}>
                        <View style={[styles.avatarShadow, { shadowColor: c.accent }]}>
                            <Avatar.Image
                                size={110}
                                source={{ uri: profile?.avatar_url || 'https://i.pravatar.cc/150?img=12' }}
                            />
                        </View>
                    </View>

                    {/* Name & Email */}
                    <Text style={[styles.name, { color: c.text }]}>
                        {profile?.full_name || 'Loading...'}
                    </Text>
                    <Text style={[styles.email, { color: c.textSec }]}>
                        {profile?.email || 'User'}
                    </Text>

                    {/* Role Badge */}
                    <View style={[styles.roleBadge, { backgroundColor: c.accent + '12', borderColor: c.accent + '20' }]}>
                        <MaterialCommunityIcons
                            name={roleName === 'Rider' ? 'motorbike' : 'account'}
                            size={13}
                            color={c.accent}
                        />
                        <Text style={[styles.roleBadgeText, { color: c.accent }]}>{roleName}</Text>
                    </View>

                    {/* Member Since */}
                    <Text style={[styles.memberSince, { color: c.textTer }]}>
                        Member since {memberSince}
                    </Text>

                    {/* Edit Profile Button */}
                    <TouchableOpacity
                        style={[styles.editBtn, { backgroundColor: c.accent }]}
                        onPress={() => navigation.navigate('EditProfile')}
                        activeOpacity={0.8}
                    >
                        <MaterialCommunityIcons name="pencil" size={14} color={c.bg} />
                        <Text style={[styles.editBtnText, { color: c.bg }]}>Edit Profile</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* ── Stats Strip ──────────────────────────────────────────── */}
            <Animated.View style={[styles.statsRow, statsAnim.style]}>
                <StatPill icon="package-variant" label="Total" value={String(deliveryCount)} c={c} />
                <StatPill icon="check-circle-outline" label="Completed" value={String(completedCount)} c={c} />
                <StatPill icon="map-marker-multiple-outline" label="Addresses" value={String(savedAddressCount)} c={c} />
            </Animated.View>

            {/* ── Personal Details ──────────────────────────────────────── */}
            <Animated.View style={sectionAnims[0].style}>
                <Text style={[styles.sectionTitle, { color: c.textSec }]}>PERSONAL DETAILS</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    <InfoRow icon="phone-outline" label="Phone Number" value={profile?.phone_number || 'Not set'} c={c} />
                    <InfoRow icon="map-marker-star-outline" label="Default Address" value={defaultAddress} c={c} />
                </View>
            </Animated.View>

            {/* ── Quick Links ──────────────────────────────────────────── */}
            <Animated.View style={sectionAnims[1].style}>
                <Text style={[styles.sectionTitle, { color: c.textSec }]}>QUICK LINKS</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    <InfoRow
                        icon="bookmark-multiple-outline"
                        label="Saved Addresses"
                        value="Manage pickup/dropoff locations"
                        c={c}
                        onPress={() => navigation.navigate('SavedAddresses')}
                    />
                    <InfoRow
                        icon="account-multiple-outline"
                        label="Saved Contacts"
                        value="Quick-fill sender/recipient"
                        c={c}
                        onPress={() => navigation.navigate('SavedContacts')}
                    />
                </View>
            </Animated.View>

            {/* ── Promo Carousel ────────────────────────────────────────── */}
            <Animated.View style={carouselAnim.style}>
                <Text style={[styles.sectionTitle, { color: c.textSec }]}>FOR YOU</Text>
                <FlatList
                    ref={flatListRef}
                    data={PROMO_SLIDES}
                    keyExtractor={(item) => item.id}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={CAROUSEL_CARD_WIDTH + 8}
                    decelerationRate="fast"
                    contentContainerStyle={styles.carouselList}
                    onMomentumScrollEnd={handleScrollEnd}
                    renderItem={({ item }) => (
                        <TouchableOpacity activeOpacity={0.8} onPress={() => {
                            if (item.id === '1') {
                                PremiumAlert.alert('Refer a Friend', 'Your referral code is: PARCEL2026. Share the love to earn free deliveries!', [{ text: 'Share Code', style: 'default' }], undefined, 'account-multiple-plus', c.accent);
                            } else if (item.id === '2') {
                                PremiumAlert.alert('Try Premium Delivery', 'Priority handling & real-time photo proof for your parcels. Upgrade to Premium now.', [{ text: 'Upgrade Now', style: 'default' }], undefined, 'star', '#F59E0B');
                            } else if (item.id === '3') {
                                PremiumAlert.alert('Rate Your Experience', 'Your feedback helps us improve Parcel-Safe for everyone.', [{ text: 'Rate Us', style: 'default' }], undefined, 'star-circle', c.accent);
                            } else if (item.id === '4') {
                                PremiumAlert.alert('Safety First', 'Your package is always photographed before unlock for security. Learn more about our process.', [{ text: 'Learn More', style: 'default' }], undefined, 'shield-check', '#10B981');
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
                {/* Dot Indicators */}
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
        </Animated.View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1 },

    // Hero
    heroBanner: {
        paddingBottom: 28,
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
    },
    heroContent: {
        alignItems: 'center',
        paddingTop: 20,
        paddingHorizontal: 16,
    },
    avatarContainer: {
        position: 'relative',
        marginBottom: 14,
    },
    avatarShadow: {
        borderRadius: 60,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
        elevation: 10,
    },

    name: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
    email: { fontSize: 14, marginTop: 3 },
    roleBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        marginTop: 10, paddingHorizontal: 14, paddingVertical: 5,
        borderRadius: 20, borderWidth: 1,
    },
    roleBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.6 },
    memberSince: { fontSize: 12, marginTop: 8 },
    editBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 24, paddingVertical: 11, borderRadius: 24, marginTop: 14,
    },
    editBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold' },

    // Stats
    statsRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        marginHorizontal: 16, marginTop: 20, marginBottom: 8, gap: 8,
    },
    statItem: {
        flex: 1, alignItems: 'center', paddingVertical: 14,
        borderRadius: 14, borderWidth: 1, gap: 4,
    },
    statValue: { fontSize: 17, fontFamily: 'Inter_700Bold' },
    statLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },

    // Sections
    sectionTitle: {
        fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8,
        marginHorizontal: 20, marginBottom: 6, marginTop: 16,
    },
    section: {
        marginHorizontal: 16, borderRadius: 14, borderWidth: 1,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
        paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowIcon: {
        width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    },
    rowContent: { flex: 1, marginLeft: 12 },
    rowLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.4 },
    rowValue: { fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 1 },

    // Carousel
    carouselList: { paddingHorizontal: 16 },
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
        alignItems: 'center', marginTop: 12, gap: 5,
    },
    dot: {
        height: 6, borderRadius: 3,
    },
});
