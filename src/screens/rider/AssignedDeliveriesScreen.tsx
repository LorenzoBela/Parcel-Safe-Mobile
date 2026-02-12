import React, { useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Linking, Platform, Alert } from 'react-native';
import { Text, Card, Button, Chip, Searchbar, Surface, useTheme, IconButton, Badge } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason } from '../../services/cancellationService';
import useAuthStore from '../../store/authStore';
import dayjs from 'dayjs';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

export default function AssignedDeliveriesScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const [searchQuery, setSearchQuery] = useState('');

    const [filter, setFilter] = useState('All'); // All, Pending, Completed
    const [dateFilter, setDateFilter] = useState('All'); // All, Today, Tomorrow, Week, Custom
    const [showFilters, setShowFilters] = useState(false); // Collapsible filter state

    // Custom Date Range State
    const [customStartDate, setCustomStartDate] = useState<Date>(new Date());
    const [customEndDate, setCustomEndDate] = useState<Date>(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [datePickerMode, setDatePickerMode] = useState<'start' | 'end'>('start');

    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    // EC-32: Cancellation State
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [selectedDelivery, setSelectedDelivery] = useState<any>(null);
    const [cancelLoading, setCancelLoading] = useState(false);

    // Enhanced Mock Data with Coordinates
    const [deliveries, setDeliveries] = useState([
        {
            id: '1',
            trk: 'TRK-8821-9023',
            customer: 'Maria Clara',
            address: '123 Rizal Park, Manila',
            pickup_lat: 14.5547,
            pickup_lng: 121.0244,
            lat: 14.5831,
            lng: 120.9794,
            dropoff_lat: 14.5831,
            dropoff_lng: 120.9794,
            type: 'Electronics',
            status: 'Pending',
            date: dayjs().format('YYYY-MM-DD'), // Today
            time: '10:30 AM',
            distance: '2.5 km',
            priority: 'High',
            image: 'https://via.placeholder.com/300'
        },
        {
            id: '2',
            trk: 'TRK-9921-1122',
            customer: 'Kean Guzon',
            address: '456 Quezon Ave, QC',
            pickup_lat: 14.5995,
            pickup_lng: 120.9842,
            lat: 14.6409,
            lng: 121.0384,
            dropoff_lat: 14.6409,
            dropoff_lng: 121.0384,
            type: 'Documents',
            status: 'In Transit',
            date: dayjs().format('YYYY-MM-DD'), // Today
            time: '11:45 AM',
            distance: '5.1 km',
            priority: 'Normal',
            image: 'https://via.placeholder.com/300'
        },
        {
            id: '3',
            trk: 'TRK-7721-3344',
            customer: 'Robert Callorina',
            address: '789 Makati Ave, Makati',
            pickup_lat: 14.5831,
            pickup_lng: 120.9794,
            lat: 14.5547,
            lng: 121.0244,
            dropoff_lat: 14.5547,
            dropoff_lng: 121.0244,
            type: 'Fragile',
            status: 'Completed',
            date: dayjs().subtract(1, 'day').format('YYYY-MM-DD'), // Yesterday
            time: '09:15 AM',
            distance: '8.2 km',
            priority: 'Normal',
            image: 'https://via.placeholder.com/300'
        },
        {
            id: '4',
            trk: 'TRK-5521-6677',
            customer: 'Jeus Manigbas',
            address: '101 Intramuros, Manila',
            pickup_lat: 14.6004,
            pickup_lng: 120.9900,
            lat: 14.5905,
            lng: 120.9768,
            dropoff_lat: 14.5905,
            dropoff_lng: 120.9768,
            type: 'Food',
            status: 'Pending',
            date: dayjs().add(1, 'day').format('YYYY-MM-DD'), // Tomorrow
            time: '01:00 PM',
            distance: '1.2 km',
            priority: 'High',
            image: 'https://via.placeholder.com/300'
        },
    ]);

    const onChangeSearch = query => setSearchQuery(query);

    const onRefresh = () => {
        setRefreshing(true);
        // Simulate fetch
        setTimeout(() => setRefreshing(false), 1500);
    };

    const openGoogleMaps = (lat, lng, address) => {
        const url = Platform.select({
            ios: `maps:0,0?q=${address}@${lat},${lng}`,
            android: `geo:0,0?q=${lat},${lng}(${address})`
        });

        // Fallback to web URL if scheme fails or for general compatibility
        const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

        Linking.canOpenURL(url || webUrl).then(supported => {
            if (supported && url) {
                Linking.openURL(url);
            } else {
                Linking.openURL(webUrl);
            }
        });
    };

    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;

    const handleCancellationSubmit = async (reason: CancellationReason, details: string) => {
        if (!selectedDelivery) return;

        setCancelLoading(true);
        try {
            // In a real app, use the actual delivery ID and box ID
            const result = await requestCancellation({
                deliveryId: selectedDelivery.trk,
                boxId: 'BOX_001',
                reason,
                reasonDetails: details,
                riderId: authedUserId ?? 'RIDER_001',
                riderName: 'Juan Dela Cruz',
            });

            if (result.success) {
                setShowCancelModal(false);
                setSelectedDelivery(null);
                Alert.alert('Success', 'Delivery cancelled successfully.');
            } else {
                Alert.alert('Error', result.error || 'Cancellation failed');
            }
        } catch (error) {
            Alert.alert('Error', 'An unexpected error occurred');
        } finally {
            setCancelLoading(false);
        }
    };

    const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
        setShowDatePicker(Platform.OS === 'ios');
        if (selectedDate) {
            if (datePickerMode === 'start') {
                setCustomStartDate(selectedDate);
                // Auto adjust end date if it's before start date
                if (dayjs(selectedDate).isAfter(dayjs(customEndDate))) {
                    setCustomEndDate(selectedDate);
                }
            } else {
                setCustomEndDate(selectedDate);
                // Auto adjust start date if it's after end date
                if (dayjs(selectedDate).isBefore(dayjs(customStartDate))) {
                    setCustomStartDate(selectedDate);
                }
            }
        }
    };

    const showDateMode = (mode: 'start' | 'end') => {
        setDatePickerMode(mode);
        setShowDatePicker(true);
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Pending': return '#FF9800';
            case 'In Transit': return '#2196F3';
            case 'Completed': return '#4CAF50';
            default: return '#757575';
        }
    };

    const filteredDeliveries = deliveries.filter(item => {
        const matchesSearch = item.trk.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.customer.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = filter === 'All' || item.status === filter || (filter === 'Pending' && item.status === 'In Transit');

        let matchesDate = true;
        const itemDate = dayjs(item.date);
        const today = dayjs();

        if (dateFilter === 'Today') {
            matchesDate = itemDate.isSame(today, 'day');
        } else if (dateFilter === 'Tomorrow') {
            matchesDate = itemDate.isSame(today.add(1, 'day'), 'day');
        } else if (dateFilter === 'Week') {
            // Check if within current week (Sunday to Saturday)
            matchesDate = itemDate.isAfter(today.startOf('week').subtract(1, 'day')) && itemDate.isBefore(today.endOf('week').add(1, 'day'));
        } else if (dateFilter === 'Custom') {
            matchesDate = itemDate.isAfter(dayjs(customStartDate).subtract(1, 'day'), 'day') &&
                itemDate.isBefore(dayjs(customEndDate).add(1, 'day'), 'day');
        }

        return matchesSearch && matchesStatus && matchesDate;
    });

    const renderItem = ({ item }) => (
        <Card style={styles.card} mode="elevated">
            <Card.Content>
                <View style={styles.cardHeader}>
                    <View style={styles.trkContainer}>
                        <MaterialCommunityIcons name="barcode-scan" size={20} color={theme.colors.primary} />
                        <Text variant="titleMedium" style={[styles.trkText, { color: theme.colors.onSurface }]}>{item.trk}</Text>
                    </View>
                    <Chip
                        style={{ backgroundColor: getStatusColor(item.status) + '20' }}
                        textStyle={{ color: getStatusColor(item.status), fontWeight: 'bold', fontSize: 12 }}
                        compact
                    >
                        {item.status}
                    </Chip>
                </View>

                <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                <View style={styles.customerRow}>
                    <View style={styles.avatarContainer}>
                        <Text style={styles.avatarText}>{item.customer.charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{item.customer}</Text>
                    </View>
                </View>

                <View style={[styles.addressContainer, { backgroundColor: theme.colors.elevation.level2 }]}>
                    <MaterialCommunityIcons name="map-marker" size={18} color={theme.colors.onSurfaceVariant} style={{ marginTop: 2 }} />
                    <Text variant="bodyMedium" style={[styles.addressText, { color: theme.colors.onSurface }]}>{item.address}</Text>
                </View>

                <View style={styles.metaContainer}>
                    <View style={styles.metaItem}>
                        <MaterialCommunityIcons name="calendar-clock" size={16} color={theme.colors.onSurfaceVariant} />
                        <Text style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>
                            {dayjs(item.date).format('MMM D')} • {item.time}
                        </Text>
                    </View>
                    <View style={styles.metaItem}>
                        <MaterialCommunityIcons name="map-marker-distance" size={16} color={theme.colors.onSurfaceVariant} />
                        <Text style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>{item.distance}</Text>
                    </View>
                </View>

            </Card.Content>
            <Card.Actions style={styles.cardActions}>
                <Button
                    mode="outlined"
                    onPress={() => console.log('Call')}
                    icon="phone"
                    style={{ flex: 1, marginRight: 8 }}
                >
                    Call
                </Button>
                {(item.status === 'Pending' || item.status === 'In Transit') && (
                    <Button
                        mode="contained"
                        onPress={() => {
                            setSelectedDelivery(item);
                            setShowCancelModal(true);
                        }}
                        buttonColor={theme.colors.error}
                        style={{ marginRight: 8 }}
                    >
                        Cancel
                    </Button>
                )}
                <Button
                    mode="contained"
                    onPress={() => {
                        if (item.status === 'Completed') {
                            navigation.navigate('DeliveryDetail', { delivery: item });
                        } else {
                            openGoogleMaps(item.lat, item.lng, item.address);
                        }
                    }}
                    style={{ flex: 1, backgroundColor: item.status === 'Completed' ? '#4CAF50' : theme.colors.primary }}
                    icon={item.status === 'Completed' ? 'history' : 'google-maps'}
                >
                    {item.status === 'Completed' ? 'History' : (item.status === 'In Transit' ? 'Resume' : 'Start')}
                </Button>
            </Card.Actions>
        </Card>
    );

    const renderGridItem = ({ item }) => (
        <Card style={styles.gridCard} mode="elevated" onPress={() => {
            if (item.status === 'Completed') {
                navigation.navigate('DeliveryDetail', { delivery: item });
            } else {
                openGoogleMaps(item.lat, item.lng, item.address);
            }
        }}>
            <Card.Content style={{ padding: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Badge size={16} style={{ backgroundColor: getStatusColor(item.status), alignSelf: 'flex-start' }}>{item.status}</Badge>
                </View>

                <Text variant="titleSmall" style={{ fontWeight: 'bold' }} numberOfLines={1}>{item.customer}</Text>
                <Text variant="bodySmall" style={{ fontSize: 10, color: theme.colors.onSurfaceVariant, marginBottom: 4 }} numberOfLines={1}>{item.trk}</Text>

                <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                    <MaterialCommunityIcons name="map-marker" size={12} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" numberOfLines={1} style={{ fontSize: 10, marginLeft: 2, flex: 1 }}>{item.address}</Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant }}>
                        {dayjs(item.date).format('MM/DD')} • {item.time}
                    </Text>
                    <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant }}>{item.distance}</Text>
                </View>
            </Card.Content>
        </Card>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <View>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>Assigned Deliveries</Text>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{dayjs().format('dddd, MMM D')}</Text>
                    </View>
                    <View style={{ flexDirection: 'row' }}>
                        <IconButton
                            icon={viewMode === 'list' ? 'view-grid' : 'view-list'}
                            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                        />
                        <IconButton
                            icon={showFilters ? 'filter-off' : 'filter'}
                            mode={showFilters ? 'contained' : 'outlined'}
                            onPress={() => setShowFilters(!showFilters)}
                        />
                    </View>
                </View>

                <Searchbar
                    placeholder="Search tracking # or customer"
                    onChangeText={onChangeSearch}
                    value={searchQuery}
                    style={styles.searchbar}
                    elevation={1}
                />

                {/* Collapsible Filters */}
                {showFilters && (
                    <View style={styles.filterSection}>
                        <Text variant="labelMedium" style={{ marginBottom: 8, color: theme.colors.onSurfaceVariant }}>Status</Text>
                        <View style={styles.filterRow}>
                            {['All', 'Pending', 'Completed'].map((status) => (
                                <Chip
                                    key={status}
                                    selected={filter === status}
                                    onPress={() => setFilter(status)}
                                    style={styles.filterChip}
                                    showSelectedOverlay
                                >
                                    {status}
                                </Chip>
                            ))}
                        </View>

                        <View style={{ height: 12 }} />

                        <Text variant="labelMedium" style={{ marginBottom: 8, color: theme.colors.onSurfaceVariant }}>Date</Text>
                        <View style={styles.filterRow}>
                            {['All', 'Today', 'Tomorrow', 'Week', 'Custom'].map((dateOpt) => (
                                <Chip
                                    key={dateOpt}
                                    selected={dateFilter === dateOpt}
                                    onPress={() => setDateFilter(dateOpt)}
                                    style={styles.filterChip}
                                    showSelectedOverlay
                                >
                                    {dateOpt}
                                </Chip>
                            ))}
                        </View>

                        {/* Custom Date Range Selection */}
                        {dateFilter === 'Custom' && (
                            <View style={styles.customDateContainer}>
                                <TouchableOpacity
                                    style={[styles.dateInput, { borderColor: theme.colors.outline }]}
                                    onPress={() => showDateMode('start')}
                                >
                                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>Start Date</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <MaterialCommunityIcons name="calendar" size={16} color={theme.colors.primary} style={{ marginRight: 4 }} />
                                        <Text variant="bodyMedium">{dayjs(customStartDate).format('MMM D, YYYY')}</Text>
                                    </View>
                                </TouchableOpacity>

                                <MaterialCommunityIcons name="arrow-right" size={20} color={theme.colors.onSurfaceVariant} style={{ marginHorizontal: 8 }} />

                                <TouchableOpacity
                                    style={[styles.dateInput, { borderColor: theme.colors.outline }]}
                                    onPress={() => showDateMode('end')}
                                >
                                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>End Date</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <MaterialCommunityIcons name="calendar" size={16} color={theme.colors.primary} style={{ marginRight: 4 }} />
                                        <Text variant="bodyMedium">{dayjs(customEndDate).format('MMM D, YYYY')}</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )}

                        {showDatePicker && (
                            <DateTimePicker
                                testID="dateTimePicker"
                                value={datePickerMode === 'start' ? customStartDate : customEndDate}
                                mode="date"
                                is24Hour={true}
                                display="default"
                                onChange={onDateChange}
                            />
                        )}
                    </View>
                )}
            </View>

            {/* List Content */}
            {viewMode === 'list' ? (
                <FlatList
                    data={filteredDeliveries}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.listContent}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <MaterialCommunityIcons name="package-variant-closed" size={64} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 16 }}>No deliveries found</Text>
                        </View>
                    }
                />
            ) : (
                <FlatList
                    data={filteredDeliveries}
                    renderItem={renderGridItem}
                    keyExtractor={item => item.id}
                    numColumns={2}
                    columnWrapperStyle={{ justifyContent: 'space-between' }}
                    contentContainerStyle={styles.listContent}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <MaterialCommunityIcons name="package-variant-closed" size={64} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 16 }}>No deliveries found</Text>
                        </View>
                    }
                />
            )}

            <CancellationModal
                visible={showCancelModal}
                onDismiss={() => setShowCancelModal(false)}
                onSubmit={handleCancellationSubmit}
                loading={cancelLoading}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        padding: 20,
        paddingBottom: 10,
        elevation: 4,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        zIndex: 1,
    },
    searchbar: {
        marginBottom: 10,
        borderRadius: 10,
        backgroundColor: '#f0f0f0'
    },
    filterSection: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#eee',
    },
    filterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    filterChip: {
        marginRight: 8,
        marginBottom: 8,
    },
    customDateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 8,
        padding: 8,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
    },
    dateInput: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
        backgroundColor: 'white',
    },
    listContent: {
        padding: 20,
        paddingTop: 20,
    },
    card: {
        marginBottom: 16,
        borderRadius: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    trkContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    trkText: {
        fontWeight: 'bold',
        marginLeft: 8,
    },
    divider: {
        height: 1,
        backgroundColor: '#F0F0F0',
        marginBottom: 12,
    },
    customerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    avatarContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#E3F2FD',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    avatarText: {
        color: '#2196F3',
        fontWeight: 'bold',
        fontSize: 18,
    },
    addressContainer: {
        flexDirection: 'row',
        marginBottom: 12,
        backgroundColor: '#F9F9F9',
        padding: 8,
        borderRadius: 8,
    },
    addressText: {
        color: '#444',
        marginLeft: 8,
        flex: 1,
    },
    metaContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    metaText: {
        color: '#888',
        marginLeft: 4,
        fontSize: 12,
    },
    cardActions: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        paddingTop: 0,
    },
    emptyState: {
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 50,
        opacity: 0.5
    },
    gridCard: {
        marginBottom: 12,
        borderRadius: 12,
        width: '48%',
    },
});
