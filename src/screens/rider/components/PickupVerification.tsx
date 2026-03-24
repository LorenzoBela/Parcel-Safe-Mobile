import React, { useMemo } from 'react';
import { View, StyleSheet, Linking, Platform, Image } from 'react-native';
import { Text, Card, Button, IconButton } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import SwipeConfirmButton from '../../../components/SwipeConfirmButton';
import { uploadPickupPhoto } from '../../../services/proofPhotoService';
import { updateDeliveryStatus } from '../../../services/riderMatchingService';
import { PremiumAlert } from '../../../services/PremiumAlertService';
import { useAppTheme } from '../../../context/ThemeContext';

// Import MapboxWrapper for geofence preview map
import MapboxGL, { isMapboxNativeAvailable, StyleURL } from '../../../components/map/MapboxWrapper';

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
    geofenceRadiusM?: number;

    onPickupConfirmed: () => void;

    onNavigate: () => void;
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
    geofenceRadiusM = 50,
    onPickupConfirmed,

    onNavigate,
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

    const [isLoading, setIsLoading] = React.useState(false);
    const [pickupPhotoUri, setPickupPhotoUri] = React.useState<string | null>(null);

    const mapAvailable = isMapboxNativeAvailable();
    const hasRiderPosition = currentLat !== 0 || currentLng !== 0;

    // Memoize geofence circle GeoJSON to avoid recalculating on every render
    const geofenceCircle = useMemo(
        () => buildGeofenceCircleGeoJSON(targetLng, targetLat, geofenceRadiusM),
        [targetLat, targetLng, geofenceRadiusM]
    );

    const handleCapturePickupPhoto = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
            });
            if (!result.canceled && result.assets?.[0]?.uri) {
                setPickupPhotoUri(result.assets[0].uri);
            }
        } catch (e) {
            PremiumAlert.alert('Camera Error', 'Unable to capture pickup photo right now.');
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
            const uploadResult = await uploadPickupPhoto({
                deliveryId,
                boxId,
                localUri: pickupPhotoUri,
            });

            if (!uploadResult.success) {
                PremiumAlert.alert('Upload Failed', 'Pickup photo upload failed. Please retry.');
                return;
            }

            const success = await updateDeliveryStatus(deliveryId, 'IN_TRANSIT', {
                picked_up_at: Date.now(),
                in_transit_at: Date.now(),
                pickup_photo_url: uploadResult.url || null,
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
            <Card mode="elevated" style={[styles.statusCard, { backgroundColor: c.card }, isInsideGeoFence ? styles.borderSuccess : styles.borderError]}>
                <Card.Content>
                    <View style={styles.statusHeader}>
                        <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: c.textTitle }}>
                            Pickup Zone
                        </Text>
                        {distanceMeters !== null && (
                            <View style={[styles.distanceBadge, { backgroundColor: c.badgeBg }]}>
                                <Text style={[styles.distanceText, { color: c.badgeText }]}>
                                    {distanceMeters > 999
                                        ? `${(distanceMeters / 1000).toFixed(1)} km away`
                                        : `${distanceMeters}m away`}
                                </Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.checksContainer}>
                        <View style={styles.checkItem}>
                            <View style={[styles.checkCircle, { borderColor: c.card }, isPhoneInside ? styles.bgSuccess : styles.bgError]}>
                                <Text style={styles.checkIcon}>{isPhoneInside ? '✓' : '✗'}</Text>
                            </View>
                            <Text style={[styles.checkLabel, { color: c.textLabel }]}>Phone GPS</Text>
                        </View>

                        <View style={[styles.checkDivider, { backgroundColor: c.border }]} />

                        <View style={styles.checkItem}>
                            <View style={[
                                styles.checkCircle,
                                { borderColor: c.card },
                                isBoxOffline ? styles.bgWarning : (isBoxInside ? styles.bgSuccess : styles.bgError)
                            ]}>
                                <Text style={styles.checkIcon}>
                                    {isBoxOffline ? '?' : (isBoxInside ? '✓' : '✗')}
                                </Text>
                            </View>
                            <Text style={[styles.checkLabel, { color: c.textLabel }]}>{isBoxOffline ? 'Box Offline' : 'Smart Box'}</Text>
                        </View>
                    </View>

                    {/* EC-FIX: Phone-Only Fallback Banner */}
                    {isPhoneOnlyFallback && (
                        <View style={[styles.fallbackBanner, { backgroundColor: c.warningBg }]}>
                            <Text style={[styles.fallbackBannerText, { color: c.warningText }]}>
                                📱 Phone-only mode — Box GPS unavailable. Proceeding with phone location only.
                            </Text>
                        </View>
                    )}

                    <View style={[styles.statusMessageContainer, { backgroundColor: isInsideGeoFence ? c.successBg : c.errorBg }]}>
                        <Text style={[styles.statusMessageText, { color: isInsideGeoFence ? c.successText : c.errorText }]}>
                            {isInsideGeoFence
                                ? 'Arrived at Sender. Capture photo to proceed.'
                                : 'Move closer to the pickup point.'}
                        </Text>
                    </View>

                    {/* ──── Geofence Map Preview ──── */}
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

                                {/* Geofence circle */}
                                <MapboxGL.ShapeSource id="geofence-circle" shape={geofenceCircle}>
                                    <MapboxGL.FillLayer
                                        id="geofence-fill"
                                        style={{
                                            fillColor: isInsideGeoFence ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                                            fillOutlineColor: isInsideGeoFence ? '#22c55e' : '#ef4444',
                                        }}
                                    />
                                </MapboxGL.ShapeSource>

                                {/* Pickup target marker — using MarkerView for reliable rendering */}
                                <MapboxGL.MarkerView
                                    id="pickup-target"
                                    coordinate={[targetLng, targetLat]}
                                >
                                    <View style={styles.targetMarker}>
                                        <Text style={styles.targetMarkerText}>📦</Text>
                                    </View>
                                </MapboxGL.MarkerView>

                                {/* Rider live position — same Rider.jpg icon as tracking pages */}
                                {hasRiderPosition && (
                                    <MapboxGL.MarkerView
                                        id="rider-position"
                                        coordinate={[currentLng, currentLat]}
                                    >
                                        <View style={[
                                            styles.riderMarkerOuter,
                                            isPhoneInside && styles.riderMarkerOuterInside,
                                        ]}>
                                            <Image
                                                source={RiderImage}
                                                style={styles.riderMarkerImage}
                                                resizeMode="cover"
                                            />
                                        </View>
                                    </MapboxGL.MarkerView>
                                )}
                            </MapboxGL.MapView>

                            {/* Distance overlay */}
                            {distanceMeters !== null && (
                                <View style={[styles.mapDistanceOverlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)' }]}>
                                    <Text style={[styles.mapDistanceText, { color: isInsideGeoFence ? '#22c55e' : c.text }]}>
                                        {isInsideGeoFence ? '✓ Inside Zone' : `${formatDistance(distanceMeters)} to zone`}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Text-based proximity fallback when map isn't available */}
                    {!mapAvailable && hasRiderPosition && distanceMeters !== null && (
                        <View style={[styles.proximityFallback, { backgroundColor: c.badgeBg, borderColor: c.border }]}>
                            <Text style={{ fontSize: 24, marginBottom: 4 }}>
                                {isInsideGeoFence ? '📍' : '🧭'}
                            </Text>
                            <Text style={[styles.proximityText, { color: c.text }]}>
                                {isInsideGeoFence
                                    ? 'You are inside the pickup zone'
                                    : `${formatDistance(distanceMeters)} from pickup zone (${formatDistance(geofenceRadiusM)} radius)`
                                }
                            </Text>
                        </View>
                    )}

                    <View style={[styles.addressRow, { borderTopColor: c.borderHard }]}>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.addressLabel, { color: c.textLabel }]}>PICKUP LOCATION</Text>
                            <Text numberOfLines={2} style={[styles.address, { color: c.text }]}>{targetAddress}</Text>

                            {senderName ? (
                                <View style={{ marginTop: 12 }}>
                                    <Text style={[styles.addressLabel, { color: c.textLabel }]}>SENDER</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <Text style={[styles.address, { color: c.text, flex: 1, marginRight: 8 }]}>{senderName}{senderPhone ? ` • ${senderPhone}` : ''}</Text>
                                        {senderPhone && (
                                            <View style={{ flexDirection: 'row' }}>
                                                <IconButton icon="phone" size={20} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`tel:${senderPhone}`)} style={{ margin: 0, marginRight: 8 }} />
                                                <IconButton icon="message-text" size={20} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`sms:${senderPhone}`)} style={{ margin: 0 }} />
                                            </View>
                                        )}
                                    </View>
                                </View>
                            ) : null}

                            {deliveryNotes ? (
                                <View style={{ marginTop: 12, padding: 8, backgroundColor: isDarkMode ? '#334155' : '#f1f5f9', borderRadius: 6 }}>
                                    <Text style={[styles.addressLabel, { color: isDarkMode ? '#cbd5e1' : '#475569' }]}>DELIVERY NOTES</Text>
                                    <Text style={[styles.address, { color: isDarkMode ? '#f8fafc' : '#334155' }]}>{deliveryNotes}</Text>
                                </View>
                            ) : null}
                        </View>
                        <View style={styles.navActions}>
                            <IconButton icon="navigation" mode="contained" containerColor="#E3F2FD" iconColor="#1976D2" size={24} onPress={onNavigate} />
                        </View>
                    </View>
                </Card.Content>
            </Card>

            <Card style={[styles.actionCard, { backgroundColor: c.card }]}>
                <Card.Content>
                    <Text style={[styles.actionTitle, { color: c.textTitle }]}>Pickup Parcel</Text>
                    <View style={{ marginTop: 12 }}>
                        <Button
                            mode="outlined"
                            icon="camera"
                            onPress={handleCapturePickupPhoto}
                            disabled={!isInsideGeoFence || isLoading}
                        >
                            {pickupPhotoUri ? 'Retake pickup photo' : 'Capture pickup photo (required)'}
                        </Button>
                        {pickupPhotoUri ? (
                            <Text style={{ marginTop: 6, color: c.successText, textAlign: 'center' }}>
                                ✅ Pickup photo ready.
                            </Text>
                        ) : (
                            <Text style={{ marginTop: 6, color: c.hintText, textAlign: 'center' }}>
                                Approach pickup point to unlock camera.
                            </Text>
                        )}
                    </View>
                    <View style={{ marginTop: 16 }}>
                        <SwipeConfirmButton
                            label="Swipe to Pick Up"
                            onConfirm={handlePickupSwipe}
                            disabled={!isInsideGeoFence || !pickupPhotoUri || isLoading}
                        />
                    </View>
                </Card.Content>
            </Card>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    statusCard: {
        marginBottom: 20,
        borderRadius: 16,
        borderWidth: 2,
        elevation: 3,
        backgroundColor: 'white',
    },
    borderSuccess: { borderColor: '#22c55e' },
    borderError: { borderColor: '#ef4444' },
    statusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    distanceBadge: {
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    distanceText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
        color: '#4B5563',
    },
    checksContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    checkItem: {
        alignItems: 'center',
        width: 100,
    },
    checkCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
        borderWidth: 2,
        borderColor: 'white',
        elevation: 2,
    },
    checkIcon: {
        fontSize: 24,
        color: 'white',
        fontFamily: 'Inter_700Bold',
    },
    bgSuccess: { backgroundColor: '#22c55e' },
    bgError: { backgroundColor: '#ef4444' },
    bgWarning: { backgroundColor: '#F59E0B' },
    checkLabel: {
        fontSize: 12,
        color: '#555',
        fontFamily: 'Inter_600SemiBold',
    },
    checkDivider: {
        height: 2,
        width: 30,
        backgroundColor: '#E5E7EB',
        marginHorizontal: 10,
        top: -14,
    },
    statusMessageContainer: {
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        alignItems: 'center',
    },
    bgSubtleSuccess: { backgroundColor: '#DCFCE7' },
    bgSubtleError: { backgroundColor: '#FEE2E2' },
    statusMessageText: {
        textAlign: 'center',
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    textSuccess: { color: '#15803d' },
    textError: { color: '#B91C1C' },

    // ──── Phone-Only Fallback Banner ────
    fallbackBanner: {
        padding: 10,
        borderRadius: 8,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    fallbackBannerText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
        flex: 1,
    },

    // ──── Geofence Map Preview ────
    mapContainer: {
        height: 180,
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 16,
        position: 'relative',
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
    riderMarkerOuter: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'white',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2.5,
        borderColor: '#0f172a',
        overflow: 'hidden',
        // Shadow for depth
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 6,
    },
    riderMarkerOuterInside: {
        borderColor: '#22c55e',
    },
    riderMarkerImage: {
        width: 35,
        height: 35,
        borderRadius: 17.5,
    },
    mapDistanceOverlay: {
        position: 'absolute',
        bottom: 8,
        left: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    mapDistanceText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },

    // ──── Text Proximity Fallback (no native map) ────
    proximityFallback: {
        padding: 16,
        borderRadius: 10,
        marginBottom: 16,
        alignItems: 'center',
        borderWidth: 1,
    },
    proximityText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
    },

    addressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
        paddingTop: 12,
    },
    addressLabel: {
        fontSize: 10,
        color: '#888',
        fontFamily: 'Inter_700Bold',
        marginBottom: 2,
    },
    address: {
        fontSize: 14,
        color: '#333',
    },
    navActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        elevation: 1,
        marginBottom: 20,
    },
    actionTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
        color: '#1a1a1a',
        marginBottom: 4,
    },
});
