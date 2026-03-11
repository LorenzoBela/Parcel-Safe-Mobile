import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, Modal, Animated } from 'react-native';
import { Text, Button, Surface, IconButton, Divider, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RiderOrderRequest, subscribeToAvailableOrders, fetchAvailableOrders, SEARCH_RADIUS_KM } from '../../services/riderMatchingService';

interface AvailableOrdersModalProps {
    visible: boolean;
    riderLat: number | null;
    riderLng: number | null;
    onClose: () => void;
    onAccept: (request: RiderOrderRequest) => void;
}

export default function AvailableOrdersModal({
    visible,
    riderLat,
    riderLng,
    onClose,
    onAccept,
}: AvailableOrdersModalProps) {
    const theme = useTheme();
    const [orders, setOrders] = useState<RiderOrderRequest[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Initial load timer to ensure skeleton shows for at least a bit,
    // and hides if Firebase returns empty quickly.
    useEffect(() => {
        if (visible) {
            setIsLoading(true);
            const timer = setTimeout(() => {
                setIsLoading(false);
            }, 1500); // 1.5s max skeleton time if no orders
            return () => clearTimeout(timer);
        }
    }, [visible]);

    // Setup real-time listener when the modal is open
    useEffect(() => {
        if (!visible || riderLat === null || riderLng === null) return;

        const unsubscribe = subscribeToAvailableOrders(riderLat, riderLng, SEARCH_RADIUS_KM, (updatedOrders) => {
            setOrders(updatedOrders);
            setIsLoading(false); // Data arrived, hide skeleton
        });

        return unsubscribe;
    }, [visible, riderLat, riderLng]);

    // Manual refresh
    const onRefresh = useCallback(async () => {
        if (riderLat === null || riderLng === null) return;
        setRefreshing(true);
        try {
            const fetchedOrders = await fetchAvailableOrders(riderLat, riderLng, SEARCH_RADIUS_KM);
            setOrders(fetchedOrders);
        } catch (error) {
            console.error('Failed to format fetched orders', error);
        } finally {
            setRefreshing(false);
        }
    }, [riderLat, riderLng]);

    const formatCurrency = (amount: number) => `₱${amount.toFixed(2)}`;

    // --- Skeleton Loader Component ---
    const SkeletonOrderCard = () => {
        const fadeAnim = React.useRef(new Animated.Value(0.3)).current;

        useEffect(() => {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(fadeAnim, {
                        toValue: 0.7,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(fadeAnim, {
                        toValue: 0.3,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        }, [fadeAnim]);

        return (
            <Surface style={styles.orderCard} elevation={2}>
                <Animated.View style={{ opacity: fadeAnim }}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.skeletonBlock, { width: 32, height: 32, borderRadius: 16 }]} />
                            <View style={[styles.skeletonBlock, { width: 100, height: 20, marginLeft: 12 }]} />
                        </View>
                        <View style={[styles.skeletonBlock, { width: 60, height: 16 }]} />
                    </View>
                    <Divider style={styles.divider} />
                    <View style={styles.locationRow}>
                        <View style={[styles.skeletonBlock, { width: 28, height: 28, borderRadius: 14 }]} />
                        <View style={styles.locationInfo}>
                            <View style={[styles.skeletonBlock, { width: 50, height: 12, marginBottom: 4 }]} />
                            <View style={[styles.skeletonBlock, { width: '80%', height: 16 }]} />
                        </View>
                    </View>
                    <View style={styles.locationRow}>
                        <View style={[styles.skeletonBlock, { width: 28, height: 28, borderRadius: 14 }]} />
                        <View style={styles.locationInfo}>
                            <View style={[styles.skeletonBlock, { width: 50, height: 12, marginBottom: 4 }]} />
                            <View style={[styles.skeletonBlock, { width: '80%', height: 16 }]} />
                        </View>
                    </View>
                    <View style={styles.fareRow}>
                        <View style={[styles.skeletonBlock, { width: 80, height: 16 }]} />
                        <View style={[styles.skeletonBlock, { width: 60, height: 24 }]} />
                    </View>
                    <View style={[styles.skeletonBlock, { width: '100%', height: 40, borderRadius: 12 }]} />
                </Animated.View>
            </Surface>
        );
    };

    const renderOrderItem = ({ item }: { item: RiderOrderRequest }) => (
        <Surface style={styles.orderCard} elevation={2}>
            <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                    <MaterialCommunityIcons name="bike-fast" size={24} color={theme.colors.primary} />
                    <Text variant="titleMedium" style={styles.cardTitle}>Nearby Order</Text>
                </View>
                <Text variant="labelMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                    {item.distanceToPickupKm.toFixed(1)} km away
                </Text>
            </View>

            <Divider style={styles.divider} />

            <View style={styles.locationRow}>
                <View style={[styles.locationIcon, { backgroundColor: '#E8F5E9' }]}>
                    <MaterialCommunityIcons name="circle-slice-8" size={14} color="#4CAF50" />
                </View>
                <View style={styles.locationInfo}>
                    <Text variant="labelSmall" style={styles.locationLabel}>PICKUP</Text>
                    <Text variant="bodyMedium" numberOfLines={2}>{item.pickupAddress}</Text>
                </View>
            </View>

            <View style={styles.locationRow}>
                <View style={[styles.locationIcon, { backgroundColor: '#FFEBEE' }]}>
                    <MaterialCommunityIcons name="map-marker" size={14} color="#F44336" />
                </View>
                <View style={styles.locationInfo}>
                    <Text variant="labelSmall" style={styles.locationLabel}>DROPOFF</Text>
                    <Text variant="bodyMedium" numberOfLines={2}>{item.dropoffAddress}</Text>
                </View>
            </View>

            <View style={styles.fareRow}>
                <Text variant="labelMedium" style={styles.fareLabel}>Estimated Fare</Text>
                <Text variant="titleMedium" style={[styles.fareAmount, { color: theme.colors.primary }]}>
                    {formatCurrency(item.estimatedFare)}
                </Text>
            </View>

            <Button
                mode="contained"
                onPress={() => onAccept(item)}
                style={styles.acceptButton}
                icon="check-circle"
            >
                Accept Order
            </Button>
        </Surface>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <Surface style={styles.modalContent} elevation={5}>
                    <View style={styles.header}>
                        <Text variant="titleLarge" style={styles.title}>Available Orders</Text>
                        <IconButton
                            icon="close"
                            size={24}
                            onPress={onClose}
                        />
                    </View>

                    <FlatList
                        data={isLoading ? ([1, 2, 3] as any[]) : orders}
                        keyExtractor={(item, index) => isLoading ? `skeleton-${index}` : (item as RiderOrderRequest).bookingId}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => isLoading ? <SkeletonOrderCard /> : renderOrderItem({ item: item as RiderOrderRequest })}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
                        }
                        ListEmptyComponent={
                            !isLoading ? (
                                <View style={styles.emptyContainer}>
                                    <MaterialCommunityIcons name="clock-outline" size={64} color="#CCC" />
                                    <Text variant="bodyLarge" style={styles.emptyText}>No available orders nearby at the moment.</Text>
                                    <Text variant="bodyMedium" style={styles.emptySubText}>Pull down to refresh and check again.</Text>
                                </View>
                            ) : null
                        }
                    />
                </Surface>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '85%',
        minHeight: '50%',
        paddingBottom: 24,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    title: {
        fontWeight: 'bold',
    },
    listContent: {
        padding: 16,
        flexGrow: 1,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        paddingHorizontal: 32,
    },
    emptyText: {
        marginTop: 16,
        textAlign: 'center',
        color: '#666',
        fontWeight: 'bold',
    },
    emptySubText: {
        marginTop: 8,
        textAlign: 'center',
        color: '#999',
    },
    orderCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#F0F0F0',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    cardHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cardTitle: {
        fontWeight: 'bold',
        marginLeft: 8,
    },
    divider: {
        marginBottom: 12,
    },
    locationRow: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    locationIcon: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    locationInfo: {
        flex: 1,
        marginLeft: 12,
        justifyContent: 'center',
    },
    locationLabel: {
        color: '#888',
        fontSize: 10,
        fontWeight: 'bold',
    },
    fareRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    fareLabel: {
        color: '#666',
    },
    fareAmount: {
        fontWeight: 'bold',
    },
    acceptButton: {
        borderRadius: 12,
        paddingVertical: 4,
    },
    skeletonBlock: {
        backgroundColor: '#E0E0E0',
        borderRadius: 4,
    },
});
