/**
 * EC-32: Return Package Screen
 *
 * Guides the rider through returning a cancelled package to the sender.
 * Flow: NAVIGATING → ARRIVED (geofence) → PHOTO_CAPTURE → UPLOADING → COMPLETED
 * The Return OTP is entered by the sender on the physical box — not on this screen.
 */

import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, ScrollView, Alert, Linking, Platform,
} from 'react-native';
import { Text, Surface, Button, useTheme, Chip, ProgressBar, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { markPackageRetrieved, subscribeToCancellation, CancellationState } from '../../services/cancellationService';
import { uploadReturnPhoto } from '../../services/proofPhotoService';
import {
    subscribeToDeliveryProof,
    subscribeToCamera,
    subscribeToLockEvents,
    subscribeToBoxState,
    LockEvent,
} from '../../services/firebaseClient';

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
    const [distanceM, setDistanceM] = useState<number>(Infinity);
    const [isInsideGeofence, setIsInsideGeofence] = useState(false);
    const [cancellationState, setCancellationState] = useState<CancellationState | null>(null);

    // ── Hardware box state (primary photo source) ──
    const [hardwareSuccess, setHardwareSuccess] = useState(false);
    const [cameraFailed, setCameraFailed] = useState(false);
    const [boxOtpValidated, setBoxOtpValidated] = useState(false);
    const [faceDetected, setFaceDetected] = useState(false);
    const [lockEvent, setLockEvent] = useState<LockEvent | null>(null);

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
        });

        const unsubscribeProof = subscribeToDeliveryProof(deliveryId, (proof) => {
            if (proof?.proof_photo_url) {
                setHardwareSuccess(true);
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
            markPackageRetrieved(deliveryId, boxId).then((ok) => {
                if (ok) {
                    setCurrentStep('COMPLETED');
                } else {
                    setUploadError('Hardware capture succeeded but failed to save. Please use fallback.');
                    setCurrentStep('PHOTO_CAPTURE');
                }
            });
        }
    }, [hardwareSuccess]);

    // Continuous location tracking with Haversine distance to pickup geofence
    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;

        const fetchLocation = async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;

            const location = await Location.getCurrentPositionAsync({});
            const R = 6371000; // Earth radius in metres
            const dLat = (pickupLat - location.coords.latitude) * Math.PI / 180;
            const dLon = (pickupLng - location.coords.longitude) * Math.PI / 180;
            const a =
                Math.sin(dLat / 2) ** 2 +
                Math.cos(location.coords.latitude * Math.PI / 180) *
                Math.cos(pickupLat * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
            const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            setDistanceM(d);
            setIsInsideGeofence(d <= GEOFENCE_RADIUS_M);
        };

        fetchLocation();
        interval = setInterval(fetchLocation, 10000);
        return () => clearInterval(interval);
    }, [pickupLat, pickupLng]);

    const formatDistance = () => {
        if (distanceM === Infinity) return 'Calculating...';
        return distanceM < 1000
            ? `${Math.round(distanceM)} m`
            : `${(distanceM / 1000).toFixed(1)} km`;
    };

    const openNavigation = () => {
        const url = Platform.select({
            ios: `maps://app?daddr=${pickupLat},${pickupLng}`,
            android: `google.navigation:q=${pickupLat},${pickupLng}`,
        });
        if (url) {
            Linking.canOpenURL(url).then((ok) => {
                if (ok) Linking.openURL(url);
                else Alert.alert('Error', 'Unable to open navigation app');
            });
        }
    };

    // ── Step 1 → 2: Geofence-gated arrival confirmation ────────────────────────
    const handleConfirmArrival = () => {
        if (!isInsideGeofence) {
            Alert.alert(
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
            Alert.alert('Permission Required', 'Camera access is needed to capture the sender photo.');
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
            Alert.alert('Photo Required', 'Please capture a fallback photo first.');
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

    const handleDone = () => navigation.navigate('RiderDashboard');

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
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
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

                {/* Destination Card */}
                <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={styles.destinationHeader}>
                        <View style={[styles.markerIcon, { backgroundColor: theme.colors.errorContainer }]}>
                            <MaterialCommunityIcons name="map-marker" size={24} color={theme.colors.error} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>RETURN TO</Text>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>{senderName}</Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{pickupAddress}</Text>
                        </View>
                        <Chip icon="map-marker-distance" compact>{formatDistance()}</Chip>
                    </View>
                    {currentStep === 'NAVIGATING' && (
                        <Button mode="contained" icon="navigation" onPress={openNavigation} style={{ marginTop: 16 }}>
                            Open Navigation
                        </Button>
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
                        style={{ fontWeight: 'bold', marginTop: 4, color: theme.colors.onSurface }}
                    >
                        {deliveryId}
                    </Text>
                </Surface>

                {/* ── Completion Card ── */}
                {currentStep === 'COMPLETED' && (
                    <Surface style={[styles.completedCard, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]} elevation={2}>
                        <MaterialCommunityIcons name="check-decagram" size={64} color="#4CAF50" />
                        <Text variant="headlineSmall" style={{ fontWeight: 'bold', marginTop: 16, color: theme.colors.onSurface }}>
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
});
