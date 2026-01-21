import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Alert } from 'react-native';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import { Text, Card, Avatar, Button, IconButton, Surface, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { subscribeToDisplay } from '../../services/firebaseClient';
import {
    subscribeToCancellation,
    CancellationState,
    formatCancellationReason,
    DeliveryStatus,
    canCustomerCancel,
    requestCustomerCancellation,
    CustomerCancellationReason,
} from '../../services/cancellationService';
import * as Clipboard from 'expo-clipboard';
import CustomerCancellationModal from '../../components/modals/CustomerCancellationModal';

export default function TrackOrderScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [displayStatus, setDisplayStatus] = useState<'OK' | 'DEGRADED' | 'FAILED'>('OK');
    const [cancellation, setCancellation] = useState<CancellationState | null>(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);

    // Mock data - in real app, get from route params or state
    const deliveryStatus = DeliveryStatus.ASSIGNED; // Example: before pickup
    const customerId = 'cust_123';

    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    // Mock Delivery ID (in real app, get from route params)
    const deliveryId = 'TRK-8821-9023';

    // Mock coordinates
    const boxLocation = { latitude: 14.5995, longitude: 120.9842 };
    const riderLocation = { latitude: 14.5990, longitude: 120.9830 };
    const destination = { latitude: 14.6000, longitude: 120.9850 };

    const riderDetails = {
        name: 'Juan Dela Cruz',
        vehicle: 'Yamaha NMAX (ABC-1234)',
        rating: 4.8,
        phone: '+63 912 345 6789',
    };

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }

        // EC-86: Monitor display health
        const unsubscribeDisplay = subscribeToDisplay('BOX_001', (displayState) => {
            if (displayState) {
                setDisplayStatus(displayState.status);
            }
        });

        // EC-32: Monitor cancellation
        const unsubscribeCancellation = subscribeToCancellation(deliveryId, (state) => {
            setCancellation(state);
        });

        return () => {
            unsubscribeDisplay();
            unsubscribeCancellation();
        };
    }, []);

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

    const canCancelResult = canCustomerCancel(deliveryStatus);

    const routeGeoJson = {
        type: 'Feature' as const,
        geometry: {
            type: 'LineString' as const,
            coordinates: [
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
                                circleRadius: 20,
                                circleColor: 'rgba(76, 175, 80, 0.1)',
                                circleStrokeColor: 'rgba(76, 175, 80, 0.5)',
                                circleStrokeWidth: 2,
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
                        {cancellation ? (
                            <Text variant="titleLarge" style={{ fontWeight: 'bold', color: theme.colors.error }}>Delivery Cancelled</Text>
                        ) : (
                            <Text variant="titleLarge" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>Arriving in 10 mins</Text>
                        )}

                        {cancellation ? (
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                Reason: {formatCancellationReason(cancellation.reason)}
                            </Text>
                        ) : (
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>On the way to your location</Text>
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
                {cancellation && (
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
                    <Avatar.Image size={50} source={{ uri: 'https://i.pravatar.cc/150?img=11' }} />
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

                {!cancellation && (
                    <Button
                        mode="contained"
                        style={styles.viewOtpBtn}
                        icon="lock-open"
                        onPress={() => navigation.navigate('OTP')}
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
