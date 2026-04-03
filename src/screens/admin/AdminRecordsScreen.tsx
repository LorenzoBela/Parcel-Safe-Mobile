import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Animated } from 'react-native';
import { Text, Chip, Searchbar, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { useAppTheme } from '../../context/ThemeContext';
import { DeliveryHistoryItem, DeliveryViewMode } from '../../types/deliveryHistory';
import { normalizeDeliveryHistoryRow } from '../../utils/deliveryHistory';
import { listAdminDeliveryRecords } from '../../services/supabaseClient';
import DeliveryHistoryCard from '../../components/DeliveryHistoryCard';
import { useInfiniteQuery } from '@tanstack/react-query';

const lightC = {
    bg: '#F7F7F8',
    card: '#FFFFFF',
    text: '#111111',
    textSec: '#6B6B6B',
    textTer: '#9E9E9E',
    accent: '#111111',
    accentText: '#FFFFFF',
    border: '#E5E5E5',
    divider: '#F0F0F0',
    search: '#F2F2F3',
};

const darkC = {
    bg: '#0D0D0D',
    card: '#1A1A1A',
    text: '#F5F5F5',
    textSec: '#A0A0A0',
    textTer: '#666666',
    accent: '#FFFFFF',
    accentText: '#000000',
    border: '#2A2A2A',
    divider: '#222222',
    search: '#1E1E1E',
};

const PAGE_SIZE = 50;

type DateFilter = 'All' | 'Today' | 'This Week' | 'This Month';

function toDateRange(filter: DateFilter): { fromDate?: string; toDate?: string } {
    const now = new Date();
    if (filter === 'All') {
        return {};
    }

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    let end = new Date(now);
    end.setHours(23, 59, 59, 999);

    if (filter === 'This Week') {
        start.setDate(start.getDate() - 6);
    }

    if (filter === 'This Month') {
        start.setDate(1);
    }

    return {
        fromDate: start.toISOString(),
        toDate: end.toISOString(),
    };
}

export default function AdminRecordsScreen() {
    const navigation = useNavigation<any>();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;

    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [filter, setFilter] = useState<DateFilter>('All');
    const [viewMode, setViewMode] = useState<DeliveryViewMode>('list');

    const [refreshing, setRefreshing] = useState(false);

    const dateRange = useMemo(() => toDateRange(filter), [filter]);

    useEffect(() => {
        const handle = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 250);

        return () => clearTimeout(handle);
    }, [searchQuery]);

    const {
        data,
        error,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
    } = useInfiniteQuery({
        queryKey: ['admin-delivery-records', debouncedSearchQuery, dateRange.fromDate || '', dateRange.toDate || ''],
        initialPageParam: 1,
        queryFn: async ({ pageParam }) => {
            const result = await listAdminDeliveryRecords({
                page: Number(pageParam),
                pageSize: PAGE_SIZE,
                search: debouncedSearchQuery,
                fromDate: dateRange.fromDate,
                toDate: dateRange.toDate,
            });

            if (result.error) {
                throw new Error(result.error);
            }

            const items = (result.data || []).map(normalizeDeliveryHistoryRow);
            return {
                items,
                nextPage: result.hasMore ? Number(pageParam) + 1 : undefined,
            };
        },
        getNextPageParam: (lastPage) => lastPage.nextPage,
    });

    const historyData: DeliveryHistoryItem[] = useMemo(
        () => (data?.pages || []).flatMap((page) => page.items || []),
        [data]
    );

    const errorMsg = error instanceof Error ? error.message : null;

    const totalEarnings = historyData
        .filter((item) => item.status === 'Delivered')
        .reduce((sum, item) => {
            const val = parseFloat(item.earnings.replace('₱', ''));
            return sum + (isNaN(val) ? 0 : val);
        }, 0);

    const onEndReached = () => {
        if (isLoading || isFetchingNextPage || refreshing || !hasNextPage) {
            return;
        }
        fetchNextPage();
    };

    const onRefresh = async () => {
        setRefreshing(true);
        try {
            await refetch();
        } finally {
            setRefreshing(false);
        }
    };

    const renderItem = ({ item }: { item: DeliveryHistoryItem }) => (
        <DeliveryHistoryCard
            item={item}
            viewMode={viewMode}
            colors={c}
            showRider
            onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
        />
    );

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenAnim.style]}>
            <View style={[styles.header, { backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border }]}>
                <View style={styles.headerTop}>
                    <IconButton icon="arrow-left" iconColor={c.text} onPress={() => navigation.goBack()} />
                    <View style={{ flex: 1 }}>
                        <Text variant="headlineSmall" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>All Deliveries</Text>
                        <Text variant="bodySmall" style={{ color: c.textSec }}>All riders • Paginated history</Text>
                    </View>
                    <IconButton
                        icon={viewMode === 'list' ? 'view-grid' : 'view-list'}
                        iconColor={c.text}
                        onPress={() => setViewMode((prev) => (prev === 'list' ? 'grid' : 'list'))}
                    />
                </View>

                <View style={styles.statsContainer}>
                    <View style={[styles.statCard, { backgroundColor: c.search, borderWidth: 1, borderColor: c.border }]}>
                        <Text variant="labelMedium" style={{ color: c.textSec }}>Loaded Jobs</Text>
                        <Text variant="headlineMedium" style={{ fontFamily: 'Inter_700Bold', color: c.accent }}>{historyData.length}</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: c.search, borderWidth: 1, borderColor: c.border }]}>
                        <Text variant="labelMedium" style={{ color: c.textSec }}>Loaded Earnings</Text>
                        <Text variant="headlineMedium" style={{ fontFamily: 'Inter_700Bold', color: '#4CAF50' }}>₱{totalEarnings.toFixed(2)}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.content}>
                <Searchbar
                    placeholder="Search by tracking or ID..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={[styles.searchBar, { backgroundColor: c.search, borderWidth: 1, borderColor: c.border }]}
                    inputStyle={{ minHeight: 0, color: c.text }}
                    iconColor={c.textSec}
                    placeholderTextColor={c.textTer}
                />

                <View style={styles.filterContainer}>
                    {(['All', 'Today', 'This Week', 'This Month'] as DateFilter[]).map((f) => (
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

                {isLoading ? (
                    <View style={styles.emptyState}>
                        <ActivityIndicator size="large" color={c.accent} />
                        <Text style={{ marginTop: 10, color: c.textSec }}>Loading records...</Text>
                    </View>
                ) : errorMsg ? (
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={60} color="#D32F2F" />
                        <Text style={{ marginTop: 10, color: '#D32F2F' }}>{errorMsg}</Text>
                        <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 16 }}>
                            <Text style={{ color: c.accent, fontFamily: 'Inter_700Bold' }}>Tap to retry</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <FlatList
                        key={viewMode}
                        data={historyData}
                        renderItem={renderItem}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        numColumns={viewMode === 'list' ? 1 : 2}
                        columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
                        onEndReached={onEndReached}
                        onEndReachedThreshold={0.4}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={onRefresh}
                                colors={[c.accent]}
                            />
                        }
                        ListFooterComponent={
                            isFetchingNextPage ? (
                                <View style={{ paddingVertical: 16 }}>
                                    <ActivityIndicator size="small" color={c.accent} />
                                </View>
                            ) : null
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyState}>
                                <MaterialCommunityIcons name="package-variant-closed" size={60} color={c.textTer} />
                                <Text style={{ marginTop: 10, color: c.textSec }}>No delivery records found</Text>
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
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    },
});
