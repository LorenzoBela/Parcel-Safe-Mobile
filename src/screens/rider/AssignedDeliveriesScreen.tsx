import React, { useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Linking, Platform, Alert } from 'react-native';
import { Text, Card, Button, Chip, Searchbar, Surface, useTheme, IconButton, Badge } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason } from '../../services/cancellationService';

export default function AssignedDeliveriesScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const [searchQuery, setSearchQuery] = useState('');

    const [filter, setFilter] = useState('All'); // All, Pending, Completed
    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list'); // New State

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
            lat: 14.5831,
            lng: 120.9794,
            type: 'Electronics',
            status: 'Pending',
            time: '10:30 AM',
            distance: '2.5 km',
            priority: 'High'
        },
        {
            id: '2',
            trk: 'TRK-9921-1122',
            customer: 'Kean Guzon',
            address: '456 Quezon Ave, QC',
            lat: 14.6409,
            lng: 121.0384,
            type: 'Documents',
            status: 'In Transit',
            time: '11:45 AM',
            distance: '5.1 km',
            priority: 'Normal'
        },
        {
            id: '3',
            trk: 'TRK-7721-3344',
            customer: 'Robert Callorina',
            address: '789 Makati Ave, Makati',
            lat: 14.5547,
            lng: 121.0244,
            type: 'Fragile',
            status: 'Completed',
            time: '09:15 AM',
            distance: '8.2 km',
            priority: 'Normal'
        },
        {
            id: '4',
            trk: 'TRK-5521-6677',
            customer: 'Jeus Manigbas',
            address: '101 Intramuros, Manila',
            lat: 14.5905,
            lng: 120.9768,
            type: 'Food',
            status: 'Pending',
            time: '01:00 PM',
            distance: '1.2 km',
            priority: 'High'
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
                riderId: 'RIDER_001',
                riderName: 'Juan Dela Cruz',
            });

            if (result.success) {
                setShowCancelModal(false);
                setSelectedDelivery(null);
                Alert.alert('Success', 'Delivery cancelled successfully.');
                // Update local state to reflect cancellation (switch to Cancelled status if we had one, or remove)
                // For now, we just show alert
            } else {
                Alert.alert('Error', result.error || 'Cancellation failed');
            }
        } catch (error) {
            Alert.alert('Error', 'An unexpected error occurred');
        } finally {
            setCancelLoading(false);
        }
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
        const matchesFilter = filter === 'All' || item.status === filter || (filter === 'Pending' && item.status === 'In Transit');
        return matchesSearch && matchesFilter;
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
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="package-variant" size={14} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodySmall" style={[styles.detailText, { color: theme.colors.onSurfaceVariant }]}>{item.type}</Text>
                            {item.priority === 'High' && (
                                <Badge size={16} style={{ backgroundColor: '#F44336', marginLeft: 8 }}>High Priority</Badge>
                            )}
                        </View>
                    </View>
                </View>

                <View style={[styles.addressContainer, { backgroundColor: theme.colors.elevation.level2 }]}>
                    <MaterialCommunityIcons name="map-marker" size={18} color={theme.colors.onSurfaceVariant} style={{ marginTop: 2 }} />
                    <Text variant="bodyMedium" style={[styles.addressText, { color: theme.colors.onSurface }]}>{item.address}</Text>
                </View>

                <View style={styles.metaContainer}>
                    <View style={styles.metaItem}>
                        <MaterialCommunityIcons name="clock-outline" size={16} color={theme.colors.onSurfaceVariant} />
                        <Text style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>{item.time}</Text>
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
                        mode="text"
                        onPress={() => {
                            setSelectedDelivery(item);
                            setShowCancelModal(true);
                        }}
                        textColor={theme.colors.error}
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
                    {item.priority === 'High' && <MaterialCommunityIcons name="alert-circle" size={16} color="#F44336" />}
                </View>

                <Text variant="titleSmall" style={{ fontWeight: 'bold' }} numberOfLines={1}>{item.customer}</Text>
                <Text variant="bodySmall" style={{ fontSize: 10, color: theme.colors.onSurfaceVariant, marginBottom: 4 }} numberOfLines={1}>{item.trk}</Text>

                <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                    <MaterialCommunityIcons name="map-marker" size={12} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" numberOfLines={1} style={{ fontSize: 10, marginLeft: 2, flex: 1 }}>{item.address}</Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant }}>{item.time}</Text>
                    <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant }}>{item.distance}</Text>
                </View>
            </Card.Content>
        </Card>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                        <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>My Queue</Text>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{filteredDeliveries.length} Active Jobs</Text>
                    </View>
                    <IconButton
                        icon={viewMode === 'list' ? 'view-grid' : 'view-list'}
                        mode="contained-tonal"
                        onPress={() => setViewMode(prev => prev === 'list' ? 'grid' : 'list')}
                    />
                </View>
            </View>


            <Searchbar
                placeholder="Search tracking # or name"
                onChangeText={onChangeSearch}
                value={searchQuery}
                style={[styles.searchBar, { backgroundColor: theme.colors.elevation.level1 }]}
                inputStyle={{ minHeight: 0 }} // Fix for some paper versions
            />

            <View style={styles.filterContainer}>
                {['All', 'Pending', 'Completed'].map((f) => (
                    <Chip
                        key={f}
                        selected={filter === f}
                        onPress={() => setFilter(f)}
                        style={[styles.filterChip, filter === f && { backgroundColor: theme.colors.primaryContainer }, { borderColor: theme.colors.outline }]}
                        textStyle={{ color: filter === f ? theme.colors.onPrimaryContainer : theme.colors.onSurface }}
                        showSelectedOverlay
                    >
                        {f}
                    </Chip>
                ))}
            </View>

            <FlatList
                key={viewMode} // Force re-render on mode change
                data={filteredDeliveries}
                renderItem={viewMode === 'list' ? renderItem : renderGridItem}
                keyExtractor={item => item.id}
                numColumns={viewMode === 'grid' ? 2 : 1}
                contentContainerStyle={styles.listContent}
                columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="package-variant-closed" size={60} color="#ccc" />
                        <Text style={{ color: '#999', marginTop: 10 }}>No deliveries found</Text>
                    </View>
                }
            />

            <CancellationModal
                visible={showCancelModal}
                onDismiss={() => {
                    setShowCancelModal(false);
                    setSelectedDelivery(null);
                }}
                onSubmit={handleCancellationSubmit}
                loading={cancelLoading}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    header: {
        padding: 20,
        paddingBottom: 10,
        // backgroundColor: 'white', // Handled by theme
    },
    searchBar: {
        marginHorizontal: 20,
        marginBottom: 10,
        // backgroundColor: 'white', // Handled by theme
        elevation: 1,
        borderRadius: 10,
    },
    filterContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        marginBottom: 10,
    },
    filterChip: {
        marginRight: 8,
        // backgroundColor: 'white',
        borderWidth: 1,
        // borderColor: '#eee',
    },
    listContent: {
        padding: 20,
        paddingTop: 10,
    },
    card: {
        marginBottom: 16,
        // backgroundColor: 'white', // Handled by theme
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
        color: '#333',
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
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
    },
    detailText: {
        color: '#666',
        marginLeft: 4,
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
        // backgroundColor: 'white', // Handled by theme
        borderRadius: 12,
        width: '48%', // Approx half width with spacing
    },
});
