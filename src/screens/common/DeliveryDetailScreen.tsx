import React, { useEffect, useMemo, useState } from 'react';
import circle from '@turf/circle';
import { View, Animated, StyleSheet, ScrollView, Image, Dimensions, Linking } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Card, Button, useTheme, Chip, Surface, IconButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import { supabase } from '../../services/supabaseClient';
import { subscribeToDeliveryProof, subscribeToPhotoAuditLog } from '../../services/firebaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);
import { parseUTCString } from '../../utils/date';

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);  // deg2rad below
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

const deg2rad = (deg: number) => {
    return deg * (Math.PI / 180)
}

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
    const [pickupPhotoVersion, setPickupPhotoVersion] = useState<number>(0);
    const [proofPhotoVersion, setProofPhotoVersion] = useState<number>(0);

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

                let initialDistance = delivery.distance || delivery.distance_text || 'N/A';
                if ((initialDistance === 'N/A' || !initialDistance) && !isNaN(pLat) && !isNaN(pLng) && !isNaN(dLat) && !isNaN(dLng)) {
                    initialDistance = `${getDistanceFromLatLonInKm(pLat, pLng, dLat, dLng).toFixed(2)} km`;
                }

                setDeliveryData(prev => ({
                    ...prev,
                    pickup_lat: !isNaN(pLat) ? pLat : prev.pickup_lat,
                    pickup_lng: !isNaN(pLng) ? pLng : prev.pickup_lng,
                    dropoff_lat: !isNaN(dLat) ? dLat : prev.dropoff_lat,
                    dropoff_lng: !isNaN(dLng) ? dLng : prev.dropoff_lng,
                    distance: initialDistance,
                    // Fix Timezone: Force Asia/Manila
                    date: prev.created_at ? dayjs.utc(parseUTCString(prev.created_at)).add(8, 'hour').format('MMM D, YYYY') : prev.date,
                    time: prev.created_at ? dayjs.utc(parseUTCString(prev.created_at)).add(8, 'hour').format('h:mm A') : prev.time,
                }));
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
                    .select('*, profiles:customer_id(full_name, phone_number)')
                    .or(`id.eq.${delivery.id},tracking_number.eq.${delivery.id}`)
                    .maybeSingle();

                if (error) throw error;

                if (data) {
                    console.log('[DeliveryDetail] Fetched fresh data:', data);
                    setDeliveryData(prev => ({
                        ...prev, // Keep passed params
                        ...data, // Override with fresh db data
                        customer: data.profiles?.full_name || 'Unknown',
                        pickupAddress: data.pickup_address,
                        dropoffAddress: data.dropoff_address,
                        // Ensure coords are explicitly set if different prop names
                        pickupLat: data.pickup_lat,
                        pickupLng: data.pickup_lng,
                        dropoffLat: data.dropoff_lat,
                        dropoffLng: data.dropoff_lng,
                    }));
                }
            } catch (err) {
                console.error('[DeliveryDetail] Failed to fetch details:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchDeliveryDetails();
    }, [delivery]);

    useEffect(() => {
        const liveId = deliveryData?.id || delivery?.id;
        if (!liveId) return;

        const unsubProof = subscribeToDeliveryProof(liveId, (proof) => {
            if (!proof) return;
            setDeliveryData((prev: any) => ({
                ...prev,
                ...(proof.pickup_photo_url ? { pickup_photo_url: proof.pickup_photo_url } : {}),
                ...(proof.proof_photo_url ? { proof_photo_url: proof.proof_photo_url } : {}),
            }));
            if (typeof proof.pickup_photo_uploaded_at === 'number') {
                setPickupPhotoVersion(proof.pickup_photo_uploaded_at);
            }
            if (typeof proof.proof_photo_uploaded_at === 'number') {
                setProofPhotoVersion(proof.proof_photo_uploaded_at);
            }
        });

        const unsubAudit = subscribeToPhotoAuditLog(liveId, (audit) => {
            if (!audit?.latest_photo_url) return;
            setDeliveryData((prev: any) => ({
                ...prev,
                proof_photo_url: audit.latest_photo_url,
            }));
            if (typeof audit.latest_photo_uploaded_at === 'number') {
                setProofPhotoVersion(audit.latest_photo_uploaded_at);
            } else {
                setProofPhotoVersion(Date.now());
            }
        });

        return () => {
            unsubProof();
            unsubAudit();
        };
    }, [deliveryData?.id, delivery?.id]);

    const withCacheBust = (url?: string | null, version?: number | string | null): string | undefined => {
        if (!url) return undefined;
        const v = version || Date.now();
        return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(String(v))}`;
    };

    const pickupImageUri = useMemo(
        () => withCacheBust(deliveryData.pickupImage || deliveryData.pickup_photo_url, pickupPhotoVersion || deliveryData.picked_up_at || deliveryData.updated_at),
        [deliveryData.pickupImage, deliveryData.pickup_photo_url, deliveryData.picked_up_at, deliveryData.updated_at, pickupPhotoVersion]
    );

    const proofImageUri = useMemo(
        () => withCacheBust(deliveryData.proof_photo_url || deliveryData.image, proofPhotoVersion || deliveryData.delivered_at || deliveryData.updated_at),
        [deliveryData.proof_photo_url, deliveryData.image, deliveryData.delivered_at, deliveryData.updated_at, proofPhotoVersion]
    );

    // Get pickup and dropoff coordinates from delivery object (or fetched data)
    // Support both new format (pickup_lat/lng, dropoff_lat/lng) and old format (lat/lng)
    const pickupLat = deliveryData.pickup_lat || deliveryData.pickupLat || 14.5831;
    const pickupLng = deliveryData.pickup_lng || deliveryData.pickupLng || 120.9794;
    const dropoffLat = deliveryData.dropoff_lat || deliveryData.dropoffLat || deliveryData.lat || 14.5995;
    const dropoffLng = deliveryData.dropoff_lng || deliveryData.dropoffLng || deliveryData.lng || 120.9842;

    const displayDistance = useMemo(() => {
        if (deliveryData.distance && deliveryData.distance !== 'N/A') return deliveryData.distance;
        if (deliveryData.distance_text && deliveryData.distance_text !== 'N/A') return deliveryData.distance_text;

        const pLat = parseFloat(pickupLat);
        const pLng = parseFloat(pickupLng);
        const dLat = parseFloat(dropoffLat);
        const dLng = parseFloat(dropoffLng);

        if (!isNaN(pLat) && !isNaN(pLng) && !isNaN(dLat) && !isNaN(dLng)) {
            return `${getDistanceFromLatLonInKm(pLat, pLng, dLat, dLng).toFixed(2)} km`;
        }
        return 'N/A';
    }, [deliveryData.distance, deliveryData.distance_text, pickupLat, pickupLng, dropoffLat, dropoffLng]);

    const isCancelled = deliveryData.status === 'Cancelled' || deliveryData.status === 'Tampered';

    // Default coordinates for the map center
    const deliveryLocation = {
        latitude: isCancelled ? pickupLat : dropoffLat,
        longitude: isCancelled ? pickupLng : dropoffLng,
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

    const formatStatus = (status: string) => {
        if (!status) return 'N/A';
        // Handle "IN_TRANSIT" -> "In Transit"
        return status
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());
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

                    // Always use fresh Mapbox driving distance (overrides stored value)
                    if (route.distance !== undefined) {
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

    // Generate 50m radius circles for geofence visual
    // Note: radius is in kilometers for turf/circle, so 50m = 0.05km
    const pickupGeofenceCircle = useMemo(() => {
        const lat = Number(pickupLat);
        const lng = Number(pickupLng);
        console.log('[DeliveryDetail] Pickup Geofence Config:', { lat, lng, valid: !isNaN(lat) && !isNaN(lng) });
        if (isNaN(lat) || isNaN(lng)) return null;
        return circle([lng, lat], 0.05, { steps: 64, units: 'kilometers' });
    }, [pickupLat, pickupLng]);

    const dropoffGeofenceCircle = useMemo(() => {
        const lat = Number(dropoffLat);
        const lng = Number(dropoffLng);
        console.log('[DeliveryDetail] Dropoff Geofence Config:', { lat, lng, valid: !isNaN(lat) && !isNaN(lng) });
        if (isNaN(lat) || isNaN(lng)) return null;
        return circle([lng, lat], 0.05, { steps: 64, units: 'kilometers' });
    }, [dropoffLat, dropoffLng]);

    useEffect(() => {
        console.log('[DeliveryDetail] Geofence Objects:', {
            hasPickup: !!pickupGeofenceCircle,
            hasDropoff: !!dropoffGeofenceCircle
        });
        console.log('[DeliveryDetail] Delivery Data Fare:', deliveryData.estimated_fare);
    }, [pickupGeofenceCircle, dropoffGeofenceCircle, deliveryData]);

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, screenAnim.style]}>
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
                                    zoomLevel={15}
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

                                {/* Geo-fence Visuals */}
                                {/* Pickup Geo-fence (Blue) */}
                                {pickupGeofenceCircle && (
                                    <MapboxGL.ShapeSource id="pickup-fence-source" shape={pickupGeofenceCircle}>
                                        <MapboxGL.FillLayer
                                            id="pickup-fence-fill"
                                            style={{
                                                fillColor: 'rgba(33, 150, 243, 0.4)', // Increased opacity
                                            }}
                                        />
                                        <MapboxGL.LineLayer
                                            id="pickup-fence-outline"
                                            style={{
                                                lineColor: 'rgba(33, 150, 243, 1)', // Solid border
                                                lineWidth: 2,
                                            }}
                                        />
                                    </MapboxGL.ShapeSource>
                                )}

                                {/* Dropoff Geo-fence (Green) */}
                                {dropoffGeofenceCircle && (
                                    <MapboxGL.ShapeSource id="dropoff-fence-source" shape={dropoffGeofenceCircle}>
                                        <MapboxGL.FillLayer
                                            id="dropoff-fence-fill"
                                            style={{
                                                fillColor: 'rgba(76, 175, 80, 0.4)',
                                            }}
                                        />
                                        <MapboxGL.LineLayer
                                            id="dropoff-fence-outline"
                                            style={{
                                                lineColor: 'rgba(76, 175, 80, 1)',
                                                lineWidth: 2,
                                            }}
                                        />
                                    </MapboxGL.ShapeSource>
                                )}

                            </MapboxGL.MapView>

                            {/* Recenter Button */}
                            <Surface style={styles.recenterButton} elevation={4}>
                                <IconButton
                                    icon="crosshairs-gps"
                                    size={24}
                                    onPress={() => {
                                        if (cameraRef.current) {
                                            const pLat = Number(pickupLat);
                                            const pLng = Number(pickupLng);
                                            const dLat = Number(dropoffLat);
                                            const dLng = Number(dropoffLng);

                                            if (!isNaN(pLat) && !isNaN(pLng) && !isNaN(dLat) && !isNaN(dLng)) {
                                                const maxLat = Math.max(pLat, dLat);
                                                const minLat = Math.min(pLat, dLat);
                                                const maxLng = Math.max(pLng, dLng);
                                                const minLng = Math.min(pLng, dLng);

                                                // Fit bounds: NE, SW, padding, duration
                                                cameraRef.current.fitBounds(
                                                    [maxLng, maxLat], // NorthEast
                                                    [minLng, minLat], // SouthWest
                                                    [50, 50, 50, 50], // Padding [top, right, bottom, left]
                                                    1000 // Animation duration
                                                );
                                            } else {
                                                // Fallback if coords invalid
                                                cameraRef.current.setCamera({
                                                    centerCoordinate: [(pLng + dLng) / 2, (pLat + dLat) / 2],
                                                    zoomLevel: 15,
                                                    animationDuration: 1000,
                                                });
                                            }
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
                            {formatStatus(deliveryData.status)}
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
                            <Text variant="bodyMedium" style={{ fontWeight: '500' }}>{displayDistance}</Text>
                        </View>
                        <View>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Fare</Text>
                            <Text variant="bodyMedium" style={{ fontWeight: '500', color: theme.colors.primary }}>
                                {deliveryData.estimated_fare ? `₱${Number(deliveryData.estimated_fare).toFixed(2)}` : (deliveryData.price && deliveryData.price !== '—' ? deliveryData.price : 'N/A')}
                            </Text>
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

                        {/* Sender Contact */}
                        {(deliveryData.sender_name || deliveryData.senderName) ? (
                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="account-arrow-right" size={24} color="#2196F3" />
                                <View style={[styles.detailTextContainer, { flex: 1 }]}>
                                    <Text variant="bodyLarge" style={styles.detailLabel}>Sender</Text>
                                    <Text variant="bodyMedium" style={styles.detailValue}>{deliveryData.sender_name || deliveryData.senderName}</Text>
                                </View>
                                {(deliveryData.sender_phone || deliveryData.senderPhone) ? (
                                    <View style={{ flexDirection: 'row' }}>
                                        <IconButton icon="phone" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`tel:${deliveryData.sender_phone || deliveryData.senderPhone}`)} style={{ margin: 0, marginRight: 4 }} />
                                        <IconButton icon="message-text" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`sms:${deliveryData.sender_phone || deliveryData.senderPhone}`)} style={{ margin: 0 }} />
                                    </View>
                                ) : null}
                            </View>
                        ) : null}

                        {/* Recipient Contact */}
                        {(deliveryData.recipient_name || deliveryData.recipientName) ? (
                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="account-arrow-left" size={24} color="#4CAF50" />
                                <View style={[styles.detailTextContainer, { flex: 1 }]}>
                                    <Text variant="bodyLarge" style={styles.detailLabel}>Recipient</Text>
                                    <Text variant="bodyMedium" style={styles.detailValue}>{deliveryData.recipient_name || deliveryData.recipientName}</Text>
                                </View>
                                {(deliveryData.profiles?.phone_number) ? (
                                    <View style={{ flexDirection: 'row' }}>
                                        <IconButton icon="phone" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`tel:${deliveryData.profiles.phone_number}`)} style={{ margin: 0, marginRight: 4 }} />
                                        <IconButton icon="message-text" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`sms:${deliveryData.profiles.phone_number}`)} style={{ margin: 0 }} />
                                    </View>
                                ) : null}
                            </View>
                        ) : null}

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
                                <Text variant="bodyLarge" style={styles.detailLabel}>
                                    {deliveryData.status === 'Cancelled' ? 'Return Destination (Pickup Point)' : 'Dropoff Address'}
                                </Text>
                                <Text variant="bodyMedium" style={styles.detailValue}>
                                    {deliveryData.status === 'Cancelled'
                                        ? (deliveryData.pickupAddress || deliveryData.pickup_address || 'N/A')
                                        : (deliveryData.dropoffAddress || deliveryData.dropoff_address || deliveryData.address || 'N/A')}
                                </Text>
                            </View>
                        </View>

                        {/* Delivery Notes */}
                        {(deliveryData.delivery_notes || deliveryData.deliveryNotes) ? (
                            <View style={{ marginTop: 4, padding: 12, backgroundColor: '#f1f5f9', borderRadius: 8 }}>
                                <Text variant="labelMedium" style={{ color: '#475569', marginBottom: 4 }}>Delivery Notes</Text>
                                <Text variant="bodyMedium" style={{ color: '#334155' }}>{deliveryData.delivery_notes || deliveryData.deliveryNotes}</Text>
                            </View>
                        ) : null}
                    </Card.Content>
                </Card>

                {/* Pickup Photo */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Pickup Photo</Text>
                {
                    pickupImageUri ? (
                        <Card style={styles.imageCard} mode="elevated">
                            <Image source={{ uri: pickupImageUri }} style={styles.proofImage} resizeMode="cover" />
                            {deliveryData.picked_up_at && (
                                <Text style={{ padding: 10, textAlign: 'center', color: '#666', fontSize: 12 }}>
                                    Taken on {dayjs.utc(parseUTCString(deliveryData.picked_up_at)).add(8, 'hour').format('MMM D, YYYY h:mm A')}
                                </Text>
                            )}
                        </Card>
                    ) : (
                        <Text style={{ color: '#888', fontStyle: 'italic', marginBottom: 20 }}>No pickup photo available.</Text>
                    )
                }

                {/* Proof of Delivery */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Proof of Delivery</Text>
                {
                    proofImageUri ? (
                        <Card style={styles.imageCard} mode="elevated">
                            <Image source={{ uri: proofImageUri }} style={styles.proofImage} resizeMode="cover" />
                            {deliveryData.delivered_at && (
                                <Text style={{ padding: 10, textAlign: 'center', color: '#666', fontSize: 12 }}>
                                    Taken on {dayjs.utc(parseUTCString(deliveryData.delivered_at)).add(8, 'hour').format('MMM D, YYYY h:mm A')}
                                </Text>
                            )}
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
        </Animated.View >
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
