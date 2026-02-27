import React, { useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Linking, Platform, Alert } from 'react-native';
import { Text, Card, Button, Chip, Searchbar, Surface, useTheme, IconButton, Badge } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason } from '../../services/cancellationService';
import useAuthStore from '../../store/authStore';
import { supabase } from '../../services/supabaseClient';
import dayjs from 'dayjs';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AssignedDeliveriesScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const [searchQuery, setSearchQuery] = useState('');

    const [filter, setFilter] = useState('All'); // All, Active, Completed, Cancelled
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

    // Data State
    const [deliveries, setDeliveries] = useState<any[]>([]);

    // Auth
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;

    const onChangeSearch = query => setSearchQuery(query);

    const fetchDeliveries = async () => {
        if (!authedUserId) return;
        setRefreshing(true);
        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, customer:profiles!deliveries_customer_id_fkey(full_name, phone_number)')
                .eq('rider_id', authedUserId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching deliveries:', error);
                Alert.alert('Error', 'Failed to fetch deliveries');
            } else {
                console.log('Fetched deliveries data:', JSON.stringify(data, null, 2)); // DEBUG LOG

                const mapped = data.map((d: any) => ({
                    id: d.id,
                    trk: d.tracking_number,
                    status: d.status,
                    customer: d.customer?.full_name || 'Unknown',
                    phone: d.customer?.phone_number || 'N/A',
                    address: d.dropoff_address, // Main address to show
                    pickupAddress: d.pickup_address,
                    lat: d.dropoff_lat, // For legacy support
                    lng: d.dropoff_lng, // For legacy support
                    pickupLat: d.pickup_lat,
                    pickupLng: d.pickup_lng,
                    dropoffLat: d.dropoff_lat,
                    dropoffLng: d.dropoff_lng,
                    snappedPickupLat: d.snapped_pickup_lat,
                    snappedPickupLng: d.snapped_pickup_lng,
                    snappedDropoffLat: d.snapped_dropoff_lat,
                    snappedDropoffLng: d.snapped_dropoff_lng,
                    date: d.created_at, // Use created_at as base date
                    time: dayjs(d.created_at).format('h:mm A'),
                    distance: d.distance ? `${d.distance.toFixed(1)} km` : '--',
                    fare: d.estimated_fare ? `₱${d.estimated_fare}` : '--',
                    earnings: d.estimated_fare ? `₱${d.estimated_fare}` : '--',
                    estimatedTime: d.duration ? `${Math.round(d.duration / 60)} min` : '-- min',
                    boxId: d.assigned_box_id || d.box_id,
                    pickupTime: d.created_at,
                    dropoffTime: d.accepted_at || d.created_at,
                    acceptedAt: d.accepted_at,
                    deliveredAt: d.delivered_at,
                    pickedUpAt: d.picked_up_at,
                    packageType: 'Standard',
                    weight: 'N/A',
                    priority: 'Standard',
                    specialInstructions: d.package_description || '',
                    senderName: d.sender_name,
                    senderPhone: d.sender_phone,
                    recipientName: d.recipient_name,
                    deliveryNotes: d.delivery_notes,
                }));
                setDeliveries(mapped);
            }
        } catch (err) {
            console.error('Unexpected error fetching deliveries:', err);
        } finally {
            setRefreshing(false);
        }
    };

    React.useEffect(() => {
        fetchDeliveries();
    }, [authedUserId]);

    const onRefresh = () => {
        fetchDeliveries();
    };

    const openGoogleMaps = (lat, lng, address) => {
        if (!lat || !lng) {
            Alert.alert('Error', 'Location coordinates missing for this delivery.');
            return;
        }
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

    const handleCancellationSubmit = async (reason: CancellationReason, details: string) => {
        if (!selectedDelivery) return;

        setCancelLoading(true);
        try {
            // In a real app, use the actual delivery ID and box ID
            const result = await requestCancellation({
                deliveryId: selectedDelivery.id,
                boxId: 'BOX_001', // Ideally fetch from delivery or pairing state
                reason,
                reasonDetails: details,
                riderId: authedUserId ?? 'RIDER_001',
                riderName: 'Juan Dela Cruz', // Ideally fetch from profile
                currentStatus: selectedDelivery.status,
            });

            if (result.success) {
                setShowCancelModal(false);
                setSelectedDelivery(null);
                Alert.alert('Success', 'Delivery cancelled successfully.');
                fetchDeliveries(); // Refresh list
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
            case 'ASSIGNED': return '#FF9800'; // Orange
            case 'PENDING': return '#FFC107'; // Amber
            case 'IN_TRANSIT': return '#2196F3'; // Blue
            case 'ARRIVED': return '#03A9F4'; // Light Blue
            case 'COMPLETED': return '#4CAF50'; // Green
            case 'CANCELLED': return '#F44336'; // Red
            case 'RETURNING': return '#FF9800'; // Orange
            case 'TAMPERED': return '#9C27B0'; // Purple
            default: return '#757575'; // Grey
        }
    };

    const filteredDeliveries = deliveries.filter(item => {
        const matchesSearch = item.trk.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.customer.toLowerCase().includes(searchQuery.toLowerCase());

        let matchesStatus = true;
        if (filter === 'All') {
            matchesStatus = true;
        } else if (filter === 'Active') {
            matchesStatus = ['ASSIGNED', 'PENDING', 'IN_TRANSIT', 'ARRIVED', 'TAMPERED', 'RETURNING'].includes(item.status);
        } else if (filter === 'Completed') {
            matchesStatus = item.status === 'COMPLETED';
        } else if (filter === 'Cancelled') {
            matchesStatus = item.status === 'CANCELLED';
        }

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

    const renderItem = ({ item }) => {
        const isPickup = !['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'RETURNING', 'RETURNED'].includes(item.status);

        return (
            <Card style={styles.card} mode="elevated" onPress={() => navigation.navigate('JobDetail', { job: { ...item, id: item.id } })}>
                <Card.Content style={{ padding: 16 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{item.customer}</Text>
                            <Text variant="bodySmall" style={{ color: '#666' }}>{item.trk}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                            <Chip icon="map-marker-distance" compact style={{ backgroundColor: '#E3F2FD', marginBottom: 4 }}>{item.distance}</Chip>
                            <Chip compact style={{ backgroundColor: '#E8F5E9' }} textStyle={{ fontSize: 10, color: '#2E7D32', fontWeight: 'bold' }}>{item.status.replace(/_/g, ' ')}</Chip>
                        </View>
                    </View>

                    <View style={styles.divider} />

                    {/* Pickup Section */}
                    <View style={{ marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            <View style={{ backgroundColor: '#E3F2FD', width: 24, height: 24, borderRadius: 12, marginRight: 8, justifyContent: 'center', alignItems: 'center' }}>
                                <MaterialCommunityIcons name="package-variant" size={14} color="#2196F3" />
                            </View>
                            <Text variant="labelSmall" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>PICKUP</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, backgroundColor: '#F9F9F9', padding: 8, borderRadius: 8 }}>
                            <Text variant="bodyMedium" style={{ color: '#444', marginLeft: 8, flex: 1 }}>
                                {item.pickupAddress || 'Pickup Address'}
                            </Text>
                            <IconButton
                                icon="navigation"
                                mode="contained"
                                containerColor={theme.colors.primaryContainer}
                                iconColor={theme.colors.primary}
                                size={20}
                                onPress={() => openGoogleMaps(item.pickupLat, item.pickupLng, item.pickupAddress)}
                                style={{ margin: 0, marginLeft: 8 }}
                            />
                        </View>
                    </View>

                    {/* Dropoff Section */}
                    <View style={{ marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            <View style={{ backgroundColor: '#FFEBEE', width: 24, height: 24, borderRadius: 12, marginRight: 8, justifyContent: 'center', alignItems: 'center' }}>
                                <MaterialCommunityIcons name="map-marker" size={14} color="#F44336" />
                            </View>
                            <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: 'bold' }}>DROPOFF</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, backgroundColor: '#F9F9F9', padding: 8, borderRadius: 8 }}>
                            <Text variant="bodyMedium" style={{ color: '#444', marginLeft: 8, flex: 1 }}>
                                {item.address}
                            </Text>
                            <IconButton
                                icon="navigation"
                                mode="contained"
                                containerColor={theme.colors.errorContainer}
                                iconColor={theme.colors.error}
                                size={20}
                                onPress={() => openGoogleMaps(item.dropoffLat, item.dropoffLng, item.address)}
                                style={{ margin: 0, marginLeft: 8 }}
                            />
                        </View>
                    </View>

                    <View style={{ flexDirection: 'row', marginTop: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
                            <MaterialCommunityIcons name="clock-outline" size={16} color="#666" />
                            <Text style={{ marginLeft: 4, color: '#666', fontSize: 12, fontWeight: 'bold' }}>ETA: {item.time || '-- min'}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
                            <MaterialCommunityIcons name="cash" size={16} color="#666" />
                            <Text style={{ marginLeft: 4, color: '#666', fontSize: 12, fontWeight: 'bold' }}>{item.earnings}</Text>
                        </View>
                    </View>
                </Card.Content>

                <Card.Actions style={[styles.cardActions, { flexDirection: 'column', paddingHorizontal: 16, paddingBottom: 16 }]}>
                    {['ASSIGNED', 'PENDING', 'IN_TRANSIT', 'ARRIVED'].includes(item.status) && (
                        <Button
                            mode="contained"
                            style={{ width: '100%', borderRadius: 8, marginBottom: 8 }}
                            contentStyle={{ height: 48 }}
                            labelStyle={{ fontSize: 16, fontWeight: 'bold' }}
                            onPress={() => {
                                navigation.navigate('Arrival', {
                                    deliveryId: item.id,
                                    boxId: item.boxId,
                                    targetLat: isPickup ? (item.snappedPickupLat ?? item.pickupLat) : (item.snappedDropoffLat ?? item.dropoffLat),
                                    targetLng: isPickup ? (item.snappedPickupLng ?? item.pickupLng) : (item.snappedDropoffLng ?? item.dropoffLng),
                                    targetAddress: isPickup ? item.pickupAddress : item.address,
                                    customerPhone: item.phone,
                                    senderName: item.senderName,
                                    senderPhone: item.senderPhone,
                                    recipientName: item.recipientName,
                                    deliveryNotes: item.deliveryNotes,
                                    // Both coordinates for dynamic geofence switching
                                    pickupLat: item.snappedPickupLat ?? item.pickupLat,
                                    pickupLng: item.snappedPickupLng ?? item.pickupLng,
                                    pickupAddress: item.pickupAddress,
                                    dropoffLat: item.snappedDropoffLat ?? item.dropoffLat,
                                    dropoffLng: item.snappedDropoffLng ?? item.dropoffLng,
                                    dropoffAddress: item.address,
                                    // @ts-ignore
                                    riderName: useAuthStore.getState().user?.fullName || 'Rider'
                                });
                            }}
                            buttonColor={theme.colors.primary}
                            icon="navigation"
                        >
                            {['PICKED_UP', 'IN_TRANSIT', 'ARRIVED'].includes(item.status) ? 'Resume Trip' : 'Start Trip'}
                        </Button>
                    )}

                    <View style={{ flexDirection: 'row', width: '100%', gap: 8 }}>
                        {item.phone !== 'N/A' && (
                            <Button
                                mode="outlined"
                                onPress={() => Linking.openURL(`tel:${item.phone}`)}
                                icon="phone"
                                style={{ flex: 1, borderColor: theme.colors.primary }}
                                textColor={theme.colors.primary}
                            >
                                Call
                            </Button>
                        )}

                        {['ASSIGNED', 'PENDING', 'IN_TRANSIT'].includes(item.status) && (
                            <Button
                                mode="contained"
                                onPress={() => {
                                    setSelectedDelivery(item);
                                    setShowCancelModal(true);
                                }}
                                buttonColor={theme.colors.error}
                                style={{ flex: 1 }}
                            >
                                Cancel
                            </Button>
                        )}
                    </View>

                    {(item.status === 'COMPLETED' || item.status === 'CANCELLED') && (
                        <Button
                            mode="outlined"
                            onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
                            style={{ width: '100%', marginTop: 8 }}
                            icon="history"
                        >
                            View History
                        </Button>
                    )}
                </Card.Actions>
            </Card>
        );
    };

    const renderGridItem = ({ item }) => (
        <Card style={styles.gridCard} mode="elevated" onPress={() => {
            navigation.navigate('JobDetail', { job: { ...item, id: item.id } });
        }}>
            <Card.Content style={{ padding: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Badge size={16} style={{ backgroundColor: getStatusColor(item.status), alignSelf: 'flex-start', paddingHorizontal: 6 }}>
                        {item.status.replace(/_/g, ' ')}
                    </Badge>
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
                    <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant }}>{item.distance} • {item.earnings}</Text>
                </View>
            </Card.Content>
        </Card>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.surface, paddingTop: Math.max(insets.top, 20) }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <View>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>Assigned Deliveries</Text>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{dayjs().format('dddd, MMM D')}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', marginRight: 4 }}>
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
                            {['All', 'Active', 'Completed', 'Cancelled'].map((status) => (
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

            {/* Validated List Content */}
            <FlatList
                key={viewMode}
                data={filteredDeliveries}
                renderItem={viewMode === 'list' ? renderItem : renderGridItem}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                numColumns={viewMode === 'list' ? 1 : 2}
                columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="package-variant-closed" size={64} color={theme.colors.onSurfaceVariant} />
                        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 16 }}>No deliveries found</Text>
                    </View>
                }
            />

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
