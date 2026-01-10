import React, { useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Linking, Platform } from 'react-native';
import { Text, Card, Button, Chip, Searchbar, Surface, useTheme, IconButton, Badge } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function AssignedDeliveriesScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState('All'); // All, Pending, Completed
    const [refreshing, setRefreshing] = useState(false);

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
                        <Text variant="titleMedium" style={styles.trkText}>{item.trk}</Text>
                    </View>
                    <Chip
                        style={{ backgroundColor: getStatusColor(item.status) + '20' }}
                        textStyle={{ color: getStatusColor(item.status), fontWeight: 'bold', fontSize: 12 }}
                        compact
                    >
                        {item.status}
                    </Chip>
                </View>

                <View style={styles.divider} />

                <View style={styles.customerRow}>
                    <View style={styles.avatarContainer}>
                        <Text style={styles.avatarText}>{item.customer.charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{item.customer}</Text>
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="package-variant" size={14} color="#666" />
                            <Text variant="bodySmall" style={styles.detailText}>{item.type}</Text>
                            {item.priority === 'High' && (
                                <Badge size={16} style={{ backgroundColor: '#F44336', marginLeft: 8 }}>High Priority</Badge>
                            )}
                        </View>
                    </View>
                </View>

                <View style={styles.addressContainer}>
                    <MaterialCommunityIcons name="map-marker" size={18} color="#666" style={{ marginTop: 2 }} />
                    <Text variant="bodyMedium" style={styles.addressText}>{item.address}</Text>
                </View>

                <View style={styles.metaContainer}>
                    <View style={styles.metaItem}>
                        <MaterialCommunityIcons name="clock-outline" size={16} color="#888" />
                        <Text style={styles.metaText}>{item.time}</Text>
                    </View>
                    <View style={styles.metaItem}>
                        <MaterialCommunityIcons name="map-marker-distance" size={16} color="#888" />
                        <Text style={styles.metaText}>{item.distance}</Text>
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
                    {item.status === 'Completed' ? 'Trip History' : (item.status === 'In Transit' ? 'Resume' : 'Start Trip')}
                </Button>
            </Card.Actions>
        </Card>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>My Queue</Text>
                <Text variant="bodyMedium" style={{ color: '#666' }}>{filteredDeliveries.length} Active Jobs</Text>
            </View>

            <Searchbar
                placeholder="Search tracking # or name"
                onChangeText={onChangeSearch}
                value={searchQuery}
                style={styles.searchBar}
                inputStyle={{ minHeight: 0 }} // Fix for some paper versions
            />

            <View style={styles.filterContainer}>
                {['All', 'Pending', 'Completed'].map((f) => (
                    <Chip
                        key={f}
                        selected={filter === f}
                        onPress={() => setFilter(f)}
                        style={[styles.filterChip, filter === f && { backgroundColor: '#E3F2FD' }]}
                        textStyle={{ color: filter === f ? '#2196F3' : '#666' }}
                        showSelectedOverlay
                    >
                        {f}
                    </Chip>
                ))}
            </View>

            <FlatList
                data={filteredDeliveries}
                renderItem={renderItem}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="package-variant-closed" size={60} color="#ccc" />
                        <Text style={{ color: '#999', marginTop: 10 }}>No deliveries found</Text>
                    </View>
                }
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
        backgroundColor: 'white',
    },
    searchBar: {
        marginHorizontal: 20,
        marginBottom: 10,
        backgroundColor: 'white',
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
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: '#eee',
    },
    listContent: {
        padding: 20,
        paddingTop: 10,
    },
    card: {
        marginBottom: 16,
        backgroundColor: 'white',
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
        alignItems: 'center',
        marginTop: 50,
    },
});
