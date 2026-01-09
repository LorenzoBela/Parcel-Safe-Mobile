import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, ScrollView, Switch, ImageBackground, Alert, RefreshControl, TouchableOpacity, Dimensions } from 'react-native';
import { Text, Card, Button, Avatar, ProgressBar, MD3Colors, Surface, Chip, useTheme, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import LottieView from 'lottie-react-native';

export default function RiderDashboard() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [isOnline, setIsOnline] = useState(true);
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [riderLocation, setRiderLocation] = useState<Location.LocationObject | null>(null);
    const [distance, setDistance] = useState<string>('Calculating...');
    const [isLocked, setIsLocked] = useState(true);
    const [logs, setLogs] = useState<{ time: string; message: string; type: string }[]>([]);
    const mapRef = useRef<MapView>(null);
    const animationRef = useRef<LottieView>(null);

    const focusOnUser = () => {
        if (riderLocation && mapRef.current) {
            mapRef.current.animateToRegion({
                latitude: riderLocation.coords.latitude,
                longitude: riderLocation.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            }, 1000);
        }
    };

    // Fixed destination for demo (e.g., Rizal Park, Manila)
    const destination = {
        latitude: 14.5831,
        longitude: 120.9794,
        title: "Delivery Destination",
        description: "Rizal Park, Manila"
    };

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(dayjs());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Simulated System Logs
    useEffect(() => {
        const addLog = (message: string, type: string = 'info') => {
            setLogs(prev => [{ time: dayjs().format('HH:mm:ss'), message, type }, ...prev].slice(0, 50));
        };

        addLog("System initialized. Monitoring sensors...", "system");

        const logInterval = setInterval(() => {
            const events = [
                "Heartbeat signal received from Box",
                "GPS signal stable",
                "Battery voltage normal (12.4V)",
                "Temperature check: 28°C (Normal)",
                "Connection verified: 4G LTE"
            ];
            const randomEvent = events[Math.floor(Math.random() * events.length)];
            addLog(randomEvent, "system");
        }, 8000); // Add a log every 8 seconds

        return () => clearInterval(logInterval);
    }, []);

    useEffect(() => {
        if (animationRef.current) {
            if (isLocked) {
                animationRef.current.play(0, 60); // Play lock animation
            } else {
                animationRef.current.play(60, 120); // Play unlock animation (approx frames)
            }
        }
    }, [isLocked]);

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Radius of the earth in km
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d.toFixed(2);
    };

    const deg2rad = (deg) => {
        return deg * (Math.PI / 180);
    };

    const fetchLocation = useCallback(async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            setLocationName('Permission denied');
            Alert.alert('Permission to access location was denied');
            return;
        }

        try {
            let location = await Location.getCurrentPositionAsync({});
            setRiderLocation(location);

            // Calculate distance
            const dist = calculateDistance(
                location.coords.latitude,
                location.coords.longitude,
                destination.latitude,
                destination.longitude
            );
            setDistance(`${dist} km`);

            let address = await Location.reverseGeocodeAsync({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude
            });

            if (address && address.length > 0) {
                const { city, region, name } = address[0];
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

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchLocation();
        setRefreshing(false);
    }, [fetchLocation]);

    const toggleLock = () => {
        Alert.alert(
            isLocked ? "Unlock Box?" : "Lock Box?",
            isLocked ? "Are you sure you want to unlock the box?" : "Ensure the box is closed before locking.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: isLocked ? "Unlock" : "Lock", onPress: () => {
                        setIsLocked(!isLocked);
                        const action = !isLocked ? "LOCKED" : "UNLOCKED";
                        setLogs(prev => [{
                            time: dayjs().format('HH:mm:ss'),
                            message: `Manual Override: Box ${action}`,
                            type: action === 'LOCKED' ? 'success' : 'warning'
                        }, ...prev]);
                    }
                }
            ]
        );
    };

    // Mock data
    const weather = { temp: '28°C', condition: 'Cloudy', icon: 'weather-cloudy' };
    const weatherImages = {
        'Sunny': 'https://images.unsplash.com/photo-1622278612016-dd3a787f8003?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Cloudy': 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Rainy': 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Thunder': 'https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
    };

    const nextDelivery = {
        id: 'TRK-8821-9023',
        address: '123 Rizal Park, Manila',
        customer: 'Lorenzo Bela',
        time: '15 mins',
    };

    const boxStatus = {
        battery: 0.85,
        connection: 'Connected',
        signal: 'Strong',
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
            {/* Attractive Header */}
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

                {/* Status Toggle */}
                <View style={styles.statusToggleContainer}>
                    <View style={styles.statusContainer}>
                        <View style={[styles.statusDot, { backgroundColor: isOnline ? '#4CAF50' : '#9E9E9E' }]} />
                        <Text variant="titleMedium" style={styles.statusText}>
                            {isOnline ? 'You are Online' : 'You are Offline'}
                        </Text>
                    </View>
                    <Switch value={isOnline} onValueChange={setIsOnline} trackColor={{ true: "#4CAF50", false: "#767577" }} />
                </View>

                {/* Quick Actions */}
                <View style={styles.actionsGrid}>
                    <QuickAction icon="qrcode-scan" label="Scan" onPress={() => console.log('Scan')} color="#4CAF50" />
                    <QuickAction icon="history" label="History" onPress={() => navigation.navigate('DeliveryRecords')} color="#2196F3" />
                    <QuickAction icon="face-agent" label="Support" onPress={() => console.log('Support')} color="#9C27B0" />
                    <QuickAction icon="cog" label="Settings" onPress={() => console.log('Settings')} color="#607D8B" />
                </View>

                {/* Next Delivery Card */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Current Job</Text>
                <Card style={styles.jobCard} mode="elevated">
                    <View style={styles.mapContainer}>
                        {riderLocation ? (
                            <>
                                <MapView
                                    ref={mapRef}
                                    style={styles.map}
                                    initialRegion={{
                                        latitude: riderLocation.coords.latitude,
                                        longitude: riderLocation.coords.longitude,
                                        latitudeDelta: 0.05,
                                        longitudeDelta: 0.05,
                                    }}
                                >
                                    <Marker
                                        coordinate={{
                                            latitude: riderLocation.coords.latitude,
                                            longitude: riderLocation.coords.longitude,
                                        }}
                                        title="You"
                                        pinColor="blue"
                                    />
                                    <Marker
                                        coordinate={destination}
                                        title={destination.title}
                                        description={destination.description}
                                    />
                                </MapView>
                                <IconButton
                                    icon="crosshairs-gps"
                                    mode="contained"
                                    containerColor="white"
                                    iconColor={theme.colors.primary}
                                    size={20}
                                    style={styles.myLocationButton}
                                    onPress={focusOnUser}
                                />
                            </>
                        ) : (
                            <View style={styles.mapPlaceholder}>
                                <Text>Loading Map...</Text>
                            </View>
                        )}
                    </View>

                    <Card.Content style={styles.jobContent}>
                        <View style={styles.jobHeader}>
                            <View>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{nextDelivery.customer}</Text>
                                <Text variant="bodySmall" style={{ color: '#666' }}>{nextDelivery.id}</Text>
                            </View>
                            <Chip icon="map-marker-distance" compact style={{ backgroundColor: '#E3F2FD' }}>{distance}</Chip>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.addressContainer}>
                            <MaterialCommunityIcons name="map-marker" size={20} color={theme.colors.primary} style={{ marginTop: 2 }} />
                            <Text variant="bodyMedium" style={styles.address}>{nextDelivery.address}</Text>
                        </View>

                        <View style={styles.jobMeta}>
                            <View style={styles.metaItem}>
                                <MaterialCommunityIcons name="clock-outline" size={16} color="#666" />
                                <Text style={styles.metaText}>ETA: {nextDelivery.time}</Text>
                            </View>
                        </View>
                    </Card.Content>

                    <Card.Actions style={styles.jobActions}>
                        <Button
                            mode="outlined"
                            style={{ flex: 1, marginRight: 8 }}
                            onPress={() => navigation.navigate('AssignedDeliveries')}
                            textColor={theme.colors.primary}
                        >
                            Details
                        </Button>
                        <Button
                            mode="contained"
                            style={{ flex: 1 }}
                            onPress={() => navigation.navigate('Arrival')}
                            buttonColor={theme.colors.primary}
                        >
                            Start Trip
                        </Button>
                    </Card.Actions>
                </Card>

                {/* Smart Box Status */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Box Status</Text>
                <Surface style={styles.statusCard} elevation={2}>

                    {/* Enhanced Unlock Button with Lottie */}
                    <View style={styles.unlockContainer}>
                        <View style={styles.unlockInfo}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Lock Mechanism</Text>
                            <Text variant="bodyMedium" style={{ color: isLocked ? '#4CAF50' : '#F44336' }}>
                                {isLocked ? 'Securely Locked' : 'Unlocked'}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={[styles.unlockButton, { backgroundColor: isLocked ? '#E8F5E9' : '#FFEBEE', borderWidth: 1, borderColor: isLocked ? '#4CAF50' : '#F44336' }]}
                            onPress={toggleLock}
                        >
                            <MaterialCommunityIcons
                                name={isLocked ? "shield-lock" : "shield-lock-open"}
                                size={40}
                                color={isLocked ? "#4CAF50" : "#F44336"}
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: '#E3F2FD' }]}>
                            <MaterialCommunityIcons name="battery-70" size={24} color="#2196F3" />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall">Battery Level</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <ProgressBar progress={boxStatus.battery} color="#2196F3" style={styles.progressBar} />
                                <Text variant="labelSmall" style={{ marginLeft: 8, fontWeight: 'bold' }}>85%</Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: '#F3E5F5' }]}>
                            <MaterialCommunityIcons name="bluetooth" size={24} color="#9C27B0" />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall">Connection</Text>
                            <Text variant="bodySmall" style={{ color: '#666' }}>{boxStatus.connection} • {boxStatus.signal}</Text>
                        </View>
                    </View>

                    <Button mode="outlined" style={{ marginTop: 16 }} onPress={() => navigation.navigate('BoxControls')}>
                        Advanced Controls
                    </Button>
                </Surface>

                {/* Real-Time Logs */}
                <Text variant="titleMedium" style={styles.sectionTitle}>System Logs</Text>
                <Surface style={styles.logsCard} elevation={1}>
                    {logs.length === 0 ? (
                        <Text style={{ color: '#999', textAlign: 'center', padding: 20 }}>No logs available</Text>
                    ) : (
                        logs.slice(0, 5).map((log, index) => (
                            <View key={index} style={styles.logItem}>
                                <Text style={styles.logTime}>{log.time}</Text>
                                <Text numberOfLines={1} style={[styles.logMessage, { color: log.type === 'warning' ? '#D32F2F' : log.type === 'success' ? '#388E3C' : '#444' }]}>
                                    {log.message}
                                </Text>
                            </View>
                        ))
                    )}
                </Surface>

            </ScrollView >
        </View >
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
        backgroundColor: 'rgba(0,0,0,0.1)',
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
        alignItems: 'flex-end',
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
    statusToggleContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
        marginTop: 10,
        backgroundColor: 'white',
        padding: 16,
        borderRadius: 16,
        elevation: 1,
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 10,
    },
    statusText: {
        fontWeight: 'bold',
        color: '#444',
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#333',
    },
    jobCard: {
        marginBottom: 24,
        backgroundColor: 'white',
        overflow: 'hidden',
        borderRadius: 16,
    },
    mapContainer: {
        height: 150,
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    map: {
        width: '100%',
        height: '100%',
    },
    mapPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    myLocationButton: {
        position: 'absolute',
        bottom: 10,
        right: 10,
        margin: 0,
    },
    jobContent: {
        padding: 16,
    },
    jobHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    addressContainer: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    address: {
        color: '#444',
        marginLeft: 8,
        flex: 1,
    },
    jobMeta: {
        flexDirection: 'row',
        marginTop: 4,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    metaText: {
        marginLeft: 4,
        color: '#666',
        fontSize: 12,
        fontWeight: 'bold',
    },
    jobActions: {
        padding: 16,
        paddingTop: 0,
    },
    statusCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    statusIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    statusInfo: {
        flex: 1,
    },
    progressBar: {
        height: 6,
        borderRadius: 3,
        flex: 1,
    },
    divider: {
        height: 1,
        backgroundColor: '#F0F0F0',
        marginVertical: 8,
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
    unlockContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    unlockInfo: {
        flex: 1,
    },
    unlockButton: {
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 1,
    },
    logsCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 16,
        maxHeight: 200,
        overflow: 'hidden', // Ensure content doesn't bleed out
    },
    logItem: {
        flexDirection: 'row',
        marginBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F5F5F5',
        paddingBottom: 4,
    },
    logTime: {
        fontSize: 12,
        color: '#999',
        width: 60,
        fontFamily: 'monospace',
    },
    logMessage: {
        fontSize: 12,
        flex: 1,
    },
});
