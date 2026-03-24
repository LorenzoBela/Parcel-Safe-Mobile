/**
 * EC-32: Return Package Screen
 *
 * Guides the rider through returning a cancelled package to the sender.
 * Flow: NAVIGATING → ARRIVED (geofence) → PHOTO_CAPTURE → UPLOADING → COMPLETED
 * The Return OTP is entered by the sender on the physical box — not on this screen.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    View, StyleSheet, ScrollView, Alert, Linking, Platform, Image,
} from 'react-native';
import { Text, Surface, Button, useTheme, Chip, ProgressBar, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { markPackageRetrieved, subscribeToCancellation, CancellationState } from '../../services/cancellationService';
import { uploadReturnPhoto } from '../../services/proofPhotoService';
import { PremiumAlert } from '../../services/PremiumAlertService';
import {
    subscribeToDeliveryProof,
    subscribeToCamera,
    subscribeToLockEvents,
    subscribeToBoxState,
    LockEvent,
} from '../../services/firebaseClient';
import { useAppTheme } from '../../context/ThemeContext';

// Import MapboxWrapper for geofence preview map
import MapboxGL, { isMapboxNativeAvailable, StyleURL } from '../../components/map/MapboxWrapper';
import AnimatedRiderMarker from '../../components/map/AnimatedRiderMarker';

// ───────────── Distance Formatter ─────────────
function formatDistanceValue(meters: number | null | undefined): string {
    if (meters == null || meters === Infinity) return 'Calculating...';
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)}km`;
    }
    return `${Math.round(meters)}m`;
}

// ───────────── Geofence Circle GeoJSON Builder ─────────────
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

interface RouteParams {
    deliveryId: string;
    returnOtp: string;
    pickupAddress: string;
    senderName: string;
    pickupLat?: number;
    pickupLng?: number;
    boxId?: string;
}

type ReturnStep =
    | 'NAVIGATING'
    | 'ARRIVED'
    | 'PHOTO_CAPTURE'
    | 'UPLOADING'
    | 'COMPLETED';

const GEOFENCE_RADIUS_M = 100;
const STEP_ORDER: ReturnStep[] = [
    'NAVIGATING', 'ARRIVED', 'PHOTO_CAPTURE', 'UPLOADING', 'COMPLETED',
];
const STEP_LABELS = ['Navigate', 'Arrive', 'Photo', 'Upload', 'Done'];

export default function ReturnPackageScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const theme = useTheme();
    const { isDarkMode } = useAppTheme();
    const params = route.params as RouteParams;

    const {
        deliveryId = 'TRK-XXXX-XXXX',
        pickupAddress = 'Unknown Address',
        senderName = 'Sender',
        pickupLat = 14.5995,
        pickupLng = 120.9842,
        boxId = 'BOX_001',
    } = params || {};

    const [currentStep, setCurrentStep] = useState<ReturnStep>('NAVIGATING');
    const [distanceM, setDistanceM] = useState<number | null>(null);
    const [isInsideGeofence, setIsInsideGeofence] = useState(false);
    const [cancellationState, setCancellationState] = useState<CancellationState | null>(null);

    // Rider live position for map preview
    const [riderLat, setRiderLat] = useState(0);
    const [riderLng, setRiderLng] = useState(0);

    // Geofence circle for map preview
    const mapAvailable = isMapboxNativeAvailable;
    const hasRiderPosition = riderLat !== 0 || riderLng !== 0;
    const geofenceCircle = useMemo(
        () => buildGeofenceCircleGeoJSON(pickupLng, pickupLat, GEOFENCE_RADIUS_M),
        [pickupLng, pickupLat]
    );

    // ── Hardware box state (primary photo source) ──
    const [hardwareSuccess, setHardwareSuccess] = useState(false);    const [hardwareProofUrl, setHardwareProofUrl] = useState<string | null>(null);    const [cameraFailed, setCameraFailed] = useState(false);
    const [boxOtpValidated, setBoxOtpValidated] = useState(false);
    const [faceDetected, setFaceDetected] = useState(false);
    const [lockEvent, setLockEvent] = useState<LockEvent | null>(null);
    const [lockAwaitingClose, setLockAwaitingClose] = useState(false);
    const [lockAwaitingCloseNeedsAssist, setLockAwaitingCloseNeedsAssist] = useState(false);
    const [lockCloseConfirmed, setLockCloseConfirmed] = useState(false);

    // Photo capture & upload (fallback only)
    const [photoUri, setPhotoUri] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState('');

    // Subscribe to cancellation state — handles external completion signals
    useEffect(() => {
        const unsubscribe = subscribeToCancellation(deliveryId, (state) => {
            setCancellationState(state);
            if (state?.packageRetrieved) {
                setCurrentStep('COMPLETED');
            }
        });
        return () => unsubscribe();
    }, [deliveryId]);

    // ── Subscribe to box hardware once rider has arrived ───────────────────────────
    // Primary: box captures sender face automatically.
    // Fallback: phone camera only if box camera reports FAILED.
    useEffect(() => {
        if (currentStep !== 'PHOTO_CAPTURE') return;

        const unsubscribeBox = subscribeToBoxState(boxId, (state) => {
            if (state?.status === 'UNLOCKING' || state?.status === 'ACTIVE') {
                setBoxOtpValidated(true);
            }

            const ackCommand = (state as any)?.command_ack_command;
            const ackStatus = (state as any)?.command_ack_status;
            const ackDetails = (state as any)?.command_ack_details;
            const awaitingClose = ackCommand === 'LOCKED' && ackStatus === 'waiting_close';

            setLockAwaitingClose(awaitingClose);
            setLockAwaitingCloseNeedsAssist(awaitingClose && ackDetails === 'reed_open');
            setLockCloseConfirmed(
                ackCommand === 'LOCKED' &&
                ackStatus === 'executed' &&
                ackDetails === 'reed_closed_confirmed'
            );
        });

        const unsubscribeProof = subscribeToDeliveryProof(deliveryId, (proof) => {
            const resolvedReturnProof = proof?.return_photo_url || proof?.proof_photo_url;
            if (resolvedReturnProof) {
                setHardwareSuccess(true);
                setHardwareProofUrl(resolvedReturnProof);
                setBoxOtpValidated(true);
            }
        });

        const unsubscribeCamera = subscribeToCamera(boxId, (camState) => {
            if (camState?.status === 'FAILED' || camState?.status === 'HARDWARE_ERROR') {
                setCameraFailed(true);
            }
        });

        const unsubscribeLock = subscribeToLockEvents(boxId, (event) => {
            if (!event) return;
            setLockEvent(event);
            if (event.otp_valid) setBoxOtpValidated(true);
            if (event.face_detected) setFaceDetected(true);
            if (event.unlocked) {
                setHardwareSuccess(true);
                setBoxOtpValidated(true);
                setFaceDetected(true);
            }
        });

        return () => {
            unsubscribeBox();
            unsubscribeProof();
            unsubscribeCamera();
            unsubscribeLock();
        };
    }, [currentStep, boxId, deliveryId]);

    // Auto-complete when hardware succeeds (box captured photo + solenoid fired)
    useEffect(() => {
        if (hardwareSuccess && currentStep === 'PHOTO_CAPTURE') {
            setCurrentStep('UPLOADING');
            markPackageRetrieved(deliveryId, boxId, hardwareProofUrl || undefined).then((ok) => {
                if (ok) {
                    setCurrentStep('COMPLETED');
                } else {
                    setUploadError('Hardware capture succeeded but failed to save. Please use fallback.');
                    setCurrentStep('PHOTO_CAPTURE');
                }
            });
        }
    }, [hardwareSuccess]);

    // Continuous high-accuracy location tracking (replaces old 10s polling interval)
    useEffect(() => {
        let subscription: Location.LocationSubscription | null = null;

        const startTracking = async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;

            subscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 2000,
                    distanceInterval: 5,
                },
                (location) => {
                    const { latitude, longitude } = location.coords;
                    setRiderLat(latitude);
                    setRiderLng(longitude);

                    // Haversine distance
                    const R = 6371000;
                    const dLat = (pickupLat - latitude) * Math.PI / 180;
                    const dLon = (pickupLng - longitude) * Math.PI / 180;
                    const a =
                        Math.sin(dLat / 2) ** 2 +
                        Math.cos(latitude * Math.PI / 180) *
                        Math.cos(pickupLat * Math.PI / 180) *
                        Math.sin(dLon / 2) ** 2;
                    const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    setDistanceM(Math.round(d));
                    setIsInsideGeofence(d <= GEOFENCE_RADIUS_M);
                }
            );
        };

        startTracking();
        return () => { subscription?.remove(); };
    }, [pickupLat, pickupLng]);

    const formatDistance = () => formatDistanceValue(distanceM);

    const openNavigation = async () => {
        const latLng = `${pickupLat},${pickupLng}`;
        const encodedLabel = encodeURIComponent(pickupAddress || 'Pickup');
        const primaryUrl = Platform.select({
            ios: `maps://app?daddr=${latLng}`,
            android: `google.navigation:q=${latLng}&mode=d`,
        })!;
        const fallbackUrl = Platform.select({
            ios: `https://maps.apple.com/?daddr=${latLng}&q=${encodedLabel}`,
            android: `geo:${latLng}?q=${latLng}(${encodedLabel})`,
        })!;

        try {
            const supported = await Linking.canOpenURL(primaryUrl);
            if (supported) {
                await Linking.openURL(primaryUrl);
            } else {
                await Linking.openURL(fallbackUrl);
            }
        } catch (error) {
            console.error('[ReturnPackage] Failed to open navigation:', error);
            try {
                await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latLng}&travelmode=driving`);
            } catch (browserError) {
                console.error('[ReturnPackage] Browser fallback also failed:', browserError);
                PremiumAlert.alert('Error', 'Unable to open navigation app');
            }
        }
    };

    // ── Step 1 → 2: Geofence-gated arrival confirmation ────────────────────────
    const handleConfirmArrival = () => {
        if (!isInsideGeofence) {
            PremiumAlert.alert(
                'Not Within Range',
                `You must be within ${GEOFENCE_RADIUS_M} m of the pickup location to proceed.\n\nCurrent distance: ${formatDistance()}`,
            );
            return;
        }
        setCurrentStep('PHOTO_CAPTURE');
    };

    // ── Step 2: Fallback phone camera (only when box camera failed) ────────────────
    const handleCapturePhoto = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            PremiumAlert.alert('Permission Required', 'Camera access is needed to capture the sender photo.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.8,
        });
        if (!result.canceled && result.assets?.[0]?.uri) {
            setPhotoUri(result.assets[0].uri);
            setUploadError('');
        }
    };

    // ── Fallback: upload phone photo then complete ──────────────────────────────────
    const handleUploadAndComplete = async () => {
        if (!photoUri) {
            PremiumAlert.alert('Photo Required', 'Please capture a fallback photo first.');
            return;
        }
        setCurrentStep('UPLOADING');
        setUploadError('');

        const upload = await uploadReturnPhoto({ deliveryId, boxId, localUri: photoUri });
        if (!upload.success) {
            setUploadError(upload.error || 'Upload failed. Please retry.');
            setCurrentStep('PHOTO_CAPTURE');
            return;
        }

        const success = await markPackageRetrieved(deliveryId, boxId, upload.url);
        if (success) {
            setCurrentStep('COMPLETED');
        } else {
            setUploadError('Failed to complete the return. Please retry.');
            setCurrentStep('PHOTO_CAPTURE');
        }
    };

    const handleDone = () => navigation.navigate('RiderApp');

    // ── Progress helpers ────────────────────────────────────────────────────────
    const getStepProgress = () => (STEP_ORDER.indexOf(currentStep) + 1) / STEP_ORDER.length;
    const stepColor = (step: ReturnStep) =>
        STEP_ORDER.indexOf(step) <= STEP_ORDER.indexOf(currentStep)
            ? theme.colors.primary
            : theme.colors.outline;

    // ── Render ──────────────────────────────────────────────────────────────────
    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>

                {/* Progress Bar */}
                <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                        RETURN PROGRESS
                    </Text>
                    <ProgressBar
                        progress={getStepProgress()}
                        color={theme.colors.primary}
                        style={{ height: 8, borderRadius: 4 }}
                    />
                    <View style={styles.progressLabels}>
                        {STEP_LABELS.map((label, i) => (
                            <Text key={label} variant="labelSmall" style={{ color: stepColor(STEP_ORDER[i]) }}>
                                {label}
                            </Text>
                        ))}
                    </View>
                </Surface>

                {/* Status Summary Card */}
                <Surface
                    style={[
                        styles.statusCard,
                        {
                            backgroundColor: currentStep === 'COMPLETED'
                                ? (theme.dark ? '#1B5E20' : '#E8F5E9')
                                : (theme.dark ? '#E65100' : '#FFF3E0'),
                        },
                    ]}
                    elevation={2}
                >
                    <MaterialCommunityIcons
                        name={currentStep === 'COMPLETED' ? 'check-circle' : 'backup-restore'}
                        size={48}
                        color={currentStep === 'COMPLETED' ? '#4CAF50' : '#FF9800'}
                    />
                    <View style={styles.statusContent}>
                        <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>
                            {currentStep === 'NAVIGATING' && 'Navigating to Pickup'}
                            {currentStep === 'ARRIVED' && 'Confirm Arrival'}
                            {currentStep === 'PHOTO_CAPTURE' && 'Capture Sender Photo'}
                            {currentStep === 'UPLOADING' && 'Uploading Photo…'}
                            {currentStep === 'COMPLETED' && 'Return Complete!'}
                        </Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                            {currentStep === 'NAVIGATING' && `${formatDistance()} away • Head to the original pickup location`}
                            {currentStep === 'ARRIVED' && (
                                isInsideGeofence
                                    ? `Within range (${formatDistance()}) — tap Confirm Arrival`
                                    : `Still ${formatDistance()} away — must be within ${GEOFENCE_RADIUS_M} m`
                            )}
                            {currentStep === 'PHOTO_CAPTURE' && (
                                hardwareSuccess
                                    ? 'Box captured sender photo ✔  Completing return…'
                                    : lockAwaitingClose
                                        ? (lockAwaitingCloseNeedsAssist
                                            ? 'Lock is waiting for physical close. Close lid fully, press # for brief assist if latch blocks, then close again.'
                                            : 'Lock is waiting for physical close. Close lid fully so reed-close can be confirmed.')
                                        : lockCloseConfirmed
                                            ? 'Lock confirmed by reed-close. Return flow can continue safely.'
                                    : cameraFailed
                                        ? 'Box camera failed — use phone camera as fallback'
                                        : boxOtpValidated && faceDetected
                                            ? 'OTP verified & face detected ✔  Finalising…'
                                            : boxOtpValidated
                                                ? 'OTP verified ✔  Waiting for face detection…'
                                                : lockEvent && !lockEvent.otp_valid
                                                    ? '❌ Wrong OTP — ask sender to check their code and retry'
                                                    : 'Waiting for sender to enter Return OTP on the box…'
                            )}
                            {currentStep === 'UPLOADING' && 'Saving verification photo to secure storage…'}
                            {currentStep === 'COMPLETED' && 'Package returned successfully. Your job is complete.'}
                        </Text>
                    </View>
                </Surface>

                {/* Destination & Map Card */}
                <Surface style={[styles.card, { backgroundColor: theme.colors.surface, padding: 0, overflow: 'hidden' }]} elevation={1}>
                    {/* Map Preview */}
                    <View style={styles.mapContainer}>
                        {mapAvailable && hasRiderPosition ? (
                            <MapboxGL.MapView
                                style={styles.map}
                                logoEnabled={false}
                                compassEnabled={false}
                                scaleBarEnabled={false}
                                attributionEnabled={false}
                                scrollEnabled={false}
                                pitchEnabled={false}
                                rotateEnabled={false}
                                zoomEnabled={false}
                                styleURL={isDarkMode ? StyleURL.Dark : StyleURL.Street}
                            >
                                <MapboxGL.Camera
                                    zoomLevel={16}
                                    centerCoordinate={[pickupLng, pickupLat]}
                                    animationMode="flyTo"
                                />

                                {/* 1. The Geofence Zone Circle */}
                                <MapboxGL.ShapeSource id="geofence-source" shape={geofenceCircle}>
                                    <MapboxGL.FillLayer
                                        id="geofence-fill"
                                        style={{
                                            fillColor: isInsideGeofence ? '#4CAF50' : '#2196F3',
                                            fillOpacity: 0.2,
                                        }}
                                    />
                                    <MapboxGL.LineLayer
                                        id="geofence-line"
                                        style={{
                                            lineColor: isInsideGeofence ? '#4CAF50' : '#2196F3',
                                            lineWidth: 2,
                                        }}
                                    />
                                </MapboxGL.ShapeSource>

                                {/* 2. The Return/Pickup Point Marker */}
                                <MapboxGL.PointAnnotation id="return-marker" coordinate={[pickupLng, pickupLat]}>
                                    <View style={[styles.targetMarker, { backgroundColor: isInsideGeofence ? '#4CAF50' : theme.colors.primary }]}>
                                        <MaterialCommunityIcons name="home-map-marker" size={16} color="white" />
                                    </View>
                                </MapboxGL.PointAnnotation>

                                {/* 3. The Rider's Current Position */}
                                {riderLat != null && riderLng != null && (
                                    <AnimatedRiderMarker
                                        latitude={riderLat}
                                        longitude={riderLng}
                                    />
                                )}
                            </MapboxGL.MapView>
                        ) : (
                            <View style={[styles.mapPlaceholder, { backgroundColor: theme.colors.surfaceVariant }]}>
                                {!hasRiderPosition ? (
                                    <>
                                        <ActivityIndicator size="small" color={theme.colors.primary} />
                                        <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant }}>Acquiring GPS...</Text>
                                    </>
                                ) : (
                                    <MaterialCommunityIcons name="map-marker-off" size={32} color={theme.colors.onSurfaceVariant} />
                                )}
                            </View>
                        )}

                        {/* Floating Distance Badge overlay on the map */}
                        {distanceM !== null && (
                            <View style={[styles.mapDistanceBadge, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
                                <Text variant="labelMedium" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>
                                    {formatDistance()}
                                </Text>
                                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>to zone</Text>
                            </View>
                        )}
                    </View>

                    {/* Destination details below map */}
                    <View style={styles.destinationDetails}>
                        <View style={[styles.markerIcon, { backgroundColor: theme.colors.errorContainer }]}>
                            <MaterialCommunityIcons name="map-marker" size={24} color={theme.colors.error} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>RETURN TO</Text>
                            <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>{senderName}</Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{pickupAddress}</Text>
                        </View>
                    </View>

                    {currentStep === 'NAVIGATING' && (
                        <View style={styles.navigationButtonContainer}>
                            <Button mode="contained" icon="navigation" onPress={openNavigation}>
                                Open Navigation
                            </Button>
                        </View>
                    )}
                </Surface>

                {/* ── Box Verification / Fallback Photo Card ── */}
                {currentStep === 'PHOTO_CAPTURE' && (
                    <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
                        <View style={styles.rowHeader}>
                            <MaterialCommunityIcons
                                name={hardwareSuccess ? 'check-circle' : cameraFailed ? 'camera-off' : 'cctv'}
                                size={20}
                                color={hardwareSuccess ? '#4CAF50' : cameraFailed ? theme.colors.error : theme.colors.primary}
                            />
                            <Text variant="labelLarge" style={{ marginLeft: 8, color: theme.colors.onSurface }}>
                                {cameraFailed ? 'Fallback Photo Required' : 'Box Camera Verification'}
                            </Text>
                        </View>

                        {/* Hardware status indicator */}
                        {!cameraFailed && (
                            <View style={[
                                styles.statusBanner,
                                { backgroundColor: hardwareSuccess ? '#DCFCE7' : boxOtpValidated ? '#DBEAFE' : '#F3F4F6' },
                            ]}>
                                <Text style={{
                                    color: hardwareSuccess ? '#15803d' : boxOtpValidated ? '#1d4ed8' : '#4b5563',
                                    fontSize: 13,
                                }}>
                                    {hardwareSuccess
                                        ? '✅ Box unlocked — sender photo captured automatically'
                                        : lockAwaitingClose
                                            ? (lockAwaitingCloseNeedsAssist
                                                ? '⚠️ Lock pending physical close — close the lid, press # for brief assist if needed, then close again'
                                                : '⚠️ Lock pending physical close — close lid fully so reed-close can be confirmed')
                                            : lockCloseConfirmed
                                                ? '✅ Lock confirmed by reed-close'
                                        : boxOtpValidated && faceDetected
                                            ? '🔓 OTP verified & face detected ✔  Finalising…'
                                            : boxOtpValidated
                                                ? '🔓 OTP verified ✔  Waiting for face detection…'
                                                : lockEvent && !lockEvent?.otp_valid
                                                    ? '❌ Wrong OTP — ask sender to check their code'
                                                    : '🔒 Waiting for sender to enter Return OTP on the box…'}
                                </Text>
                            </View>
                        )}

                        {/* Fallback: only shown when box camera failed */}
                        {cameraFailed && (
                            <>
                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                                    The box camera failed. Use your phone to capture a photo of the sender as proof.
                                </Text>
                                {photoUri ? (
                                    <View style={styles.photoPreview}>
                                        <MaterialCommunityIcons name="check-circle" size={40} color="#4CAF50" />
                                        <Text variant="bodyMedium" style={{ color: '#4CAF50', marginTop: 8 }}>Fallback photo captured</Text>
                                        <Button mode="outlined" icon="camera-retake" onPress={handleCapturePhoto} style={{ marginTop: 12 }} compact>
                                            Retake
                                        </Button>
                                    </View>
                                ) : (
                                    <Button mode="contained" icon="camera" onPress={handleCapturePhoto}>
                                        Capture Fallback Photo
                                    </Button>
                                )}
                            </>
                        )}

                        {!!uploadError && (
                            <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>
                                {uploadError}
                            </Text>
                        )}
                    </Surface>
                )}

                {/* ── Upload Progress ── */}
                {currentStep === 'UPLOADING' && (
                    <Surface style={[styles.card, styles.centered, { backgroundColor: theme.colors.surface }]} elevation={1}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text variant="bodyMedium" style={{ marginTop: 16, color: theme.colors.onSurfaceVariant }}>
                            Uploading photo to secure storage…
                        </Text>
                    </Surface>
                )}

                {/* Tracking ID */}
                <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={styles.trackingRow}>
                        <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.primary} />
                        <Text variant="bodyMedium" style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>Tracking Number:</Text>
                    </View>
                    <Text
                        variant="bodyMedium"
                        numberOfLines={1}
                        ellipsizeMode="middle"
                        style={{ fontFamily: 'Inter_700Bold', marginTop: 4, color: theme.colors.onSurface }}
                    >
                        {deliveryId}
                    </Text>
                </Surface>

                {/* ── Completion Card ── */}
                {currentStep === 'COMPLETED' && (
                    <Surface style={[styles.completedCard, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]} elevation={2}>
                        <MaterialCommunityIcons name="check-decagram" size={64} color="#4CAF50" />
                        <Text variant="headlineSmall" style={{ fontFamily: 'Inter_700Bold', marginTop: 16, color: theme.colors.onSurface }}>
                            Return Successful!
                        </Text>
                        <Text variant="bodyMedium" style={{ textAlign: 'center', marginTop: 8, color: theme.colors.onSurfaceVariant }}>
                            The package has been returned to the sender. Your job is complete.
                        </Text>
                    </Surface>
                )}

            </ScrollView>

            {/* Bottom Actions */}
            <Surface style={[styles.bottomActions, { backgroundColor: theme.colors.surface }]} elevation={4}>
                {currentStep === 'NAVIGATING' && (
                    <Button
                        mode="contained"
                        onPress={handleConfirmArrival}
                        style={{ flex: 1 }}
                        icon={isInsideGeofence ? 'map-marker-check' : 'map-marker-off'}
                        buttonColor={isInsideGeofence ? undefined : theme.colors.error}
                    >
                        {isInsideGeofence ? "I've Arrived" : `Out of Range (${formatDistance()})`}
                    </Button>
                )}

                {currentStep === 'ARRIVED' && (
                    <Button
                        mode="contained"
                        onPress={handleConfirmArrival}
                        style={{ flex: 1 }}
                        icon={isInsideGeofence ? 'map-marker-check' : 'map-marker-off'}
                        buttonColor={isInsideGeofence ? undefined : theme.colors.error}
                    >
                        {isInsideGeofence ? 'Confirm Arrival' : `Out of Range (${formatDistance()})`}
                    </Button>
                )}

                {currentStep === 'PHOTO_CAPTURE' && cameraFailed && photoUri && (
                    <Button
                        mode="contained"
                        onPress={handleUploadAndComplete}
                        style={{ flex: 1 }}
                        icon="upload"
                        buttonColor="#4CAF50"
                    >
                        Upload Fallback &amp; Complete
                    </Button>
                )}

                {currentStep === 'UPLOADING' && (
                    <Button mode="contained" disabled style={{ flex: 1 }} loading>
                        Saving…
                    </Button>
                )}

                {currentStep === 'COMPLETED' && (
                    <Button mode="contained" onPress={handleDone} style={{ flex: 1 }} icon="home">
                        Back to Dashboard
                    </Button>
                )}
            </Surface>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollContent: { padding: 16, paddingBottom: 100 },
    card: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    progressLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    statusCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
    },
    statusContent: { marginLeft: 16, flex: 1 },
    destinationHeader: { flexDirection: 'row', alignItems: 'center' },
    markerIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    statusBanner: {
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
    },
    photoPreview: { alignItems: 'center', paddingVertical: 16 },
    centered: { alignItems: 'center', padding: 32 },
    trackingRow: { flexDirection: 'row', alignItems: 'center' },
    completedCard: {
        padding: 32,
        borderRadius: 16,
        alignItems: 'center',
        marginBottom: 16,
    },
    bottomActions: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        padding: 16,
        paddingBottom: 24,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    mapContainer: {
        height: 160,
        width: '100%',
        backgroundColor: '#e5e5e5',
        position: 'relative',
    },
    map: { flex: 1 },
    mapPlaceholder: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    mapDistanceBadge: {
        position: 'absolute',
        top: 12,
        right: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    targetMarker: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 4,
    },
    riderMarkerContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'white',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#4CAF50',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 4,
    },
    riderMarkerImage: {
        width: 32,
        height: 32,
        borderRadius: 16,
        resizeMode: 'cover',
    },
    destinationDetails: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    navigationButtonContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
});
