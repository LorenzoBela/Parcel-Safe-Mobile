import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Alert, Share } from 'react-native';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import { Text, Card, Avatar, Button, IconButton, Surface, useTheme } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { subscribeToDisplay } from '../../services/firebaseClient';
import {
    subscribeToDelivery,
    subscribeToRiderLocation,
    subscribeToBoxLocation,
    getRiderProfile,
    DeliveryRecord,
    RiderProfile,
} from '../../services/riderMatchingService';
import {
    subscribeToCancellation,
    CancellationState,
    formatCancellationReason,
    DeliveryStatus,
    canCustomerCancel,
    requestCustomerCancellation,
    CustomerCancellationReason,
} from '../../services/cancellationService';
import statusUpdateService from '../../services/statusUpdateService';
import * as Clipboard from 'expo-clipboard';
import CustomerCancellationModal from '../../components/modals/CustomerCancellationModal';
import useAuthStore from '../../store/authStore';
import { lineString } from '@turf/helpers';
// MapboxGL is already imported from wrapper

interface TrackRouteParams {
    bookingId: string;
    riderId?: string;
    shareToken?: string;
    pickup?: string;
    dropoff?: string;
    pickupLat?: number;
    pickupLng?: number;
    dropoffLat?: number;
    dropoffLng?: number;
}

function mapStatusToCancellationStatus(status: string | undefined): DeliveryStatus {
    switch (status) {
        case 'PENDING':
            return DeliveryStatus.PENDING;
        case 'ASSIGNED':
            return DeliveryStatus.ASSIGNED;
        case 'PICKED_UP':
            return DeliveryStatus.PICKED_UP;
        case 'IN_TRANSIT':
            return DeliveryStatus.IN_TRANSIT;
        case 'ARRIVED':
            return DeliveryStatus.ARRIVED;
        case 'COMPLETED':
            return DeliveryStatus.DELIVERED;
        case 'CANCELLED':
            return DeliveryStatus.CANCELLED;
        default:
            return DeliveryStatus.ASSIGNED;
    }
}

