import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, Dimensions, Linking } from 'react-native';
import { Text, Card, Button, Chip, useTheme, IconButton, Surface, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapboxGL from '../../components/map/MapboxWrapper';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TIMEZONE = 'Asia/Manila';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Haversine formula — returns distance in km */
function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function JobDetailScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    // Get job data from params
    const jobData = route.params?.job;

    if (!jobData) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <Surface style={{ padding: 20, borderRadius: 12, alignItems: 'center' }} elevation={2}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={48} color={theme.colors.error} />
                    <Text variant="titleMedium" style={{ marginTop: 12, marginBottom: 8 }}>No Job Selected</Text>
                    <Button mode="contained" onPress={() => navigation.goBack()}>Go Back</Button>
                </Surface>
            </View>
        );
    }

    const [routeGeometry, setRouteGeometry] = useState<any>(null);
    const [routeDistanceKm, setRouteDistanceKm] = useState<string | null>(null);
    const [routeDurationMin, setRouteDurationMin] = useState<string | null>(null);
    const cameraRef = useRef<any>(null);

    /** Calculate total delivery time from timestamps */
    const getTotalDeliveryTime = (): string => {
        const startTime = jobData.acceptedAt || jobData.pickedUpAt || jobData.pickupTime;
        const endTime = jobData.deliveredAt;
        if (!startTime || !endTime) {
            // If delivery not yet finished, show elapsed since start
            if (startTime) {
                const elapsed = dayjs().diff(dayjs(startTime), 'minute');
                if (elapsed < 1) return 'Just started';
                if (elapsed >= 60) return `${Math.floor(elapsed / 60)}h ${elapsed % 60}m (ongoing)`;
                return `${elapsed} min (ongoing)`;
            }
            return 'N/A';
        }
        const totalMin = dayjs(endTime).diff(dayjs(startTime), 'minute');
        if (totalMin < 1) return '< 1 min';
        if (totalMin >= 60) return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
        return `${totalMin} min`;
    };

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    // Fetch route
    useEffect(() => {
        const fetchRoute = async () => {
            if (!MAPBOX_TOKEN) return;

            try {
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${jobData.pickupLng},${jobData.pickupLat};${jobData.dropoffLng},${jobData.dropoffLat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;

                const response = await fetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    setRouteGeometry(data.routes[0].geometry);
                    // Extract distance (meters → km) and duration (seconds → minutes)
                    if (data.routes[0].distance != null) {
                        setRouteDistanceKm((data.routes[0].distance / 1000).toFixed(1) + ' km');
                    }
                    if (data.routes[0].duration != null) {
                        const mins = Math.ceil(data.routes[0].duration / 60);
                        setRouteDurationMin(mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`);
                    }
                }
            } catch (error) {
                console.error('Route calculation error:', error);
            }
        };

        fetchRoute();
    }, [MAPBOX_TOKEN, jobData]);

    const handleStartTrip = () => {
        const isPickup = !['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED'].includes(jobData.status);

        navigation.navigate('Arrival', {
            deliveryId: jobData.id,
            boxId: jobData.boxId || 'BOX_001',
            targetLat: isPickup ? (jobData.snappedPickupLat ?? jobData.pickupLat) : (jobData.snappedDropoffLat ?? jobData.dropoffLat),
            targetLng: isPickup ? (jobData.snappedPickupLng ?? jobData.pickupLng) : (jobData.snappedDropoffLng ?? jobData.dropoffLng),
            targetAddress: isPickup ? jobData.pickupAddress : jobData.address,
            customerPhone: jobData.phone,
            senderName: jobData.senderName,
            senderPhone: jobData.senderPhone,
            recipientName: jobData.customer,
            deliveryNotes: jobData.deliveryNotes,
            // Both coordinates for dynamic geofence switching
            pickupLat: jobData.snappedPickupLat ?? jobData.pickupLat,
            pickupLng: jobData.snappedPickupLng ?? jobData.pickupLng,
            pickupAddress: jobData.pickupAddress,
            dropoffLat: jobData.snappedDropoffLat ?? jobData.dropoffLat,
            dropoffLng: jobData.snappedDropoffLng ?? jobData.dropoffLng,
            dropoffAddress: jobData.address,
        });
    };
    // Helper to ensure time is in PH format
    // Helper to ensure time is in PH format
    const getFormattedTime = (timeStr: string) => {
        if (!timeStr || timeStr === '--:--') return '--:--';

        console.log('[JobDetail] Parsing timeStr:', timeStr);

        // If it matches HH:mm A format, return as is (avoid double shift for legacy data)
        if (timeStr.match(/^\d{1,2}:\d{2} [AP]M$/)) return timeStr;

        // Try parsing with DayJS
        // Parse as UTC (server default) and manually add 8 hours for PH Time
        const d = dayjs.utc(timeStr).add(8, 'hour');

        if (!d.isValid()) {
            console.warn('[JobDetail] Invalid date string:', timeStr);
            // Fallback: If it looks like T04:18:38.479, try to extract time
            if (timeStr.includes('T')) {
                const parts = timeStr.split('T');
                if (parts.length > 1) {
                    // Try to format just the time part if possible, or return it cleaned
                    const subTime = parts[1].split('.')[0]; // 04:18:38
                    return subTime;
                }
            }
            return timeStr;
        }

        return d.format('h:mm A');
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Header */}
            <Surface style={[styles.header, { backgroundColor: theme.colors.surface, paddingTop: insets.top + 10 }]} elevation={2}>
                <IconButton
                    icon="arrow-left"
                    size={24}
                    onPress={() => navigation.goBack()}
                />
                <View style={{ flex: 1 }}>
                    <Text variant="titleLarge" style={{ fontWeight: 'bold' }}>Job Details</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{jobData.id}</Text>
                </View>
            </Surface>

            {/* Map Section - Fixed at top */}
            <View style={styles.mapContainer}>
                {MAPBOX_TOKEN ? (
                    <>
                        <MapboxGL.MapView
                            style={styles.map}
                            logoEnabled={false}
                            attributionEnabled={false}
                            styleURL={MapboxGL.StyleURL.Street}
                            scrollEnabled={true}
                            pitchEnabled={true}
                            rotateEnabled={true}
                            zoomEnabled={true}
                        >
                            <MapboxGL.Camera
                                ref={cameraRef}
                                defaultSettings={{
                                    centerCoordinate: [
                                        (jobData.pickupLng + jobData.dropoffLng) / 2,
                                        (jobData.pickupLat + jobData.dropoffLat) / 2
                                    ],
                                    zoomLevel: 12
                                }}
                                bounds={{
                                    ne: [
                                        Math.max(jobData.pickupLng, jobData.dropoffLng),
                                        Math.max(jobData.pickupLat, jobData.dropoffLat)
                                    ],
                                    sw: [
                                        Math.min(jobData.pickupLng, jobData.dropoffLng),
                                        Math.min(jobData.pickupLat, jobData.dropoffLat)
                                    ],
                                    paddingBottom: 50,
                                    paddingLeft: 50,
                                    paddingRight: 50,
                                    paddingTop: 50
                                }}
                                animationMode="flyTo"
                                animationDuration={2000}
                            />

                            {/* Pickup Marker */}
                            <MapboxGL.PointAnnotation
                                id="pickup-marker"
                                coordinate={[jobData.pickupLng, jobData.pickupLat]}
                            >
                                <View style={styles.pickupMarker}>
                                    <MaterialCommunityIcons name="package-variant" size={20} color="white" />
                                </View>
                            </MapboxGL.PointAnnotation>

                            {/* Dropoff Marker */}
                            <MapboxGL.PointAnnotation
                                id="dropoff-marker"
                                coordinate={[jobData.dropoffLng, jobData.dropoffLat]}
                            >
                                <View style={styles.dropoffMarker}>
                                    <MaterialCommunityIcons name="map-marker" size={24} color="white" />
                                </View>
                            </MapboxGL.PointAnnotation>

                            {/* Route Line */}
                            {routeGeometry && (
                                <MapboxGL.ShapeSource
                                    id="route-line"
                                    shape={{
                                        type: 'Feature',
                                        geometry: routeGeometry,
                                        properties: {},
                                    }}
                                >
                                    <MapboxGL.LineLayer
                                        id="route-line-layer"
                                        style={{
                                            lineColor: '#2196F3',
                                            lineWidth: 4,
                                            lineOpacity: 0.8,
                                        }}
                                    />
                                </MapboxGL.ShapeSource>
                            )}
                        </MapboxGL.MapView>

                        {/* Fit to Route Button */}
                        <Surface style={{ position: 'absolute', right: 12, bottom: 12, borderRadius: 24, backgroundColor: 'white' }} elevation={4}>
                            <IconButton
                                icon="fit-to-screen-outline"
                                size={22}
                                onPress={() => {
                                    if (cameraRef.current) {
                                        cameraRef.current.fitBounds(
                                            [Math.max(jobData.pickupLng, jobData.dropoffLng), Math.max(jobData.pickupLat, jobData.dropoffLat)],
                                            [Math.min(jobData.pickupLng, jobData.dropoffLng), Math.min(jobData.pickupLat, jobData.dropoffLat)],
                                            [50, 50, 50, 50],
                                            1000
                                        );
                                    }
                                }}
                            />
                        </Surface>
                    </>
                ) : (
                    <View style={[styles.map, styles.mapFallback]}>
                        <Text>Map unavailable</Text>
                    </View>
                )}
            </View>

            <ScrollView style={{ flex: 1 }}>
                {/* Trip Summary */}
                <View style={{ padding: 16 }}>
                    <Card style={{ marginBottom: 16 }} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 16 }}>Trip Summary</Text>

                            <View style={styles.summaryRow}>
                                <MaterialCommunityIcons name="map-marker-distance" size={20} color={theme.colors.primary} />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>Distance</Text>
                                    <Text variant="bodyLarge" style={{ fontWeight: 'bold' }}>
                                        {routeDistanceKm
                                            || (jobData.distance && jobData.distance !== '--' ? jobData.distance : null)
                                            || (jobData.pickupLat && jobData.dropoffLat
                                                ? `${getDistanceKm(jobData.pickupLat, jobData.pickupLng, jobData.dropoffLat, jobData.dropoffLng).toFixed(1)} km`
                                                : 'N/A')}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.summaryRow}>
                                <MaterialCommunityIcons name="timer-outline" size={20} color={theme.colors.primary} />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>Total Time</Text>
                                    <Text variant="bodyLarge" style={{ fontWeight: 'bold' }}>
                                        {getTotalDeliveryTime()}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.summaryRow}>
                                <MaterialCommunityIcons name="cash" size={20} color="#4CAF50" />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>Fare</Text>
                                    <Text variant="bodyLarge" style={{ fontWeight: 'bold', color: '#4CAF50' }}>{jobData.fare}</Text>
                                </View>
                            </View>
                        </Card.Content>
                    </Card>

                    {/* Pickup Details */}
                    <Card style={{ marginBottom: 16 }} mode="elevated">
                        <Card.Content>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                                <View style={[styles.badge, { backgroundColor: '#E3F2FD' }]}>
                                    <MaterialCommunityIcons name="package-variant" size={20} color="#2196F3" />
                                </View>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', marginLeft: 8 }}>Pickup</Text>
                            </View>

                            {jobData.senderName ? (
                                <View style={styles.detailRow}>
                                    <MaterialCommunityIcons name="account" size={18} color={theme.colors.onSurfaceVariant} />
                                    <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{jobData.senderName}</Text>
                                </View>
                            ) : null}

                            {jobData.senderPhone ? (
                                <View style={[styles.detailRow, { alignItems: 'center' }]}>
                                    <MaterialCommunityIcons name="phone" size={18} color={theme.colors.onSurfaceVariant} />
                                    <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{jobData.senderPhone}</Text>
                                    <IconButton icon="phone" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`tel:${jobData.senderPhone}`)} style={{ margin: 0, marginLeft: 4 }} />
                                    <IconButton icon="message-text" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`sms:${jobData.senderPhone}`)} style={{ margin: 0, marginLeft: 4 }} />
                                </View>
                            ) : null}

                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="map-marker" size={18} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{jobData.pickupAddress}</Text>
                            </View>

                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="clock" size={18} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{getFormattedTime(jobData.pickupTime)}</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    {/* Dropoff Details */}
                    <Card style={{ marginBottom: 16 }} mode="elevated">
                        <Card.Content>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                                <View style={[styles.badge, { backgroundColor: '#FFEBEE' }]}>
                                    <MaterialCommunityIcons name="map-marker" size={20} color="#F44336" />
                                </View>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', marginLeft: 8 }}>Dropoff</Text>
                            </View>

                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="account" size={18} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{jobData.recipientName || jobData.customer}</Text>
                            </View>

                            {jobData.phone && jobData.phone !== 'N/A' ? (
                                <View style={[styles.detailRow, { alignItems: 'center' }]}>
                                    <MaterialCommunityIcons name="phone" size={18} color={theme.colors.onSurfaceVariant} />
                                    <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{jobData.phone}</Text>
                                    <IconButton icon="phone" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`tel:${jobData.phone}`)} style={{ margin: 0, marginLeft: 4 }} />
                                    <IconButton icon="message-text" size={18} mode="contained-tonal" iconColor="#1976D2" onPress={() => Linking.openURL(`sms:${jobData.phone}`)} style={{ margin: 0, marginLeft: 4 }} />
                                </View>
                            ) : null}

                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="map-marker" size={18} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{jobData.address}</Text>
                            </View>

                            <View style={styles.detailRow}>
                                <MaterialCommunityIcons name="clock" size={18} color={theme.colors.onSurfaceVariant} />
                                <Text variant="bodyMedium" style={{ flex: 1, marginLeft: 8 }}>{getFormattedTime(jobData.dropoffTime)}</Text>
                            </View>

                            {jobData.deliveryNotes ? (
                                <View style={{ marginTop: 8, padding: 12, backgroundColor: theme.colors.surfaceVariant, borderRadius: 8 }}>
                                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>Delivery Notes</Text>
                                    <Text variant="bodyMedium">{jobData.deliveryNotes}</Text>
                                </View>
                            ) : null}
                        </Card.Content>
                    </Card>
                </View>
            </ScrollView>

            {/* Bottom Actions */}
            <Surface style={[styles.bottomActions, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(insets.bottom, 16) }]} elevation={4}>
                <Button
                    mode="outlined"
                    onPress={() => navigation.goBack()}
                    style={{ flex: 1, marginRight: 8 }}
                >
                    Back
                </Button>
                <Button
                    mode="contained"
                    onPress={handleStartTrip}
                    style={{ flex: 2 }}
                    icon="navigation"
                >
                    Start Trip
                </Button>
            </Surface>
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 8,
        paddingTop: 40,
    },
    mapContainer: {
        height: 250,
        width: '100%',
    },
    map: {
        flex: 1,
    },
    mapFallback: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f1f1f1',
    },
    pickupMarker: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#2196F3',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    dropoffMarker: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F44336',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    badge: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    bottomActions: {
        flexDirection: 'row',
        padding: 16,
        paddingBottom: 24,
    },
});
