import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Animated } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Chip, Searchbar, useTheme, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { triggerDeliverySync } from '../../services/deliverySyncService';
import useAuthStore from '../../store/authStore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { parseUTCString } from '../../utils/date';
import { useAppTheme } from '../../context/ThemeContext';

dayjs.extend(utc);
dayjs.extend(timezone);

const lightC = {
    bg: '#F7F7F8', card: '#FFFFFF', text: '#111111', textSec: '#6B6B6B', textTer: '#9E9E9E',
    accent: '#111111', accentText: '#FFFFFF', border: '#E5E5E5', divider: '#F0F0F0',
    search: '#F2F2F3',
};
const darkC = {
    bg: '#0D0D0D', card: '#1A1A1A', text: '#F5F5F5', textSec: '#A0A0A0', textTer: '#666666',
    accent: '#FFFFFF', accentText: '#000000', border: '#2A2A2A', divider: '#222222',
    search: '#1E1E1E',
};

/** Map Supabase DeliveryStatus to display-friendly labels */
const mapStatus = (raw: string): string => {
    switch (raw) {
        case 'COMPLETED': return 'Delivered';
        case 'IN_TRANSIT':
        case 'ASSIGNED':
        case 'ARRIVED':
            return 'In Transit';
        case 'PENDING': return 'Pending';
        case 'TAMPERED': return 'Tampered';
        case 'CANCELLED': return 'Cancelled';
        case 'RETURNING': return 'Returning';
        case 'RETURNED': return 'Returned';
        default: return raw;
    }
};

