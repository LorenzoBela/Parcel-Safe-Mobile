import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { Text, Card, Searchbar, Chip, useTheme, Surface, IconButton } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../services/supabaseClient';
import { parseUTCString } from '../../utils/date';
import { triggerDeliverySync } from '../../services/deliverySyncService';
import useAuthStore from '../../store/authStore';

/** Map Supabase DeliveryStatus to display-friendly labels */
const mapStatus = (raw: string): string => {
    switch (raw) {
        case 'COMPLETED': return 'Delivered';
        case 'IN_TRANSIT': return 'In Transit';
        case 'ASSIGNED': return 'In Transit';
        case 'PENDING': return 'Pending';
        case 'ARRIVED': return 'In Transit';
        case 'TAMPERED': return 'Tampered';
        case 'CANCELLED': return 'Cancelled';
        default: return raw;
    }
};

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);  // deg2rad below
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

const deg2rad = (deg: number) => {
    return deg * (Math.PI / 180)
}

export default function DeliveryLogScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const userId = useAuthStore((state: any) => state.user?.userId);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFilter, setSelectedFilter] = useState('All');
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const FILTERS = ['All', 'Delivered', 'In Transit', 'Cancelled', 'Tampered'];
    const insets = useSafeAreaInsets();

    const fetchDeliveries = useCallback(async (isRefresh = false) => {
        if (!userId || !supabase) {
            setLoading(false);
            return;
        }

        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        setErrorMsg(null);

        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, customer:customer_id(full_name)')
                .eq('customer_id', userId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[DeliveryLog] Supabase error:', error.message);
                setErrorMsg('Failed to load delivery history.');
            } else {
                const mapped = (data || []).map((d: any) => ({
                    id: d.id,
                    trk: d.tracking_number || d.id,
                    status: mapStatus(d.status),
                    rawStatus: d.status,
                    date: d.created_at
                        ? parseUTCString(d.created_at).toLocaleDateString('en-US', {
                            timeZone: 'Asia/Manila',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                        })
                        : 'N/A',
                    rider: d.rider_name || 'Unassigned',
                    price: d.estimated_fare != null ? `₱${Number(d.estimated_fare).toFixed(2)}` : '—',
                    serviceType: 'Parcel Delivery',
                    // Map actual coordinates and details
                    pickupLat: d.pickup_lat,
                    pickupLng: d.pickup_lng,
                    dropoffLat: d.dropoff_lat,
                    dropoffLng: d.dropoff_lng,
                    pickupAddress: d.pickup_address || 'No pickup address',
                    dropoffAddress: d.dropoff_address || 'No dropoff address',
                    address: d.dropoff_address || 'No address provided', // Legacy field
                    customer: d.recipient_name || d.customer?.full_name || 'Unknown',
                    distance: d.pickup_lat && d.pickup_lng && d.dropoff_lat && d.dropoff_lng
                        ? `${getDistanceFromLatLonInKm(d.pickup_lat, d.pickup_lng, d.dropoff_lat, d.dropoff_lng).toFixed(2)} km`
                        : 'N/A',
                }));
                setLogs(mapped);
            }
        } catch (err) {
            console.error('[DeliveryLog] fetch error:', err);
            setErrorMsg('Something went wrong.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [userId]);

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

    const filteredLogs = logs.filter(log => {
        const matchesSearch = log.trk.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = selectedFilter === 'All' || log.status === selectedFilter;
        return matchesSearch && matchesFilter;
    });

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Delivered': return '#4CAF50';
            case 'In Transit': return '#2196F3';
            case 'Pending': return '#FF9800';
            case 'Cancelled': return '#9E9E9E';
            case 'Tampered': return '#D32F2F';
            default: return '#9E9E9E';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'Delivered': return 'check-circle';
            case 'In Transit': return 'truck-delivery';
            case 'Pending': return 'clock-outline';
            case 'Cancelled': return 'close-circle';
            case 'Tampered': return 'alert-circle';
            default: return 'help-circle';
        }
    };

    const renderItem = ({ item }: { item: any }) => (
        <Card
            style={[
                styles.card,
                viewMode === 'grid' ? styles.cardGrid : styles.cardList,
                { backgroundColor: theme.colors.surface }
            ]}
            mode="elevated"
            onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
        >
            <View style={styles.cardInner}>
                <View style={styles.cardContent}>
                    <View style={styles.cardHeader}>
                        <View style={{ flex: 1 }}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }} numberOfLines={1}>{item.trk}</Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>{item.serviceType}</Text>
                        </View>
                        {viewMode === 'list' && (
                            <Chip
                                icon={getStatusIcon(item.status)}
                                textStyle={{ fontSize: 11, color: 'white', fontWeight: 'bold' }}
                                style={{ backgroundColor: getStatusColor(item.status), height: 30, borderRadius: 15 }}
                            >
                                {item.status.toUpperCase()}
                            </Chip>
                        )}
                    </View>

                    {viewMode === 'grid' && (
                        <View style={{ height: 4, backgroundColor: getStatusColor(item.status), borderRadius: 2, marginBottom: 8, marginTop: 4 }} />
                    )}

                    {item.status === 'Tampered' && (
                        <View style={styles.alertContainer}>
                            <MaterialCommunityIcons name="alert-circle" size={16} color="#D32F2F" />
                            <Text style={styles.alertText}>Tampering Detected!</Text>
                        </View>
                    )}

                    {viewMode === 'list' && (
                        <View style={styles.addressContainer}>
                            <View style={styles.addressRow}>
                                <MaterialCommunityIcons name="map-marker-outline" size={14} color={theme.colors.primary} />
                                <Text variant="bodySmall" style={styles.addressText} numberOfLines={1}>
                                    {item.pickupAddress}
                                </Text>
                            </View>
                            <View style={styles.addressDotLine} />
                            <View style={styles.addressRow}>
                                <MaterialCommunityIcons name="map-marker" size={14} color={theme.colors.error} />
                                <Text variant="bodySmall" style={styles.addressText} numberOfLines={1}>
                                    {item.dropoffAddress}
                                </Text>
                            </View>
                        </View>
                    )}

                    <View style={styles.divider} />

                    <View style={[styles.footer, viewMode === 'grid' && styles.footerGrid]}>
                        <View style={{ flex: viewMode === 'grid' ? 0 : 1 }}>
                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="calendar" size={14} color="#888" />
                                <Text variant="bodySmall" style={styles.detailText} numberOfLines={1}>{item.date}</Text>
                            </View>
                            <View style={[styles.detailRow, { marginTop: 4 }]}>
                                <MaterialCommunityIcons name="map-marker-distance" size={14} color="#888" />
                                <Text variant="bodySmall" style={styles.detailText} numberOfLines={1}>{item.distance}</Text>
                            </View>
                            {viewMode === 'list' && (
                                <View style={[styles.detailRow, { marginTop: 4 }]}>
                                    <MaterialCommunityIcons name="motorbike" size={14} color="#888" />
                                    <Text variant="bodySmall" style={styles.detailText}>{item.rider}</Text>
                                </View>
                            )}
                        </View>
                        <Text
                            variant="titleMedium"
                            style={[
                                { fontWeight: 'bold', color: theme.colors.primary },
                                viewMode === 'grid' && { marginTop: 4 }
                            ]}
                        >
                            {viewMode === 'list' ? `Fare: ${item.price}` : item.price}
                        </Text>
                    </View>
                </View>
            </View>
        </Card>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.surface, paddingTop: insets.top + 10 }]}>
                <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.onSurface }]}>Delivery History</Text>
                <View style={{ flexDirection: 'row' }}>
                    <IconButton
                        icon={showFilters ? "filter-off" : "filter-variant"}
                        onPress={() => setShowFilters(!showFilters)}
                        selected={showFilters}
                    />
                    <IconButton
                        icon={viewMode === 'grid' ? "view-list" : "view-grid"}
                        onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                    />
                </View>
            </View>

            <Searchbar
                placeholder="Search tracking ID..."
                onChangeText={setSearchQuery}
                value={searchQuery}
                style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}
                inputStyle={{ fontSize: 14, color: theme.colors.onSurface }}
                iconColor={theme.colors.onSurfaceVariant}
                placeholderTextColor={theme.colors.onSurfaceVariant}
            />

            {showFilters && (
                <View style={styles.filterContainer}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                        {FILTERS.map((filter) => (
                            <Chip
                                key={filter}
                                selected={selectedFilter === filter}
                                onPress={() => setSelectedFilter(filter)}
                                style={[styles.filterChip, selectedFilter === filter && { backgroundColor: theme.colors.primaryContainer }]}
                                showSelectedOverlay
                            >
                                {filter}
                            </Chip>
                        ))}
                    </ScrollView>
                </View>
            )}

            {loading ? (
                <View style={styles.emptyState}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                    <Text style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>Loading deliveries...</Text>
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
                    data={filteredLogs}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    numColumns={viewMode === 'grid' ? 2 : 1}
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
                            <Text style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>No deliveries found</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 50,
        paddingBottom: 10,
        backgroundColor: 'white',
    },
    title: {
        fontWeight: 'bold',
    },
    searchBar: {
        margin: 20,
        marginTop: 10,
        backgroundColor: 'white',
        elevation: 2,
        borderRadius: 12,
    },
    listContent: {
        padding: 20,
        paddingTop: 10,
    },
    filterContainer: {
        marginBottom: 10,
    },
    filterScroll: {
        paddingHorizontal: 20,
    },
    filterChip: {
        marginRight: 8,
    },
    card: {
        backgroundColor: 'white',
        borderRadius: 12,
        overflow: 'hidden',
    },
    cardList: {
        marginBottom: 16,
    },
    cardGrid: {
        flex: 0.48,
        marginBottom: 16,
    },
    cardInner: {
        flexDirection: 'row',
    },
    cardContent: {
        flex: 1,
        padding: 16,
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
        marginVertical: 12,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    detailText: {
        color: '#666',
        marginLeft: 6,
    },
    alertContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    alertText: {
        color: '#D32F2F',
        fontSize: 12,
        fontWeight: 'bold',
        marginLeft: 4,
    },
    addressContainer: {
        marginVertical: 8,
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    addressText: {
        color: '#555',
        marginLeft: 8,
        flex: 1,
    },
    addressDotLine: {
        height: 10,
        borderLeftWidth: 1,
        borderLeftColor: '#ddd',
        marginLeft: 7,
        marginBottom: 4,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 'auto',
    },
    footerGrid: {
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    riderInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    },
});
