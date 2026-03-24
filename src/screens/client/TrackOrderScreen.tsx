import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Alert, Share, Image, Animated, Easing, Linking, ActivityIndicator, Modal, TextInput } from 'react-native';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import { Text, Card, Avatar, Button, IconButton, Surface, useTheme } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { subscribeToDisplay, subscribeToDeliveryProof, subscribeToPhotoAuditLog } from '../../services/firebaseClient';
import { parseUTCString } from '../../utils/date';
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
import { showStatusNotification, updateOngoingNotification } from '../../services/pushNotificationService';
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

const formatSpeed = (speedMs: number | undefined | null) => {
    if (speedMs == null || speedMs < 0) return '0 km/h';
    return `${Math.round(speedMs * 3.6)} km/h`;
};

const PH_TIMEZONE = 'Asia/Manila';

const formatPhDateTime = (value: string | number | null | undefined): string => {
    if (value == null) return 'Unknown time';
    const parsed = parseUTCString(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown time';
    return parsed.toLocaleString('en-US', {
        timeZone: PH_TIMEZONE,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
};

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
        case 'RETURNING':
            return DeliveryStatus.RETURNING;
        case 'RETURNED':
            return DeliveryStatus.RETURNED;
        default:
            return DeliveryStatus.ASSIGNED;
    }
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumAlert } from '../../services/PremiumAlertService';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';

const RiderImage = require('../../../assets/Rider.jpg');
const ArrowHeadImage = require('../../../assets/arrow_head.png');

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
    const [riderLiveLocation, setRiderLiveLocation] = useState<{ lat: number; lng: number; speed?: number; lastUpdated: number } | null>(null);
    const [boxLiveLocation, setBoxLiveLocation] = useState<{ lat: number; lng: number; lastUpdated: number } | null>(null);
    const [routeCoordinates, setRouteCoordinates] = useState<number[][] | null>(null);
    const [completedRouteCoords, setCompletedRouteCoords] = useState<number[][] | null>(null); // P1: traveled route
    const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);
    const [eta, setEta] = useState<number | null>(null);
    const [distanceToTarget, setDistanceToTarget] = useState<number | null>(null); // km
    const [cameraBearing, setCameraBearing] = useState<number>(0);
    const [isMapLoading, setIsMapLoading] = useState(true); // Loading screen until real location is fetched
    const [isRouteView, setIsRouteView] = useState(false);
    const [isNavigationMode, setIsNavigationMode] = useState(false);
    const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(true);
    const [pickupPhotoVersion, setPickupPhotoVersion] = useState<number>(0);
    const [proofPhotoVersion, setProofPhotoVersion] = useState<number>(0);
    const [returnPhotoVersion, setReturnPhotoVersion] = useState<number>(0);

    // Modals & Rating State
    const [showRiderDetailsModal, setShowRiderDetailsModal] = useState(false);
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [ratingScore, setRatingScore] = useState(0);
    const [isRatingSubmitting, setIsRatingSubmitting] = useState(false);
    const [ratingSubmitted, setRatingSubmitted] = useState(false);

    // EC-SMART-ROUTE: Refs for optimization (borrowed from Web)
    const consecutiveOffRouteCount = useRef(0);
    const recalcCount = useRef(0);
    const lastRecalcTimestamp = useRef(0);
    const isRecalculating = useRef(false);
    const routeAverageSpeed = useRef<number>(25 / 3.6); // Default 25km/h in m/s
    const fullOriginalRoute = useRef<number[][] | null>(null); // Stores the FULL original route for slicing
    const MAX_RECALCS = 20;
    const MIN_DIST_TO_RECALC_KM = 0.2; // 200m
    const RECALC_COOLDOWN_MS = 5000; // 5s — faster rerouting (was 8s)
    const CONSECUTIVE_OFF_ROUTE_REQUIRED = 1; // Immediate off-route reaction (was 2)
    const OFF_ROUTE_THRESHOLD_KM = 0.05; // 50m

    // --- Map Matching budget control & local snap refs ---
    const rawPathBuffer = useRef<{ coord: [number, number]; time: number }[]>([]);
    const lastMatchTimeRef = useRef<number>(0);
    const lastMatchedCoordRef = useRef<[number, number] | null>(null);
    const lastMatchedRoadRef = useRef<[number, number][]>([]);
    const lastSnapIndexRef = useRef<number>(0);
    const smoothedCoordsRef = useRef<[number, number] | null>(null);
    const EMA_POSITION_ALPHA = 0.4;
    const deviceSpeedRef = useRef<number>(0);
    const MAP_MATCH_MIN_MOVEMENT_M = 20;
    const MAP_MATCH_MAX_DRIFT_M = 25;
    const [snappedLocation, setSnappedLocation] = useState<{ lat: number; lng: number } | null>(null);

    // Loop/Status Guard Ref
    const stopTracking = useRef(false);
    // Track previous delivery status to detect changes and fire local notifications
    const prevDeliveryStatus = useRef<string | null>(null);

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
    const isTerminalState = ['COMPLETED', 'RETURNED', 'TAMPERED', 'CANCELLED'].includes(delivery?.status || '');

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

    const isPickedUp = ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'RETURNING'].includes(delivery?.status || '');

    const withCacheBust = (url?: string | null, version?: number | string | null): string | undefined => {
        if (!url) return undefined;
        const v = version || Date.now();
        return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(String(v))}`;
    };

    const pickupPhotoUri = useMemo(
        () => withCacheBust(delivery?.pickup_photo_url, pickupPhotoVersion || delivery?.picked_up_at || delivery?.updated_at),
        [delivery?.pickup_photo_url, delivery?.picked_up_at, delivery?.updated_at, pickupPhotoVersion]
    );

    const proofPhotoUri = useMemo(
        () => withCacheBust(delivery?.proof_photo_url, proofPhotoVersion || delivery?.delivered_at || delivery?.updated_at),
        [delivery?.proof_photo_url, delivery?.delivered_at, delivery?.updated_at, proofPhotoVersion]
    );

    const returnPhotoUri = useMemo(
        () => withCacheBust(delivery?.return_photo_url, returnPhotoVersion || delivery?.updated_at),
        [delivery?.return_photo_url, delivery?.updated_at, returnPhotoVersion]
    );

    // Two-Phase Routing: determine the current route target
    const routeTarget = (delivery?.status === 'RETURNING') ? pickupLocation : (isPickedUp ? destination : pickupLocation);

    // EC-FIX: Smart Fallback Logic - Prefer the freshest data source
    const useBoxLocation = useMemo(() => {
        if (!boxLiveLocation) return false;
        if (!riderLiveLocation) return true;
        // If box location is newer than rider location (plus 5s grace period for network jitter), use box
        return boxLiveLocation.lastUpdated > (riderLiveLocation.lastUpdated + 5000);
    }, [boxLiveLocation, riderLiveLocation]);

    const displayLocation = useBoxLocation ? boxLiveLocation : riderLiveLocation;

    const tamperEventTime = useMemo(() => {
        return formatPhDateTime(delivery?.updated_at ?? delivery?.arrived_at ?? delivery?.created_at);
    }, [delivery?.updated_at, delivery?.arrived_at, delivery?.created_at]);

    const tamperWhere = useMemo(() => {
        if (boxLiveLocation?.lat != null && boxLiveLocation?.lng != null) {
            return `${boxLiveLocation.lat.toFixed(5)}, ${boxLiveLocation.lng.toFixed(5)} (box GPS)`;
        }
        if (riderLiveLocation?.lat != null && riderLiveLocation?.lng != null) {
            return `${riderLiveLocation.lat.toFixed(5)}, ${riderLiveLocation.lng.toFixed(5)} (phone fallback)`;
        }
        if (delivery?.dropoff_lat != null && delivery?.dropoff_lng != null) {
            return `${Number(delivery.dropoff_lat).toFixed(5)}, ${Number(delivery.dropoff_lng).toFixed(5)} (drop-off reference)`;
        }
        return 'Unknown Location';
    }, [boxLiveLocation, riderLiveLocation, delivery?.dropoff_lat, delivery?.dropoff_lng]);

    const wasSecurityIncidentCancelled = useMemo(() => {
        const reason = String(delivery?.cancellation_reason || '').toUpperCase();
        return reason.includes('SECURITY_INCIDENT');
    }, [delivery?.cancellation_reason]);

    // --- Map Matching function for mobile ---
    const matchCoordinatesToRoad = async (
        buffer: { coord: [number, number]; time: number }[],
        rawCoord: [number, number]
    ): Promise<[number, number][] | null> => {
        if (buffer.length < 2 || !MAPBOX_TOKEN) return null;
        const payloadPoints = buffer.slice(-25);
        const coordinatesString = payloadPoints.map(p => `${p.coord[0]},${p.coord[1]}`).join(';');
        const radiuses = payloadPoints.map(() => 8).join(';');
        const timestamps = payloadPoints.map(p => Math.round(p.time / 1000)).join(';');
        try {
            const response = await fetch(
                `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinatesString}?radiuses=${radiuses}&timestamps=${timestamps}&tidy=true&geometries=geojson&access_token=${MAPBOX_TOKEN}`
            );
            if (!response.ok) return null;
            const data = await response.json();
            if (data.matchings && data.matchings.length > 0) {
                const matchedGeometry = data.matchings[0].geometry.coordinates as [number, number][];
                if (matchedGeometry.length > 0) {
                    const lastPt = matchedGeometry[matchedGeometry.length - 1];
                    const driftDist = distanceTurf(point(rawCoord), point(lastPt), { units: 'meters' });
                    if (driftDist > MAP_MATCH_MAX_DRIFT_M) return null;
                }
                return matchedGeometry;
            }
        } catch (error) {
            console.warn('[Map Matching Mobile] Failed:', error);
        }
        return null;
    };

    // --- GPS Snap Processing Effect ---
    useEffect(() => {
        if (!displayLocation?.lat || !displayLocation?.lng) return;
        const rawCoord: [number, number] = [displayLocation.lng, displayLocation.lat];

        // Buffer raw GPS with timestamps
        rawPathBuffer.current.push({ coord: rawCoord, time: Date.now() });
        if (rawPathBuffer.current.length > 25) rawPathBuffer.current = rawPathBuffer.current.slice(-25);

        // Estimate speed for adaptive cooldown
        const prev = prevRiderPos.current;
        if (prev) {
            const moveDist = distanceTurf(point([prev.lng, prev.lat]), point(rawCoord), { units: 'meters' });
            const estimatedSpeed = moveDist / 2;
            deviceSpeedRef.current = deviceSpeedRef.current * 0.7 + estimatedSpeed * 0.3;
        }

        // Adaptive cooldown: highway = 3s, normal = 5s, slow = 10s
        let adaptiveCooldown: number;
        if (deviceSpeedRef.current > 15) adaptiveCooldown = 3_000;
        else if (deviceSpeedRef.current > 3) adaptiveCooldown = 5_000;
        else adaptiveCooldown = 10_000;

        const nowMs = Date.now();
        const timeSinceLastMatch = nowMs - lastMatchTimeRef.current;
        const movementSinceMatch = lastMatchedCoordRef.current
            ? distanceTurf(point(lastMatchedCoordRef.current), point(rawCoord), { units: 'meters' })
            : Infinity;

        let snappedLng = displayLocation.lng;
        let snappedLat = displayLocation.lat;

        const processSnap = async () => {
            // Budget-gated API call
            if (rawPathBuffer.current.length >= 2 && timeSinceLastMatch >= adaptiveCooldown && movementSinceMatch >= MAP_MATCH_MIN_MOVEMENT_M) {
                const matchedSegment = await matchCoordinatesToRoad(rawPathBuffer.current, rawCoord);
                lastMatchTimeRef.current = nowMs;
                lastMatchedCoordRef.current = rawCoord;
                if (matchedSegment && matchedSegment.length > 0) {
                    // Extend road forward ~100m
                    const extendedRoad = [...matchedSegment];
                    if (matchedSegment.length >= 2) {
                        const secondLast = matchedSegment[matchedSegment.length - 2];
                        const last = matchedSegment[matchedSegment.length - 1];
                        const dLng = last[0] - secondLast[0];
                        const dLat = last[1] - secondLast[1];
                        for (let i = 1; i <= 3; i++) {
                            extendedRoad.push([last[0] + dLng * i, last[1] + dLat * i]);
                        }
                    }
                    lastMatchedRoadRef.current = extendedRoad;
                    lastSnapIndexRef.current = 0;
                    const lastMatchedPt = matchedSegment[matchedSegment.length - 1];
                    snappedLng = lastMatchedPt[0];
                    snappedLat = lastMatchedPt[1];
                }
            } else {
                // Between calls: locally snap onto stored road geometry
                if (lastMatchedRoadRef.current.length >= 2) {
                    try {
                        const rawPt = point(rawCoord);
                        const road = lineString(lastMatchedRoadRef.current);
                        const snapped = nearestPointOnLine(road, rawPt);
                        const snapDist = (snapped.properties.dist ?? Infinity) * 1000;
                        const snapIdx = snapped.properties.index ?? 0;
                        const prevIdx = lastSnapIndexRef.current;
                        if (snapDist < 30 && snapIdx >= prevIdx - 1) {
                            const [sLng, sLat] = snapped.geometry.coordinates as [number, number];
                            lastSnapIndexRef.current = Math.max(prevIdx, snapIdx);
                            snappedLng = sLng;
                            snappedLat = sLat;
                        }
                    } catch { /* fallback to raw */ }
                }
            }

            // EMA smoothing
            if (smoothedCoordsRef.current) {
                snappedLng = EMA_POSITION_ALPHA * snappedLng + (1 - EMA_POSITION_ALPHA) * smoothedCoordsRef.current[0];
                snappedLat = EMA_POSITION_ALPHA * snappedLat + (1 - EMA_POSITION_ALPHA) * smoothedCoordsRef.current[1];
            }
            smoothedCoordsRef.current = [snappedLng, snappedLat];

            setSnappedLocation({ lat: snappedLat, lng: snappedLng });
        };

        processSnap();
    }, [displayLocation?.lat, displayLocation?.lng]);

    // Fallback coordinates if no live data available
    const fallbackLat = delivery?.pickup_lat ?? params.pickupLat ?? destination.latitude;
    const fallbackLng = delivery?.pickup_lng ?? params.pickupLng ?? destination.longitude;

    const boxLocation = {
        latitude: boxLiveLocation?.lat ?? (isPickedUp ? fallbackLat : fallbackLat), // Logic: if picked up, box moves with rider. If not, box is at pickup.
        longitude: boxLiveLocation?.lng ?? (isPickedUp ? fallbackLng : fallbackLng),
    };

    // The marker displayed as "Rider" on the map — uses snapped location when available
    const hasLiveLocation = !!(displayLocation?.lat && displayLocation?.lng);
    const riderMarkerLocation = {
        latitude: snappedLocation?.lat ?? displayLocation?.lat ?? (isPickedUp ? boxLocation.latitude : fallbackLat),
        longitude: snappedLocation?.lng ?? displayLocation?.lng ?? (isPickedUp ? boxLocation.longitude : fallbackLng),
    };

    // Compute rider bearing from the same coordinates used by the rendered marker.
    // This keeps rotation stable and aligned with what the user actually sees.
    const prevRiderPos = useRef<{ lat: number; lng: number } | null>(null);
    const [riderBearing, setRiderBearing] = useState(0);

    useEffect(() => {
        if (!riderMarkerLocation.latitude || !riderMarkerLocation.longitude) return;

        const prev = prevRiderPos.current;
        if (prev) {
            const from = point([prev.lng, prev.lat]);
            const to = point([riderMarkerLocation.longitude, riderMarkerLocation.latitude]);
            const distKm = distanceTurf(from, to, { units: 'kilometers' });

            // Match web behavior: update heading only when movement is meaningful (> ~5m).
            if (distKm > 0.005) {
                let nextBearing = bearing(from, to);
                if (nextBearing < 0) nextBearing += 360;
                setRiderBearing(nextBearing);
            }
        }

        prevRiderPos.current = {
            lat: riderMarkerLocation.latitude,
            lng: riderMarkerLocation.longitude,
        };
    }, [riderMarkerLocation.latitude, riderMarkerLocation.longitude]);

    const riderDetails = {
        name: riderProfile?.full_name || delivery?.rider_name || (delivery?.status === 'ACCEPTED' ? 'Rider Assigned' : 'Connecting...'),
        vehicle: 'Delivery Rider',
        rating: riderProfile?.rating || 4.8,
        phone: delivery?.rider_phone || '',
        avatar: riderProfile?.avatar_url || 'https://i.pravatar.cc/150?img=11',
    };

    const lastCameraBearingRef = useRef<number>(0);
    const updateCameraBearing = (event: any) => {
        const nextBearingRaw =
            event?.properties?.heading ??
            event?.properties?.bearing ??
            event?.heading ??
            event?.bearing ??
            event?.nativeEvent?.properties?.heading ??
            event?.nativeEvent?.properties?.bearing;

        if (typeof nextBearingRaw !== 'number' || Number.isNaN(nextBearingRaw)) return;

        const normalized = ((nextBearingRaw % 360) + 360) % 360;
        const prev = lastCameraBearingRef.current;
        const diff = Math.abs(normalized - prev);
        const circularDiff = Math.min(diff, 360 - diff);

        if (circularDiff >= 0.5) {
            lastCameraBearingRef.current = normalized;
            setCameraBearing(normalized);
        }
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
                            speed: riderLoc.speed,
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

    const subscriptionStartTime = useRef<number>(0);

    useEffect(() => {
        if (!deliveryId) {
            PremiumAlert.alert('Missing Delivery', 'Unable to open tracking without a valid delivery.', [
                { text: 'Go Back', onPress: () => navigation.goBack() },
            ]);
            return;
        }

        subscriptionStartTime.current = Date.now();

        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }

        const unsubscribeDelivery = subscribeToDelivery(deliveryId, (data) => {
            setDelivery(data);

            // Fire a local notification whenever the delivery status changes.
            // prevDeliveryStatus=null on first call so we skip the initial snapshot.
            if (data?.status && prevDeliveryStatus.current !== null && data.status !== prevDeliveryStatus.current) {
                const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
                    ASSIGNED: { title: '✅ Rider Assigned', body: 'A rider has accepted your order and is on the way!' },
                    PICKED_UP: { title: '📦 Package Picked Up', body: 'Your parcel has been collected by the rider.' },
                    IN_TRANSIT: { title: '🚀 Package in Transit', body: 'Your parcel is on its way to the destination.' },
                    ARRIVED: { title: '🎉 Rider Arrived!', body: 'Your rider has arrived at the destination.' },
                    COMPLETED: { title: '✅ Delivery Complete', body: 'Your package has been delivered successfully!' },
                    CANCELLED: {
                        title: '❌ Delivery Cancelled',
                        body: data?.cancellation_reason === 'SECURITY_INCIDENT_CONFIRMED'
                            ? 'Cancelled after security review. Refund processing has started.'
                            : 'Your delivery has been cancelled.'
                    },
                    TAMPERED: { title: '⚠️ Security Hold', body: 'Security hold is active while investigation is in progress.' },
                    RETURNING: { title: '↩️ Package Returning', body: 'Rider is returning the package to sender.' },
                    RETURNED: { title: '↩️ Package Returned', body: 'Package has been returned to sender.' },
                    FAILED: { title: '⚠️ Delivery Failed', body: 'Delivery attempt failed. Please contact support.' },
                };
                const msg = STATUS_MESSAGES[data.status];
                
                // EC-Fix: Ignore state transitions that happen immediately upon subscription.
                // Firebase offline persistence fires with cached old data first, then 
                // quickly updates with fresh network data. This looks like a state change!
                const isInitialLoadPhase = Date.now() - subscriptionStartTime.current < 3000;
                
                if (msg && !isInitialLoadPhase) {
                    showStatusNotification(msg.title, msg.body, { deliveryId, status: data.status })
                        .catch(console.error);
                    // Keep the ongoing sticky notification in the shade in sync
                    updateOngoingNotification(data.status as any).catch(console.error);
                }
            }
            prevDeliveryStatus.current = data?.status ?? null;
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
                    speed: location.speed,
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

        // Realtime proof-photo updates for tracking UI (no manual refresh).
        const unsubscribeProof = subscribeToDeliveryProof(deliveryId, (proof) => {
            if (!proof) return;
            if (proof.pickup_photo_url) {
                setDelivery(prev => prev ? ({ ...prev, pickup_photo_url: proof.pickup_photo_url }) : prev);
            }
            if (proof.proof_photo_url) {
                setDelivery(prev => prev ? ({ ...prev, proof_photo_url: proof.proof_photo_url }) : prev);
            }
            if (proof.return_photo_url) {
                setDelivery(prev => prev ? ({ ...prev, return_photo_url: proof.return_photo_url }) : prev);
            }
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

        const unsubscribeAudit = subscribeToPhotoAuditLog(deliveryId, (audit) => {
            if (!audit?.latest_photo_url) return;
            setDelivery(prev => prev ? ({ ...prev, proof_photo_url: audit.latest_photo_url }) : prev);
            if (typeof audit.latest_photo_uploaded_at === 'number') {
                setProofPhotoVersion(audit.latest_photo_uploaded_at);
            } else {
                setProofPhotoVersion(Date.now());
            }
        });

        return () => {
            unsubscribeDelivery();
            unsubscribeRiderLocation();
            unsubscribeCancellation();
            unsubscribeProof();
            unsubscribeAudit();
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
                speed: location.speed,
                lastUpdated: location.lastUpdated || Date.now()
            });
        });
    }, [delivery?.rider_id]);

    const copyReturnOtp = async () => {
        if (cancellation?.returnOtp) {
            await Clipboard.setStringAsync(cancellation.returnOtp);
            PremiumAlert.alert('Copied', 'Return OTP copied to clipboard');
        }
    };

    // Customer cancellation handler
    const handleCancellationSubmit = async (reason: CustomerCancellationReason, details: string) => {
        setCancelLoading(true);
        try {
            if (!customerId) {
                PremiumAlert.alert('Authentication Required', 'Please log in again to manage this delivery.');
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
                PremiumAlert.alert('Cancellation Failed', result.error || 'Unable to cancel order');
            }
        } catch (err) {
            PremiumAlert.alert('Error', 'An unexpected error occurred');
        } finally {
            setCancelLoading(false);
        }
    };

    const handleShareTracking = async () => {
        const token = delivery?.share_token || params.shareToken;
        if (!token) {
            PremiumAlert.alert('Share Unavailable', 'Tracking link is not ready yet.');
            return;
        }

        const baseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';
        const url = `${baseUrl}/track/${token}`;
        await Share.share({
            message: `Track your Parcel-Safe delivery: ${url}`,
            url,
        });
    };

    const handleRatingSubmit = async () => {
        if (ratingScore < 1 || ratingScore > 5 || !delivery) return;

        setIsRatingSubmitting(true);
        try {
            // Note: In mobile, we might not use relative paths like '/api/...'.
            // We need to use the full API URL based on EXPO_PUBLIC_TRACKING_WEB_BASE_URL
            const baseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL || 'https://parcel-safe.vercel.app';
            const res = await fetch(`${baseUrl}/api/rate-delivery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    delivery_id: delivery.id,
                    share_token: delivery.share_token,
                    rating: ratingScore
                })
            });

            const data = await res.json();
            if (data.success) {
                setRatingSubmitted(true);
                setShowRatingModal(false);
                setDelivery(prev => prev ? { ...prev, rating: ratingScore } : prev);
                PremiumAlert.alert('Success', 'Thank you for your rating!');
            } else {
                PremiumAlert.alert('Error', data.error || 'Failed to submit rating.');
            }
        } catch (err) {
            console.error('Rating submission error:', err);
            PremiumAlert.alert('Error', 'An unexpected error occurred while submitting your rating.');
        } finally {
            setIsRatingSubmitting(false);
        }
    };

    // Auto-show rating modal when completed
    useEffect(() => {
        if (
            delivery?.status === 'COMPLETED' &&
            delivery.customer_id === customerId &&
            !ratingSubmitted &&
            !delivery.rating // Not rated yet
        ) {
            // Slight delay so the user sees the delivery completed first
            const timer = setTimeout(() => {
                setShowRatingModal(true);
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [delivery?.status, delivery?.customer_id, customerId, ratingSubmitted, delivery?.rating]);

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
                fullOriginalRoute.current = route; // Store full route for slicing
                setRouteCoordinates(route);
                setCompletedRouteCoords(null); // Clear traveled segment on new route
                recalcCount.current += 1;

                // Update ETA and Speed
                const durationSeconds = json.routes[0].duration;
                const distanceMeters = json.routes[0].distance;

                if (durationSeconds > 0) {
                    routeAverageSpeed.current = distanceMeters / durationSeconds;
                    setEta(smoothEta(Math.ceil(durationSeconds / 60)));
                    setDistanceToTarget(distanceMeters / 1000); // Convert m → km (route distance)
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
        // Use the full original route for slicing so we always operate on the complete path
        const routeForSlicing = fullOriginalRoute.current;
        if (!riderLiveLocation || !routeForSlicing || routeForSlicing.length < 2) return;

        const checkRoute = async () => {
            try {
                const { lat, lng } = riderLiveLocation;

                // 1. Calculate straight-line distance to target (fallback only)
                const distToDest = distanceTurf(
                    point([lng, lat]),
                    point([routeTarget.longitude, routeTarget.latitude]),
                    { units: 'kilometers' }
                );

                // 2. Check if Off-Route using the FULL original route
                const fullRouteLine = lineString(routeForSlicing);
                const riderPoint = point([lng, lat]);
                const snapped = nearestPointOnLine(fullRouteLine, riderPoint);
                const distFromRoute = distanceTurf(riderPoint, snapped, { units: 'kilometers' });

                if (distFromRoute > OFF_ROUTE_THRESHOLD_KM) {
                    // Rider is Off-Route — use straight-line as fallback distance
                    setDistanceToTarget(distToDest);
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

                    // Dynamic route slicing: split into remaining + completed segments
                    try {
                        const startPoint = point(routeForSlicing[0]);
                        const endPoint = point(routeForSlicing[routeForSlicing.length - 1]);

                        // Remaining: snapped → end (this becomes the visible route)
                        const remainingSlice = lineSlice(snapped, endPoint, fullRouteLine);
                        const remainingCoords = (remainingSlice as any).geometry?.coordinates;
                        const slicedDistanceKm = length(remainingSlice, { units: 'kilometers' });

                        // Update route to show ONLY remaining segment (instant consumption)
                        if (remainingCoords && remainingCoords.length > 1) {
                            setRouteCoordinates(remainingCoords);
                        }

                        // Completed: start → snapped (dashed gray traveled segment)
                        try {
                            const completedSlice = lineSlice(startPoint, snapped, fullRouteLine);
                            const completedCoords = (completedSlice as any).geometry?.coordinates;
                            if (completedCoords && completedCoords.length > 1) {
                                setCompletedRouteCoords(completedCoords);
                            }
                        } catch { /* ignore slice errors for completed segment */ }

                        // Update distance to ROUTE distance (not straight-line) — matches web
                        setDistanceToTarget(slicedDistanceKm);

                        // Calculate ETA based on route's average speed
                        const distanceMeters = slicedDistanceKm * 1000;
                        const estimatedSeconds = distanceMeters / routeAverageSpeed.current;
                        setEta(smoothEta(Math.ceil(estimatedSeconds / 60)));
                    } catch (err) {
                        // Fallback to straight-line distance if slicing fails
                        setDistanceToTarget(distToDest);
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
                ...(isNavigationMode ? {
                    pitch: 60,
                    zoomLevel: 19,
                    heading: riderBearing
                } : {
                    pitch: 0,
                    zoomLevel: 16 // Fallback standard zoom
                })
            });
        }
    }, [riderMarkerLocation.latitude, riderMarkerLocation.longitude, isRouteView, isNavigationMode, isMapLoading]);

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

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, screenAnim.style]}>
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
                    onCameraChanged={updateCameraBearing}
                    onRegionDidChange={updateCameraBearing}
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
                                lineWidth: 5,
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
                        rotation={riderBearing}
                        mapBearing={cameraBearing}
                        speed={riderLiveLocation?.speed}
                        pathGeometry={lastMatchedRoadRef.current}
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

            {/* Recenter & Navigation on Rider Buttons */}
            <View style={[styles.recenterActions, { top: 20 + insets.top, flexDirection: 'row', gap: 8 }]}>
                {/* Navigation Mode Button */}
                <Surface style={[styles.iconButtonSurface, { backgroundColor: theme.colors.surface }]} elevation={2}>
                    <IconButton
                        icon={isNavigationMode ? "compass-off-outline" : "compass-outline"}
                        size={24}
                        iconColor={isNavigationMode ? theme.colors.error : theme.colors.primary}
                        onPress={() => {
                            if (isNavigationMode) {
                                setIsNavigationMode(false);
                                cameraRef.current?.setCamera({
                                    centerCoordinate: [riderMarkerLocation.longitude, riderMarkerLocation.latitude],
                                    zoomLevel: 16,
                                    pitch: 0,
                                    heading: 0,
                                    animationDuration: 1000,
                                });
                            } else {
                                setIsNavigationMode(true);
                                setIsRouteView(false); // Make them mutually exclusive
                                cameraRef.current?.setCamera({
                                    centerCoordinate: [riderMarkerLocation.longitude, riderMarkerLocation.latitude],
                                    zoomLevel: 19,
                                    pitch: 60,
                                    animationDuration: 1000,
                                });
                            }
                        }}
                    />
                </Surface>
                {/* Recenter / Route View Button */}
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
                                    zoomLevel: 16,
                                    pitch: 0,
                                    heading: 0,
                                    animationDuration: 1000,
                                });
                            } else {
                                setIsRouteView(true);
                                setIsNavigationMode(false); // Mutually exclusive
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
                                <Text variant="titleLarge" style={{ fontFamily: 'Inter_700Bold', color: '#4CAF50' }}>Delivery Complete!</Text>
                            ) : delivery?.status === 'TAMPERED' ? (
                                <Text variant="titleLarge" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.error }}>Security Hold</Text>
                            ) : cancellation && delivery?.status === 'CANCELLED' ? (
                                <Text variant="titleLarge" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.error }}>Delivery Cancelled</Text>
                            ) : (
                                <Text variant="titleLarge" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>
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
                                    <View>
                                        <Text variant="bodyMedium" style={{ color: theme.colors.error }}>
                                            Security Hold is active. We detected a box incident and our team is investigating.
                                        </Text>
                                        <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 4 }}>
                                            When: {tamperEventTime}
                                        </Text>
                                        <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                                            Last known location: {tamperWhere}
                                        </Text>
                                    </View>
                                ) : cancellation && delivery?.status === 'CANCELLED' ? (
                                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                        {wasSecurityIncidentCancelled
                                            ? 'Cancelled after security review. Refund processing is in progress.'
                                            : `Reason: ${formatCancellationReason(cancellation.reason)}`}
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
                                <Text style={{ color: 'white', fontFamily: 'Inter_700Bold' }}>
                                    {eta !== null ? `${eta} min\n(Arrives ~${dayjs().add(eta, 'minute').format('h:mm A')})` : 'Calculating...'}
                                </Text>
                                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10 }}>
                                    {isPickedUp ? 'to you' : 'to pickup'}
                                </Text>
                                {distanceToTarget !== null && (
                                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2, fontFamily: 'Inter_600SemiBold' }}>
                                        {distanceToTarget < 1
                                            ? `${Math.round(distanceToTarget * 1000)}m away`
                                            : `${distanceToTarget.toFixed(1)}km away`}
                                    </Text>
                                )}
                                {riderLiveLocation?.speed != null && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                        <MaterialCommunityIcons name="speedometer" size={12} color="rgba(255,255,255,0.85)" />
                                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: 'Inter_600SemiBold', marginLeft: 4 }}>
                                            {formatSpeed(riderLiveLocation.speed)}
                                        </Text>
                                    </View>
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
                                    <Text style={{ marginLeft: 8, color: theme.colors.onSurface, fontFamily: 'Inter_700Bold' }}>Return Authorization</Text>
                                </View>
                                <Text style={{ marginBottom: 12, color: theme.colors.onSurfaceVariant }}>
                                    Please provide this OTP to the rider to retrieve your package.
                                </Text>

                                <TouchableOpacity onPress={copyReturnOtp} activeOpacity={0.7}>
                                    <Surface style={styles.otpContainer} elevation={2}>
                                        <Text variant="displaySmall" style={{ letterSpacing: 4, fontFamily: 'Inter_700Bold', color: theme.colors.primary }}>
                                            {cancellation.returnOtp}
                                        </Text>
                                        <MaterialCommunityIcons name="content-copy" size={20} color={theme.colors.primary} style={{ position: 'absolute', right: 16 }} />
                                    </Surface>
                                </TouchableOpacity>
                            </Surface>
                        )}

                        <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                        <TouchableOpacity
                            style={styles.riderInfo}
                            activeOpacity={0.7}
                            onPress={() => setShowRiderDetailsModal(true)}
                        >
                            <Avatar.Image size={50} source={{ uri: riderDetails.avatar }} />
                            <View style={{ flex: 1, marginLeft: 16 }}>
                                <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>{riderDetails.name}</Text>
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
                                            PremiumAlert.alert('Unavailable', 'Rider phone number is not available yet.');
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
                                            PremiumAlert.alert('Unavailable', 'Rider phone number is not available yet.');
                                            return;
                                        }
                                        Linking.openURL(`sms:${riderDetails.phone}`);
                                    }}
                                />
                            </View>
                        </TouchableOpacity>

                        {/* Pickup Photo - Show if available and NOT pending */}
                        {pickupPhotoUri && delivery?.status !== 'PENDING' && (
                            <View>
                                <Card style={{ marginBottom: 12, borderRadius: 12 }} mode="elevated">
                                    <Card.Title title="Pickup Photo" titleVariant="titleSmall" />
                                    <Card.Cover source={{ uri: pickupPhotoUri }} style={{ height: 180 }} />
                                    {delivery.picked_up_at && (
                                        <Text style={{ padding: 10, textAlign: 'center', color: '#666', fontSize: 12 }}>
                                            Taken on {dayjs.utc(parseUTCString(delivery.picked_up_at)).add(8, 'hour').format('MMM D, YYYY h:mm A')}
                                        </Text>
                                    )}
                                </Card>
                            </View>
                        )}

                        {/* Completed state: show proof photo and go-home buttons */}
                        {delivery?.status === 'COMPLETED' && (
                            <View>
                                {proofPhotoUri && (
                                    <Card style={{ marginBottom: 12, borderRadius: 12 }} mode="elevated">
                                        <Card.Title title="Proof of Delivery" titleVariant="titleSmall" />
                                        <Card.Cover source={{ uri: proofPhotoUri }} style={{ height: 180 }} />
                                        {delivery.delivered_at && (
                                            <Text style={{ padding: 10, textAlign: 'center', color: '#666', fontSize: 12 }}>
                                                Taken on {dayjs.utc(parseUTCString(delivery.delivered_at)).add(8, 'hour').format('MMM D, YYYY h:mm A')}
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

                        {delivery?.status === 'RETURNED' && returnPhotoUri && (
                            <View>
                                <Card style={{ marginBottom: 12, borderRadius: 12 }} mode="elevated">
                                    <Card.Title title="Return Verification" titleVariant="titleSmall" />
                                    <Card.Cover source={{ uri: returnPhotoUri }} style={{ height: 180 }} />
                                    <Text style={{ padding: 10, textAlign: 'center', color: '#666', fontSize: 12 }}>
                                        Sender return proof captured
                                    </Text>
                                </Card>
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
                                    onPress={() => PremiumAlert.alert('Support', 'Please contact support at support@parcel-safe.app or call +63 XXX XXX XXXX.')}
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

                                {/* OTP is only relevant once rider has arrived at the drop-off location */}
                                {!cancellation && delivery?.status === 'ARRIVED' && (
                                    <Button
                                        mode="contained"
                                        style={styles.viewOtpBtn}
                                        icon="lock-open"
                                        onPress={() => {
                                            const boxId = delivery?.box_id;
                                            if (!boxId) {
                                                return;
                                            }
                                            navigation.navigate('OTP', { boxId, deliveryId: delivery?.id });
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

            {/* Rider Details Modal */}
            <Modal
                visible={showRiderDetailsModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowRiderDetailsModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <Surface style={[styles.modalContent, { backgroundColor: theme.colors.surface }]} elevation={5}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>Rider Details</Text>
                            <IconButton
                                icon="close"
                                size={24}
                                onPress={() => setShowRiderDetailsModal(false)}
                                iconColor={theme.colors.onSurfaceVariant}
                            />
                        </View>

                        <View style={{ alignItems: 'center', marginVertical: 16 }}>
                            <Avatar.Image size={80} source={{ uri: riderDetails.avatar }} />
                            <Text variant="titleLarge" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface, marginTop: 12 }}>
                                {riderDetails.name}
                            </Text>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                {riderDetails.phone}
                            </Text>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                            <Surface style={[styles.modalStatCard, { backgroundColor: theme.dark ? '#1A237E' : '#E3F2FD' }]} elevation={0}>
                                <Text variant="labelMedium" style={{ color: '#2196F3' }}>RATING</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                    <Text variant="displaySmall" style={{ fontFamily: 'Inter_700Bold', color: '#2196F3', marginRight: 4 }}>
                                        {riderDetails.rating}
                                    </Text>
                                    <MaterialCommunityIcons name="star" size={24} color="#FFC107" />
                                </View>
                            </Surface>

                            <Surface style={[styles.modalStatCard, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]} elevation={0}>
                                <Text variant="labelMedium" style={{ color: '#4CAF50' }}>DELIVERIES</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                    <Text variant="displaySmall" style={{ fontFamily: 'Inter_700Bold', color: '#4CAF50', marginRight: 4 }}>
                                        {riderProfile?.totalDeliveries || 0}
                                    </Text>
                                    <MaterialCommunityIcons name="bike" size={24} color="#4CAF50" />
                                </View>
                            </Surface>
                        </View>
                    </Surface>
                </View>
            </Modal>

            {/* Rating Modal */}
            <Modal
                visible={showRatingModal}
                transparent
                animationType="slide"
                onRequestClose={() => {
                    // Do nothing - ensure they click a button to skip or rate
                }}
            >
                <View style={styles.modalOverlay}>
                    <View style={{ flex: 1 }} />
                    <Surface style={[styles.ratingModalContent, { backgroundColor: theme.colors.surface }]} elevation={5}>
                        <View style={{ alignItems: 'center', marginBottom: 24 }}>
                            <View style={{
                                width: 80, height: 80, borderRadius: 40,
                                backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center',
                                marginBottom: 16,
                                shadowColor: '#10B981', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
                                elevation: 8
                            }}>
                                <MaterialCommunityIcons name="check" size={48} color="white" />
                            </View>
                            <Text variant="headlineSmall" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface, textAlign: 'center' }}>
                                Delivery Complete!
                            </Text>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }}>
                                How was your experience with {riderDetails.name}?
                            </Text>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 32 }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                                <TouchableOpacity
                                    key={star}
                                    onPress={() => setRatingScore(star)}
                                    activeOpacity={0.7}
                                    style={{ padding: 4 }}
                                >
                                    <MaterialCommunityIcons
                                        name={ratingScore >= star ? "star" : "star-outline"}
                                        size={48}
                                        color={ratingScore >= star ? "#FFC107" : theme.colors.onSurfaceVariant}
                                        style={ratingScore >= star ? {
                                            textShadowColor: 'rgba(255, 193, 7, 0.4)',
                                            textShadowOffset: { width: 0, height: 2 },
                                            textShadowRadius: 8,
                                        } : undefined}
                                    />
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Button
                            mode="contained"
                            onPress={handleRatingSubmit}
                            disabled={ratingScore === 0 || isRatingSubmitting}
                            loading={isRatingSubmitting}
                            style={{ paddingVertical: 8, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
                            buttonColor={theme.colors.onSurface}
                            textColor={theme.colors.surface}
                        >
                            <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold' }}>Submit Rating</Text>
                        </Button>

                        <Button
                            mode="text"
                            onPress={() => {
                                setRatingSubmitted(true);
                                setShowRatingModal(false);
                            }}
                            textColor={theme.colors.onSurfaceVariant}
                            style={{ marginTop: 16 }}
                        >
                            Skip for now
                        </Button>
                    </Surface>
                </View>
            </Modal>
        </Animated.View>
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
        fontFamily: 'Inter_600SemiBold',
        marginTop: 16,
        letterSpacing: 0.5,
    },
    loadingSubtitle: {
        color: '#94a3b8',
        fontSize: 13,
        marginTop: 4,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        padding: 24,
    },
    modalContent: {
        borderRadius: 24,
        padding: 24,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
    },
    modalStatCard: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
    },
    ratingModalContent: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 32,
        paddingBottom: 48,
    },
});
