import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Alert, Share, Image, Animated, Easing, Linking, ActivityIndicator } from 'react-native';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import { Text, Card, Avatar, Button, IconButton, Surface, useTheme } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { subscribeToDisplay } from '../../services/firebaseClient';
import {
    subscribeToDelivery,
    subscribeToRiderLocation,
    subscribeToBoxLocation,
    getInitialRiderLocation,
    getInitialBoxLocation,
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
import { lineString, point } from '@turf/helpers';
import circle from '@turf/circle';
import bearing from '@turf/bearing';
import lineSlice from '@turf/line-slice';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import length from '@turf/length';
import distanceTurf from '@turf/distance';
// MapboxGL is already imported from wrapper
import AnimatedRiderMarker from '../../components/map/AnimatedRiderMarker';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

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
    completed_at?: number;
    proof_photo_url?: string;
    rider_avatar_url?: string; // rider profile pic
}

function mapStatusToCancellationStatus(status: string | undefined): DeliveryStatus {
    switch (status) {
        case 'PENDING':
            return DeliveryStatus.PENDING;
        case 'ASSIGNED':
            return DeliveryStatus.ASSIGNED;
        case 'PICKED_UP':
            return DeliveryStatus.IN_TRANSIT;
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

import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RiderImage = require('../../../assets/Rider.jpg');

// Pulse animation component for rider marker
function PulseRing() {
    const pulseAnim = useRef(new Animated.Value(0.4)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const pulse = Animated.loop(
            Animated.parallel([
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 0, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 0.4, duration: 0, useNativeDriver: true }),
                ]),
                Animated.sequence([
                    Animated.timing(scaleAnim, { toValue: 2, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
                    Animated.timing(scaleAnim, { toValue: 1, duration: 0, useNativeDriver: true }),
                ]),
            ])
        );
        pulse.start();
        return () => pulse.stop();
    }, [pulseAnim, scaleAnim]);

    return (
        <Animated.View
            style={{
                position: 'absolute',
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: '#10b981',
                opacity: pulseAnim,
                transform: [{ scale: scaleAnim }],
            }}
        />
    );
}

