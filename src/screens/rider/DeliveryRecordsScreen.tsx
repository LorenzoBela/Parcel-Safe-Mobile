import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Text, Card, Chip, Searchbar, Surface, useTheme, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { triggerDeliverySync } from '../../services/deliverySyncService';
import useAuthStore from '../../store/authStore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

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
        default: return raw;
    }
};

export default function DeliveryRecordsScreen() {
    const theme = useTheme();
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
            // Updated query to fetch customer profile
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
                    // Truncate if too long (e.g., > 12 chars), show last 8
                    const shortTrk = rawTrk.length > 20 ? '...' + rawTrk.slice(-12) : rawTrk;

                    const dateObj = d.created_at ? new Date(d.created_at) : null;
                    if (d.created_at) {
                        const testDayjs = dayjs(d.created_at).tz('Asia/Manila').format('h:mm A');
                        console.log(`[DeliveryRecords] ID: ${d.id}, Raw: ${d.created_at}, DayJS: ${testDayjs}`);
                    }

                    return {
                        id: d.id,
                        trk: rawTrk,
                        shortTrk: shortTrk,
                        status: mapStatus(d.status),
                        rawStatus: d.status,
                        // Fix Timezone: Manually add 8 hours to the raw timestamp (which Supabase sends as UTC-like string)
                        date: dateObj ? dayjs(d.created_at).add(8, 'hour').format('MMM D, YYYY') : 'N/A',
                        time: dateObj ? dayjs(d.created_at).add(8, 'hour').format('h:mm A') : '',
                        // Map Customer Name
                        customer: d.profiles?.full_name || 'Unknown Customer',
                        customerName: d.profiles?.full_name || 'Unknown Customer', // Keep for backward compat if needed locally
                        earnings: d.estimated_fare != null ? `₱${Number(d.estimated_fare).toFixed(2)}` : '—',
                        // Separate Addresses
                        pickup: d.pickup_address || 'N/A',
                        dropoff: d.dropoff_address || 'N/A',
                        pickupAddress: d.pickup_address || 'N/A', // Keep for safety if used elsewhere
                        dropoffAddress: d.dropoff_address || 'N/A',

                        // Coordinates for Map
                        pickup_lat: d.pickup_lat,
                        pickup_lng: d.pickup_lng,
                        dropoff_lat: d.dropoff_lat,
                        dropoff_lng: d.dropoff_lng,

                        // Pass image if available (proof of delivery)
                        image: d.proof_of_delivery_url || d.image_url || null,
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

    // Fetch on mount
    useEffect(() => {
        fetchDeliveries();
    }, [fetchDeliveries]);

    // Re-fetch when screen gains focus (sync first, then fetch)
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
            default: return '#757575';
        }
    };

    // Use actual current date for filter comparisons
    const currentDate = new Date();

    const filteredData = historyData.filter(item => {
        const matchesSearch = item.trk.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.customerName.toLowerCase().includes(searchQuery.toLowerCase());

        let matchesFilter = true;

        if (filter === 'Today') {
            const itemDate = new Date(item.date);
            matchesFilter =
                itemDate.getDate() === currentDate.getDate() &&
                itemDate.getMonth() === currentDate.getMonth() &&
                itemDate.getFullYear() === currentDate.getFullYear();
        } else if (filter === 'This Week') {
            const itemDate = new Date(item.date);
            const diffTime = Math.abs(currentDate.getTime() - itemDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            matchesFilter = diffDays <= 7;
        } else if (filter === 'This Month') {
            const itemDate = new Date(item.date);
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
        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated" onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}>
            <Card.Content>
                <View style={styles.cardHeader}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold' }} numberOfLines={1}>
                            {item.shortTrk}
                        </Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                            {item.date} • {item.time}
                        </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.primary }}>
                            {item.earnings}
                        </Text>
                        <Chip
                            style={{ backgroundColor: getStatusColor(item.status) + '20', height: 24, paddingVertical: 0 }}
                            textStyle={{ color: getStatusColor(item.status), fontWeight: 'bold', fontSize: 10, lineHeight: 10 }}
                            compact
                        >
                            {item.status}
                        </Chip>
                    </View>
                </View>

                <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                {/* Customer Info */}
                <View style={styles.row}>
                    <View style={styles.iconBox}>
                        <MaterialCommunityIcons name="account" size={16} color={theme.colors.onSurfaceVariant} />
                    </View>
                    <Text variant="bodyMedium" style={[styles.rowText, { color: theme.colors.onSurface, fontWeight: '600' }]}>
                        {item.customerName}
                    </Text>
                </View>

                {/* Pickup Address */}
                <View style={[styles.row, { alignItems: 'flex-start' }]}>
                    <View style={[styles.iconBox, { marginTop: 2 }]}>
                        <MaterialCommunityIcons name="map-marker-up" size={16} color="#4CAF50" />
                    </View>
                    <Text variant="bodySmall" numberOfLines={2} style={[styles.rowText, { color: theme.colors.onSurface }]}>
                        {item.pickup}
                    </Text>
                </View>

                {/* Dropoff Address */}
                <View style={[styles.row, { alignItems: 'flex-start' }]}>
                    <View style={[styles.iconBox, { marginTop: 2 }]}>
                        <MaterialCommunityIcons name="map-marker-down" size={16} color="#F44336" />
                    </View>
                    <Text variant="bodySmall" numberOfLines={2} style={[styles.rowText, { color: theme.colors.onSurface }]}>
                        {item.dropoff}
                    </Text>
                </View>

            </Card.Content>
        </Card>
    );

    const renderGridItem = ({ item }: { item: any }) => (
        <Card style={[styles.gridCard, { backgroundColor: theme.colors.surface }]} mode="elevated" onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}>
            <Card.Content style={{ padding: 12 }}>
                <Text variant="labelLarge" style={{ fontWeight: 'bold', fontSize: 12 }} numberOfLines={1}>
                    {item.shortTrk}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10, marginBottom: 8 }}>
                    {item.date}
                </Text>

                <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.primary, marginBottom: 4 }}>
                    {item.earnings}
                </Text>

                <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurface, fontWeight: 'bold' }}>
                    {item.customerName}
                </Text>

                <View style={{ marginTop: 8 }}>
                    <Chip
                        style={{ backgroundColor: getStatusColor(item.status) + '20', height: 20, alignSelf: 'flex-start' }}
                        textStyle={{ color: getStatusColor(item.status), fontWeight: 'bold', fontSize: 9, lineHeight: 10 }}
                        compact
                    >
                        {item.status}
                    </Chip>
                </View>
            </Card.Content>
        </Card>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
                <View style={styles.headerTop}>
                    <IconButton icon="arrow-left" onPress={() => navigation.goBack()} />
                    <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>History & Earnings</Text>
                    <IconButton
                        icon={viewMode === 'list' ? 'view-grid' : 'view-list'}
                        onPress={() => setViewMode(prev => prev === 'list' ? 'grid' : 'list')}
                    />
                </View>

                {/* Summary Stats */}
                <View style={styles.statsContainer}>
                    <Surface style={[styles.statCard, { backgroundColor: theme.colors.surface }]} elevation={2}>
                        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>Total Jobs</Text>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: '#2196F3' }}>{filteredData.length}</Text>
                    </Surface>
                    <Surface style={[styles.statCard, { backgroundColor: theme.colors.surface }]} elevation={2}>
                        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>Total Earnings</Text>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: '#4CAF50' }}>Total: ₱{totalEarnings.toFixed(2)}</Text>
                    </Surface>
                </View>
            </View>

            <View style={styles.content}>
                <Searchbar
                    placeholder="Search history..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={[styles.searchBar, { backgroundColor: theme.colors.elevation.level1 }]}
                    inputStyle={{ minHeight: 0 }}
                />

                <View style={styles.filterContainer}>
                    {['All', 'Today', 'This Week', 'This Month'].map((f) => (
                        <Chip
                            key={f}
                            selected={filter === f}
                            onPress={() => setFilter(f)}
                            style={[styles.filterChip, filter === f && { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary }]}
                            textStyle={{ color: filter === f ? theme.colors.onPrimaryContainer : theme.colors.onSurface }}
                            showSelectedOverlay
                        >
                            {f}
                        </Chip>
                    ))}
                </View>

                {loading ? (
                    <View style={styles.emptyState}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>Loading records...</Text>
                    </View>
                ) : errorMsg ? (
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={60} color={theme.colors.error} />
                        <Text style={{ marginTop: 10, color: theme.colors.error }}>{errorMsg}</Text>
                        <TouchableOpacity onPress={() => fetchDeliveries()} style={{ marginTop: 16 }}>
                            <Text style={{ color: theme.colors.primary, fontWeight: 'bold' }}>Tap to retry</Text>
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
                                colors={[theme.colors.primary]}
                            />
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyState}>
                                <MaterialCommunityIcons name="package-variant-closed" size={60} color={theme.colors.onSurfaceVariant} />
                                <Text style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>No delivery records yet</Text>
                            </View>
                        }
                    />
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingBottom: 20,
        elevation: 2,
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
        backgroundColor: 'white',
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
        elevation: 1,
        borderRadius: 12,
    },
    filterContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        marginBottom: 12,
    },
    filterChip: {
        marginRight: 8,
        borderWidth: 1,
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    card: {
        marginBottom: 12,
        borderRadius: 12,
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
        backgroundColor: '#F0F0F0',
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
        color: '#444',
        flex: 1,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    },
});
