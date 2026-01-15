/**
 * TrackMyBoxScreen.tsx - EC-81: Top Box Stolen
 * 
 * Live map tracking for stolen box with location history.
 * Features:
 * - Real-time box location on map
 * - Location history trail
 * - Speed and heading display
 * - Last update timestamp
 * 
 * Firebase Path: /boxes/{mac_address}/theft_status
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { Text, Surface, Chip, useTheme, ActivityIndicator, IconButton } from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, AnimatedRegion } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
    subscribeToBoxLocation,
    getLocationHistory,
    TheftStatus,
    LocationHistoryEntry,
} from '../../services/theftService';

dayjs.extend(relativeTime);

const { width, height } = Dimensions.get('window');

export default function TrackMyBoxScreen() {
    const route = useRoute<any>();
    const theme = useTheme();
    const mapRef = useRef<MapView>(null);

    const boxId = route.params?.boxId || 'BOX_001';

    // State
    const [currentLocation, setCurrentLocation] = useState<{
        lat: number;
        lng: number;
        heading: number;
        speed: number;
    } | null>(null);
    const [locationHistory, setLocationHistory] = useState<LocationHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [showHistory, setShowHistory] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    // Subscribe to live location
    useEffect(() => {
        const unsubscribe = subscribeToBoxLocation(boxId, (location) => {
            if (location) {
                setCurrentLocation({
                    lat: location.lat,
                    lng: location.lng,
                    heading: location.heading || 0,
                    speed: location.speed || 0,
                });
                setLastUpdate(new Date());
                setLoading(false);

                // Animate map to new location
                if (mapRef.current) {
                    mapRef.current.animateToRegion({
                        latitude: location.lat,
                        longitude: location.lng,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                    }, 500);
                }
            }
        });

        return () => unsubscribe();
    }, [boxId]);

    // Fetch location history
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const history = await getLocationHistory(boxId, 24);
                setLocationHistory(history);
            } catch (error) {
                console.error('Failed to fetch location history:', error);
            }
        };

        fetchHistory();
        // Refresh history every 5 minutes
        const interval = setInterval(fetchHistory, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [boxId]);

    // Center map on current location
    const centerOnBox = () => {
        if (currentLocation && mapRef.current) {
            mapRef.current.animateToRegion({
                latitude: currentLocation.lat,
                longitude: currentLocation.lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            }, 500);
        }
    };

    // Format speed
    const formatSpeed = (mps: number) => {
        const kph = mps * 3.6;
        return `${kph.toFixed(1)} km/h`;
    };

    // Create polyline coordinates from history
    const historyCoordinates = locationHistory.map(entry => ({
        latitude: entry.lat,
        longitude: entry.lng,
    }));

    if (loading && !currentLocation) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={{ marginTop: 16, color: '#666' }}>Locating box...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Map */}
            <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={currentLocation ? {
                    latitude: currentLocation.lat,
                    longitude: currentLocation.lng,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                } : {
                    latitude: 14.5995,
                    longitude: 120.9842,
                    latitudeDelta: 0.1,
                    longitudeDelta: 0.1,
                }}
            >
                {/* Location History Trail */}
                {showHistory && historyCoordinates.length > 1 && (
                    <Polyline
                        coordinates={historyCoordinates}
                        strokeColor="#2196F3"
                        strokeWidth={3}
                        lineDashPattern={[5, 5]}
                    />
                )}

                {/* History Points */}
                {showHistory && locationHistory.map((entry, index) => (
                    <Marker
                        key={`history-${index}`}
                        coordinate={{ latitude: entry.lat, longitude: entry.lng }}
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        <View style={styles.historyDot} />
                    </Marker>
                ))}

                {/* Current Location Marker */}
                {currentLocation && (
                    <Marker
                        coordinate={{
                            latitude: currentLocation.lat,
                            longitude: currentLocation.lng,
                        }}
                        anchor={{ x: 0.5, y: 0.5 }}
                        rotation={currentLocation.heading}
                    >
                        <View style={styles.boxMarker}>
                            <MaterialCommunityIcons
                                name="cube"
                                size={24}
                                color="white"
                            />
                        </View>
                    </Marker>
                )}
            </MapView>

            {/* Status Card */}
            <Surface style={styles.statusCard} elevation={4}>
                <View style={styles.statusHeader}>
                    <View style={styles.pulsingDot} />
                    <Text style={styles.liveText}>LIVE TRACKING</Text>
                    <Chip
                        compact
                        icon="map-marker"
                        style={{ backgroundColor: '#E3F2FD' }}
                    >
                        {locationHistory.length} points
                    </Chip>
                </View>

                <View style={styles.statusGrid}>
                    {/* Speed */}
                    <View style={styles.statusItem}>
                        <MaterialCommunityIcons name="speedometer" size={20} color="#666" />
                        <Text style={styles.statusValue}>
                            {currentLocation ? formatSpeed(currentLocation.speed) : '--'}
                        </Text>
                        <Text style={styles.statusLabel}>Speed</Text>
                    </View>

                    {/* Heading */}
                    <View style={styles.statusItem}>
                        <MaterialCommunityIcons name="compass" size={20} color="#666" />
                        <Text style={styles.statusValue}>
                            {currentLocation ? `${Math.round(currentLocation.heading)}°` : '--'}
                        </Text>
                        <Text style={styles.statusLabel}>Heading</Text>
                    </View>

                    {/* Last Update */}
                    <View style={styles.statusItem}>
                        <MaterialCommunityIcons name="clock-outline" size={20} color="#666" />
                        <Text style={styles.statusValue}>
                            {lastUpdate ? dayjs(lastUpdate).fromNow() : '--'}
                        </Text>
                        <Text style={styles.statusLabel}>Updated</Text>
                    </View>
                </View>

                {/* Coordinates */}
                {currentLocation && (
                    <View style={styles.coordsRow}>
                        <MaterialCommunityIcons name="crosshairs-gps" size={16} color="#999" />
                        <Text style={styles.coordsText}>
                            {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
                        </Text>
                    </View>
                )}
            </Surface>

            {/* Map Controls */}
            <View style={styles.mapControls}>
                <TouchableOpacity
                    style={styles.controlButton}
                    onPress={() => setShowHistory(!showHistory)}
                >
                    <MaterialCommunityIcons
                        name={showHistory ? 'map-marker-path' : 'map-marker'}
                        size={24}
                        color={showHistory ? theme.colors.primary : '#666'}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.controlButton}
                    onPress={centerOnBox}
                >
                    <MaterialCommunityIcons
                        name="crosshairs-gps"
                        size={24}
                        color={theme.colors.primary}
                    />
                </TouchableOpacity>
            </View>

            {/* Stolen Badge */}
            <Surface style={styles.stolenBadge} elevation={4}>
                <MaterialCommunityIcons name="alert-circle" size={20} color="white" />
                <Text style={styles.stolenText}>STOLEN BOX</Text>
            </Surface>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F7F9FC',
    },
    map: {
        width: width,
        height: height,
    },
    statusCard: {
        position: 'absolute',
        bottom: 30,
        left: 16,
        right: 16,
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 16,
    },
    statusHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    pulsingDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#4CAF50',
        marginRight: 8,
    },
    liveText: {
        flex: 1,
        fontWeight: 'bold',
        color: '#4CAF50',
        fontSize: 12,
        letterSpacing: 1,
    },
    statusGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    statusItem: {
        alignItems: 'center',
    },
    statusValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
        marginTop: 4,
    },
    statusLabel: {
        fontSize: 11,
        color: '#999',
        marginTop: 2,
    },
    coordsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#eee',
    },
    coordsText: {
        marginLeft: 6,
        fontSize: 12,
        color: '#999',
        fontFamily: 'monospace',
    },
    mapControls: {
        position: 'absolute',
        top: 100,
        right: 16,
    },
    controlButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    boxMarker: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#D32F2F',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    historyDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#2196F3',
        borderWidth: 1,
        borderColor: 'white',
    },
    stolenBadge: {
        position: 'absolute',
        top: 50,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#D32F2F',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    stolenText: {
        color: 'white',
        fontWeight: 'bold',
        marginLeft: 8,
        fontSize: 12,
        letterSpacing: 1,
    },
});
