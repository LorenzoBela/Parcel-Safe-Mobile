import React, { useState } from 'react';
import { View, StyleSheet, FlatList, Image, TouchableOpacity, ScrollView } from 'react-native';
import { Text, Card, Searchbar, Chip, useTheme, Surface, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function DeliveryLogScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFilter, setSelectedFilter] = useState('All');
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');


    const FILTERS = ['All', 'Delivered', 'In Transit', 'Cancelled', 'Tampered'];

    // Mock data with images and tampering cases
    // Mock data removed — replaced with empty state until backend integration
    const logs: any[] = [];

    const filteredLogs = logs.filter(log => {
        const matchesSearch = log.trk.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesFilter = selectedFilter === 'All' || log.status === selectedFilter;

        return matchesSearch && matchesFilter;
    });

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

                    {/* Show status color bar for grid view instead of big chip to save space */}
                    {viewMode === 'grid' && (
                        <View style={{ height: 4, backgroundColor: getStatusColor(item.status), borderRadius: 2, marginBottom: 8, marginTop: 4 }} />
                    )}

                    {item.status === 'Tampered' && (
                        <View style={styles.alertContainer}>
                            <MaterialCommunityIcons name="alert-circle" size={16} color="#D32F2F" />
                            <Text style={styles.alertText}>Tampering Detected!</Text>
                        </View>
                    )}

                    <View style={styles.divider} />

                    <View style={styles.footer}>
                        <View style={{ flex: 1 }}>
                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="calendar" size={14} color="#888" />
                                <Text variant="bodySmall" style={styles.detailText} numberOfLines={1}>{item.date}</Text>
                            </View>
                            {viewMode === 'list' && (
                                <View style={[styles.detailRow, { marginTop: 4 }]}>
                                    <MaterialCommunityIcons name="motorbike" size={14} color="#888" />
                                    <Text variant="bodySmall" style={styles.detailText}>{item.rider}</Text>
                                </View>
                            )}
                        </View>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.primary }}>{item.price}</Text>
                    </View>
                </View>
            </View>
        </Card>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
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

            <FlatList
                key={viewMode} // Force re-render when switching modes
                data={filteredLogs}
                renderItem={renderItem}
                keyExtractor={item => item.trk}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                numColumns={viewMode === 'grid' ? 2 : 1}
                columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="package-variant-closed" size={60} color={theme.colors.onSurfaceVariant} />
                        <Text style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>No deliveries found</Text>
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
        flex: 0.48, // Slightly less than 50% to allow for spacing
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
