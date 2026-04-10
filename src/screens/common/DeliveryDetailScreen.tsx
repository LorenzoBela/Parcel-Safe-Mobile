import React, { useEffect, useMemo, useState } from 'react';
import { useAppTheme } from '../../context/ThemeContext';

function buildGeofenceCircleGeoJSON(
    centerLng: number,
    centerLat: number,
    radiusM: number,
    segments: number = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
    const coords: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const dLat = (radiusM / 111320) * Math.cos(angle);
        const dLng = (radiusM / (111320 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(angle);
        coords.push([centerLng + dLng, centerLat + dLat]);
    }
    return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
    };
}
import { View, Animated, StyleSheet, ScrollView, Image, Dimensions, Linking } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Card, Button, Chip, Surface, IconButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
    const insets = useSafeAreaInsets();
    const { isDarkMode } = useAppTheme();
    const c = {
        background: isDarkMode ? '#0B0B0B' : '#F3F3F0',
        text: isDarkMode ? '#F2F2F2' : '#111111',
        textSec: isDarkMode ? '#A5A5A5' : '#666661',
        card: isDarkMode ? '#151515' : '#FFFFFF',
        border: isDarkMode ? '#2A2A2A' : '#D8D8D2',
        routeLine: isDarkMode ? '#D6D6D6' : '#2B2B2B',
        markerPickup: isDarkMode ? '#6E6E6E' : '#616161',
        markerDropoff: isDarkMode ? '#D0D0D0' : '#1C1C1C',
        markerIcon: isDarkMode ? '#0D0D0D' : '#FFFFFF',
        pickupFenceFill: isDarkMode ? '#8A8A8A' : '#878787',
        pickupFenceLine: isDarkMode ? '#B4B4B4' : '#666666',
        dropoffFenceFill: isDarkMode ? '#5A5A5A' : '#585858',
        dropoffFenceLine: isDarkMode ? '#8E8E8E' : '#373737',
        chipText: isDarkMode ? '#101010' : '#FFFFFF',
        noteBg: isDarkMode ? '#1C1C1C' : '#F0F0EB',
        alertBg: '#1E1E1E',
        alertText: '#F2F2F2',
        buttonBg: isDarkMode ? '#EAEAEA' : '#141414',
        buttonText: isDarkMode ? '#111111' : '#FFFFFF',
        icon: isDarkMode ? '#D0D0D0' : '#2C2C2C',
        iconButtonBg: isDarkMode ? '#232323' : '#ECECE7',
    };
    const { delivery } = route.params;
    console.log('[DeliveryDetail] Received delivery params:', JSON.stringify(delivery, null, 2));
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [routeGeometry, setRouteGeometry] = useState<any>(null);
    const [deliveryData, setDeliveryData] = useState<any>(delivery);
    const [loading, setLoading] = useState(false);
    const [pickupPhotoVersion, setPickupPhotoVersion] = useState<number>(0);
    const [proofPhotoVersion, setProofPhotoVersion] = useState<number>(0);
    const [returnPhotoVersion, setReturnPhotoVersion] = useState<number>(0);

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
                ...(proof.return_photo_url ? { return_photo_url: proof.return_photo_url } : {}),
            }));
            if (typeof proof.pickup_photo_uploaded_at === 'number') {
                setPickupPhotoVersion(proof.pickup_photo_uploaded_at);
            }
            if (typeof proof.proof_photo_uploaded_at === 'number') {
                setProofPhotoVersion(proof.proof_photo_uploaded_at);
            }
            if (typeof proof.return_photo_uploaded_at === 'number') {
                setReturnPhotoVersion(proof.return_photo_uploaded_at);
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

    const returnImageUri = useMemo(
        () => withCacheBust(deliveryData.return_photo_url, returnPhotoVersion || deliveryData.updated_at),
        [deliveryData.return_photo_url, deliveryData.updated_at, returnPhotoVersion]
    );

    // Get pickup and dropoff coordinates from delivery object (or fetched data)
    // Support both new format (pickup_lat/lng, dropoff_lat/lng) and old format (lat/lng)
    const pickupLat = deliveryData.pickup_lat || deliveryData.pickupLat || 14.5831;
    const pickupLng = deliveryData.pickup_lng || deliveryData.pickupLng || 120.9794;
    const dropoffLat = deliveryData.dropoff_lat || deliveryData.dropoffLat || deliveryData.lat || 14.5995;
    const dropoffLng = deliveryData.dropoff_lng || deliveryData.dropoffLng || deliveryData.lng || 120.9842;

    const displayDistance = useMemo(() => {
        if (deliveryData.distance && deliveryData.distance !== 'N/A') {
            const distStr = String(deliveryData.distance);
            return distStr.includes('km') ? distStr : `${distStr} km`;
        }
        if (deliveryData.distance_text && deliveryData.distance_text !== 'N/A') {
            const distStr = String(deliveryData.distance_text);
            return distStr.includes('km') ? distStr : `${distStr} km`;
        }

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

    const getStatusTone = (status: string) => {
        const normalized = String(status || '').toLowerCase().replace(/_/g, ' ');

        if (normalized.includes('delivered') || normalized.includes('completed')) {
            return {
                bg: isDarkMode ? '#2F2F2F' : '#1E1E1E',
                fg: '#F3F3F3',
            };
        }

        if (normalized.includes('in transit')) {
            return {
                bg: isDarkMode ? '#3A3A3A' : '#2A2A2A',
                fg: '#F3F3F3',
            };
        }

        if (normalized.includes('cancel')) {
            return {
                bg: isDarkMode ? '#444444' : '#353535',
                fg: '#F3F3F3',
            };
        }

        if (normalized.includes('tamper')) {
            return {
                bg: isDarkMode ? '#505050' : '#404040',
                fg: '#F3F3F3',
            };
        }

        return {
            bg: isDarkMode ? '#3C3C3C' : '#2F2F2F',
            fg: '#F3F3F3',
        };
    };

    const getStatusIcon = (status: string) => {
        const normalized = String(status || '').toLowerCase().replace(/_/g, ' ');
        if (normalized.includes('delivered') || normalized.includes('completed')) return 'check-circle';
        if (normalized.includes('in transit')) return 'truck-delivery';
        if (normalized.includes('cancel')) return 'close-circle';
        if (normalized.includes('tamper')) return 'alert-circle';
        return 'help-circle';
    };

    const statusTone = useMemo(() => getStatusTone(deliveryData.status), [deliveryData.status, isDarkMode]);

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
        return buildGeofenceCircleGeoJSON(lng, lat, 50);
    }, [pickupLat, pickupLng]);

    const dropoffGeofenceCircle = useMemo(() => {
        const lat = Number(dropoffLat);
        const lng = Number(dropoffLng);
        console.log('[DeliveryDetail] Dropoff Geofence Config:', { lat, lng, valid: !isNaN(lat) && !isNaN(lng) });
        if (isNaN(lat) || isNaN(lng)) return null;
        return buildGeofenceCircleGeoJSON(lng, lat, 50);
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
        <Animated.View style={[styles.container, screenAnim.style, { backgroundColor: c.background }]}>
            <View style={[styles.header, { backgroundColor: c.card, paddingTop: Math.max(insets.top, 8) }]}>
                <IconButton icon="arrow-left" onPress={() => navigation.goBack()} iconColor={c.text} />
                <Text variant="titleLarge" style={[styles.headerTitle, { color: c.text }]}>Delivery Details</Text>
                <View style={{ width: 48 }} />
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                scrollEnabled={scrollEnabled}
            >
                {/* Map Section */}
                <View
                    style={[styles.mapContainer, { backgroundColor: c.card, borderColor: c.border }]}
                    onTouchStart={() => setScrollEnabled(false)}
                    onTouchEnd={() => setScrollEnabled(true)}
                >
                    {MAPBOX_TOKEN ? (
                        <View style={{ flex: 1 }}>
                            <MapboxGL.MapView
                                style={styles.map}
                                logoEnabled={false}
                                attributionEnabled={false}
                                styleURL={isDarkMode ? MapboxGL.StyleURL.Dark : MapboxGL.StyleURL.Street}
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
                                                lineColor: c.routeLine,
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
                                            backgroundColor: c.markerDropoff,
                                            borderWidth: 2,
                                            borderColor: c.card,
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <MaterialCommunityIcons name="flag-checkered" size={14} color={c.markerIcon} />
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
                                            backgroundColor: c.markerPickup,
                                            borderWidth: 2,
                                            borderColor: c.card,
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <MaterialCommunityIcons name="package-variant" size={14} color={c.markerIcon} />
                                        </View>
                                    </MapboxGL.PointAnnotation>
                                )}

                                {/* Geo-fence Visuals */}
                                {/* Pickup Geo-fence (Blue) */}
                                {pickupGeofenceCircle && !isNaN(pickupLat) && !isNaN(pickupLng) && (
                                    <MapboxGL.ShapeSource id="pickup-fence-source" shape={pickupGeofenceCircle as any}>
                                        <MapboxGL.FillLayer
                                            id="pickup-fence-fill"
                                            style={{
                                                fillColor: c.pickupFenceFill,
                                                fillOpacity: 0.2, // 20% opacity
                                            }}
                                        />
                                        <MapboxGL.LineLayer
                                            id="pickup-fence-outline"
                                            style={{
                                                lineColor: c.pickupFenceLine,
                                                lineWidth: 2,
                                                lineOpacity: 0.8,
                                            }}
                                        />
                                    </MapboxGL.ShapeSource>
                                )}

                                {/* Dropoff Geo-fence (Green) */}
                                {dropoffGeofenceCircle && !isNaN(dropoffLat) && !isNaN(dropoffLng) && (
                                    <MapboxGL.ShapeSource id="dropoff-fence-source" shape={dropoffGeofenceCircle as any}>
                                        <MapboxGL.FillLayer
                                            id="dropoff-fence-fill"
                                            style={{
                                                fillColor: c.dropoffFenceFill,
                                                fillOpacity: 0.2,
                                            }}
                                        />
                                        <MapboxGL.LineLayer
                                            id="dropoff-fence-outline"
                                            style={{
                                                lineColor: c.dropoffFenceLine,
                                                lineWidth: 2,
                                                lineOpacity: 0.8,
                                            }}
                                        />
                                    </MapboxGL.ShapeSource>
                                )}

                            </MapboxGL.MapView>

                            {/* Recenter Button */}
                            <Surface style={[styles.recenterButton, { backgroundColor: c.card, borderColor: c.border }]} elevation={4}>
                                <IconButton
                                    icon="crosshairs-gps"
                                    size={24}
                                    iconColor={c.text}
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
                        <View style={[styles.map, styles.mapFallback, { backgroundColor: c.card }]}>
                            <Text style={{ color: c.textSec }}>
                                Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env
                            </Text>
                        </View>
                    )}
                </View>

                {/* Status Card */}
                <Surface style={[styles.statusCard, { backgroundColor: c.card }]} elevation={2}>
                    <View style={styles.statusHeader}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                            <Text variant="labelSmall" style={{ color: c.textSec }}>Tracking Number</Text>
                            <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: c.text }} numberOfLines={1} ellipsizeMode="middle">{deliveryData.trk || deliveryData.tracking_number || deliveryData.id}</Text>
                        </View>
                        <Chip
                            icon={({ size }) => (
                                <MaterialCommunityIcons
                                    name={getStatusIcon(deliveryData.status)}
                                    size={size}
                                    color={statusTone.fg}
                                />
                            )}
                            textStyle={{ color: statusTone.fg, fontFamily: 'Inter_700Bold' }}
                            style={{ backgroundColor: statusTone.bg }}
                        >
                            {formatStatus(deliveryData.status)}
                        </Chip>
                    </View>
                    <View style={[styles.divider, { backgroundColor: c.border }]} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                        <View>
                            <Text variant="labelSmall" style={{ color: c.textSec }}>Date</Text>
                            <Text variant="bodyMedium" style={{ fontFamily: 'Inter_500Medium', color: c.text }}>{deliveryData.date || deliveryData.time || 'N/A'}</Text>
                        </View>
                        <View>
                            <Text variant="labelSmall" style={{ color: c.textSec }}>Distance</Text>
                            <Text variant="bodyMedium" style={{ fontFamily: 'Inter_500Medium', color: c.text }}>{displayDistance}</Text>
                        </View>
                        <View>
                            <Text variant="labelSmall" style={{ color: c.textSec }}>Fare</Text>
                            <Text variant="bodyMedium" style={{ fontFamily: 'Inter_500Medium', color: c.text }}>
                                {(() => {
                                    const fare = deliveryData.fare || deliveryData.estimated_fare || deliveryData.price;
                                    if (!fare || fare === 'N/A' || fare === '--') return 'N/A';
                                    const fareStr = String(fare);
                                    if (fareStr.includes('₱')) return fareStr;
                                    const num = Number(fareStr.replace(/[^0-9.-]+/g, ""));
                                    return isNaN(num) ? 'N/A' : `₱${num.toFixed(2)}`;
                                })()}
                            </Text>
                        </View>
                    </View>
                </Surface>

                {/* Item Details */}
                <Card style={[styles.card, { backgroundColor: c.card }]} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Item Details</Text>

                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="account" size={24} color={c.icon} />
                            <View style={styles.detailTextContainer}>
                                <Text variant="bodyLarge" style={[styles.detailLabel, { color: c.text }]}>Customer Name</Text>
                                <Text variant="bodyMedium" style={[styles.detailValue, { color: c.textSec }]}>{deliveryData.customer || deliveryData.customerName || 'N/A'}</Text>
                            </View>
                        </View>

                        {/* Sender Contact */}
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="account-arrow-right" size={24} color={c.icon} />
                            <View style={[styles.detailTextContainer, { flex: 1 }]}>
                                <Text variant="bodyLarge" style={[styles.detailLabel, { color: c.text }]}>Sender</Text>
                                <Text variant="bodyMedium" style={[styles.detailValue, { color: c.textSec }]}>{deliveryData.sender_name || deliveryData.senderName || deliveryData.profiles?.full_name || 'Unknown Sender'}</Text>
                            </View>
                            {(deliveryData.sender_phone || deliveryData.senderPhone) ? (
                                <View style={{ flexDirection: 'row' }}>
                                    <IconButton icon="phone" size={18} mode="contained" containerColor={c.iconButtonBg} iconColor={c.icon} onPress={() => Linking.openURL(`tel:${deliveryData.sender_phone || deliveryData.senderPhone}`)} style={{ margin: 0, marginRight: 4 }} />
                                    <IconButton icon="message-text" size={18} mode="contained" containerColor={c.iconButtonBg} iconColor={c.icon} onPress={() => Linking.openURL(`sms:${deliveryData.sender_phone || deliveryData.senderPhone}`)} style={{ margin: 0 }} />
                                </View>
                            ) : null}
                        </View>

                        {/* Recipient Contact */}
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="account-arrow-left" size={24} color={c.icon} />
                            <View style={[styles.detailTextContainer, { flex: 1 }]}>
                                <Text variant="bodyLarge" style={[styles.detailLabel, { color: c.text }]}>Recipient</Text>
                                <Text variant="bodyMedium" style={[styles.detailValue, { color: c.textSec }]}>{deliveryData.recipient_name || deliveryData.recipientName || deliveryData.customer || deliveryData.customerName || 'Unknown Recipient'}</Text>
                            </View>
                            {(deliveryData.recipient_phone || deliveryData.recipientPhone || deliveryData.profiles?.phone_number) ? (
                                <View style={{ flexDirection: 'row' }}>
                                    <IconButton icon="phone" size={18} mode="contained" containerColor={c.iconButtonBg} iconColor={c.icon} onPress={() => Linking.openURL(`tel:${deliveryData.recipient_phone || deliveryData.recipientPhone || deliveryData.profiles?.phone_number}`)} style={{ margin: 0, marginRight: 4 }} />
                                    <IconButton icon="message-text" size={18} mode="contained" containerColor={c.iconButtonBg} iconColor={c.icon} onPress={() => Linking.openURL(`sms:${deliveryData.recipient_phone || deliveryData.recipientPhone || deliveryData.profiles?.phone_number}`)} style={{ margin: 0 }} />
                                </View>
                            ) : null}
                        </View>

                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="map-marker-outline" size={24} color={c.icon} />
                            <View style={[styles.detailTextContainer, { flex: 1 }]}>
                                <Text variant="bodyLarge" style={[styles.detailLabel, { color: c.text }]}>Pickup Address</Text>
                                <Text variant="bodyMedium" style={[styles.detailValue, { color: c.textSec }]}>{deliveryData.pickupAddress || deliveryData.pickup_address || 'N/A'}</Text>
                            </View>
                        </View>
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="map-marker" size={24} color={c.icon} />
                            <View style={[styles.detailTextContainer, { flex: 1 }]}>
                                <Text variant="bodyLarge" style={[styles.detailLabel, { color: c.text }]}>
                                    {deliveryData.status === 'Cancelled' ? 'Return Destination (Pickup Point)' : 'Dropoff Address'}
                                </Text>
                                <Text variant="bodyMedium" style={[styles.detailValue, { color: c.textSec }]}>
                                    {deliveryData.status === 'Cancelled'
                                        ? (deliveryData.pickupAddress || deliveryData.pickup_address || 'N/A')
                                        : (deliveryData.dropoffAddress || deliveryData.dropoff_address || deliveryData.address || 'N/A')}
                                </Text>
                            </View>
                        </View>

                        {/* Delivery Notes */}
                        {(deliveryData.delivery_notes || deliveryData.deliveryNotes) ? (
                            <View style={{ marginTop: 4, padding: 12, backgroundColor: c.noteBg, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
                                <Text variant="labelMedium" style={{ color: c.textSec, marginBottom: 4 }}>Delivery Notes</Text>
                                <Text variant="bodyMedium" style={{ color: c.text }}>{deliveryData.delivery_notes || deliveryData.deliveryNotes}</Text>
                            </View>
                        ) : null}
                    </Card.Content>
                </Card>

                {/* Pickup Photo */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Pickup Photo</Text>
                {
                    pickupImageUri ? (
                        <Card style={styles.imageCard} mode="elevated">
                            <Image source={{ uri: pickupImageUri }} style={styles.proofImage} resizeMode="cover" />
                            {deliveryData.picked_up_at && (
                                <Text style={{ padding: 10, textAlign: 'center', color: c.textSec, fontSize: 12 }}>
                                    Taken on {dayjs.utc(parseUTCString(deliveryData.picked_up_at)).add(8, 'hour').format('MMM D, YYYY h:mm A')}
                                </Text>
                            )}
                        </Card>
                    ) : (
                        <Text style={{ color: c.textSec, fontStyle: 'italic', marginBottom: 20 }}>No pickup photo available.</Text>
                    )
                }

                {/* Proof of Delivery */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>
                    {String(deliveryData.status || '').toUpperCase() === 'RETURNED' ? 'Return Verification' : 'Proof of Delivery'}
                </Text>
                {
                    (returnImageUri || proofImageUri) ? (
                        <Card style={styles.imageCard} mode="elevated">
                            <Image source={{ uri: returnImageUri || proofImageUri }} style={styles.proofImage} resizeMode="cover" />
                            {deliveryData.delivered_at && (
                                <Text style={{ padding: 10, textAlign: 'center', color: c.textSec, fontSize: 12 }}>
                                    Taken on {dayjs.utc(parseUTCString(deliveryData.delivered_at)).add(8, 'hour').format('MMM D, YYYY h:mm A')}
                                </Text>
                            )}
                        </Card>
                    ) : (
                        <Text style={{ color: c.textSec, fontStyle: 'italic', marginBottom: 20 }}>No proof of delivery image available.</Text>
                    )
                }

                {
                    deliveryData.status === 'Tampered' && (
                        <Surface style={[styles.tamperAlert, { backgroundColor: c.alertBg, borderColor: c.border }]} elevation={2}>
                            <MaterialCommunityIcons name="alert-circle" size={30} color={c.alertText} />
                            <View style={{ marginLeft: 12, flex: 1 }}>
                                <Text variant="titleMedium" style={{ color: c.alertText, fontFamily: 'Inter_700Bold' }}>Tampering Detected</Text>
                                <Text variant="bodySmall" style={{ color: c.alertText }}>
                                    This package showed signs of unauthorized access. Please contact support immediately.
                                </Text>
                            </View>
                        </Surface>
                    )
                }

                <Button mode="contained" style={styles.supportButton} buttonColor={c.buttonBg} textColor={c.buttonText} onPress={() => console.log('Contact Support')}>
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
        paddingBottom: 10,
        paddingHorizontal: 10,
        backgroundColor: 'white',
        elevation: 2,
    },
    headerTitle: {
        fontFamily: 'Inter_700Bold',
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
        borderWidth: StyleSheet.hairlineWidth,
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
        fontFamily: 'Inter_700Bold',
        marginBottom: 12,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    detailTextContainer: {
        marginLeft: 16,
        flex: 1,
    },
    detailLabel: {
        fontFamily: 'Inter_700Bold',
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
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        borderWidth: StyleSheet.hairlineWidth,
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
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 24,
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