export default function TrackOrderScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const cameraRef = useRef<any>(null);
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [cancellation, setCancellation] = useState<CancellationState | null>(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
    const [riderLiveLocation, setRiderLiveLocation] = useState<{ lat: number; lng: number; lastUpdated: number } | null>(null);
    const [boxLiveLocation, setBoxLiveLocation] = useState<{ lat: number; lng: number; lastUpdated: number } | null>(null);
    const [routeCoordinates, setRouteCoordinates] = useState<number[][] | null>(null);
    const [completedRouteCoords, setCompletedRouteCoords] = useState<number[][] | null>(null); // P1: traveled route
    const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);
    const [eta, setEta] = useState<number | null>(null);
    const [distanceToTarget, setDistanceToTarget] = useState<number | null>(null); // km
    const [isMapLoading, setIsMapLoading] = useState(true); // Loading screen until real location is fetched
    const [isRouteView, setIsRouteView] = useState(false);
    const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(true);

    // EC-SMART-ROUTE: Refs for optimization (borrowed from Web)
    const consecutiveOffRouteCount = useRef(0);
    const recalcCount = useRef(0);
    const lastRecalcTimestamp = useRef(0);
    const isRecalculating = useRef(false);
    const routeAverageSpeed = useRef<number>(25 / 3.6); // Default 25km/h in m/s
    const MAX_RECALCS = 20;
    const MIN_DIST_TO_RECALC_KM = 0.2; // 200m
    const RECALC_COOLDOWN_MS = 8000; // 8s (faster rerouting)
    const CONSECUTIVE_OFF_ROUTE_REQUIRED = 2; // React faster to off-route
    const OFF_ROUTE_THRESHOLD_KM = 0.05; // 50m

    // Loop/Status Guard Ref
    const stopTracking = useRef(false);

    // --- P2: ETA Smoothing & Stale Data ---
    const smoothedEtaRef = useRef<number | null>(null);
    const lastUpdateTimestamp = useRef<number>(Date.now());
    const ETA_ALPHA = 0.3;

    const smoothEta = (rawMinutes: number): number => {
        if (smoothedEtaRef.current === null) {
            smoothedEtaRef.current = rawMinutes;
            return rawMinutes;
        }
        const delta = Math.abs(rawMinutes - smoothedEtaRef.current);
        const pctChange = delta / Math.max(smoothedEtaRef.current, 1);
        if (delta < 1 && pctChange < 0.1) return smoothedEtaRef.current; // Suppress flicker
        const alpha = rawMinutes < smoothedEtaRef.current ? 0.5 : ETA_ALPHA;
        smoothedEtaRef.current = Math.ceil(alpha * rawMinutes + (1 - alpha) * smoothedEtaRef.current);
        return smoothedEtaRef.current;
    };

    const params = (route.params || {}) as TrackRouteParams;
    const deliveryId = params.bookingId;
    const customerId = useAuthStore((state: any) => state.user?.userId) as string | undefined;

    const deliveryStatus = mapStatusToCancellationStatus(delivery?.status);
    const isTerminalState = ['COMPLETED', 'TAMPERED', 'CANCELLED'].includes(delivery?.status || '');

    // Sync Ref and Clear Data on Terminal State
    useEffect(() => {
        stopTracking.current = isTerminalState;
        if (isTerminalState) {
            setRiderLiveLocation(null);
            setBoxLiveLocation(null);
        }
    }, [isTerminalState]);

    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const destination = {
        latitude: delivery?.dropoff_lat ?? params.dropoffLat ?? 0,
        longitude: delivery?.dropoff_lng ?? params.dropoffLng ?? 0,
    };

    const pickupLocation = {
        latitude: delivery?.pickup_lat ?? params.pickupLat ?? 0,
        longitude: delivery?.pickup_lng ?? params.pickupLng ?? 0,
    };

    const isPickedUp = ['PICKED_UP', 'IN_TRANSIT'].includes(delivery?.status || '');

    // Two-Phase Routing: determine the current route target
    const routeTarget = isPickedUp ? destination : pickupLocation;

    // EC-FIX: Smart Fallback Logic - Prefer the freshest data source
    const useBoxLocation = useMemo(() => {
        if (!boxLiveLocation) return false;
        if (!riderLiveLocation) return true;
        // If box location is newer than rider location (plus 5s grace period for network jitter), use box
        return boxLiveLocation.lastUpdated > (riderLiveLocation.lastUpdated + 5000);
    }, [boxLiveLocation, riderLiveLocation]);

    const displayLocation = useBoxLocation ? boxLiveLocation : riderLiveLocation;

    // Fallback coordinates if no live data available
    const fallbackLat = delivery?.pickup_lat ?? params.pickupLat ?? destination.latitude;
    const fallbackLng = delivery?.pickup_lng ?? params.pickupLng ?? destination.longitude;

    const boxLocation = {
        latitude: boxLiveLocation?.lat ?? (isPickedUp ? fallbackLat : fallbackLat), // Logic: if picked up, box moves with rider. If not, box is at pickup.
        longitude: boxLiveLocation?.lng ?? (isPickedUp ? fallbackLng : fallbackLng),
    };

    // The marker displayed as "Rider" on the map
    const hasLiveLocation = !!(displayLocation?.lat && displayLocation?.lng);
    const riderMarkerLocation = {
        latitude: displayLocation?.lat ?? (isPickedUp ? boxLocation.latitude : fallbackLat),
        longitude: displayLocation?.lng ?? (isPickedUp ? boxLocation.longitude : fallbackLng),
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

    // ONE-SHOT READ: Fetch rider/box real location before map renders
    useEffect(() => {
        let cancelled = false;
        const fetchInitialLocations = async () => {
            try {
                const riderId = params.riderId;
                // Try rider location first
                if (riderId) {
                    const riderLoc = await getInitialRiderLocation(riderId);
                    if (!cancelled && riderLoc) {
                        setRiderLiveLocation({
                            lat: riderLoc.lat,
                            lng: riderLoc.lng,
                            lastUpdated: riderLoc.lastUpdated,
                        });
                        console.log('[TrackOrder] Pre-fetched rider location:', riderLoc.lat, riderLoc.lng);
                    }
                }
            } catch (err) {
                console.warn('[TrackOrder] Failed to pre-fetch locations:', err);
            } finally {
                if (!cancelled) setIsMapLoading(false);
            }
        };

        fetchInitialLocations();
        return () => { cancelled = true; };
    }, [params.riderId]);

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
                if (stopTracking.current) return;
                if (!location) {
                    setRiderLiveLocation(null);
                    return;
                }
                lastUpdateTimestamp.current = Date.now(); // P2: stale data tracking
                setRiderLiveLocation({
                    lat: location.lat,
                    lng: location.lng,
                    lastUpdated: location.lastUpdated || Date.now()
                });
            });
        }

        // EC-32: Monitor cancellation
        const unsubscribeCancellation = subscribeToCancellation(deliveryId, (state) => {
            // Only consider it cancelled if the state exists AND is marked as cancelled
            if (state && state.cancelled) {
                setCancellation(state);
            } else {
                setCancellation(null);
            }
        });

        return () => {
            unsubscribeDelivery();
            unsubscribeRiderLocation();
            unsubscribeCancellation();
        };
    }, [MAPBOX_TOKEN, deliveryId, params.riderId, navigation]);

    // Box-dependent subscriptions (separate to avoid tearing down delivery/rider subs)
    useEffect(() => {
        if (!delivery?.box_id) return;

        const unsubscribeDisplay = subscribeToDisplay(delivery.box_id, (displayState) => {
            if (displayState) {
                setDisplayStatus(displayState.status);
            }
        });

        const unsubscribeBox = subscribeToBoxLocation(delivery.box_id, (location) => {
            if (stopTracking.current) return;
            if (location) {
                lastUpdateTimestamp.current = Date.now(); // P2: stale data tracking
                setBoxLiveLocation({
                    lat: location.lat,
                    lng: location.lng,
                    lastUpdated: location.lastUpdated || Date.now()
                });
            }
        });

        return () => {
            unsubscribeDisplay();
            unsubscribeBox();
        };
    }, [delivery?.box_id]);

    useEffect(() => {
        if (!delivery?.rider_id) {
            return;
        }

        return subscribeToRiderLocation(delivery.rider_id, (location) => {
            if (stopTracking.current) return;
            if (!location) {
                setRiderLiveLocation(null);
                return;
            }
            lastUpdateTimestamp.current = Date.now(); // P2: stale data tracking
            setRiderLiveLocation({
                lat: location.lat,
                lng: location.lng,
                lastUpdated: location.lastUpdated || Date.now()
            });
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

        const baseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';
        const url = `${baseUrl}/track/${token}`;
        await Share.share({
            message: `Track your Parcel-Safe delivery: ${url}`,
            url,
        });
    };

    const canCancelResult = canCustomerCancel(deliveryStatus);

    // EC-SMART-ROUTE: Efficient Route Fetching
    const fetchAndSetRoute = async (startLat: number, startLng: number, endLat: number, endLng: number) => {
        if (!MAPBOX_TOKEN) return;
        try {
            const response = await fetch(
                `https://api.mapbox.com/directions/v5/mapbox/driving/${startLng},${startLat};${endLng},${endLat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`
            );
            const json = await response.json();
            if (json.routes && json.routes.length > 0) {
                const route = json.routes[0].geometry.coordinates;
                setRouteCoordinates(route);
                recalcCount.current += 1;

                // Update ETA and Speed
                const durationSeconds = json.routes[0].duration;
                const distanceMeters = json.routes[0].distance;

                if (durationSeconds > 0) {
                    routeAverageSpeed.current = distanceMeters / durationSeconds;
                    setEta(smoothEta(Math.ceil(durationSeconds / 60)));
                    setDistanceToTarget(distanceMeters / 1000); // Convert m → km
                }
            }
        } catch (error) {
            console.error('Error fetching route:', error);
        }
    };

    // Initial Route Fetch
    useEffect(() => {
        if (!riderMarkerLocation.latitude || !routeTarget.latitude || !MAPBOX_TOKEN) return;
        // Only fetch initial route if we don't have one yet
        if (!routeCoordinates) {
            fetchAndSetRoute(riderMarkerLocation.latitude, riderMarkerLocation.longitude, routeTarget.latitude, routeTarget.longitude);
        }
    }, [routeTarget.latitude, routeTarget.longitude, riderMarkerLocation.latitude, MAPBOX_TOKEN]);

    // EC-SMART-ROUTE: Off-Route Detection & Recalculation
    useEffect(() => {
        if (!riderLiveLocation || !routeCoordinates || routeCoordinates.length < 2) return;

        const checkRoute = async () => {
            try {
                const { lat, lng } = riderLiveLocation;

                // 1. Calculate Distance to current target (pickup or dropoff)
                const distToDest = distanceTurf(
                    point([lng, lat]),
                    point([routeTarget.longitude, routeTarget.latitude]),
                    { units: 'kilometers' }
                );

                // Update distance to target for UI display
                setDistanceToTarget(distToDest);

                // 2. Check if Off-Route
                if (!routeCoordinates || routeCoordinates.length < 2) return;

                const fullRouteLine = lineString(routeCoordinates);
                const riderPoint = point([lng, lat]);
                const snapped = nearestPointOnLine(fullRouteLine, riderPoint);
                const distFromRoute = distanceTurf(riderPoint, snapped, { units: 'kilometers' });

                if (distFromRoute > OFF_ROUTE_THRESHOLD_KM) {
                    // Rider is Off-Route
                    consecutiveOffRouteCount.current += 1;

                    if (
                        !isRecalculating.current &&
                        consecutiveOffRouteCount.current >= CONSECUTIVE_OFF_ROUTE_REQUIRED &&
                        recalcCount.current < MAX_RECALCS &&
                        distToDest > MIN_DIST_TO_RECALC_KM
                    ) {
                        const now = Date.now();
                        // Check Cooldown
                        if (now - lastRecalcTimestamp.current > RECALC_COOLDOWN_MS) {
                            console.log("Rider is off route (Mobile)! Recalculating...");
                            isRecalculating.current = true;
                            lastRecalcTimestamp.current = now;
                            consecutiveOffRouteCount.current = 0;

                            await fetchAndSetRoute(lat, lng, routeTarget.latitude, routeTarget.longitude);
                            isRecalculating.current = false;
                        }
                    }
                } else {
                    // On Route - Reset counter
                    consecutiveOffRouteCount.current = 0;

                    // Update ETA using dynamic slicing (Web logic)
                    try {
                        const startPoint = point(routeCoordinates[0]);
                        const endPoint = point(routeCoordinates[routeCoordinates.length - 1]);
                        const sliced = lineSlice(snapped, endPoint, fullRouteLine);
                        const slicedDistanceKm = length(sliced, { units: 'kilometers' });

                        // P1: Compute completed (traveled) segment
                        try {
                            const completedSlice = lineSlice(startPoint, snapped, fullRouteLine);
                            const completedCoords = (completedSlice as any).geometry?.coordinates;
                            if (completedCoords && completedCoords.length > 1) {
                                setCompletedRouteCoords(completedCoords);
                            }
                        } catch { /* ignore slice errors for completed segment */ }

                        // Calculate ETA based on route's average speed
                        const distanceMeters = slicedDistanceKm * 1000;
                        const estimatedSeconds = distanceMeters / routeAverageSpeed.current;
                        setEta(smoothEta(Math.ceil(estimatedSeconds / 60)));
                    } catch (err) {
                        // Fallback to simple distance if slicing fails
                        const estimatedSeconds = (distToDest * 1000) / routeAverageSpeed.current;
                        setEta(smoothEta(Math.ceil(estimatedSeconds / 60)));
                    }
                }
            } catch (err) {
                console.warn('Turf routing calculation error:', err);
                // Fallback to direct distance if Turf crashes to avoid blank white screen
                const distToDestFallback = Math.sqrt(
                    Math.pow(riderLiveLocation.lat - routeTarget.latitude, 2) +
                    Math.pow(riderLiveLocation.lng - routeTarget.longitude, 2)
                ) * 111; // Approx km
                setDistanceToTarget(distToDestFallback);
            }
        };

        checkRoute();

    }, [riderLiveLocation, routeTarget.latitude, routeTarget.longitude]);

    // Two-Phase: Refetch route when the phase transitions (pre-pickup → post-pickup)
    useEffect(() => {
        // Skip if no rider location yet or if we're in a terminal state
        if (!riderLiveLocation || isTerminalState) return;

        // When isPickedUp changes, we need a fresh route to the new target
        // Reset route state so the initial fetch effect re-triggers
        setRouteCoordinates(null);
        setCompletedRouteCoords(null); // P1: Clear traveled route on phase change
        recalcCount.current = 0;
        consecutiveOffRouteCount.current = 0;

        console.log(`Phase transition (mobile): ${isPickedUp ? 'now routing to dropoff' : 'routing to pickup'}`);
        fetchAndSetRoute(
            riderLiveLocation.lat,
            riderLiveLocation.lng,
            routeTarget.latitude,
            routeTarget.longitude,
        );
    }, [isPickedUp]); // Only fires when the pickup phase changes

    // Auto-follow rider when not in Route View
    useEffect(() => {
        if (!isRouteView && riderMarkerLocation.latitude && riderMarkerLocation.longitude && !isMapLoading && !stopTracking.current) {
            cameraRef.current?.setCamera({
                centerCoordinate: [riderMarkerLocation.longitude, riderMarkerLocation.latitude],
                animationDuration: 1000,
            });
        }
    }, [riderMarkerLocation.latitude, riderMarkerLocation.longitude, isRouteView, isMapLoading]);

    const routeGeoJson = {
        type: 'Feature' as const,
        geometry: {
            type: 'LineString' as const,
            coordinates: routeCoordinates || [
                [riderMarkerLocation.longitude, riderMarkerLocation.latitude],
                [boxLocation.longitude, boxLocation.latitude],
                [destination.longitude, destination.latitude],
            ],
        },
        properties: {},
    };

    // P1: Completed route visual (traveled segment — dashed gray)
    const completedRouteGeoJson = {
        type: 'Feature' as const,
        geometry: {
            type: 'LineString' as const,
            coordinates: completedRouteCoords || [],
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

    // Generate 50m radius circle for geofence visual
    // Note: radius is in kilometers for turf/circle, so 50m = 0.05km
    const geofenceCircle = circle(
        [destination.longitude, destination.latitude],
        0.05,
        { steps: 64, units: 'kilometers' }
    );

    const pickupGeofenceCircle = circle(
        [pickupLocation.longitude, pickupLocation.latitude],
        0.05,
        { steps: 64, units: 'kilometers' }
    );

    return (
        <View style={styles.container}>
            {/* Loading Overlay — shown until real location is fetched */}
            {isMapLoading && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="large" color="#10b981" />
                    <Text style={styles.loadingTitle}>Locating Rider</Text>
                    <Text style={styles.loadingSubtitle}>Fetching real-time GPS data…</Text>
                </View>
            )}

            {MAPBOX_TOKEN && !isMapLoading ? (
                <MapboxGL.MapView
                    style={styles.map}
                    styleURL={theme.dark ? MapboxGL.StyleURL.Dark : MapboxGL.StyleURL.Light}
                    logoEnabled={false}
                    attributionEnabled={false}
                >
                    <MapboxGL.Camera
                        ref={cameraRef}
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

                    {/* P1: Completed Route (Traveled segment — dashed gray) */}
                    {completedRouteCoords && completedRouteCoords.length > 1 && (
                        <MapboxGL.ShapeSource id="completed-route" shape={completedRouteGeoJson}>
                            <MapboxGL.LineLayer
                                id="completed-route-line"
                                style={{
                                    lineColor: theme.dark ? '#94a3b8' : '#9ca3af',
                                    lineWidth: 4,
                                    lineOpacity: 0.5,
                                    lineDasharray: [2, 2],
                                }}
                            />
                        </MapboxGL.ShapeSource>
                    )}

                    {/* Box Marker - Only show if not picked up yet */}
                    {!isPickedUp && (
                        <MapboxGL.PointAnnotation
                            id="box-marker"
                            coordinate={[pickupLocation.longitude, pickupLocation.latitude]}
                            title="Pickup"
                        >
                            <View style={styles.markerContainer}>
                                <Avatar.Icon size={40} icon="package-variant" style={{ backgroundColor: 'orange' }} />
                            </View>
                        </MapboxGL.PointAnnotation>
                    )}

                    {/* Rider Marker — Always show, uses fallback before live data arrives */}
                    <AnimatedRiderMarker
                        latitude={riderMarkerLocation.latitude}
                        longitude={riderMarkerLocation.longitude}
                    />

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
                    {/* Pickup Geo-fence (Blue) */}
                    <MapboxGL.ShapeSource id="pickup-fence-source" shape={pickupGeofenceCircle}>
                        <MapboxGL.FillLayer
                            id="pickup-fence-fill"
                            style={{
                                fillColor: 'rgba(33, 150, 243, 0.25)', // Blue fill
                            }}
                        />
                        <MapboxGL.LineLayer
                            id="pickup-fence-outline"
                            style={{
                                lineColor: 'rgba(33, 150, 243, 0.8)', // Blue border
                                lineWidth: 2,
                            }}
                        />
                    </MapboxGL.ShapeSource>

                    {/* Dropoff Geo-fence (Green) */}
                    <MapboxGL.ShapeSource id="dropoff-fence-source" shape={geofenceCircle}>
                        <MapboxGL.FillLayer
                            id="dropoff-fence-fill"
                            style={{
                                fillColor: 'rgba(76, 175, 80, 0.25)',
                            }}
                        />
                        <MapboxGL.LineLayer
                            id="dropoff-fence-outline"
                            style={{
                                lineColor: 'rgba(76, 175, 80, 0.8)',
                                lineWidth: 2,
                            }}
                        />
                    </MapboxGL.ShapeSource>
                </MapboxGL.MapView>
            ) : !isMapLoading ? (
                <View style={[styles.map, styles.mapFallback]}>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env
                    </Text>
                </View>
            ) : null}

            {/* Header Actions */}
            <View style={[styles.headerActions, { top: 20 + insets.top }]}>
                <Surface style={[styles.iconButtonSurface, { backgroundColor: theme.colors.surface }]} elevation={2}>
                    <IconButton icon="arrow-left" size={24} iconColor={theme.colors.onSurface} onPress={() => navigation.goBack()} />
                </Surface>
            </View>

            {/* Recenter on Rider Button */}
            <View style={[styles.recenterActions, { top: 20 + insets.top }]}>
                <Surface style={[styles.iconButtonSurface, { backgroundColor: theme.colors.surface }]} elevation={2}>
                    <IconButton
                        icon={isRouteView ? "crosshairs-gps" : "map-search-outline"}
                        size={24}
                        iconColor={theme.colors.primary}
                        onPress={() => {
                            if (isRouteView) {
                                setIsRouteView(false);
                                cameraRef.current?.setCamera({
                                    centerCoordinate: [riderMarkerLocation.longitude, riderMarkerLocation.latitude],
                                    animationDuration: 1000,
                                });
                            } else {
                                setIsRouteView(true);
                                if (routeCoordinates && routeCoordinates.length > 0) {
                                    const lats = routeCoordinates.map(c => c[1]);
                                    const lngs = routeCoordinates.map(c => c[0]);
                                    const minLat = Math.min(...lats);
                                    const maxLat = Math.max(...lats);
                                    const minLng = Math.min(...lngs);
                                    const maxLng = Math.max(...lngs);

                                    cameraRef.current?.fitBounds(
                                        [maxLng, maxLat],
                                        [minLng, minLat],
                                        50,
                                        1000
                                    );
                                } else {
                                    // Fallback if no route coords yet
                                    const maxLng = Math.max(riderMarkerLocation.longitude, destination.longitude);
                                    const maxLat = Math.max(riderMarkerLocation.latitude, destination.latitude);
                                    const minLng = Math.min(riderMarkerLocation.longitude, destination.longitude);
                                    const minLat = Math.min(riderMarkerLocation.latitude, destination.latitude);
                                    cameraRef.current?.fitBounds(
                                        [maxLng, maxLat],
                                        [minLng, minLat],
                                        50,
                                        1000
                                    );
                                }
                            }
                        }}
                    />
                </Surface>
            </View>

            {/* Bottom Sheet Info */}
            <View style={[styles.bottomSheet, { backgroundColor: theme.colors.surface, paddingBottom: 24 + insets.bottom }]}>
                <TouchableOpacity onPress={() => setIsBottomSheetExpanded(!isBottomSheetExpanded)} activeOpacity={0.7}>
                    <View style={[styles.handleBar, { backgroundColor: theme.colors.outline }]} />

                    <View style={styles.statusHeader}>
                        <View style={{ flex: 1 }}>
                            {delivery?.status === 'COMPLETED' ? (
                                <Text variant="titleLarge" style={{ fontWeight: 'bold', color: '#4CAF50' }}>Delivery Complete!</Text>
                            ) : delivery?.status === 'TAMPERED' ? (
                                <Text variant="titleLarge" style={{ fontWeight: 'bold', color: theme.colors.error }}>Security Alert</Text>
                            ) : cancellation && delivery?.status === 'CANCELLED' ? (
                                <Text variant="titleLarge" style={{ fontWeight: 'bold', color: theme.colors.error }}>Delivery Cancelled</Text>
                            ) : (
                                <Text variant="titleLarge" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                                    {delivery?.status === 'ARRIVED' ? 'Rider Arrived' : (isPickedUp ? 'Delivery In Progress' : 'Heading to Pickup')}
                                </Text>
                            )}

                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <MaterialCommunityIcons
                                    name={isBottomSheetExpanded ? "chevron-down" : "chevron-up"}
                                    size={16}
                                    color={theme.colors.onSurfaceVariant}
                                    style={{ marginRight: 6 }}
                                />
                                {delivery?.status === 'COMPLETED' ? (
                                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                        Your package has been delivered successfully.
                                    </Text>
                                ) : delivery?.status === 'TAMPERED' ? (
                                    <Text variant="bodyMedium" style={{ color: theme.colors.error }}>
                                        Tampering was detected on the delivery box. Contact support immediately.
                                    </Text>
                                ) : cancellation && delivery?.status === 'CANCELLED' ? (
                                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                        Reason: {formatCancellationReason(cancellation.reason)}
                                    </Text>
                                ) : (
                                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                        {delivery?.status === 'PICKED_UP' ? 'Package picked up - rider is on the way'
                                            : delivery?.status === 'IN_TRANSIT' ? 'Your package is in transit'
                                                : delivery?.status === 'ARRIVED' ? 'Rider has arrived at your location'
                                                    : delivery?.status === 'ASSIGNED' ? 'Rider is heading to pickup'
                                                        : 'On the way to your location'}
                                    </Text>
                                )}
                            </View>

                            {/* EC-86: Display hint when keypad unavailable */}
                            {displayStatus === 'FAILED' && !isTerminalState && (
                                <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 4 }}>
                                    Keypad display unavailable - use app to unlock
                                </Text>
                            )}
                        </View>
                        {!isTerminalState && !cancellation && (
                            <Surface style={styles.etaBadge} elevation={0}>
                                <Text style={{ color: 'white', fontWeight: 'bold' }}>
                                    {eta !== null ? `${eta} min\n(Arrives ~${dayjs().add(eta, 'minute').format('h:mm A')})` : 'Calculating...'}
                                </Text>
                                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10 }}>
                                    {isPickedUp ? 'to you' : 'to pickup'}
                                </Text>
                                {distanceToTarget !== null && (
                                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2, fontWeight: '600' }}>
                                        {distanceToTarget < 1
                                            ? `${Math.round(distanceToTarget * 1000)}m away`
                                            : `${distanceToTarget.toFixed(1)}km away`}
                                    </Text>
                                )}
                            </Surface>
                        )}
                        {delivery?.status === 'COMPLETED' && (
                            <MaterialCommunityIcons name="check-circle" size={48} color="#4CAF50" />
                        )}
                        {delivery?.status === 'TAMPERED' && (
                            <MaterialCommunityIcons name="alert-circle" size={48} color={theme.colors.error} />
                        )}
                    </View>
                </TouchableOpacity>

                {isBottomSheetExpanded && (
                    <>
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
                                    containerColor={theme.dark ? '#1A237E' : '#E3F2FD'}
                                    iconColor="#2196F3"
                                    size={24}
                                    onPress={() => {
                                        if (!riderDetails.phone) {
                                            Alert.alert('Unavailable', 'Rider phone number is not available yet.');
                                            return;
                                        }
                                        Linking.openURL(`tel:${riderDetails.phone}`);
                                    }}
                                />
                                <IconButton
                                    mode="contained"
                                    icon="message-text"
                                    containerColor={theme.dark ? '#1B5E20' : '#E8F5E9'}
                                    iconColor="#4CAF50"
                                    size={24}
                                    onPress={() => {
                                        if (!riderDetails.phone) {
                                            Alert.alert('Unavailable', 'Rider phone number is not available yet.');
                                            return;
                                        }
                                        Linking.openURL(`sms:${riderDetails.phone}`);
                                    }}
                                />
                            </View>
                        </View>

                        {/* Pickup Photo - Show if available and NOT pending */}
                        {delivery?.pickup_photo_url && delivery?.status !== 'PENDING' && (
                            <View>
                                <Card style={{ marginBottom: 12, borderRadius: 12 }} mode="elevated">
                                    <Card.Title title="Pickup Photo" titleVariant="titleSmall" />
                                    <Card.Cover source={{ uri: delivery.pickup_photo_url }} style={{ height: 180 }} />
                                    {delivery.picked_up_at && (
                                        <Text style={{ padding: 10, textAlign: 'center', color: '#666', fontSize: 12 }}>
                                            Taken on {dayjs.utc(delivery.picked_up_at).tz('Asia/Manila').format('MMM D, YYYY h:mm A')}
                                        </Text>
                                    )}
                                </Card>
                            </View>
                        )}

                        {/* Completed state: show proof photo and go-home buttons */}
                        {delivery?.status === 'COMPLETED' && (
                            <View>
                                {delivery?.proof_photo_url && (
                                    <Card style={{ marginBottom: 12, borderRadius: 12 }} mode="elevated">
                                        <Card.Title title="Proof of Delivery" titleVariant="titleSmall" />
                                        <Card.Cover source={{ uri: delivery.proof_photo_url }} style={{ height: 180 }} />
                                        {delivery.delivered_at && (
                                            <Text style={{ padding: 10, textAlign: 'center', color: '#666', fontSize: 12 }}>
                                                Taken on {dayjs.utc(delivery.delivered_at).tz('Asia/Manila').format('MMM D, YYYY h:mm A')}
                                            </Text>
                                        )}
                                    </Card>
                                )}
                                <Button
                                    mode="contained"
                                    style={styles.viewOtpBtn}
                                    icon="home"
                                    onPress={() => navigation.navigate('Home')}
                                >
                                    Back to Home
                                </Button>
                                <Button
                                    mode="outlined"
                                    style={{ marginTop: 8, borderRadius: 12 }}
                                    icon="history"
                                    onPress={() => navigation.navigate('DeliveryLog')}
                                >
                                    View Delivery History
                                </Button>
                            </View>
                        )}

                        {/* Tampered state: show support button */}
                        {delivery?.status === 'TAMPERED' && (
                            <View>
                                <Button
                                    mode="contained"
                                    style={styles.viewOtpBtn}
                                    icon="headset"
                                    buttonColor={theme.colors.error}
                                    onPress={() => Alert.alert('Support', 'Please contact support at support@parcel-safe.app or call +63 XXX XXX XXXX.')}
                                >
                                    Contact Support
                                </Button>
                                <Button
                                    mode="outlined"
                                    style={{ marginTop: 8, borderRadius: 12 }}
                                    icon="home"
                                    onPress={() => navigation.navigate('Home')}
                                >
                                    Back to Home
                                </Button>
                            </View>
                        )}

                        {/* Active delivery actions - only show when NOT in terminal state */}
                        {!isTerminalState && (
                            <>
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
                            </>
                        )}
                    </>
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
        left: 20,
        zIndex: 10,
    },
    recenterActions: {
        position: 'absolute',
        right: 20,
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
    riderMarkerOuter: {
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
    },
    riderMarkerCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#0f172a',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        zIndex: 2,
    },
    riderMarkerImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    riderDirectionCone: {
        position: 'absolute',
        top: -12,
        width: 0,
        height: 0,
        borderLeftWidth: 6,
        borderRightWidth: 6,
        borderBottomWidth: 10,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: 'rgba(15, 23, 42, 0.9)',
        zIndex: 3,
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
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 100,
        backgroundColor: 'rgba(2, 6, 23, 0.92)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '600',
        marginTop: 16,
        letterSpacing: 0.5,
    },
    loadingSubtitle: {
        color: '#94a3b8',
        fontSize: 13,
        marginTop: 4,
    },
});