export default function TrackOrderScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [cancellation, setCancellation] = useState<CancellationState | null>(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
    const [riderLiveLocation, setRiderLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [boxLiveLocation, setBoxLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [routeCoordinates, setRouteCoordinates] = useState<number[][] | null>(null);
    const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);

    const params = (route.params || {}) as TrackRouteParams;
    const deliveryId = params.bookingId;
    const customerId = useAuthStore((state: any) => state.user?.userId) as string | undefined;

    const deliveryStatus = mapStatusToCancellationStatus(delivery?.status);

    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const destination = {
        latitude: delivery?.dropoff_lat ?? params.dropoffLat ?? 0,
        longitude: delivery?.dropoff_lng ?? params.dropoffLng ?? 0,
    };

    const isPickedUp = ['PICKED_UP', 'IN_TRANSIT'].includes(delivery?.status || '');

    const boxLocation = {
        latitude: boxLiveLocation?.lat ?? (isPickedUp ? RiderFallbackLat() : (delivery?.pickup_lat ?? params.pickupLat ?? destination.latitude)),
        longitude: boxLiveLocation?.lng ?? (isPickedUp ? RiderFallbackLng() : (delivery?.pickup_lng ?? params.pickupLng ?? destination.longitude)),
    };

    // Helper to get rider location for fallback without circular dependency reference in const
    function RiderFallbackLat() { return riderLiveLocation?.lat ?? delivery?.pickup_lat ?? destination.latitude; }
    function RiderFallbackLng() { return riderLiveLocation?.lng ?? delivery?.pickup_lng ?? destination.longitude; }

    const riderLocation = {
        latitude: riderLiveLocation?.lat ?? (isPickedUp ? boxLocation.latitude : (delivery?.pickup_lat ?? params.pickupLat ?? destination.latitude)),
        longitude: riderLiveLocation?.lng ?? (isPickedUp ? boxLocation.longitude : (delivery?.pickup_lng ?? params.pickupLng ?? destination.longitude)),
    };

    const riderDetails = {
        name: riderProfile?.full_name || delivery?.rider_name || (delivery?.status === 'ACCEPTED' ? 'Rider Assigned' : 'Connecting...'),
        vehicle: 'Delivery Rider',
        rating: riderProfile?.rating || 4.8,
        phone: delivery?.rider_phone || '',
        avatar: riderProfile?.avatar_url || 'https://i.pravatar.cc/150?img=11',
    };

    // Fetch Rider Profile when rider_id is assigned
    useEffect(() => {
        if (delivery?.rider_id) {
            getRiderProfile(delivery.rider_id).then(setRiderProfile);
        } else {
            setRiderProfile(null);
        }
    }, [delivery?.rider_id]);

    useEffect(() => {
        // Best-effort flush of queued status updates (EC-35) when tracking UI opens.
        statusUpdateService.processQueue().catch(() => undefined);
    }, []);

    useEffect(() => {
        if (!deliveryId) {
            Alert.alert('Missing Delivery', 'Unable to open tracking without a valid delivery.', [
                { text: 'Go Back', onPress: () => navigation.goBack() },
            ]);
            return;
        }

        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }

        const unsubscribeDelivery = subscribeToDelivery(deliveryId, (data) => {
            setDelivery(data);
        });

        const initialRiderId = params.riderId;
        let unsubscribeRiderLocation = () => undefined;
        if (initialRiderId) {
            unsubscribeRiderLocation = subscribeToRiderLocation(initialRiderId, (location) => {
                if (!location) {
                    setRiderLiveLocation(null);
                    return;
                }
                setRiderLiveLocation({ lat: location.lat, lng: location.lng });
            });
        }

        // EC-86: Monitor display health
        const unsubscribeDisplay = delivery?.box_id
            ? subscribeToDisplay(delivery.box_id, (displayState) => {
                if (displayState) {
                    setDisplayStatus(displayState.status);
                }
            })
            : () => undefined;

        // EC-32: Monitor cancellation
        const unsubscribeCancellation = subscribeToCancellation(deliveryId, (state) => {
            // Only consider it cancelled if the state exists AND is marked as cancelled
            if (state && state.cancelled) {
                setCancellation(state);
            } else {
                setCancellation(null);
            }
        });

        const unsubscribeBox = delivery?.box_id
            ? subscribeToBoxLocation(delivery.box_id, (location) => {
                if (location) {
                    setBoxLiveLocation({ lat: location.lat, lng: location.lng });
                }
            })
            : () => undefined;

        return () => {
            unsubscribeDelivery();
            unsubscribeRiderLocation();
            unsubscribeDisplay();
            unsubscribeCancellation();
            unsubscribeBox();
        };
    }, [MAPBOX_TOKEN, deliveryId, params.riderId, delivery?.box_id, navigation]);

    useEffect(() => {
        if (!delivery?.rider_id) {
            return;
        }

        return subscribeToRiderLocation(delivery.rider_id, (location) => {
            if (!location) {
                setRiderLiveLocation(null);
                return;
            }
            setRiderLiveLocation({ lat: location.lat, lng: location.lng });
        });
    }, [delivery?.rider_id]);

    const copyReturnOtp = async () => {
        if (cancellation?.returnOtp) {
            await Clipboard.setStringAsync(cancellation.returnOtp);
            Alert.alert('Copied', 'Return OTP copied to clipboard');
        }
    };

    // Customer cancellation handler
    const handleCancellationSubmit = async (reason: CustomerCancellationReason, details: string) => {
        setCancelLoading(true);
        try {
            if (!customerId) {
                Alert.alert('Authentication Required', 'Please log in again to manage this delivery.');
                setCancelLoading(false);
                return;
            }

            const result = await requestCustomerCancellation(
                {
                    deliveryId,
                    customerId,
                    reason,
                    reasonDetails: details,
                },
                deliveryStatus
            );

            if (result.success) {
                setShowCancelModal(false);
                navigation.navigate('CustomerCancellationConfirm', {
                    deliveryId,
                    reason,
                    reasonDetails: details,
                    refundStatus: result.refundStatus,
                });
            } else {
                Alert.alert('Cancellation Failed', result.error || 'Unable to cancel order');
            }
        } catch (err) {
            Alert.alert('Error', 'An unexpected error occurred');
        } finally {
            setCancelLoading(false);
        }
    };

    const handleShareTracking = async () => {
        const token = delivery?.share_token || params.shareToken;
        if (!token) {
            Alert.alert('Share Unavailable', 'Tracking link is not ready yet.');
            return;
        }

        const baseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.web.app';
        const url = `${baseUrl}/track/${token}`;
        await Share.share({
            message: `Track your Parcel-Safe delivery: ${url}`,
            url,
        });
    };

    const canCancelResult = canCustomerCancel(deliveryStatus);

    // Fetch route from Mapbox Directions API
    useEffect(() => {
        if (!riderLocation.latitude || !destination.latitude || !MAPBOX_TOKEN) return;

        const fetchRoute = async () => {
            try {
                const response = await fetch(
                    `https://api.mapbox.com/directions/v5/mapbox/driving/${riderLocation.longitude},${riderLocation.latitude};${destination.longitude},${destination.latitude}?geometries=geojson&access_token=${MAPBOX_TOKEN}`
                );
                const json = await response.json();
                if (json.routes && json.routes.length > 0) {
                    setRouteCoordinates(json.routes[0].geometry.coordinates);
                }
            } catch (error) {
                console.error('Error fetching route:', error);
            }
        };

        // Debounce or throttle this in production? For now, fetch on significant location change?
        // Actually, just fetching on mount or destination change is safer for quota.
        // Updating route every second is expensive. Let's fetch once initially or if destination changes.
        // If rider moves, we might want to update, but maybe just visually showing the rider moving along the static route is enough?
        // User asked for "mapping the street not just lines".
        fetchRoute();
    }, [destination.latitude, destination.longitude, MAPBOX_TOKEN]); // Removed riderLocation dependency to avoid API spam

    const routeGeoJson = {
        type: 'Feature' as const,
        geometry: {
            type: 'LineString' as const,
            coordinates: routeCoordinates || [
                [riderLocation.longitude, riderLocation.latitude],
                [boxLocation.longitude, boxLocation.latitude],
                [destination.longitude, destination.latitude],
            ],
        },
        properties: {},
    };

    const destinationPoint = {
        type: 'Feature' as const,
        geometry: {
            type: 'Point' as const,
            coordinates: [destination.longitude, destination.latitude],
        },
        properties: {},
    };

    return (
        <View style={styles.container}>
            {MAPBOX_TOKEN ? (
                <MapboxGL.MapView
                    style={styles.map}
                    styleURL={theme.dark ? MapboxGL.StyleURL.Dark : MapboxGL.StyleURL.Light}
                    logoEnabled={false}
                    attributionEnabled={false}
                >
                    <MapboxGL.Camera
                        zoomLevel={14}
                        centerCoordinate={[boxLocation.longitude, boxLocation.latitude]}
                    />

                    {/* Route Line */}
                    <MapboxGL.ShapeSource id="route" shape={routeGeoJson}>
                        <MapboxGL.LineLayer
                            id="route-line"
                            style={{
                                lineColor: theme.colors.primary,
                                lineWidth: 4,
                            }}
                        />
                    </MapboxGL.ShapeSource>

                    {/* Box Marker */}
                    <MapboxGL.PointAnnotation
                        id="box-marker"
                        coordinate={[boxLocation.longitude, boxLocation.latitude]}
                        title="Your Parcel"
                    >
                        <View style={styles.markerContainer}>
                            <Avatar.Icon size={40} icon="package-variant" style={{ backgroundColor: 'orange' }} />
                        </View>
                    </MapboxGL.PointAnnotation>

                    {/* Rider Marker */}
                    <MapboxGL.PointAnnotation
                        id="rider-marker"
                        coordinate={[riderLocation.longitude, riderLocation.latitude]}
                        title="Rider"
                    >
                        <View style={styles.markerContainer}>
                            <Avatar.Icon size={40} icon="motorbike" style={{ backgroundColor: theme.colors.primary }} />
                        </View>
                    </MapboxGL.PointAnnotation>

                    {/* Destination Marker */}
                    <MapboxGL.PointAnnotation
                        id="destination-marker"
                        coordinate={[destination.longitude, destination.latitude]}
                        title="Destination"
                    >
                        <View style={styles.markerContainer}>
                            <MaterialCommunityIcons name="map-marker" size={40} color="#F44336" />
                        </View>
                    </MapboxGL.PointAnnotation>

                    {/* Geo-fence */}
                    <MapboxGL.ShapeSource id="destination" shape={destinationPoint}>
                        <MapboxGL.CircleLayer
                            id="destination-fence"
                            style={{
                                circleRadius: 60,
                                circleColor: 'rgba(76, 175, 80, 0.25)', // More visible green fill
                                circleStrokeColor: 'rgba(76, 175, 80, 0.8)', // Solid strong border
                                circleStrokeWidth: 3,
                            }}
                        />
                    </MapboxGL.ShapeSource>
                </MapboxGL.MapView>
            ) : (
                <View style={[styles.map, styles.mapFallback]}>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env
                    </Text>
                </View>
            )}

            {/* Header Actions */}
            <View style={styles.headerActions}>
                <Surface style={[styles.iconButtonSurface, { backgroundColor: theme.colors.surface }]} elevation={2}>
                    <IconButton icon="arrow-left" size={24} iconColor={theme.colors.onSurface} onPress={() => navigation.goBack()} />
                </Surface>
            </View>

            {/* Bottom Sheet Info */}
            <View style={[styles.bottomSheet, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.handleBar, { backgroundColor: theme.colors.outline }]} />

                <View style={styles.statusHeader}>
                    <View>
                        {cancellation && delivery?.status === 'CANCELLED' ? (
                            <Text variant="titleLarge" style={{ fontWeight: 'bold', color: theme.colors.error }}>Delivery Cancelled</Text>
                        ) : (
                            <Text variant="titleLarge" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                                {delivery?.status === 'ARRIVED' ? 'Rider Arrived' : 'Delivery In Progress'}
                            </Text>
                        )}

                        {cancellation && delivery?.status === 'CANCELLED' ? (
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                Reason: {formatCancellationReason(cancellation.reason)}
                            </Text>
                        ) : (
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                {delivery?.status ? `Status: ${delivery.status}` : 'On the way to your location'}
                            </Text>
                        )}

                        {/* EC-86: Display hint when keypad unavailable */}
                        {displayStatus === 'FAILED' && (
                            <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 4 }}>
                                ℹ️ Keypad display unavailable - use app to unlock
                            </Text>
                        )}
                    </View>
                    {!cancellation && (
                        <Surface style={styles.etaBadge} elevation={0}>
                            <Text style={{ color: 'white', fontWeight: 'bold' }}>10 min</Text>
                        </Surface>
                    )}
                </View>

                {/* EC-32: Cancellation Details & Return OTP */}
                {cancellation && delivery?.status === 'CANCELLED' && (
                    <Surface style={[styles.cancellationCard, { backgroundColor: theme.colors.errorContainer }]} elevation={1}>
                        <View style={styles.cancellationHeader}>
                            <MaterialCommunityIcons name="alert-circle-outline" size={24} color={theme.colors.error} />
                            <Text style={{ marginLeft: 8, color: theme.colors.onSurface, fontWeight: 'bold' }}>Return Authorization</Text>
                        </View>
                        <Text style={{ marginBottom: 12, color: theme.colors.onSurfaceVariant }}>
                            Please provide this OTP to the rider to retrieve your package.
                        </Text>

                        <TouchableOpacity onPress={copyReturnOtp} activeOpacity={0.7}>
                            <Surface style={styles.otpContainer} elevation={2}>
                                <Text variant="displaySmall" style={{ letterSpacing: 4, fontWeight: 'bold', color: theme.colors.primary }}>
                                    {cancellation.returnOtp}
                                </Text>
                                <MaterialCommunityIcons name="content-copy" size={20} color={theme.colors.primary} style={{ position: 'absolute', right: 16 }} />
                            </Surface>
                        </TouchableOpacity>
                    </Surface>
                )}

                <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                <View style={styles.riderInfo}>
                    <Avatar.Image size={50} source={{ uri: riderDetails.avatar }} />
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>{riderDetails.name}</Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{riderDetails.vehicle}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <MaterialCommunityIcons name="star" size={16} color="#FFC107" />
                            <Text variant="labelSmall" style={{ marginLeft: 4, color: theme.colors.onSurface }}>{riderDetails.rating}</Text>
                        </View>
                    </View>
                    <View style={styles.actionButtons}>
                        <IconButton
                            mode="contained"
                            icon="phone"
                            containerColor={theme.dark ? '#1A237E' : '#E3F2FD'} // Darker blue for dark mode
                            iconColor="#2196F3"
                            size={24}
                            onPress={() => console.log('Call')}
                        />
                        <IconButton
                            mode="contained"
                            icon="message-text"
                            containerColor={theme.dark ? '#1B5E20' : '#E8F5E9'} // Darker green for dark mode
                            iconColor="#4CAF50"
                            size={24}
                            onPress={() => console.log('Message')}
                        />
                    </View>
                </View>

                <Button
                    mode="outlined"
                    style={styles.cancelBtn}
                    icon="share-variant"
                    onPress={handleShareTracking}
                >
                    Share Tracking Link
                </Button>

                {!cancellation && (
                    <Button
                        mode="contained"
                        style={styles.viewOtpBtn}
                        icon="lock-open"
                        onPress={() => {
                            const boxId = delivery?.box_id;
                            if (!boxId) {
                                return;
                            }
                            navigation.navigate('OTP', { boxId });
                        }}
                        disabled={!delivery?.box_id}
                    >
                        View Secure OTP
                    </Button>
                )}

                {/* Customer Cancel Button - Only show if cancellation is allowed */}
                {!cancellation && canCancelResult.canCancel && (
                    <Button
                        mode="outlined"
                        style={styles.cancelBtn}
                        icon="close-circle"
                        textColor={theme.colors.error}
                        onPress={() => setShowCancelModal(true)}
                    >
                        Cancel Order
                    </Button>
                )}
            </View>

            {/* Customer Cancellation Modal */}
            <CustomerCancellationModal
                visible={showCancelModal}
                onDismiss={() => setShowCancelModal(false)}
                onSubmit={handleCancellationSubmit}
                loading={cancelLoading}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    map: {
        width: Dimensions.get('window').width,
        height: Dimensions.get('window').height,
    },
    mapFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    headerActions: {
        position: 'absolute',
        top: 50,
        left: 20,
        zIndex: 10,
    },
    iconButtonSurface: {
        borderRadius: 25,
        backgroundColor: 'white',
    },
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingTop: 12,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    handleBar: {
        width: 40,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 20,
    },
    statusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    etaBadge: {
        backgroundColor: '#4CAF50',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    divider: {
        height: 1,
        marginBottom: 20,
    },
    riderInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    actionButtons: {
        flexDirection: 'row',
    },
    viewOtpBtn: {
        borderRadius: 12,
        paddingVertical: 6,
    },
    cancellationCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 20,
    },
    cancellationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    otpContainer: {
        backgroundColor: 'white',
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
    },
    cancelBtn: {
        marginTop: 12,
        borderRadius: 12,
        borderColor: '#EF4444',
    },
});
