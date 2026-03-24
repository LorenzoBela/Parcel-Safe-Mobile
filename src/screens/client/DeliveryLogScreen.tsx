import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, StatusBar, TextInput, Animated } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabaseClient';
import { parseUTCString } from '../../utils/date';
import { triggerDeliverySync } from '../../services/deliverySyncService';
import useAuthStore from '../../store/authStore';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', search: '#F2F2F7', pillBg: '#F2F2F7',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', search: '#1C1C1E', pillBg: '#1C1C1E',
};

const mapStatus = (raw: string): string => {
    switch (raw) {
        case 'COMPLETED': return 'Delivered';
        case 'IN_TRANSIT': case 'ASSIGNED': case 'ARRIVED': return 'In Transit';
        case 'PENDING': return 'Pending';
        case 'TAMPERED': return 'Tampered';
        case 'CANCELLED': return 'Cancelled';
        case 'RETURNING': return 'Returning';
        case 'RETURNED': return 'Returned';
        default: return raw;
    }
};

function statusColor(s: string): string {
    switch (s) {
        case 'Delivered': return '#34C759';
        case 'In Transit': return '#007AFF';
        case 'Pending': return '#FF9500';
        case 'Cancelled': case 'Returned': return '#8E8E93';
        case 'Tampered': case 'Returning': return '#FF3B30';
        default: return '#8E8E93';
    }
}

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const FILTERS: { key: string; icon: string; color: string }[] = [
    { key: 'All', icon: 'format-list-bulleted', color: '#8E8E93' },
    { key: 'Delivered', icon: 'check-circle', color: '#34C759' },
    { key: 'In Transit', icon: 'truck-delivery', color: '#007AFF' },
    { key: 'Pending', icon: 'clock-outline', color: '#FF9500' },
    { key: 'Cancelled', icon: 'close-circle', color: '#8E8E93' },
    { key: 'Tampered', icon: 'alert-circle', color: '#FF3B30' },
];