export default function DeliveryRecordsScreen() {
    const theme = useTheme();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const navigation = useNavigation<any>();
    const riderId = useAuthStore((state: any) => state.user?.userId);

    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState('All');
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    const [historyData, setHistoryData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const fetchDeliveries = useCallback(async (isRefresh = false) => {
        if (!riderId || !supabase) {
            setLoading(false);
            return;
        }

        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        setErrorMsg(null);

        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, profiles:customer_id(full_name)')
                .eq('rider_id', riderId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[DeliveryRecords] Supabase error:', error.message);
                setErrorMsg('Failed to load delivery records.');
            } else {
                const mapped = (data || []).map((d: any) => {
                    const rawTrk = d.tracking_number || d.id;
                    const shortTrk = rawTrk.length > 20 ? '...' + rawTrk.slice(-12) : rawTrk;

                      const timestampToUse = d.delivered_at || d.updated_at || d.created_at;
                      const dateObj = timestampToUse ? parseUTCString(timestampToUse) : null;
                      if (timestampToUse) {
                          const testDayjs = dayjs(timestampToUse).tz('Asia/Manila').format('h:mm A');
                          console.log(`[DeliveryRecords] ID: ${d.id}, Raw: ${timestampToUse}, DayJS: ${testDayjs}`);
                      }

                      return {
                          id: d.id,
                          trk: rawTrk,
                          shortTrk: shortTrk,
                          status: mapStatus(d.status),
                          rawStatus: d.status,
                          rawDate: timestampToUse,
                          date: dateObj ? dayjs(timestampToUse).add(8, 'hour').format('MMM D, YYYY') : 'N/A',
                          time: dateObj ? dayjs(timestampToUse).add(8, 'hour').format('h:mm A') : '',
                        customer: d.profiles?.full_name || 'Unknown Customer',
                        customerName: d.profiles?.full_name || 'Unknown Customer',
                        earnings: d.estimated_fare != null ? `₱${Number(d.estimated_fare).toFixed(2)}` : '—',
                        pickup: d.pickup_address || 'N/A',
                        dropoff: d.dropoff_address || 'N/A',
                        pickupAddress: d.pickup_address || 'N/A',
                        dropoffAddress: d.dropoff_address || 'N/A',
                        pickup_lat: d.pickup_lat,
                        pickup_lng: d.pickup_lng,
                        dropoff_lat: d.dropoff_lat,
                        dropoff_lng: d.dropoff_lng,
                        image: d.proof_of_delivery_url || d.image_url || null,
                        pickupImage: d.pickup_photo_url || null,
                        distance: d.distance_text || (d.distance ? `${d.distance.toFixed(1)} km` : 'N/A'),
                    };
                });
                setHistoryData(mapped);
            }
        } catch (err) {
            console.error('[DeliveryRecords] fetch error:', err);
            setErrorMsg('Something went wrong.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [riderId]);

    useEffect(() => {
        fetchDeliveries();
    }, [fetchDeliveries]);

    useFocusEffect(
        useCallback(() => {
            triggerDeliverySync().then(() => fetchDeliveries());
        }, [fetchDeliveries])
    );

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Delivered': return '#4CAF50';
            case 'In Transit': return '#2196F3';
            case 'Pending': return '#FF9800';
            case 'Cancelled': return '#F44336';
            case 'Tampered': return '#D32F2F';
            case 'Returning': return '#FF9800';
            case 'Returned': return '#9E9E9E';
            default: return '#757575';
        }
    };

    const currentDate = new Date();

    const filteredData = historyData.filter(item => {
        const matchesSearch = item.trk.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.customerName.toLowerCase().includes(searchQuery.toLowerCase());

        let matchesFilter = true;

        if (filter === 'Today') {
            const itemDate = parseUTCString(item.rawDate);
            matchesFilter =
                itemDate.getDate() === currentDate.getDate() &&
                itemDate.getMonth() === currentDate.getMonth() &&
                itemDate.getFullYear() === currentDate.getFullYear();
        } else if (filter === 'This Week') {
            const itemDate = parseUTCString(item.rawDate);
            const diffTime = Math.abs(currentDate.getTime() - itemDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            matchesFilter = diffDays <= 7;
        } else if (filter === 'This Month') {
            const itemDate = parseUTCString(item.rawDate);
            matchesFilter = itemDate.getMonth() === currentDate.getMonth() &&
                itemDate.getFullYear() === currentDate.getFullYear();
        }

        return matchesSearch && matchesFilter;
    });

    const totalEarnings = filteredData
        .filter(item => item.status === 'Delivered')
        .reduce((sum, item) => {
            const val = parseFloat(item.earnings.replace('₱', ''));
            return sum + (isNaN(val) ? 0 : val);
        }, 0);

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
            style={[styles.card, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}
        >
            <View style={styles.cardHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.text }} numberOfLines={1}>
                        {item.shortTrk}
                    </Text>
                    <Text variant="bodySmall" style={{ color: c.textSec }}>
                        {item.date} • {item.time}
                    </Text>
                </View>
                <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.accent }}>
                        {item.earnings}
                    </Text>
                    <View style={{ backgroundColor: getStatusColor(item.status) + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 2 }}>
                        <Text style={{ color: getStatusColor(item.status), fontWeight: 'bold', fontSize: 10 }}>
                            {item.status}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={[styles.divider, { backgroundColor: c.divider }]} />

            <View style={styles.row}>
                <View style={styles.iconBox}>
                    <MaterialCommunityIcons name="account" size={16} color={c.textSec} />
                </View>
                <Text variant="bodyMedium" style={[styles.rowText, { color: c.text, fontWeight: '600' }]}>
                    {item.customerName}
                </Text>
            </View>

            <View style={[styles.row, { alignItems: 'flex-start' }]}>
                <View style={[styles.iconBox, { marginTop: 2 }]}>
                    <MaterialCommunityIcons name="map-marker-up" size={16} color="#4CAF50" />
                </View>
                <Text variant="bodySmall" numberOfLines={2} style={[styles.rowText, { color: c.text }]}>
                    {item.pickup}
                </Text>
            </View>

            <View style={[styles.row, { alignItems: 'flex-start' }]}>
                <View style={[styles.iconBox, { marginTop: 2 }]}>
                    <MaterialCommunityIcons name="map-marker-down" size={16} color="#F44336" />
                </View>
                <Text variant="bodySmall" numberOfLines={2} style={[styles.rowText, { color: c.text }]}>
                    {item.dropoff}
                </Text>
            </View>
        </TouchableOpacity>
    );

    const renderGridItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
            style={[styles.gridCard, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}
        >
            <View style={{ padding: 12 }}>
                <Text variant="labelLarge" style={{ fontWeight: 'bold', fontSize: 12, color: c.text }} numberOfLines={1}>
                    {item.shortTrk}
                </Text>
                <Text variant="bodySmall" style={{ color: c.textSec, fontSize: 10, marginBottom: 8 }}>
                    {item.date}
                </Text>

                <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.accent, marginBottom: 4 }}>
                    {item.earnings}
                </Text>

                <View style={[styles.divider, { backgroundColor: c.divider }]} />

                <Text numberOfLines={1} style={{ fontSize: 12, color: c.text, fontWeight: 'bold' }}>
                    {item.customerName}
                </Text>

                <View style={{ marginTop: 8 }}>
                    <View style={{ backgroundColor: getStatusColor(item.status) + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' }}>
                        <Text style={{ color: getStatusColor(item.status), fontWeight: 'bold', fontSize: 9 }}>
                            {item.status}
                        </Text>
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenAnim.style]}>
            <View style={[styles.header, { backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border }]}>
                <View style={styles.headerTop}>
                    <IconButton icon="arrow-left" iconColor={c.text} onPress={() => navigation.goBack()} />
                    <Text variant="headlineSmall" style={{ fontWeight: 'bold', color: c.text }}>History & Earnings</Text>
                    <IconButton
                        icon={viewMode === 'list' ? 'view-grid' : 'view-list'}
                        iconColor={c.text}
                        onPress={() => setViewMode(prev => prev === 'list' ? 'grid' : 'list')}
                    />
                </View>

                {/* Summary Stats */}
                <View style={styles.statsContainer}>
                    <View style={[styles.statCard, { backgroundColor: c.search, borderWidth: 1, borderColor: c.border }]}>
                        <Text variant="labelMedium" style={{ color: c.textSec }}>Total Jobs</Text>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: c.accent }}>{filteredData.length}</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: c.search, borderWidth: 1, borderColor: c.border }]}>
                        <Text variant="labelMedium" style={{ color: c.textSec }}>Total Earnings</Text>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: '#4CAF50' }}>₱{totalEarnings.toFixed(2)}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.content}>
                <Searchbar
                    placeholder="Search history..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={[styles.searchBar, { backgroundColor: c.search, borderWidth: 1, borderColor: c.border }]}
                    inputStyle={{ minHeight: 0, color: c.text }}
                    iconColor={c.textSec}
                    placeholderTextColor={c.textTer}
                />

                <View style={styles.filterContainer}>
                    {['All', 'Today', 'This Week', 'This Month'].map((f) => (
                        <Chip
                            key={f}
                            selected={filter === f}
                            onPress={() => setFilter(f)}
                            style={[
                                styles.filterChip,
                                {
                                    backgroundColor: filter === f ? c.accent : c.search,
                                    borderWidth: 1,
                                    borderColor: filter === f ? c.accent : c.border,
                                },
                            ]}
                            textStyle={{ color: filter === f ? c.accentText : c.text, fontSize: 12 }}
                            showSelectedCheck={false}
                            showSelectedOverlay={false}
                        >
                            {f}
                        </Chip>
                    ))}
                </View>

                {loading ? (
                    <View style={styles.emptyState}>
                        <ActivityIndicator size="large" color={c.accent} />
                        <Text style={{ marginTop: 10, color: c.textSec }}>Loading records...</Text>
                    </View>
                ) : errorMsg ? (
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={60} color="#D32F2F" />
                        <Text style={{ marginTop: 10, color: '#D32F2F' }}>{errorMsg}</Text>
                        <TouchableOpacity onPress={() => fetchDeliveries()} style={{ marginTop: 16 }}>
                            <Text style={{ color: c.accent, fontWeight: 'bold' }}>Tap to retry</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <FlatList
                        key={viewMode}
                        data={filteredData}
                        renderItem={viewMode === 'list' ? renderItem : renderGridItem}
                        keyExtractor={item => item.id}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        numColumns={viewMode === 'list' ? 1 : 2}
                        columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={() => fetchDeliveries(true)}
                                colors={[c.accent]}
                            />
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyState}>
                                <MaterialCommunityIcons name="package-variant-closed" size={60} color={c.textTer} />
                                <Text style={{ marginTop: 10, color: c.textSec }}>No delivery records yet</Text>
                            </View>
                        }
                    />
                )}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingBottom: 20,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        zIndex: 1,
    },
    headerTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 40,
        paddingHorizontal: 10,
    },
    statsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        marginTop: 10,
        gap: 12,
    },
    statCard: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        paddingTop: 20,
    },
    searchBar: {
        marginHorizontal: 20,
        marginBottom: 12,
        borderRadius: 12,
        elevation: 0,
    },
    filterContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        marginBottom: 12,
    },
    filterChip: {
        marginRight: 8,
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    card: {
        marginBottom: 12,
        borderRadius: 12,
        padding: 16,
    },
    gridCard: {
        marginBottom: 12,
        borderRadius: 12,
        width: '48%',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    divider: {
        height: 1,
        marginBottom: 12,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    iconBox: {
        width: 24,
        alignItems: 'center',
        marginRight: 8,
    },
    rowText: {
        flex: 1,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    },
});
