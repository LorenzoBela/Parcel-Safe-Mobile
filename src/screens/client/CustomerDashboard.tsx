import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ImageBackground, Image, Alert, RefreshControl, Share } from 'react-native';
import { Text, Card, Button, useTheme, Avatar, Surface, Portal, Modal, IconButton } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext'; // Import custom hook if needed, or just useTheme from paper
import * as Location from 'expo-location';
import { CustomerHardwareBanner, NetworkStatusBanner } from '../../components';
import { subscribeToDisplay } from '../../services/firebaseClient';
import {
    subscribeToCancellation,
    CancellationState,
    formatCancellationReason
} from '../../services/cancellationService';
import { supabase } from '../../services/supabaseClient';

import useAuthStore from '../../store/authStore';
import { fetchWeather, weatherBackgroundImages, WeatherData } from '../../services/weatherService';

export default function CustomerDashboard() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [modalVisible, setModalVisible] = useState(false); // For Proof of Delivery
    const [shareModalVisible, setShareModalVisible] = useState(false); // For Share Warning
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [cancellation, setCancellation] = useState<CancellationState | null>(null);
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lng: number } | null>(null);

    // Get authenticated user data from store
    const authedUser = useAuthStore((state: any) => state.user) as any;
    const displayName = authedUser?.fullName || authedUser?.name || authedUser?.email || 'User';
    const avatarUri = authedUser?.photo || null;

    // Dynamic data — populated from real sources when available
    const [activeDelivery, setActiveDelivery] = useState<{
        id: string; status: string; eta: string; rider: string; location: string; shareToken?: string;
    } | null>(null);

    const activeDeliveryId = activeDelivery?.id || null;

    const [recentActivity, setRecentActivity] = useState<{
        id: number; trackingId: string; type: string; date: string;
        serviceType: string; status: string;
    }[]>([]);

    const handleShare = () => {
        setShareModalVisible(true);
    };

    const performShare = async () => {
        setShareModalVisible(false);
        if (!activeDelivery) return;
        try {
            const token = activeDelivery.shareToken || activeDelivery.id;
            const baseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';
            const shareUrl = `${baseUrl}/track/${token}`;
            await Share.share({
                message: `Track your Parcel-Safe delivery here: ${shareUrl}`,
                url: shareUrl, // iOS uses this
                title: 'Track Parcel'
            });
        } catch (error: any) {
            Alert.alert(error.message);
        }
    };

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(dayjs());
        }, 1000); // Update every second
        return () => clearInterval(timer);
    }, []);

    const fetchLocation = useCallback(async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            setLocationName('Permission denied');
            Alert.alert('Permission to access location was denied');
            return;
        }

        try {
            let location = await Location.getCurrentPositionAsync({});
            const { latitude, longitude } = location.coords;
            setDeviceCoords({ lat: latitude, lng: longitude });

            let address = await Location.reverseGeocodeAsync({ latitude, longitude });

            if (address && address.length > 0) {
                const { city, region, name } = address[0];
                // Prefer city/region, fallback to name
                const locString = city ? `${city}, ${region}` : name;
                setLocationName(locString || 'Unknown Location');
            }
        } catch (error) {
            console.log('Error fetching location:', error);
            setLocationName('Location unavailable');
        }
    }, []);

    useEffect(() => {
        fetchLocation();
    }, [fetchLocation]);

    // Fetch weather when location is available
    useEffect(() => {
        if (!deviceCoords) return;
        fetchWeather(deviceCoords.lat, deviceCoords.lng).then((data) => {
            if (data) setWeather(data);
        });
    }, [deviceCoords]);

    const fetchActiveDelivery = useCallback(async () => {
        console.log('Fetching active delivery...');
        if (!authedUser?.userId) return;

        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, rider:rider_id(full_name)')
                .eq('customer_id', authedUser.userId)
                .in('status', ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED'])
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 is "The result contains 0 rows"
                console.log('Error fetching active delivery:', error);
                setActiveDelivery(null);
                return;
            }

            if (data) {
                setActiveDelivery({
                    id: data.id,
                    status: data.status,
                    // ETA logic: if estimated_dropoff_time exists, show formatted time (e.g. "5:30 PM").
                    // If not, show "Calculating..."
                    eta: data.estimated_dropoff_time ? dayjs(data.estimated_dropoff_time).format('h:mm A') : null,
                    rider: data.rider?.full_name || 'Finding a rider...',
                    location: data.status === 'PENDING' ? (data.pickup_address || 'Pickup Point') : (data.dropoff_address || 'Dropoff Point'),
                    shareToken: data.share_token
                });
            } else {
                setActiveDelivery(null);
            }

        } catch (error) {
            console.log('Error in fetchActiveDelivery:', error);
            setActiveDelivery(null);
        }
    }, [authedUser?.userId]);

    useEffect(() => {
        fetchActiveDelivery();
    }, [fetchActiveDelivery]);

    const fetchRecentActivity = useCallback(async () => {
        if (!authedUser?.userId) return;

        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*')
                .eq('customer_id', authedUser.userId)
                .order('created_at', { ascending: false })
                .limit(3);

            if (error) {
                console.log('Error fetching recent activity:', error);
                return;
            }

            if (data) {
                const mappedActivity = data.map((item: any) => ({
                    id: item.id,
                    trackingId: item.tracking_number || item.id,
                    type: 'Delivery',
                    date: dayjs(item.created_at).format('MMM D, YYYY'),
                    serviceType: 'Standard Delivery',
                    status: item.status
                }));
                setRecentActivity(mappedActivity);
            }
        } catch (error) {
            console.log('Error in fetchRecentActivity:', error);
        }
    }, [authedUser?.userId]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([fetchLocation(), fetchActiveDelivery(), fetchRecentActivity()]);
        setRefreshing(false);
    }, [fetchLocation, fetchActiveDelivery, fetchRecentActivity]);

    useFocusEffect(
        useCallback(() => {
            fetchActiveDelivery();
            fetchRecentActivity();
        }, [fetchActiveDelivery, fetchRecentActivity])
    );

    const hideModal = () => setModalVisible(false);

    const getStatusIcon = (status) => {
        switch (status) {
            case 'Delivered': return { icon: 'check', color: theme.colors.primary, bg: theme.colors.primaryContainer };
            case 'Tampered': return { icon: 'alert-circle', color: theme.colors.error, bg: theme.colors.errorContainer };
            case 'Cancelled': return { icon: 'close', color: theme.colors.onSurfaceVariant, bg: theme.colors.surfaceVariant };
            default: return { icon: 'information', color: theme.colors.secondary, bg: theme.colors.secondaryContainer };
        }
    };

    // Helper to format status string (e.g., "IN_TRANSIT" -> "In Transit")
    const formatStatus = (status: string) => {
        if (!status) return '';
        switch (status) {
            case 'PENDING': return 'Pending';
            case 'ASSIGNED': return 'Rider Assigned';
            case 'PICKED_UP': return 'Picked Up';
            case 'IN_TRANSIT': return 'In Transit';
            case 'ARRIVED': return 'Arrived';
            case 'COMPLETED': return 'Delivered';
            case 'CANCELLED': return 'Cancelled';
            default: return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
    };

    const QuickAction = ({ icon, label, onPress, color }) => (
        <TouchableOpacity style={styles.actionItem} onPress={onPress}>
            <Surface style={[styles.actionIcon, { backgroundColor: color }]} elevation={2}>
                <MaterialCommunityIcons name={icon} size={28} color="white" />
            </Surface>
            <Text variant="labelMedium" style={styles.actionLabel}>{label}</Text>
        </TouchableOpacity>
    );

    const getGreeting = () => {
        const hour = currentTime.hour();
        if (hour < 12) return 'Good Morning,';
        if (hour < 18) return 'Good Afternoon,';
        return 'Good Evening,';
    };

    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Attractive Header with Weather Background */}
            <ImageBackground
                source={{ uri: weather ? (weatherBackgroundImages[weather.condition] || weatherBackgroundImages['Sunny']) : weatherBackgroundImages['Sunny'] }}
                style={[styles.headerBackground, { height: 180 + insets.top }]}
                imageStyle={{ borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}
                resizeMode="cover"
            >
                <View style={[styles.headerOverlay, { paddingBottom: 20 }]}>
                    <View style={styles.headerContent}>
                        <View>
                            <View style={styles.locationContainer}>
                                <MaterialCommunityIcons name="map-marker" size={16} color="rgba(255,255,255,0.9)" />
                                <Text style={styles.locationText}>{locationName}</Text>
                            </View>
                            <Text style={styles.dateText}>{currentTime.format('dddd, MMMM D')}</Text>
                            <Text style={styles.timeText}>{currentTime.format('h:mm A')}</Text>
                        </View>
                        {weather && (
                            <View style={styles.weatherContainer}>
                                <MaterialCommunityIcons name={weather.icon as any} size={30} color="white" />
                                <Text style={styles.weatherText}>{weather.temp}</Text>
                                <Text style={styles.weatherCondition}>{weather.condition}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </ImageBackground>

            <ScrollView
                style={{ backgroundColor: theme.colors.background }}
                contentContainerStyle={[
                    styles.scrollContent,
                    { paddingBottom: 80 + insets.bottom }
                ]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >

                {/* Greeting Section */}
                <View style={styles.greetingContainer}>
                    <View>
                        <Text variant="headlineSmall" style={[styles.greeting, { color: theme.colors.onSurfaceVariant }]}>{getGreeting()}</Text>
                        <Text variant="headlineMedium" style={[styles.userName, { color: theme.colors.onSurface }]}>{displayName}</Text>
                    </View>
                    {avatarUri ? (
                        <Avatar.Image size={50} source={{ uri: avatarUri }} />
                    ) : (
                        <Avatar.Text size={50} label={displayName.charAt(0).toUpperCase()} />
                    )}
                </View>

                {/* Network connectivity status */}
                <NetworkStatusBanner />

                {/* EC-86: Display failure notification */}
                <CustomerHardwareBanner displayStatus={displayStatus} />

                {/* EC-32: Cancellation Alert Banner */}
                {cancellation && !cancellation.packageRetrieved && (
                    <TouchableOpacity
                        onPress={() => navigation.navigate('TrackOrder')}
                        activeOpacity={0.8}
                    >
                        <Surface style={[styles.cancellationBanner, { backgroundColor: theme.colors.errorContainer }]} elevation={2}>
                            <View style={styles.cancellationBannerContent}>
                                <View style={[styles.cancellationIcon, { backgroundColor: theme.colors.error }]}>
                                    <MaterialCommunityIcons name="alert-circle" size={24} color="white" />
                                </View>
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text variant="titleSmall" style={{ fontWeight: 'bold', color: theme.colors.error }}>
                                        Delivery Cancelled
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onErrorContainer }}>
                                        {formatCancellationReason(cancellation.reason)} • Tap to view return OTP
                                    </Text>
                                </View>
                                <MaterialCommunityIcons name="chevron-right" size={24} color={theme.colors.error} />
                            </View>
                        </Surface>
                    </TouchableOpacity>
                )}

                {/* Active Delivery Card */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Active Delivery</Text>
                {activeDelivery ? (
                    <Card style={[styles.deliveryCard, { backgroundColor: theme.colors.primaryContainer }]} mode="elevated">
                        <View style={styles.deliveryHeader}>
                            <View style={styles.deliveryIdContainer}>
                                <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.onPrimaryContainer} />
                                {/* Truncate ID to 8 chars and uppercase for better UI */}
                                <Text variant="titleSmall" style={{ marginLeft: 8, color: theme.colors.onPrimaryContainer }}>
                                    {activeDelivery.id.substring(0, 8).toUpperCase()}
                                </Text>
                            </View>
                            <View style={[styles.statusBadge, { backgroundColor: theme.colors.primary }]}>
                                <Text style={[styles.statusText, { color: theme.colors.onPrimary }]}>
                                    {formatStatus(activeDelivery.status)}
                                </Text>
                            </View>
                        </View>

                        <Card.Content style={styles.deliveryContent}>
                            <View style={styles.deliveryRow}>
                                <MaterialCommunityIcons name="clock-outline" size={20} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={[styles.deliveryDetail, { color: theme.colors.onSurface }]}>
                                    {activeDelivery.eta ? `Arriving by ${activeDelivery.eta}` : 'Calculating ETA...'}
                                </Text>
                            </View>
                            <View style={styles.deliveryRow}>
                                <MaterialCommunityIcons name="map-marker-outline" size={20} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={[styles.deliveryDetail, { color: theme.colors.onSurface }]}>{activeDelivery.location}</Text>
                            </View>
                            <View style={styles.deliveryRow}>
                                <MaterialCommunityIcons name="motorbike" size={20} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={[styles.deliveryDetail, { color: theme.colors.onSurface }]}>{activeDelivery.rider}</Text>
                            </View>
                        </Card.Content>

                        <Card.Content style={styles.deliveryActions}>
                            <Button
                                mode="contained"
                                onPress={() => navigation.navigate('TrackOrder', { bookingId: activeDelivery.id })}
                                icon="map"
                                style={{ width: '100%', borderRadius: 8, marginBottom: 12 }}
                                contentStyle={{ height: 56 }}
                                labelStyle={{ fontSize: 18, fontWeight: 'bold' }}
                            >
                                Track Order
                            </Button>
                            <View style={{ flexDirection: 'row', gap: 12 }}>
                                <Button
                                    mode="contained-tonal"
                                    onPress={() => navigation.navigate('OTP', { boxId: activeDelivery.id })}
                                    icon="lock-open"
                                    style={{ flex: 1, borderRadius: 8 }}
                                    contentStyle={{ height: 48 }}
                                    labelStyle={{ fontSize: 14, fontWeight: 'bold' }}
                                >
                                    Unlock
                                </Button>
                                <Button
                                    mode="outlined"
                                    onPress={handleShare}
                                    icon="share-variant"
                                    style={{ flex: 1, borderRadius: 8, borderColor: theme.colors.primary }}
                                    contentStyle={{ height: 48 }}
                                    labelStyle={{ fontSize: 14, fontWeight: 'bold' }}
                                >
                                    Share
                                </Button>
                            </View>
                        </Card.Content>
                    </Card>
                ) : (
                    <Card style={[styles.deliveryCard, { backgroundColor: theme.colors.surfaceVariant }]} mode="elevated">
                        <Card.Content style={{ alignItems: 'center', paddingVertical: 24 }}>
                            <MaterialCommunityIcons name="package-variant" size={48} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>No active delivery</Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Book a service to get started</Text>
                        </Card.Content>
                    </Card>
                )}

                {/* Main Action - Book Now */}
                <Card style={[styles.bookActionCard, { backgroundColor: theme.colors.surface }]} onPress={() => navigation.navigate('BookService')} mode="elevated">
                    <Card.Content style={styles.bookActionContent}>
                        <View style={styles.bookActionTextContainer}>
                            <Text variant="titleLarge" style={[styles.bookActionTitle, { color: theme.colors.onSurface }]}>Send a Package</Text>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Fast, secure delivery with Parcel-Safe</Text>
                        </View>
                        <Surface style={styles.bookActionIcon} elevation={4}>
                            <MaterialCommunityIcons name="moped" size={32} color={theme.colors.primary} />
                        </Surface>
                    </Card.Content>
                </Card>

                <View style={styles.actionsGrid}>
                    {/* Book button removed from here, promoted to Hero Card */}
                    <QuickAction icon="calculator" label="Rates" onPress={() => navigation.navigate('Rates')} color={theme.colors.primary} />
                    <QuickAction icon="history" label="History" onPress={() => navigation.navigate('DeliveryLog')} color={theme.colors.secondary} />
                    <QuickAction icon="file-document-outline" label="Report" onPress={() => navigation.navigate('Report')} color={theme.colors.tertiary} />
                </View>

                {/* Recent Activity */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Recent Activity</Text>
                {recentActivity.length > 0 ? (
                    recentActivity.map((activity) => {
                        const statusStyle = getStatusIcon(activity.status);
                        return (
                            <Card key={activity.id} style={[styles.activityCard, { backgroundColor: theme.colors.surface }]} mode="elevated">
                                <Card.Content style={styles.activityContent}>
                                    <View style={styles.activityRow}>
                                        <View style={[styles.iconContainer, { backgroundColor: statusStyle.bg }]}>
                                            <MaterialCommunityIcons name={statusStyle.icon as any} size={24} color={statusStyle.color} />
                                        </View>
                                        <View style={styles.activityInfo}>
                                            <Text variant="titleSmall" style={[styles.trackingId, { color: theme.colors.onSurface }]}>{activity.trackingId}</Text>
                                            <Text variant="bodySmall" style={[styles.serviceType, { color: theme.colors.onSurfaceVariant }]}>{activity.serviceType}</Text>
                                        </View>
                                        <View style={styles.activityStatus}>
                                            <Text variant="labelSmall" style={{ color: statusStyle.color, fontWeight: 'bold' }}>{activity.status}</Text>
                                            <Text variant="bodySmall" style={styles.dateTextCard}>{activity.date}</Text>
                                        </View>
                                    </View>
                                </Card.Content>
                            </Card>
                        );
                    })
                ) : (
                    <Card style={[styles.activityCard, { backgroundColor: theme.colors.surface }]} mode="elevated">
                        <Card.Content style={{ alignItems: 'center', paddingVertical: 20 }}>
                            <MaterialCommunityIcons name="history" size={36} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>No recent activity</Text>
                        </Card.Content>
                    </Card>
                )}

            </ScrollView>



            {/* Premium Share Warning Modal */}
            <Portal>
                <Modal visible={shareModalVisible} onDismiss={() => setShareModalVisible(false)} contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}>
                    <View style={styles.modalContent}>
                        <Surface style={[styles.warningIconSurface, { backgroundColor: theme.colors.errorContainer }]} elevation={2}>
                            <MaterialCommunityIcons name="shield-lock-outline" size={48} color={theme.colors.error} />
                        </Surface>

                        <Text variant="headlineSmall" style={[styles.modalTitle, { marginTop: 16, color: theme.colors.error }]}>
                            Security Warning
                        </Text>

                        <Text variant="bodyLarge" style={{ textAlign: 'center', marginBottom: 24, color: theme.colors.onSurface, lineHeight: 24 }}>
                            You are about to share a live tracking link.
                            {'\n\n'}
                            <Text style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>Only share this with the intended recipient.</Text>
                            {'\n'}
                            They may be able to <Text style={{ color: theme.colors.primary, fontWeight: 'bold' }}>unlock the box</Text> depending on your settings.
                        </Text>

                        <Button
                            mode="contained"
                            onPress={performShare}
                            style={{ width: '100%', marginBottom: 12, backgroundColor: theme.colors.primary }}
                            contentStyle={{ paddingVertical: 6 }}
                        >
                            I Understand, Share Link
                        </Button>

                        <Button
                            mode="outlined"
                            onPress={() => setShareModalVisible(false)}
                            style={{ width: '100%', borderColor: theme.colors.outline }}
                            textColor={theme.colors.onSurfaceVariant}
                        >
                            Cancel
                        </Button>
                    </View>
                </Modal>
            </Portal>

            {/* Proof of Delivery Modal */}
            <Portal>
                <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}>
                    <View style={styles.modalContent}>
                        <IconButton icon="close" size={24} onPress={() => setModalVisible(false)} style={styles.closeButton} />
                        <Text variant="titleMedium" style={[styles.modalTitle, { color: theme.colors.onSurface }]}>Delivery Proof</Text>
                        {/* Image removed from history, keeping modal structure if needed for active delivery later */}
                        <Text>No proof image available.</Text>
                    </View>
                </Modal>
            </Portal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    headerBackground: {
        height: 180,
        justifyContent: 'flex-end',
    },
    headerOverlay: {
        backgroundColor: 'rgba(0,0,0,0.1)', // Lighter overlay to show image better
        height: '100%',
        justifyContent: 'flex-end',
        paddingBottom: 20,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
    },
    headerContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end', // Align bottom to keep time and weather aligned
    },
    locationContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    locationText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    dateText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
        fontWeight: 'bold',
    },
    timeText: {
        color: 'white',
        fontSize: 32,
        fontWeight: 'bold',
    },
    weatherContainer: {
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
        padding: 8,
        borderRadius: 12,
    },
    weatherText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    weatherCondition: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 12,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 80,
    },
    greetingContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
        marginTop: 10,
    },
    greeting: {
        color: '#666',
    },
    userName: {
        fontWeight: 'bold',
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
        marginTop: 8,
    },
    deliveryCard: {
        marginBottom: 24,
        borderRadius: 16,
    },
    deliveryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    deliveryIdContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusBadge: {
        backgroundColor: '#E3F2FD',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: '#1976D2',
        fontSize: 12,
        fontWeight: 'bold',
    },
    deliveryContent: {
        padding: 16,
    },
    deliveryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    deliveryDetail: {
        marginLeft: 10,
        color: '#444',
    },
    deliveryActions: {
        padding: 16,
        paddingTop: 0,
    },
    actionsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    actionItem: {
        alignItems: 'center',
        width: '22%',
    },
    actionIcon: {
        width: 50,
        height: 50,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    actionLabel: {
        color: '#555',
    },


    modalContainer: {
        padding: 20,
        margin: 20,
        borderRadius: 16,
        alignItems: 'center',
    },
    modalContent: {
        width: '100%',
        alignItems: 'center',
    },
    closeButton: {
        position: 'absolute',
        right: -10,
        top: -10,
    },
    modalTitle: {
        fontWeight: 'bold',
        marginBottom: 16,
    },
    activityCard: {
        marginBottom: 12,
        borderRadius: 12,
    },
    activityContent: {
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    activityRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    activityInfo: {
        flex: 1,
    },
    trackingId: {
        fontWeight: 'bold',
        color: '#333',
    },
    serviceType: {
        color: '#777',
    },
    activityStatus: {
        alignItems: 'flex-end',
    },
    dateTextCard: {
        color: '#999',
        fontSize: 11,
        marginTop: 2,
    },
    bookActionCard: {
        marginBottom: 24,
        backgroundColor: '#009688', // Teal primary color (or use theme.colors.primary)
        borderRadius: 16,
        elevation: 4,
    },
    bookActionContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
    },
    bookActionTextContainer: {
        flex: 1,
    },
    bookActionTitle: {
        color: 'white',
        fontWeight: 'bold',
        marginBottom: 4,
    },
    bookActionIcon: {
        backgroundColor: 'white',
        borderRadius: 25,
        width: 50,
        height: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    warningIconSurface: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    // EC-32: Cancellation Banner
    cancellationBanner: {
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
    },
    cancellationBannerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    cancellationIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