export default function DeliveryLogScreen() {
    const navigation = useNavigation<any>();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const userId = useAuthStore((state: any) => state.user?.userId);
    const insets = useSafeAreaInsets();

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFilter, setSelectedFilter] = useState('All');
    const [showFilters, setShowFilters] = useState(false);
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const fetchDeliveries = useCallback(async (isRefresh = false) => {
        if (!userId || !supabase) { setLoading(false); return; }
        if (isRefresh) setRefreshing(true); else setLoading(true);
        setErrorMsg(null);
        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, customer:customer_id(full_name)')
                .eq('customer_id', userId)
                .order('created_at', { ascending: false });
            if (error) { setErrorMsg('Failed to load history.'); return; }
            setLogs((data || []).map((d: any) => ({
                id: d.id,
                trk: d.tracking_number || d.id,
                status: mapStatus(d.status),
                rawStatus: d.status,
                date: d.created_at
                    ? parseUTCString(d.created_at).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' })
                    : 'N/A',
                rider: d.rider_name || 'Unassigned',
                price: d.estimated_fare != null ? `₱${Number(d.estimated_fare).toFixed(2)}` : '—',
                pickupAddress: d.pickup_address || 'No pickup address',
                dropoffAddress: d.dropoff_address || 'No dropoff address',
                distance: d.pickup_lat && d.pickup_lng && d.dropoff_lat && d.dropoff_lng
                    ? `${getDistanceFromLatLonInKm(d.pickup_lat, d.pickup_lng, d.dropoff_lat, d.dropoff_lng).toFixed(1)} km` : 'N/A',
            })));
        } catch { setErrorMsg('Something went wrong.'); }
        finally { setLoading(false); setRefreshing(false); }
    }, [userId]);

    useEffect(() => { fetchDeliveries(); }, [fetchDeliveries]);
    useFocusEffect(useCallback(() => { triggerDeliverySync().then(() => fetchDeliveries()); }, [fetchDeliveries]));

    const filtered = logs.filter(l =>
        l.trk.toLowerCase().includes(searchQuery.toLowerCase()) &&
        (selectedFilter === 'All' || l.status === selectedFilter)
    );

    // Count per filter for badges
    const countFor = (key: string) => key === 'All' ? logs.length : logs.filter(l => l.status === key).length;

    const renderItem = ({ item }: { item: any }) => {
        const sc = statusColor(item.status);
        return (
            <TouchableOpacity
                style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
                activeOpacity={0.7}
            >
                {/* Header */}
                <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTrk, { color: c.text }]} numberOfLines={1}>{item.trk}</Text>
                        <Text style={[styles.cardSub, { color: c.textSec }]}>{item.date}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: sc + '1A' }]}>
                        <Text style={[styles.statusPillText, { color: sc }]}>{item.status}</Text>
                    </View>
                </View>
                {/* Tampered alert */}
                {item.status === 'Tampered' && (
                    <View style={[styles.alertRow, { backgroundColor: '#FF3B30' + '14' }]}>
                        <MaterialCommunityIcons name="alert-circle" size={14} color="#FF3B30" />
                        <Text style={styles.alertText}>Tampering Detected!</Text>
                    </View>
                )}
                {/* Route */}
                <View style={styles.routeBlock}>
                    <View style={styles.routeRow}>
                        <View style={[styles.routeDot, { backgroundColor: c.accent }]} />
                        <Text style={[styles.routeText, { color: c.text }]} numberOfLines={1}>{item.pickupAddress}</Text>
                    </View>
                    <View style={[styles.routeLine, { backgroundColor: c.border }]} />
                    <View style={styles.routeRow}>
                        <View style={[styles.routeDot, { backgroundColor: c.textTer }]} />
                        <Text style={[styles.routeText, { color: c.text }]} numberOfLines={1}>{item.dropoffAddress}</Text>
                    </View>
                </View>
                {/* Footer */}
                <View style={[styles.cardFooter, { borderTopColor: c.border }]}>
                    <View style={styles.footerMeta}>
                        <MaterialCommunityIcons name="map-marker-distance" size={13} color={c.textTer} />
                        <Text style={[styles.footerText, { color: c.textSec }]}>{item.distance}</Text>
                    </View>
                    <View style={styles.footerMeta}>
                        <MaterialCommunityIcons name="motorbike" size={13} color={c.textTer} />
                        <Text style={[styles.footerText, { color: c.textSec }]}>{item.rider}</Text>
                    </View>
                    <Text style={[styles.fareText, { color: c.accent }]}>{item.price}</Text>
                </View>
            </TouchableOpacity>
        );
    };

    const headerAnim = useEntryAnimation(0);
    const listAnim = useEntryAnimation(60);

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

            {/* Header */}
            <Animated.View style={[styles.header, { backgroundColor: c.bg, paddingTop: insets.top + 10 }, headerAnim.style]}>
                <Text style={[styles.title, { color: c.text }]}>History</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {selectedFilter !== 'All' && (
                        <TouchableOpacity onPress={() => setSelectedFilter('All')} activeOpacity={0.7}>
                            <Text style={{ fontSize: 12, color: c.accent, fontFamily: 'Inter_600SemiBold' }}>Clear</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        onPress={() => setShowFilters(!showFilters)}
                        style={[styles.filterToggle, {
                            backgroundColor: showFilters ? c.accent : c.search,
                        }]}
                        activeOpacity={0.7}
                    >
                        <MaterialCommunityIcons
                            name={showFilters ? 'filter-off' : 'filter-variant'}
                            size={16}
                            color={showFilters ? c.bg : c.textSec}
                        />
                    </TouchableOpacity>
                </View>
            </Animated.View>

            {/* Search */}
            <View style={[styles.searchRow, { backgroundColor: c.search, marginHorizontal: 16, borderRadius: 10 }]}>
                <MaterialCommunityIcons name="magnify" size={16} color={c.textTer} />
                <TextInput
                    placeholder="Search tracking ID..."
                    placeholderTextColor={c.textTer}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    style={[styles.searchInput, { color: c.text }]}
                />
            </View>

            {/* Filters (collapsible) */}
            {showFilters && (
                <View style={styles.filterRow}>
                    {FILTERS.map(f => {
                        const active = selectedFilter === f.key;
                        const count = countFor(f.key);
                        return (
                            <TouchableOpacity
                                key={f.key}
                                onPress={() => setSelectedFilter(f.key)}
                                style={[styles.filterChip, {
                                    backgroundColor: active ? c.accent : 'transparent',
                                }]}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.filterChipText, { color: active ? c.bg : c.textSec }]}>
                                    {f.key}{count > 0 ? ` (${count})` : ''}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            )}

            {/* Results count */}
            <View style={styles.resultRow}>
                <Text style={[styles.resultText, { color: c.textTer }]}>
                    {filtered.length} {filtered.length === 1 ? 'delivery' : 'deliveries'}
                    {selectedFilter !== 'All' ? ` · ${selectedFilter}` : ''}
                </Text>
            </View>

            {/* List */}
            {loading ? (
                <View style={styles.emptyState}>
                    <ActivityIndicator size="large" color={c.accent} />
                    <Text style={[styles.emptyText, { color: c.textSec }]}>Loading...</Text>
                </View>
            ) : errorMsg ? (
                <View style={styles.emptyState}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={48} color="#FF3B30" />
                    <Text style={[styles.emptyText, { color: '#FF3B30' }]}>{errorMsg}</Text>
                    <TouchableOpacity onPress={() => fetchDeliveries()}>
                        <Text style={[styles.retryText, { color: c.accent }]}>Tap to retry</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={filtered}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ padding: 16, paddingBottom: 80 + insets.bottom }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchDeliveries(true)} />}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <MaterialCommunityIcons name="package-variant-closed" size={48} color={c.textTer} />
                            <Text style={[styles.emptyText, { color: c.textSec }]}>No deliveries found</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { paddingHorizontal: 20, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { fontSize: 28, fontFamily: 'Inter_700Bold' },
    filterToggle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6, marginBottom: 6 },
    searchInput: { flex: 1, fontSize: 14, padding: 0 },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 4, gap: 6 },
    filterChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
    filterChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    resultRow: { paddingHorizontal: 20, paddingBottom: 4, paddingTop: 2 },
    resultText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
    // Card
    card: { borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
    cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    cardTrk: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    cardSub: { fontSize: 12, marginTop: 1 },
    statusPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
    statusPillText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
    alertRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 6 },
    alertText: { color: '#FF3B30', fontSize: 12, fontFamily: 'Inter_700Bold' },
    routeBlock: { paddingHorizontal: 14, paddingBottom: 10 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    routeDot: { width: 8, height: 8, borderRadius: 4 },
    routeLine: { width: 1, height: 12, marginLeft: 3.5 },
    routeText: { fontSize: 13, flex: 1 },
    cardFooter: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 12 },
    footerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    footerText: { fontSize: 12 },
    fareText: { fontSize: 14, fontFamily: 'Inter_700Bold', marginLeft: 'auto' },
    // Empty
    emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100 },
    emptyText: { marginTop: 10, fontSize: 14 },
    retryText: { marginTop: 12, fontFamily: 'Inter_700Bold', fontSize: 14 },
});
