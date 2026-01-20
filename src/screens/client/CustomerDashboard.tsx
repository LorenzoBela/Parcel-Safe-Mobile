import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ImageBackground, Image, Alert, RefreshControl, Share } from 'react-native';
import { Text, Card, Button, useTheme, Avatar, Surface, Portal, Modal, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useAppTheme } from '../../context/ThemeContext'; // Import custom hook if needed, or just useTheme from paper
import * as Location from 'expo-location';
import { CustomerHardwareBanner } from '../../components';
import { subscribeToDisplay } from '../../services/firebaseClient';

export default function CustomerDashboard() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [modalVisible, setModalVisible] = useState(false); // For Proof of Delivery
    const [shareModalVisible, setShareModalVisible] = useState(false); // For Share Warning
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');

    const handleShare = () => {
        setShareModalVisible(true);
    };

    const performShare = async () => {
        setShareModalVisible(false);
        try {
            const result = await Share.share({
                message: 'Track your Parcel-Safe delivery here: https://parcel-safe.web.app/track/TEMP-123',
                url: 'https://parcel-safe.web.app/track/TEMP-123', // iOS uses this
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
            let address = await Location.reverseGeocodeAsync({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude
            });

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

    useEffect(() => {
        // EC-86: Monitor display health
        const unsubscribe = subscribeToDisplay('BOX_001', (displayState) => {
            if (displayState) {
                setDisplayStatus(displayState.status);
            }
        });
        return () => unsubscribe();
    }, []);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchLocation();
        setRefreshing(false);
    }, [fetchLocation]);

    // Mock data
    const weather = { temp: '28°C', condition: 'Cloudy', icon: 'weather-cloudy' };

    const weatherImages = {
        'Sunny': 'https://images.unsplash.com/photo-1622278612016-dd3a787f8003?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Cloudy': 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Rainy': 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Thunder': 'https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
    };

    const activeDelivery = {
        id: 'TRK-8821-9023',
        status: 'In Transit',
        eta: '15 mins',
        rider: 'Kean Guzon',
        location: 'Near Manila City Hall',
    };

    const recentActivity = [
        {
            id: 1,
            trackingId: 'TRK-9921-8821',
            type: 'Delivered',
            date: 'Yesterday, 2:30 PM',
            serviceType: 'Standard Delivery',
            status: 'Delivered',
        },
        {
            id: 2,
            trackingId: 'TRK-1120-3342',
            type: 'Tampered',
            date: 'Oct 24, 10:15 AM',
            serviceType: 'Express Delivery',
            status: 'Tampered',
        },
        {
            id: 3,
            trackingId: 'TRK-7782-1102',
            type: 'Cancelled',
            date: 'Oct 20, 9:00 AM',
            serviceType: 'Standard Delivery',
            status: 'Cancelled',
        },
    ];



    const hideModal = () => setModalVisible(false);

    const getStatusIcon = (status) => {
        switch (status) {
            case 'Delivered': return { icon: 'check', color: '#4CAF50', bg: '#E8F5E9' };
            case 'Tampered': return { icon: 'alert-circle', color: '#D32F2F', bg: '#FFEBEE' };
            case 'Cancelled': return { icon: 'close', color: '#9E9E9E', bg: '#F5F5F5' };
            default: return { icon: 'information', color: '#2196F3', bg: '#E3F2FD' };
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

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Attractive Header with Weather Background */}
            <ImageBackground
                source={{ uri: weatherImages[weather.condition] || weatherImages['Sunny'] }}
                style={styles.headerBackground}
                imageStyle={{ borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}
                resizeMode="cover"
            >
                <View style={styles.headerOverlay}>
                    <View style={styles.headerContent}>
                        <View>
                            <View style={styles.locationContainer}>
                                <MaterialCommunityIcons name="map-marker" size={16} color="rgba(255,255,255,0.9)" />
                                <Text style={styles.locationText}>{locationName}</Text>
                            </View>
                            <Text style={styles.dateText}>{currentTime.format('dddd, MMMM D')}</Text>
                            <Text style={styles.timeText}>{currentTime.format('h:mm A')}</Text>
                        </View>
                        <View style={styles.weatherContainer}>
                            <MaterialCommunityIcons name={weather.icon as any} size={30} color="white" />
                            <Text style={styles.weatherText}>{weather.temp}</Text>
                            <Text style={styles.weatherCondition}>{weather.condition}</Text>
                        </View>
                    </View>
                </View>
            </ImageBackground>

            <ScrollView
                style={{ backgroundColor: theme.colors.background }}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >

                {/* Greeting Section */}
                <View style={styles.greetingContainer}>
                    <View>
                        <Text variant="headlineSmall" style={[styles.greeting, { color: theme.colors.onSurfaceVariant }]}>{getGreeting()}</Text>
                        <Text variant="headlineMedium" style={[styles.userName, { color: theme.colors.onSurface }]}>Lorenzo Bela</Text>
                    </View>
                    <Avatar.Image size={50} source={{ uri: 'https://i.pravatar.cc/150?img=12' }} />
                </View>

                {/* EC-86: Display failure notification */}
                <CustomerHardwareBanner displayStatus={displayStatus} />

                {/* Active Delivery Card */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Active Delivery</Text>
                <Card style={[styles.deliveryCard, { backgroundColor: theme.colors.primaryContainer }]} mode="elevated">
                    <View style={styles.deliveryHeader}>
                        <View style={styles.deliveryIdContainer}>
                            <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.onPrimaryContainer} />
                            <Text variant="titleSmall" style={{ marginLeft: 8, color: theme.colors.onPrimaryContainer }}>{activeDelivery.id}</Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: theme.colors.primary }]}>
                            <Text style={[styles.statusText, { color: theme.colors.onPrimary }]}>{activeDelivery.status}</Text>
                        </View>
                    </View>

                    <Card.Content style={styles.deliveryContent}>
                        <View style={styles.deliveryRow}>
                            <MaterialCommunityIcons name="clock-outline" size={20} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyMedium" style={[styles.deliveryDetail, { color: theme.colors.onSurface }]}>Arriving in {activeDelivery.eta}</Text>
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

                    <Card.Actions style={styles.deliveryActions}>
                        <Button
                            mode="contained"
                            onPress={() => navigation.navigate('TrackOrder')}
                            icon="map"
                            style={{ flex: 1, marginRight: 4 }}
                            contentStyle={{ paddingHorizontal: 0 }}
                            labelStyle={{ fontSize: 13 }}
                        >
                            Track
                        </Button>
                        <Button
                            mode="contained-tonal"
                            onPress={() => navigation.navigate('OTP', { boxId: 'BOX_001' })}
                            icon="lock-open"
                            style={{ flex: 1, marginRight: 4 }}
                            contentStyle={{ paddingHorizontal: 0 }}
                            labelStyle={{ fontSize: 13 }}
                        >
                            Unlock
                        </Button>
                        <Button
                            mode="outlined"
                            onPress={handleShare}
                            icon="share-variant"
                            style={{ flex: 1, borderColor: theme.colors.primary }}
                            contentStyle={{ paddingHorizontal: 0 }}
                            labelStyle={{ fontSize: 13 }}
                        >
                            Share
                        </Button>
                    </Card.Actions>
                </Card>

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
                    <QuickAction icon="calculator" label="Rates" onPress={() => navigation.navigate('Rates')} color="#4CAF50" />
                    <QuickAction icon="history" label="History" onPress={() => navigation.navigate('DeliveryLog')} color="#2196F3" />
                    <QuickAction icon="file-document-outline" label="Report" onPress={() => navigation.navigate('Report')} color="#FF9800" />
                </View>

                {/* Recent Activity */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Recent Activity</Text>
                {recentActivity.map((activity) => {
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
                })}

            </ScrollView>



            {/* Premium Share Warning Modal */}
            <Portal>
                <Modal visible={shareModalVisible} onDismiss={() => setShareModalVisible(false)} contentContainerStyle={styles.modalContainer}>
                    <View style={styles.modalContent}>
                        <Surface style={[styles.warningIconSurface, { backgroundColor: '#FFF3E0' }]} elevation={2}>
                            <MaterialCommunityIcons name="shield-lock-outline" size={48} color="#F57C00" />
                        </Surface>

                        <Text variant="headlineSmall" style={[styles.modalTitle, { marginTop: 16, color: '#F57C00' }]}>
                            Security Warning
                        </Text>

                        <Text variant="bodyLarge" style={{ textAlign: 'center', marginBottom: 24, color: '#555', lineHeight: 24 }}>
                            You are about to share a live tracking link.
                            {'\n\n'}
                            <Text style={{ fontWeight: 'bold', color: '#333' }}>Only share this with the intended recipient.</Text>
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
                            style={{ width: '100%', borderColor: '#ddd' }}
                            textColor="#777"
                        >
                            Cancel
                        </Button>
                    </View>
                </Modal>
            </Portal>

            {/* Proof of Delivery Modal */}
            <Portal>
                <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={styles.modalContainer}>
                    <View style={styles.modalContent}>
                        <IconButton icon="close" size={24} onPress={() => setModalVisible(false)} style={styles.closeButton} />
                        <Text variant="titleMedium" style={styles.modalTitle}>Delivery Proof</Text>
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
        backgroundColor: 'white',
        borderRadius: 16,
    },
    deliveryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
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
        backgroundColor: 'white',
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
        backgroundColor: 'white',
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
});
