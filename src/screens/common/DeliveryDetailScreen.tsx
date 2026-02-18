import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Image, Dimensions } from 'react-native';
import { Text, Card, Button, useTheme, Chip, Surface, IconButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import { supabase } from '../../services/supabaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export default function DeliveryDetailScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const { delivery } = route.params;
    console.log('[DeliveryDetail] Received delivery params:', JSON.stringify(delivery, null, 2));
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [routeGeometry, setRouteGeometry] = useState<any>(null);
    const [deliveryData, setDeliveryData] = useState<any>(delivery);
    const [loading, setLoading] = useState(false);

    // Map UX State
    const cameraRef = React.useRef<any>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const [scrollEnabled, setScrollEnabled] = useState(true);

    // Fetch fresh details if coordinates are missing
    useEffect(() => {
        const fetchDeliveryDetails = async () => {
            // Check if we have minimal data needed
            if (delivery) {
                // Ensure coordinates are numbers
                const pLat = parseFloat(delivery.pickup_lat);
                const pLng = parseFloat(delivery.pickup_lng);
                const dLat = parseFloat(delivery.dropoff_lat);
                const dLng = parseFloat(delivery.dropoff_lng);

                setDeliveryData({
                    ...delivery,
                    pickup_lat: !isNaN(pLat) ? pLat : delivery.pickup_lat,
                    pickup_lng: !isNaN(pLng) ? pLng : delivery.pickup_lng,
                    dropoff_lat: !isNaN(dLat) ? dLat : delivery.dropoff_lat,
                    dropoff_lng: !isNaN(dLng) ? dLng : delivery.dropoff_lng,
                    // Fix Timezone: Force Asia/Manila
                    date: delivery.created_at ? dayjs.utc(delivery.created_at).tz('Asia/Manila').format('MMM D, YYYY') : delivery.date,
                    time: delivery.created_at ? dayjs.utc(delivery.created_at).tz('Asia/Manila').format('h:mm A') : delivery.time,
                });
            }

            if (delivery.pickup_lat && delivery.pickup_lng && delivery.dropoff_lat && delivery.dropoff_lng) {
                // If we have all coordinates, we can stop here for initial data.
                // Further processing (like route fetching) will use deliveryData state.
                return;
            }

            console.log('[DeliveryDetail] Missing coordinates, fetching from Supabase for ID:', delivery.id);
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from('deliveries')
                    .select('*, profiles:customer_id(full_name)')
                    .eq('id', delivery.id)
                    .single();

                if (error) throw error;

                if (data) {
                    console.log('[DeliveryDetail] Fetched fresh data:', data);
                    setDeliveryData({
                        ...delivery, // Keep passed params
                        ...data, // Override with fresh db data
                        customer: data.profiles?.full_name || 'Unknown',
                        pickupAddress: data.pickup_address,
                        dropoffAddress: data.dropoff_address,
                        // Ensure coords are explicitly set if different prop names
                        pickupLat: data.pickup_lat,
                        pickupLng: data.pickup_lng,
                        dropoffLat: data.dropoff_lat,
                        dropoffLng: data.dropoff_lng,
                    });
                }
            } catch (err) {
                console.error('[DeliveryDetail] Failed to fetch details:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchDeliveryDetails();
    }, [delivery]);

    // Get pickup and dropoff coordinates from delivery object (or fetched data)
    // Support both new format (pickup_lat/lng, dropoff_lat/lng) and old format (lat/lng)
    const pickupLat = deliveryData.pickup_lat || deliveryData.pickupLat || 14.5831;
    const pickupLng = deliveryData.pickup_lng || deliveryData.pickupLng || 120.9794;
    const dropoffLat = deliveryData.dropoff_lat || deliveryData.dropoffLat || deliveryData.lat || 14.5995;
    const dropoffLng = deliveryData.dropoff_lng || deliveryData.dropoffLng || deliveryData.lng || 120.9842;

    // Mock coordinates for the map (Manila area)
    const deliveryLocation = {
        latitude: dropoffLat,
        longitude: dropoffLng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Delivered': return '#4CAF50';
            case 'In Transit': return '#2196F3';
            case 'Cancelled': return '#9E9E9E';
            case 'Tampered': return '#D32F2F';
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

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    // Fetch actual route from Mapbox Directions API
    useEffect(() => {
        const fetchRoute = async () => {
            if (!MAPBOX_TOKEN) return;

            try {
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;

                const response = await fetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    setRouteGeometry(route.geometry);

                    // Extract distance if missing (convert meters to km)
                    if ((!deliveryData.distance || deliveryData.distance === 'N/A') && !deliveryData.distance_text && route.distance) {
                        const distKm = (route.distance / 1000).toFixed(1) + ' km';
                        console.log('[DeliveryDetail] Calculated distance from route:', distKm);
                        setDeliveryData(prev => ({ ...prev, distance: distKm }));
                    }
                }
            } catch (error) {
                console.error('Route calculation error:', error);
            }
        };

        fetchRoute();
    }, [MAPBOX_TOKEN, pickupLat, pickupLng, dropoffLat, dropoffLng]);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <IconButton icon="arrow-left" onPress={() => navigation.goBack()} />
                <Text variant="titleLarge" style={styles.headerTitle}>Delivery Details</Text>
                <View style={{ width: 48 }} />
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                scrollEnabled={scrollEnabled}
            >
                {/* Map Section */}
                <View
                    style={styles.mapContainer}
                    onTouchStart={() => setScrollEnabled(false)}
                    onTouchEnd={() => setScrollEnabled(true)}
                >
                    {MAPBOX_TOKEN ? (
                        <View style={{ flex: 1 }}>
                            <MapboxGL.MapView
                                style={styles.map}
                                logoEnabled={false}
                                attributionEnabled={false}
                                scrollEnabled={true}
                                pitchEnabled={true}
                                rotateEnabled={true}
                                scaleEnabled={true}
                            >
                                <MapboxGL.Camera
                                    ref={cameraRef}
                                    zoomLevel={13}
                                    centerCoordinate={[(pickupLng + dropoffLng) / 2, (pickupLat + dropoffLat) / 2]}
                                    animationMode={'flyTo'}
                                    animationDuration={2000}
                                />

                                {/* Actual Street-by-Street Route from Mapbox Directions API */}
                                {routeGeometry && (
                                    <MapboxGL.ShapeSource
                                        id="delivery-route"
                                        shape={{
                                            type: 'Feature',
                                            geometry: routeGeometry,
                                            properties: {},
                                        }}
                                    >
                                        <MapboxGL.LineLayer
                                            id="delivery-route-line"
                                            style={{
                                                lineColor: theme.colors.primary,
                                                lineWidth: 4,
                                                lineOpacity: 0.8,
                                            }}
                                        />
                                    </MapboxGL.ShapeSource>
                                )}

                                {/* Dropoff Location (Destination) */}
                                {deliveryData.dropoff_lat && deliveryData.dropoff_lng && (
                                    <MapboxGL.PointAnnotation
                                        id="delivery-location"
                                        coordinate={[Number(deliveryData.dropoff_lng), Number(deliveryData.dropoff_lat)]}
                                        title="Delivery Location"
                                    >
                                        <View style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: 12,
                                            backgroundColor: '#4CAF50',
                                            borderWidth: 2,
                                            borderColor: 'white',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <MaterialCommunityIcons name="flag-checkered" size={14} color="white" />
                                        </View>
                                    </MapboxGL.PointAnnotation>
                                )}

                                {/* Pickup Location (Start Point) */}
                                {deliveryData.pickup_lat && deliveryData.pickup_lng && (
                                    <MapboxGL.PointAnnotation
                                        id="delivery-start"
                                        coordinate={[Number(deliveryData.pickup_lng), Number(deliveryData.pickup_lat)]}
                                        title="Pickup Location"
                                    >
                                        <View style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: 12,
                                            backgroundColor: '#2196F3',
                                            borderWidth: 2,
                                            borderColor: 'white',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <MaterialCommunityIcons name="package-variant" size={14} color="white" />
                                        </View>
                                    </MapboxGL.PointAnnotation>
                                )}

                            </MapboxGL.MapView>

                            {/* Recenter Button */}
                            <Surface style={styles.recenterButton} elevation={4}>
                                <IconButton
                                    icon="crosshairs-gps"
                                    size={24}
                                    onPress={() => {
                                        if (cameraRef.current) {
                                            cameraRef.current.setCamera({
                                                centerCoordinate: [(pickupLng + dropoffLng) / 2, (pickupLat + dropoffLat) / 2],
                                                zoomLevel: 14,
                                                animationDuration: 1000,
                                            });
                                        }
                                    }}
                                />
                            </Surface>
                        </View>
                    ) : (
                        <View style={[styles.map, styles.mapFallback]}>
                            <Text style={{ color: theme.colors.onSurfaceVariant }}>
                                Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env
                            </Text>
                        </View>
                    )}
                </View>

                {/* Status Card */}
                <Surface style={styles.statusCard} elevation={2}>
                    <View style={styles.statusHeader}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Tracking Number</Text>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }} numberOfLines={1} ellipsizeMode="middle">{deliveryData.trk || deliveryData.tracking_number || deliveryData.id}</Text>
                        </View>
                        <Chip
                            icon={getStatusIcon(deliveryData.status)}
                            textStyle={{ color: 'white', fontWeight: 'bold' }}
                            style={{ backgroundColor: getStatusColor(deliveryData.status) }}
                        >
                            {deliveryData.status.toUpperCase()}
                        </Chip>
                    </View>
                    <View style={styles.divider} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                        <View>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Date</Text>
                            <Text variant="bodyMedium" style={{ fontWeight: '500' }}>{deliveryData.date || deliveryData.time || 'N/A'}</Text>
                        </View>
                        <View>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Distance</Text>
                            <Text variant="bodyMedium" style={{ fontWeight: '500' }}>{deliveryData.distance || deliveryData.distance_text || 'N/A'}</Text>
                        </View>
                    </View>
                </Surface>

                {/* Item Details */}
                <Card style={styles.card} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={styles.sectionTitle}>Item Details</Text>

                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="account" size={24} color={theme.colors.primary} />
                            <View style={styles.detailTextContainer}>
                                <Text variant="bodyLarge" style={styles.detailLabel}>Customer Name</Text>
                                <Text variant="bodyMedium" style={styles.detailValue}>{deliveryData.customer || deliveryData.customerName || 'N/A'}</Text>
                            </View>
                        </View>
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="map-marker-outline" size={24} color={theme.colors.primary} />
                            <View style={styles.detailTextContainer}>
                                <Text variant="bodyLarge" style={styles.detailLabel}>Pickup Address</Text>
                                <Text variant="bodyMedium" style={styles.detailValue}>{deliveryData.pickupAddress || deliveryData.pickup_address || 'N/A'}</Text>
                            </View>
                        </View>
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="map-marker" size={24} color={theme.colors.primary} />
                            <View style={styles.detailTextContainer}>
                                <Text variant="bodyLarge" style={styles.detailLabel}>Dropoff Address</Text>
                                <Text variant="bodyMedium" style={styles.detailValue}>{deliveryData.dropoffAddress || deliveryData.dropoff_address || deliveryData.address || 'N/A'}</Text>
                            </View>
                        </View>
                    </Card.Content>
                </Card>

                {/* Proof of Delivery */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Proof of Delivery</Text>
                {
                    deliveryData.image ? (
                        <Card style={styles.imageCard} mode="elevated">
                            <Image source={{ uri: deliveryData.image }} style={styles.proofImage} resizeMode="cover" />
                        </Card>
                    ) : (
                        <Text style={{ color: '#888', fontStyle: 'italic', marginBottom: 20 }}>No proof of delivery image available.</Text>
                    )
                }

                {
                    deliveryData.status === 'Tampered' && (
                        <Surface style={styles.tamperAlert} elevation={2}>
                            <MaterialCommunityIcons name="alert-circle" size={30} color="white" />
                            <View style={{ marginLeft: 12, flex: 1 }}>
                                <Text variant="titleMedium" style={{ color: 'white', fontWeight: 'bold' }}>Tampering Detected</Text>
                                <Text variant="bodySmall" style={{ color: 'white' }}>
                                    This package showed signs of unauthorized access. Please contact support immediately.
                                </Text>
                            </View>
                        </Surface>
                    )
                }

                <Button mode="contained" style={styles.supportButton} onPress={() => console.log('Contact Support')}>
                    Contact Support
                </Button>
            </ScrollView >
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 40,
        paddingBottom: 10,
        paddingHorizontal: 10,
        backgroundColor: 'white',
        elevation: 2,
    },
    headerTitle: {
        fontWeight: 'bold',
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 40,
    },
    mapContainer: {
        height: 300,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 20,
        elevation: 3,
        backgroundColor: 'white',
    },
    map: {
        ...StyleSheet.absoluteFillObject,
    },
    mapFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f1f1f1',
    },
    markerDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#4CAF50',
        borderWidth: 2,
        borderColor: 'white',
    },
    statusCard: {
        padding: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 20,
    },
    statusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    card: {
        marginBottom: 20,
        backgroundColor: 'white',
        borderRadius: 12,
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    detailTextContainer: {
        marginLeft: 16,
    },
    detailLabel: {
        fontWeight: 'bold',
        fontSize: 14,
        color: '#333',
    },
    detailValue: {
        color: '#666',
    },
    riderContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    riderAvatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#2196F3',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageCard: {
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 20,
    },
    proofImage: {
        width: '100%',
        height: 250,
    },
    tamperAlert: {
        backgroundColor: '#D32F2F',
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    supportButton: {
        marginTop: 10,
    },
    divider: {
        height: 1,
        backgroundColor: '#eee',
        marginVertical: 12,
    },
    recenterButton: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        backgroundColor: 'white',
        borderRadius: 24,
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
