import React, { useState } from 'react';
import { View, StyleSheet, FlatList, Image, TouchableOpacity } from 'react-native';
import { Text, Card, Searchbar, Chip, useTheme, Surface, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function DeliveryLogScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [searchQuery, setSearchQuery] = useState('');

    // Mock data with images and tampering cases
    const logs = [
        {
            trk: 'TRK-8821-9023',
            date: 'Oct 25, 2023',
            time: '2:30 PM',
            status: 'Delivered',
            rider: 'Lorenzo Bela',
            type: 'Electronics Package',
            customer: 'Kean Guzon',
            address: '123 Rizal Park, Manila',
            price: '₱1,250',
            distance: '2.5 km',
            priority: 'High',
            image: 'https://images.unsplash.com/photo-1566576912906-600aceeb7aef?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80'
        },
        {
            trk: 'TRK-8821-9024',
            date: 'Oct 20, 2023',
            time: '9:15 AM',
            status: 'Tampered',
            rider: 'Kean Guzon',
            type: 'Office Documents',
            customer: 'Robert Callorina',
            address: '456 Quezon Ave, QC',
            price: '₱150',
            distance: '5.1 km',
            priority: 'Normal',
            image: 'https://images.unsplash.com/photo-1606168094336-42f9e9462f7f?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80'
        },
        {
            trk: 'TRK-8821-9025',
            date: 'Oct 15, 2023',
            time: '6:45 PM',
            status: 'Cancelled',
            rider: 'Robert Callorina',
            type: 'Food Delivery',
            customer: 'Jeus Manigbas',
            address: '789 Makati Ave, Makati',
            price: '₱450',
            distance: '1.2 km',
            priority: 'High',
            image: 'https://images.unsplash.com/photo-1595246140625-573b715d1128?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80'
        },
        {
            trk: 'TRK-8821-9026',
            date: 'Oct 10, 2023',
            time: '11:00 AM',
            status: 'Delivered',
            rider: 'Jeus Manigbas',
            type: 'Clothing',
            customer: 'Lorenzo Bela',
            address: '101 Intramuros, Manila',
            price: '₱890',
            distance: '8.2 km',
            priority: 'Normal',
            image: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80'
        },
    ];

    const filteredLogs = logs.filter(log =>
        log.trk.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.type.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusColor = (status) => {
        switch (status) {
            case 'Delivered': return '#4CAF50'; // Green
            case 'In Transit': return '#2196F3'; // Blue
            case 'Cancelled': return '#9E9E9E'; // Grey
            case 'Tampered': return '#D32F2F'; // Red
            default: return '#9E9E9E';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'Delivered': return 'check-circle';
            case 'In Transit': return 'truck-delivery';
            case 'Cancelled': return 'close-circle';
            case 'Tampered': return 'alert-circle';
            default: return 'help-circle';
        }
    };

    const renderItem = ({ item }) => (
        <Card style={styles.card} mode="elevated" onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}>
            <View style={styles.cardInner}>
                {/* Image Thumbnail */}
                <Image source={{ uri: item.image }} style={styles.thumbnail} />

                <View style={styles.cardContent}>
                    <View style={styles.cardHeader}>
                        <Text variant="titleSmall" style={{ fontWeight: 'bold', color: theme.colors.primary }}>{item.trk}</Text>
                        <Chip
                            icon={getStatusIcon(item.status)}
                            textStyle={{ fontSize: 11, color: 'white', fontWeight: 'bold' }}
                            style={{ backgroundColor: getStatusColor(item.status), height: 30, borderRadius: 15 }}
                        >
                            {item.status.toUpperCase()}
                        </Chip>
                    </View>

                    <Text variant="titleMedium" style={styles.itemName} numberOfLines={1}>{item.type}</Text>

                    {item.status === 'Tampered' && (
                        <View style={styles.alertContainer}>
                            <MaterialCommunityIcons name="alert-circle" size={16} color="#D32F2F" />
                            <Text style={styles.alertText}>Tampering Detected!</Text>
                        </View>
                    )}

                    <View style={styles.detailsRow}>
                        <Text variant="bodySmall" style={styles.detailText}>{item.date} • {item.time}</Text>
                    </View>

                    <View style={styles.footer}>
                        <View style={styles.riderInfo}>
                            <MaterialCommunityIcons name="motorbike" size={14} color="#666" />
                            <Text variant="bodySmall" style={{ marginLeft: 4, color: '#666' }}>{item.rider}</Text>
                        </View>
                        <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>{item.price}</Text>
                    </View>
                </View>
            </View>
        </Card>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text variant="headlineSmall" style={styles.title}>Delivery History</Text>
                <IconButton icon="filter-variant" onPress={() => console.log('Filter')} />
            </View>

            <Searchbar
                placeholder="Search tracking ID or item..."
                onChangeText={setSearchQuery}
                value={searchQuery}
                style={styles.searchBar}
                inputStyle={{ fontSize: 14 }}
            />

            <FlatList
                data={filteredLogs}
                renderItem={renderItem}
                keyExtractor={item => item.trk}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="package-variant-closed" size={60} color="#CCC" />
                        <Text style={{ marginTop: 10, color: '#999' }}>No deliveries found</Text>
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
        paddingTop: 0,
    },
    card: {
        marginBottom: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        overflow: 'hidden',
    },
    cardInner: {
        flexDirection: 'row',
    },
    thumbnail: {
        width: 100,
        height: '100%',
        backgroundColor: '#eee',
    },
    cardContent: {
        flex: 1,
        padding: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    itemName: {
        fontWeight: 'bold',
        marginBottom: 4,
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
    detailsRow: {
        marginBottom: 8,
    },
    detailText: {
        color: '#888',
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 'auto',
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
