import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Animated } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Chip, Searchbar, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { triggerDeliverySync } from '../../services/deliverySyncService';
import useAuthStore from '../../store/authStore';
import { parseUTCString } from '../../utils/date';
import { useAppTheme } from '../../context/ThemeContext';
import { DeliveryHistoryItem } from '../../types/deliveryHistory';
import { normalizeDeliveryHistoryRow } from '../../utils/deliveryHistory';
import DeliveryHistoryCard from '../../components/DeliveryHistoryCard';

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

export default function DeliveryRecordsScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const navigation = useNavigation<any>();
    const riderId = useAuthStore((state: any) => state.user?.userId);

    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState('All');
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    const [historyData, setHistoryData] = useState<DeliveryHistoryItem[]>([]);
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
                const mapped = (data || []).map(normalizeDeliveryHistoryRow);
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

    const renderItem = ({ item }: { item: DeliveryHistoryItem }) => (
        <DeliveryHistoryCard
            item={item}
            viewMode={viewMode}
            colors={c}
            onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
        />
    );

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenAnim.style]}>
            <View style={[styles.header, { backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border }]}>
                <View style={styles.headerTop}>
                    <IconButton icon="arrow-left" iconColor={c.text} onPress={() => navigation.goBack()} />
                    <Text variant="headlineSmall" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>History & Earnings</Text>
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
                        <Text variant="headlineMedium" style={{ fontFamily: 'Inter_700Bold', color: c.accent }}>{filteredData.length}</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: c.search, borderWidth: 1, borderColor: c.border }]}>
                        <Text variant="labelMedium" style={{ color: c.textSec }}>Total Earnings</Text>
                        <Text variant="headlineMedium" style={{ fontFamily: 'Inter_700Bold', color: '#4CAF50' }}>₱{totalEarnings.toFixed(2)}</Text>
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
                            <Text style={{ color: c.accent, fontFamily: 'Inter_700Bold' }}>Tap to retry</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <FlatList
                        key={viewMode}
                        data={filteredData}
                        renderItem={renderItem}
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
