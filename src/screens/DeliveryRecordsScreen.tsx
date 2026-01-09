import React, { useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Card, Button, Chip, Searchbar, Surface, useTheme, IconButton, Avatar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function DeliveryRecordsScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState('All'); // All, Today, This Week

    // Mock Data for History
    const historyData = [
        {
            id: '1',
            trk: 'TRK-8821-9023',
            customer: 'Lorenzo Bela',
            address: '123 Rizal Park, Manila',
            date: 'Dec 2, 2025',
            time: '10:30 AM',
            earnings: '₱150.00',
            status: 'Delivered',
            type: 'Electronics',
            distance: '2.5 km',
            priority: 'High',
            lat: 14.5831,
            lng: 120.9794,
            image: 'https://via.placeholder.com/300' // Mock image
        },
        {
            id: '2',
            trk: 'TRK-9921-1122',
            customer: 'Kean Guzon',
            address: '456 Quezon Ave, QC',
            date: 'Dec 1, 2025',
            time: '02:15 PM',
            earnings: '₱120.00',
            status: 'Delivered',
            type: 'Documents',
            distance: '5.1 km',
            priority: 'Normal',
            lat: 14.6409,
            lng: 121.0384,
            image: 'https://via.placeholder.com/300'
        },
        {
            id: '3',
            trk: 'TRK-7721-3344',
            customer: 'Robert Callorina',
            address: '789 Makati Ave, Makati',
            date: 'Nov 30, 2025',
            time: '09:45 AM',
            earnings: '₱0.00',
            status: 'Cancelled',
            type: 'Fragile',
            distance: '8.2 km',
            priority: 'Normal',
            lat: 14.5547,
            lng: 121.0244,
            image: 'https://via.placeholder.com/300'
        },
        {
            id: '4',
            trk: 'TRK-5521-6677',
            customer: 'Jeus Manigbas',
            address: '101 Intramuros, Manila',
            date: 'Nov 29, 2025',
            time: '04:20 PM',
            earnings: '₱200.00',
            status: 'Delivered',
            type: 'Food',
            distance: '1.2 km',
            priority: 'High',
            lat: 14.5905,
            lng: 120.9768,
            image: 'https://via.placeholder.com/300'
        },
    ];

    const getStatusColor = (status) => {
        switch (status) {
            case 'Delivered': return '#4CAF50';
            case 'Cancelled': return '#F44336';
            default: return '#757575';
        }
    };

    const filteredData = historyData.filter(item => {
        const matchesSearch = item.trk.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.customer.toLowerCase().includes(searchQuery.toLowerCase());
        // Simple mock filter logic
        const matchesFilter = filter === 'All' ||
            (filter === 'Today' && item.date === 'Dec 2, 2025') ||
            (filter === 'This Week');
        return matchesSearch && matchesFilter;
    });

    const totalEarnings = filteredData
        .filter(item => item.status === 'Delivered')
        .reduce((sum, item) => sum + parseFloat(item.earnings.replace('₱', '')), 0);

    const renderItem = ({ item }) => (
        <Card style={styles.card} mode="elevated" onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}>
            <Card.Content>
                <View style={styles.cardHeader}>
                    <View>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{item.trk}</Text>
                        <Text variant="bodySmall" style={{ color: '#888' }}>{item.date} • {item.time}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.primary }}>{item.earnings}</Text>
                        <Chip
                            style={{ backgroundColor: getStatusColor(item.status) + '20', height: 24 }}
                            textStyle={{ color: getStatusColor(item.status), fontWeight: 'bold', fontSize: 10, lineHeight: 10 }}
                            compact
                        >
                            {item.status}
                        </Chip>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.row}>
                    <View style={styles.iconBox}>
                        <MaterialCommunityIcons name="account" size={16} color="#555" />
                    </View>
                    <Text variant="bodyMedium" style={styles.rowText}>{item.customer}</Text>
                </View>

                <View style={styles.row}>
                    <View style={styles.iconBox}>
                        <MaterialCommunityIcons name="map-marker" size={16} color="#555" />
                    </View>
                    <Text variant="bodyMedium" numberOfLines={1} style={styles.rowText}>{item.address}</Text>
                </View>

            </Card.Content>
        </Card>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <IconButton icon="arrow-left" onPress={() => navigation.goBack()} />
                    <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>History & Earnings</Text>
                    <View style={{ width: 48 }} />
                </View>

                {/* Summary Stats */}
                <View style={styles.statsContainer}>
                    <Surface style={styles.statCard} elevation={2}>
                        <Text variant="labelMedium" style={{ color: '#666' }}>Total Jobs</Text>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: '#2196F3' }}>{filteredData.length}</Text>
                    </Surface>
                    <Surface style={styles.statCard} elevation={2}>
                        <Text variant="labelMedium" style={{ color: '#666' }}>Total Earnings</Text>
                        <Text variant="headlineMedium" style={{ fontWeight: 'bold', color: '#4CAF50' }}>₱{totalEarnings.toFixed(2)}</Text>
                    </Surface>
                </View>
            </View>

            <View style={styles.content}>
                <Searchbar
                    placeholder="Search history..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={styles.searchBar}
                    inputStyle={{ minHeight: 0 }}
                />

                <View style={styles.filterContainer}>
                    {['All', 'Today', 'This Week'].map((f) => (
                        <Chip
                            key={f}
                            selected={filter === f}
                            onPress={() => setFilter(f)}
                            style={[styles.filterChip, filter === f && { backgroundColor: '#E3F2FD', borderColor: '#2196F3' }]}
                            textStyle={{ color: filter === f ? '#2196F3' : '#666' }}
                            showSelectedOverlay
                        >
                            {f}
                        </Chip>
                    ))}
                </View>

                <FlatList
                    data={filteredData}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    header: {
        backgroundColor: 'white',
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
        backgroundColor: 'white',
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
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: '#eee',
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    card: {
        marginBottom: 12,
        backgroundColor: 'white',
        borderRadius: 12,
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
        marginBottom: 8,
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
});
