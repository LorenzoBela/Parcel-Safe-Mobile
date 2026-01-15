import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ImageBackground, Image, Alert, RefreshControl } from 'react-native';
import { Text, Card, Button, FAB, useTheme, Avatar, Surface, Portal, Modal, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import * as Location from 'expo-location';
import { CustomerHardwareBanner } from '../../../components';
import { subscribeToDisplay } from '../../../services/firebaseClient';

export default function CustomerDashboard() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null);
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');

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
        'Cloudy': 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80', // More distinct cloudy sky
        'Rainy': 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80', // Rain on glass
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
            type: 'Delivered',
            date: 'Yesterday',
            item: 'Electronics Package',
            status: 'Delivered',
            image: 'https://images.unsplash.com/photo-1566576912906-600aceeb7aef?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80'
        },
        {
            id: 2,
            type: 'Tampered',
            date: 'Oct 24',
            item: 'Documents',
            status: 'Tampered',
            image: 'https://images.unsplash.com/photo-1606168094336-42f9e9462f7f?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80'
        },
        {
            id: 3,
            type: 'Cancelled',
            date: 'Oct 20',
            item: 'Food Delivery',
            status: 'Cancelled',
            image: 'https://images.unsplash.com/photo-1595246140625-573b715d1128?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80'
        },
    ];

    const showImage = (image) => {
        setSelectedImage(image);
        setModalVisible(true);
    };

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

    return (
        <View style={styles.container}>
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
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >

                {/* Greeting Section */}
                <View style={styles.greetingContainer}>
                    <View>
                        <Text variant="headlineSmall" style={styles.greeting}>Good Morning,</Text>
                        <Text variant="headlineMedium" style={styles.userName}>Lorenzo Bela</Text>
                    </View>
                    <Avatar.Image size={50} source={{ uri: 'https://i.pravatar.cc/150?img=12' }} />
                </View>

                {/* EC-86: Display failure notification */}
                <CustomerHardwareBanner displayStatus={displayStatus} />

                {/* Active Delivery Card */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Active Delivery</Text>
                <Card style={styles.deliveryCard} mode="elevated">
                    <View style={styles.deliveryHeader}>
                        <View style={styles.deliveryIdContainer}>
                            <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.primary} />
                            <Text variant="titleSmall" style={{ marginLeft: 8, color: theme.colors.primary }}>{activeDelivery.id}</Text>
                        </View>
                        <View style={styles.statusBadge}>
                            <Text style={styles.statusText}>{activeDelivery.status}</Text>
                        </View>
                    </View>

                    <Card.Content style={styles.deliveryContent}>
                        <View style={styles.deliveryRow}>
                            <MaterialCommunityIcons name="clock-outline" size={20} color="#666" />
                            <Text variant="bodyMedium" style={styles.deliveryDetail}>Arriving in {activeDelivery.eta}</Text>
                        </View>
                        <View style={styles.deliveryRow}>
                            <MaterialCommunityIcons name="map-marker-outline" size={20} color="#666" />
                            <Text variant="bodyMedium" style={styles.deliveryDetail}>{activeDelivery.location}</Text>
                        </View>
                        <View style={styles.deliveryRow}>
                            <MaterialCommunityIcons name="motorbike" size={20} color="#666" />
                            <Text variant="bodyMedium" style={styles.deliveryDetail}>{activeDelivery.rider}</Text>
                        </View>
                    </Card.Content>

                    <Card.Actions style={styles.deliveryActions}>
                        <Button
                            mode="contained"
                            onPress={() => navigation.navigate('TrackOrder')}
                            icon="map"
                            style={{ flex: 1, marginRight: 8 }}
                        >
                            Track
                        </Button>
                        <Button
                            mode="contained-tonal"
                            onPress={() => navigation.navigate('OTP')}
                            icon="lock-open"
                            style={{ flex: 1 }}
                        >
                            Unlock
                        </Button>
                    </Card.Actions>
                </Card>

                {/* Quick Actions */}
                <View style={styles.actionsGrid}>
                    <QuickAction icon="qrcode-scan" label="Scan" onPress={() => console.log('Scan')} color="#4CAF50" />
                    <QuickAction icon="history" label="History" onPress={() => navigation.navigate('DeliveryLog')} color="#2196F3" />
                    <QuickAction icon="file-document-outline" label="Report" onPress={() => console.log('Report')} color="#FF9800" />
                    <QuickAction icon="share-variant" label="Share" onPress={() => console.log('Share')} color="#9C27B0" />
                </View>

                {/* Recent Activity */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Recent Activity</Text>
                {recentActivity.map((activity) => {
                    const statusStyle = getStatusIcon(activity.status);
                    return (
                        <TouchableOpacity key={activity.id} onPress={() => showImage(activity.image)}>
                            <Surface style={styles.activityItem} elevation={1}>
                                <View style={styles.activityLeft}>
                                    <View style={[styles.activityIcon, { backgroundColor: statusStyle.bg }]}>
                                        <MaterialCommunityIcons name={statusStyle.icon as any} size={20} color={statusStyle.color} />
                                    </View>
                                    <View style={{ marginLeft: 12 }}>
                                        <Text variant="titleSmall">{activity.item}</Text>
                                        <Text variant="bodySmall" style={{ color: statusStyle.color, fontWeight: 'bold' }}>{activity.status}</Text>
                                    </View>
                                </View>
                                <Text variant="bodySmall" style={{ color: '#999' }}>{activity.date}</Text>
                            </Surface>
                        </TouchableOpacity>
                    );
                })}

            </ScrollView>

            <FAB
                icon="plus"
                style={[styles.fab, { backgroundColor: theme.colors.primary }]}
                color="white"
                onPress={() => console.log('New Delivery Request')}
            />

            {/* Image Modal */}
            <Portal>
                <Modal visible={modalVisible} onDismiss={hideModal} contentContainerStyle={styles.modalContainer}>
                    <View style={styles.modalContent}>
                        <IconButton icon="close" size={24} onPress={hideModal} style={styles.closeButton} />
                        <Text variant="titleMedium" style={styles.modalTitle}>Delivery Proof</Text>
                        {selectedImage && (
                            <Image source={{ uri: selectedImage }} style={styles.proofImage} resizeMode="cover" />
                        )}
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
        backgroundColor: 'rgba(255,255,255,0.2)',
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
    activityItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 10,
    },
    activityLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    activityIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fab: {
        position: 'absolute',
        margin: 16,
        right: 0,
        bottom: 0,
        borderRadius: 16,
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
    proofImage: {
        width: '100%',
        height: 300,
        borderRadius: 12,
    },
});
