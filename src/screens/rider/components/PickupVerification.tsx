import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Linking, Platform, Image } from 'react-native';
import { Text, Card, Button, IconButton, Switch } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadPickupPhoto } from '../../../services/proofPhotoService';
import { updateDeliveryStatus } from '../../../services/riderMatchingService';
import { PremiumAlert } from '../../../services/PremiumAlertService';
import { useAppTheme } from '../../../context/ThemeContext';
import { subscribeToBoxState, BoxState, updateBoxState } from '../../../services/firebaseClient';
import { enqueueBoxCommand, flushQueuedBoxCommands, markLatestSentCommandAcked } from '../../../services/boxCommandQueueService';

// Import MapboxWrapper for geofence preview map
import MapboxGL, { isMapboxNativeAvailable, StyleURL } from '../../../components/map/MapboxWrapper';
import AnimatedRiderMarker from '../../../components/map/AnimatedRiderMarker';

// Same rider image used across all tracking pages (AnimatedRiderMarker)
const RiderImage = require('../../../../assets/Rider.jpg');

// ───────────── Distance Formatter ─────────────
function formatDistance(meters: number | null | undefined): string {
    if (meters == null) return '';
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)}km`;
    }
    return `${meters}m`;
}

interface PickupVerificationProps {
    deliveryId: string;
    boxId: string;
    targetAddress: string;
    targetLat: number;
    targetLng: number;
    senderName?: string;
    senderPhone?: string;
    deliveryNotes?: string;

    isInsideGeoFence: boolean;
    distanceMeters: number | null;
    isPhoneInside: boolean;
    isBoxInside: boolean;
    isBoxOffline: boolean;
    isPhoneOnlyFallback?: boolean;

    // Rider's current GPS position for map preview
    currentLat: number;
    currentLng: number;
    currentHeading?: number | null;
    geofenceRadiusM?: number;

    onPickupConfirmed: () => void;
    onNavigate: () => void;
    deliveryOtp?: string;
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
        // Approximate offset in degrees
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

export default function PickupVerification({
    deliveryId,
    boxId,
    targetAddress,
    targetLat,
    targetLng,
    senderName,
    senderPhone,
    deliveryNotes,
    isInsideGeoFence,
    distanceMeters,
    isPhoneInside,
    isBoxInside,
    isBoxOffline,
    isPhoneOnlyFallback = false,
    currentLat,
    currentLng,
    currentHeading = null,
    geofenceRadiusM = 50,
    onPickupConfirmed,
    onNavigate,
    deliveryOtp,
}: PickupVerificationProps) {
    const { isDarkMode } = useAppTheme();
    const c = {
        card: isDarkMode ? '#1e1e1e' : '#ffffff',
        text: isDarkMode ? '#ffffff' : '#333333',
        textTitle: isDarkMode ? '#ffffff' : '#1a1a1a',
        textLabel: isDarkMode ? '#a1a1aa' : '#888888',
        border: isDarkMode ? '#27272a' : '#E5E7EB',
        borderHard: isDarkMode ? '#3f3f46' : '#f0f0f0',
        badgeBg: isDarkMode ? '#27272a' : '#F3F4F6',
        badgeText: isDarkMode ? '#d4d4d8' : '#4B5563',
        successBg: isDarkMode ? '#064e3b' : '#DCFCE7',
        successText: isDarkMode ? '#34d399' : '#15803d',
        errorBg: isDarkMode ? '#7f1d1d' : '#FEE2E2',
        errorText: isDarkMode ? '#f87171' : '#B91C1C',
        hintText: isDarkMode ? '#a1a1aa' : '#6b7280',
        warningBg: isDarkMode ? '#78350f' : '#FEF3C7',
        warningText: isDarkMode ? '#fbbf24' : '#92400E',
    };

    const [isLoading, setIsLoading] = useState(false);
    const [pickupPhotoUri, setPickupPhotoUri] = useState<string | null>(null);
    const [uploadFailed, setUploadFailed] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    // ── Box Control State ──
    const [boxState, setBoxState] = useState<BoxState | null>(null);
    const [manualModeEnabled, setManualModeEnabled] = useState(false);
    const [manualCommandLoading, setManualCommandLoading] = useState(false);

    // ── Subscribe to box state for lock status ──
    useEffect(() => {
        if (!boxId) return;
        const unsub = subscribeToBoxState(boxId, (state) => setBoxState(state));
        return unsub;
    }, [boxId]);

    // ── Derived box control flags ──
    const canManualControl = manualModeEnabled && isInsideGeoFence;
    const lockAckCommand = (boxState as any)?.command_ack_command;
    const lockAckStatus = (boxState as any)?.command_ack_status;
    const lockAckDetails = (boxState as any)?.command_ack_details;
    const lockAwaitingClose = lockAckCommand === 'LOCKED' && lockAckStatus === 'waiting_close';
    const lockAwaitingCloseNeedsAssist = lockAwaitingClose && lockAckDetails === 'reed_open';
    const lockCloseConfirmed = lockAckCommand === 'LOCKED' && lockAckStatus === 'executed' && lockAckDetails === 'reed_closed_confirmed';

    // ── Manual box command handler ──
    const handleManualBoxCommand = useCallback(async (command: 'UNLOCKING' | 'LOCKED') => {
        if (!canManualControl) {
            PremiumAlert.alert('Control Locked', 'Enter the pickup geofence and enable manual mode first.');
            return;
        }
        setManualCommandLoading(true);
        try {
            const requestId = `pickup_manual_${Date.now()}`;
            await enqueueBoxCommand({ deliveryId, boxId, command, requestId, requestedBy: 'mobile_rider_pickup_manual' });
            const flushResult = await flushQueuedBoxCommands(async (item) => {
                await updateBoxState(item.boxId, { command: item.command, command_request_id: item.requestId, command_requested_by: item.requestedBy } as any);
            }, 10);
            PremiumAlert.alert('Command Sent', flushResult.sent > 0
                ? (command === 'UNLOCKING' ? 'Unlock command sent to box.' : 'Lock command sent to box.')
                : 'Queued locally. Will send when connectivity stabilizes.');
        } catch {
            PremiumAlert.alert('Command Failed', 'Could not send command. Please try again.');
        } finally {
            setManualCommandLoading(false);
        }
    }, [canManualControl, deliveryId, boxId]);

    // ── Retry upload handler ──
    const handleRetryUpload = useCallback(async () => {
        if (!pickupPhotoUri) return;
        setIsLoading(true);
        setUploadFailed(false);
        setUploadError(null);
        try {
            const result = await uploadPickupPhoto({ deliveryId, boxId, localUri: pickupPhotoUri });
            if (!result.success) {
                setUploadFailed(true);
                setUploadError(result.error || 'Unknown error');
                PremiumAlert.alert('Retry Failed', `Still failed: ${result.error || 'Unknown error'}`);
            } else {
                setUploadFailed(false);
                PremiumAlert.alert('Upload Success', 'Pickup photo uploaded. You can now swipe to confirm.');
            }
        } catch {
            setUploadFailed(true);
            setUploadError('Network error');
        } finally {
            setIsLoading(false);
        }
    }, [pickupPhotoUri, deliveryId, boxId]);

    const mapAvailable = isMapboxNativeAvailable();
    const hasRiderPosition = currentLat !== 0 || currentLng !== 0;

    // Memoize geofence circle GeoJSON to avoid recalculating on every render
    const geofenceCircle = useMemo(
        () => buildGeofenceCircleGeoJSON(targetLng, targetLat, geofenceRadiusM),
        [targetLat, targetLng, geofenceRadiusM]
    );

    const handleCapturePickupPhoto = async () => {
        try {
            let permissionResult;
            try {
                permissionResult = await ImagePicker.requestCameraPermissionsAsync();
            } catch (permErr) {
                console.error('Camera permission request failed', permErr);
                PremiumAlert.alert('Permission Error', `Camera permission request failed: ${String(permErr)}`);
                return;
            }

            const status = (permissionResult && (permissionResult.status || permissionResult.granted ? permissionResult.status ?? (permissionResult.granted ? 'granted' : 'denied') : undefined)) || 'denied';
            if (status !== 'granted') {
                PremiumAlert.alert('Permission Required', 'Camera permission is required to take pickup photos.');
                return;
            }

            let result;
            try {
                result = await ImagePicker.launchCameraAsync({
                    mediaTypes: ['images'],
                    quality: 0.7,
                    allowsEditing: false,
                });
            } catch (launchErr) {
                console.error('launchCameraAsync failed', launchErr);
                PremiumAlert.alert('Camera Error', `Unable to open camera: ${String(launchErr)}`);
                return;
            }

            if (!result.canceled && result.assets?.[0]?.uri) {
                setPickupPhotoUri(result.assets[0].uri);
            }
        } catch (e) {
            console.error('Unexpected camera error', e);
            PremiumAlert.alert('Camera Error', `Unable to capture pickup photo right now: ${String(e)}`);
        }
    };

    const handlePickupSwipe = async () => {
        if (!isInsideGeoFence) {
            PremiumAlert.alert('Location Required', 'Move inside the pickup geofence before confirming pickup.');
            return;
        }

        if (!pickupPhotoUri) {
            PremiumAlert.alert('Photo Required', 'Please capture a pickup photo before confirming pickup.');
            return;
        }

        setIsLoading(true);
        try {
            setUploadFailed(false);
            setUploadError(null);

            const uploadResult = await uploadPickupPhoto({
                deliveryId,
                boxId,
                localUri: pickupPhotoUri,
            });

            if (!uploadResult.success) {
                setUploadFailed(true);
                setUploadError(uploadResult.error || 'Unknown error');
                PremiumAlert.alert(
                    'Upload Failed',
                    `Pickup photo upload failed: ${uploadResult.error || 'Unknown error'}. Tap "Retry Upload" to try again.`
                );
                return;
            }

            const success = await updateDeliveryStatus(deliveryId, 'IN_TRANSIT', {
                picked_up_at: Date.now(),
                in_transit_at: Date.now(),
                pickup_photo_url: uploadResult.url || null,
                pickup_photo_uploaded_at: Date.now(),
            });

            if (!success) {
                PremiumAlert.alert('Action Failed', 'Unable to confirm pickup right now.');
                return;
            }

            PremiumAlert.alert('Pickup Confirmed', 'Package marked as picked up.');
            onPickupConfirmed();
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            {/* Header Status Block */}
            <View style={styles.modernHeader}>
                <View style={[styles.modernHeaderIcon, { backgroundColor: isInsideGeoFence ? c.successBg : c.errorBg }]}>
                    <Text style={{ fontSize: 24 }}>{isInsideGeoFence ? '📍' : '🧭'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                    <Text style={[styles.modernHeaderTitle, { color: c.textTitle }]}>Pickup Zone</Text>
                    <Text style={[styles.modernHeaderSubtitle, { color: isInsideGeoFence ? c.successText : c.errorText }]}>
                        {isInsideGeoFence ? 'You are inside the zone' : distanceMeters !== null ? `${formatDistance(distanceMeters)} away` : 'Locating...'}
                    </Text>
                </View>
            </View>

            {/* Check Badges */}
            <View style={styles.checksContainer}>
                <View style={[styles.minimalCheckBadge, { backgroundColor: isPhoneInside ? c.successBg : c.errorBg }]}>
                    <Text style={{ fontSize: 12, color: isPhoneInside ? c.successText : c.errorText, fontFamily: 'Inter_600SemiBold' }}>
                        {isPhoneInside ? '✓ Phone GPS' : '✗ Phone GPS'}
                    </Text>
                </View>
                <View style={[styles.minimalCheckBadge, { backgroundColor: isBoxOffline ? c.warningBg : (isBoxInside ? c.successBg : c.errorBg) }]}>
                    <Text style={{ fontSize: 12, color: isBoxOffline ? c.warningText : (isBoxInside ? c.successText : c.errorText), fontFamily: 'Inter_600SemiBold' }}>
                        {isBoxOffline ? '? Box Offline' : (isBoxInside ? '✓ Smart Box' : '✗ Smart Box')}
                    </Text>
                </View>
            </View>

            {/* Phone-Only Fallback Banner */}
            {isPhoneOnlyFallback && (
                <View style={[styles.fallbackBanner, { backgroundColor: c.warningBg }]}>
                    <Text style={[styles.fallbackBannerText, { color: c.warningText }]}>
                        📱 Phone-only mode — Box GPS unavailable. Proceeding with phone location only.
                    </Text>
                </View>
            )}

            {/* Map Preview */}
            {mapAvailable && targetLat !== 0 && (
                <View style={styles.mapContainer}>
                    <MapboxGL.MapView
                        style={styles.map}
                        styleURL={isDarkMode ? StyleURL.Dark : StyleURL.Light}
                        logoEnabled={false}
                        attributionEnabled={false}
                        scrollEnabled={false}
                        zoomEnabled={false}
                        pitchEnabled={false}
                        rotateEnabled={false}
                    >
                        <MapboxGL.Camera
                            centerCoordinate={[targetLng, targetLat]}
                            zoomLevel={16}
                            animationMode="none"
                        />
                        <MapboxGL.ShapeSource id="geofence-circle" shape={geofenceCircle}>
                            <MapboxGL.FillLayer
                                id="geofence-fill"
                                style={{
                                    fillColor: isInsideGeoFence ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                    fillOutlineColor: isInsideGeoFence ? '#22c55e' : '#ef4444',
                                }}
                            />
                        </MapboxGL.ShapeSource>
                        <MapboxGL.MarkerView id="pickup-target" coordinate={[targetLng, targetLat]}>
                            <View style={styles.targetMarker}><Text style={styles.targetMarkerText}>📦</Text></View>
                        </MapboxGL.MarkerView>
                        {hasRiderPosition && currentLat != null && currentLng != null && (
                            <AnimatedRiderMarker
                                latitude={currentLat}
                                longitude={currentLng}
                                rotation={currentHeading ?? undefined}
                                isSelected={isPhoneInside}
                            />
                        )}
                    </MapboxGL.MapView>
                </View>
            )}

            {/* Location & Sender Details Block */}
            <View style={[styles.detailsBlock, { backgroundColor: isDarkMode ? '#18181b' : '#fafafa', borderColor: c.border }]}>
                <View style={styles.locationHeaderRow}>
                    <View style={{ flex: 1, paddingRight: 16 }}>
                        <Text style={[styles.sectionLabel, { color: c.textLabel }]}>PICKUP LOCATION</Text>
                        <Text style={[styles.detailText, { color: c.textTitle }]}>{targetAddress}</Text>
                    </View>
                    <IconButton icon="navigation-variant" size={24} mode="contained" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} iconColor={isDarkMode ? '#e4e4e7' : '#18181b'} onPress={onNavigate} style={{ margin: 0 }} />
                </View>

                {senderName ? (
                    <View style={[styles.senderRow, { borderTopColor: c.border }]}>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.sectionLabel, { color: c.textLabel }]}>SENDER</Text>
                            <Text style={[styles.detailText, { color: c.textTitle }]}>{senderName}</Text>
                            {senderPhone ? <Text style={{ fontSize: 13, color: c.textLabel, marginTop: 2 }}>{senderPhone}</Text> : null}
                        </View>
                        {senderPhone && (
                            <View style={styles.actionButtons}>
                                <IconButton icon="message-text" size={20} iconColor={c.textTitle} mode="contained-tonal" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} onPress={() => Linking.openURL(`sms:${senderPhone}`)} style={{ margin: 0 }} />
                                <IconButton icon="phone" size={20} iconColor={c.textTitle} mode="contained-tonal" containerColor={isDarkMode ? '#27272a' : '#f4f4f5'} onPress={() => Linking.openURL(`tel:${senderPhone}`)} style={{ margin: 0 }} />
                            </View>
                        )}
                    </View>
                ) : null}

                {deliveryNotes ? (
                    <View style={[styles.notesRow, { backgroundColor: isDarkMode ? '#27272a' : '#f4f4f5' }]}>
                        <Text style={[styles.sectionLabel, { color: c.textLabel }]}>DELIVERY NOTES</Text>
                        <Text style={{ fontSize: 14, color: c.textTitle, marginTop: 4 }}>{deliveryNotes}</Text>
                    </View>
                ) : null}
            </View>

            {/* Verification & Action Block */}
            <View style={[styles.verificationBlock, { backgroundColor: isDarkMode ? '#18181b' : '#fafafa', borderColor: c.border }]}>
                <View style={styles.verificationHeader}>
                    <Text style={[styles.verificationTitle, { color: c.textTitle }]}>Package Verification</Text>
                    <Text style={{ fontSize: 13, color: c.textLabel, marginTop: 2 }}>Capture condition at pickup</Text>
                </View>
                
                <View style={{ padding: 16 }}>
                    {pickupPhotoUri ? (
                        <View style={styles.photoContainer}>
                            <View style={[styles.photoPreviewWrapper, { borderColor: isDarkMode ? '#064e3b' : '#dcfce7', backgroundColor: isDarkMode ? '#000' : '#f8f9fa' }]}>
                                <Image source={{ uri: pickupPhotoUri }} style={styles.photoImage} resizeMode="cover" />
                                <View style={styles.photoVerifiedOverlay}>
                                    <Text style={styles.photoVerifiedText}>✅ Photo Verified</Text>
                                </View>
                            </View>
                            <Button mode="text" icon="camera-retake" onPress={handleCapturePickupPhoto} disabled={!isInsideGeoFence || isLoading} textColor={c.hintText} style={{ marginTop: 8 }}>
                                Retake Photo
                            </Button>
                        </View>
                    ) : (
                        <View style={[styles.photoEmptyState, { borderColor: isInsideGeoFence ? c.borderHard : c.border }]}>
                            <IconButton icon="camera-plus" size={48} iconColor={isInsideGeoFence ? c.textLabel : c.hintText} />
                            <Text style={[styles.photoEmptyStateText, { color: isInsideGeoFence ? c.textTitle : c.hintText }]}>
                                {isInsideGeoFence ? 'Capture Package Condition' : 'Approach to unlock camera'}
                            </Text>
                            <Button mode="contained" icon="camera" onPress={handleCapturePickupPhoto} disabled={!isInsideGeoFence || isLoading} buttonColor={isDarkMode ? '#27272a' : '#18181b'} textColor="#fff" style={{ borderRadius: 8 }}>
                                Open Camera
                            </Button>
                        </View>
                    )}

                    {uploadFailed && pickupPhotoUri && (
                        <View style={[styles.errorBanner, { backgroundColor: c.errorBg, borderColor: c.errorText }]}>
                            <Text style={[styles.errorBannerText, { color: c.errorText }]}>⚠️ Upload Failed: {uploadError}</Text>
                            <Button mode="contained" icon="refresh" onPress={handleRetryUpload} loading={isLoading} disabled={isLoading} buttonColor="#ef4444" textColor="#fff" style={{ borderRadius: 8, marginTop: 8 }}>
                                Retry
                            </Button>
                        </View>
                    )}

                    <View style={{ marginTop: 16 }}>
                        <SwipeConfirmButton label="Swipe to Pick Up" onConfirm={handlePickupSwipe} disabled={!isInsideGeoFence || !pickupPhotoUri || isLoading || uploadFailed} />
                    </View>
                </View>
            </View>

            {/* Smart Box Controls */}
            <View style={styles.boxControlSection}>
                <View style={styles.boxControlHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 18 }}>📦</Text>
                        <Text style={[styles.boxControlTitle, { color: c.textTitle }]}>Box Control</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.connectionDot, { backgroundColor: boxState ? c.successText : c.errorText }]} />
                        <Text style={[styles.connectionText, { color: boxState ? c.successText : c.errorText }]}>
                            {boxState ? 'Connected' : 'Offline'}
                        </Text>
                    </View>
                </View>



                {isInsideGeoFence ? (
                    <View style={{ marginTop: 8 }}>
                        <View style={[styles.manualOverrideRow, { borderTopColor: c.border }]}>
                            <Text style={[styles.manualOverrideText, { color: c.textTitle }]}>Manual override</Text>
                            <Switch value={manualModeEnabled} onValueChange={setManualModeEnabled} color={isDarkMode ? '#f4f4f5' : '#18181b'} trackColor={{ false: isDarkMode ? '#3f3f46' : '#e4e4e7', true: isDarkMode ? '#f4f4f5' : '#18181b' }} thumbColor={isDarkMode ? '#18181b' : '#ffffff'} />
                        </View>

                        {manualModeEnabled && (
                            <View style={{ paddingTop: 16 }}>
                                <View style={{ flexDirection: 'row', gap: 12 }}>
                                    <Button
                                        mode={boxState?.status === 'UNLOCKING' ? 'contained' : 'outlined'}
                                        icon={boxState?.status === 'UNLOCKING' ? 'check' : 'lock-open-outline'}
                                        onPress={() => handleManualBoxCommand('UNLOCKING')}
                                        disabled={!canManualControl || manualCommandLoading || boxState?.status === 'UNLOCKING'}
                                        loading={manualCommandLoading && boxState?.status === 'UNLOCKING'}
                                        style={[styles.boxButton, { borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7' }]}
                                        buttonColor={boxState?.status === 'UNLOCKING' ? (isDarkMode ? '#f4f4f5' : '#18181b') : 'transparent'}
                                        textColor={boxState?.status === 'UNLOCKING' ? (isDarkMode ? '#000' : '#fff') : c.textTitle}
                                    >
                                        {boxState?.status === 'UNLOCKING' ? 'Unlocked' : 'Unlock'}
                                    </Button>
                                    <Button
                                        mode={boxState?.status === 'LOCKED' ? 'contained' : 'outlined'}
                                        icon={boxState?.status === 'LOCKED' ? 'lock' : 'lock-outline'}
                                        onPress={() => handleManualBoxCommand('LOCKED')}
                                        disabled={!canManualControl || manualCommandLoading || boxState?.status === 'LOCKED'}
                                        loading={manualCommandLoading && boxState?.status !== 'UNLOCKING'}
                                        style={[styles.boxButton, { borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7' }]}
                                        buttonColor={boxState?.status === 'LOCKED' ? (isDarkMode ? '#f4f4f5' : '#18181b') : 'transparent'}
                                        textColor={boxState?.status === 'LOCKED' ? (isDarkMode ? '#000' : '#fff') : c.textTitle}
                                    >
                                        {boxState?.status === 'LOCKED' ? 'Locked' : 'Lock'}
                                    </Button>
                                </View>

                                {lockAwaitingClose && (
                                    <Text style={[styles.boxAlertText, { color: c.warningText }]}>
                                        {lockAwaitingCloseNeedsAssist ? '⚠️ Press # on keypad, then push lid down' : '⚠️ Push lid down to secure lock'}
                                    </Text>
                                )}

                                {lockCloseConfirmed && (
                                    <Text style={[styles.boxAlertText, { color: c.successText }]}>✓ Box is physically secured</Text>
                                )}
                            </View>
                        )}
                    </View>
                ) : (
                    <View style={[styles.autoControlsMsg, { borderTopColor: c.border }]}>
                        <Text style={{ fontSize: 13, color: c.hintText }}>Controls unlock automatically upon arrival.</Text>
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingBottom: 24,
    },
    modernHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    modernHeaderIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modernHeaderTitle: {
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
        marginBottom: 2,
    },
    modernHeaderSubtitle: {
        fontSize: 14,
        fontFamily: 'Inter_500Medium',
    },
    checksContainer: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    minimalCheckBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
    },
    fallbackBanner: {
        padding: 12,
        borderRadius: 8,
        marginBottom: 20,
    },
    fallbackBannerText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
    },
    mapContainer: {
        height: 160,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 24,
    },
    map: {
        flex: 1,
    },
    targetMarker: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    targetMarkerText: {
        fontSize: 24,
    },
    detailsBlock: {
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 24,
        overflow: 'hidden',
    },
    locationHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
    },
    sectionLabel: {
        fontSize: 11,
        fontFamily: 'Inter_700Bold',
        marginBottom: 4,
        letterSpacing: 0.5,
    },
    detailText: {
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        lineHeight: 22,
    },
    senderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderTopWidth: 1,
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    notesRow: {
        padding: 16,
    },
    verificationBlock: {
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 24,
        overflow: 'hidden',
    },
    verificationHeader: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(150,150,150,0.1)',
    },
    verificationTitle: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    photoContainer: {
        marginBottom: 16,
        alignItems: 'center',
    },
    photoPreviewWrapper: {
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 2,
        width: '100%',
    },
    photoImage: {
        width: '100%',
        height: 220,
    },
    photoVerifiedOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 12,
        backgroundColor: 'rgba(0,0,0,0.65)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoVerifiedText: {
        color: '#fff',
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    photoEmptyState: {
        marginBottom: 16,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        borderRadius: 16,
        borderWidth: 2,
        borderStyle: 'dashed',
        width: '100%',
    },
    photoEmptyStateText: {
        textAlign: 'center',
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 12,
    },
    errorBanner: {
        marginTop: 10,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
    },
    errorBannerText: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
    },
    boxControlSection: {
        paddingHorizontal: 4,
    },
    boxControlHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    boxControlTitle: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    connectionDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    connectionText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    manualOverrideRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderTopWidth: 1,
    },
    manualOverrideText: {
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
    },
    boxButton: {
        flex: 1,
        borderRadius: 8,
        borderWidth: 1,
    },
    boxAlertText: {
        marginTop: 16,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
        textAlign: 'center',
    },
    autoControlsMsg: {
        paddingVertical: 16,
        borderTopWidth: 1,
    },
});
