import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Image, Dimensions } from 'react-native';
import { Text, Card, Button, useTheme, Chip, Surface, IconButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapboxGL from '@rnmapbox/maps';

export default function DeliveryDetailScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const { delivery } = route.params;
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    // Mock coordinates for the map (Manila area)
    const deliveryLocation = {
        latitude: 14.5995,
        longitude: 120.9842,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Delivered': return '#4CAF50';
            case 'In Transit': return '#2196F3';
            case 'Cancelled': return '#9E9E9E';
            case 'Tampered': return '#D32F2F';
            default: return '#9E9E9E';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'Delivered': return 'check-circle';
            case 'In Transit': return 'truck-delivery';
            case 'Cancelled': return 'close-circle';
            case 'Tampered': return 'alert-circle';
            default: return 'help-circle';
        }
    };

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    const routeGeoJson = useMemo(() => ({
        type: 'Feature' as const,
        geometry: {
            type: 'LineString' as const,
            coordinates: [
                [120.9794, 14.5831],
                [120.9810, 14.5890],
                [120.9830, 14.5950],
                [deliveryLocation.longitude, deliveryLocation.latitude],
            ],
        },
    }), [deliveryLocation.latitude, deliveryLocation.longitude]);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <IconButton icon="arrow-left" onPress={() => navigation.goBack()} />
                <Text variant="titleLarge" style={styles.headerTitle}>Delivery Details</Text>
                <View style={{ width: 48 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Map Section */}
                <View style={styles.mapContainer}>
                    {MAPBOX_TOKEN ? (
                        <MapboxGL.MapView
                            style={styles.map}
                            logoEnabled={false}
                            attributionEnabled={false}
                        >
                            <MapboxGL.Camera
                                zoomLevel={14}
                                centerCoordinate={[deliveryLocation.longitude, deliveryLocation.latitude]}
                            />

                            <MapboxGL.ShapeSource id="delivery-route" shape={routeGeoJson}>
                                <MapboxGL.LineLayer
                                    id="delivery-route-line"
                                    style={{
                                        lineColor: theme.colors.primary,
                                        lineWidth: 3,
                                    }}
                                />
                            </MapboxGL.ShapeSource>

                            <MapboxGL.PointAnnotation
                                id="delivery-location"
                                coordinate={[deliveryLocation.longitude, deliveryLocation.latitude]}
                                title="Delivery Location"
                            >
                                <View style={styles.markerDot} />
                            </MapboxGL.PointAnnotation>

                            <MapboxGL.PointAnnotation
                                id="delivery-start"
                                coordinate={[120.9794, 14.5831]}
                                title="Start Point"
                            >
                                <View style={[styles.markerDot, { backgroundColor: '#2196F3' }]} />
                            </MapboxGL.PointAnnotation>
                        </MapboxGL.MapView>
                    ) : (
                        <View style={[styles.map, styles.mapFallback]}>
                            <Text style={{ color: theme.colors.onSurfaceVariant }}>
                                Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env
                            </Text>
                        </View>
                    )}
                </View>

                {/* Status Card */}
                <Surface style={styles.statusCard} elevation={2}>
                    <View style={styles.statusHeader}>
                        <View>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Tracking Number</Text>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{delivery.trk}</Text>
                        </View>
                        <Chip
                            icon={getStatusIcon(delivery.status)}
                            textStyle={{ color: 'white', fontWeight: 'bold' }}
                            style={{ backgroundColor: getStatusColor(delivery.status) }}
                        >
                            {delivery.status.toUpperCase()}
                        </Chip>
                    </View>
                    <View style={styles.divider} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                        <View>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Time</Text>
                            <Text variant="bodyMedium" style={{ fontWeight: '500' }}>{delivery.time}</Text>
                        </View>
                        <View>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Distance</Text>
                            <Text variant="bodyMedium" style={{ fontWeight: '500' }}>{delivery.distance}</Text>
                        </View>
                        <View>
                            <Text variant="labelSmall" style={{ color: '#888' }}>Priority</Text>
                            <Text variant="bodyMedium" style={{ fontWeight: '500' }}>{delivery.priority}</Text>
                        </View>
                    </View>
                </Surface>

                {/* Item Details */}
                <Card style={styles.card} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={styles.sectionTitle}>Item Details</Text>
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="package-variant" size={24} color={theme.colors.primary} />
                            <View style={styles.detailTextContainer}>
                                <Text variant="bodyLarge" style={styles.detailLabel}>Item Type</Text>
                                <Text variant="bodyMedium" style={styles.detailValue}>{delivery.type}</Text>
                            </View>
                        </View>
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="account" size={24} color={theme.colors.primary} />
                            <View style={styles.detailTextContainer}>
                                <Text variant="bodyLarge" style={styles.detailLabel}>Recipient</Text>
                                <Text variant="bodyMedium" style={styles.detailValue}>{delivery.customer}</Text>
                            </View>
                        </View>
                        <View style={styles.detailRow}>
                            <MaterialCommunityIcons name="map-marker" size={24} color={theme.colors.primary} />
                            <View style={styles.detailTextContainer}>
                                <Text variant="bodyLarge" style={styles.detailLabel}>Address</Text>
                                <Text variant="bodyMedium" style={styles.detailValue}>{delivery.address}</Text>
                            </View>
                        </View>
                    </Card.Content>
                </Card>

                {/* Proof of Delivery */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Proof of Delivery</Text>
                <Card style={styles.imageCard} mode="elevated">
                    <Image source={{ uri: delivery.image }} style={styles.proofImage} resizeMode="cover" />
                </Card>

                {delivery.status === 'Tampered' && (
                    <Surface style={styles.tamperAlert} elevation={2}>
                        <MaterialCommunityIcons name="alert-circle" size={30} color="white" />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                            <Text variant="titleMedium" style={{ color: 'white', fontWeight: 'bold' }}>Tampering Detected</Text>
                            <Text variant="bodySmall" style={{ color: 'white' }}>
                                This package showed signs of unauthorized access. Please contact support immediately.
                            </Text>
                        </View>
                    </Surface>
                )}

                <Button mode="contained" style={styles.supportButton} onPress={() => console.log('Contact Support')}>
                    Contact Support
                </Button>
            </ScrollView>
        </View>
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
        paddingTop: 40,
        paddingBottom: 10,
        paddingHorizontal: 10,
        backgroundColor: 'white',
        elevation: 2,
    },
    headerTitle: {
        fontWeight: 'bold',
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
        fontWeight: 'bold',
        marginBottom: 12,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    detailTextContainer: {
        marginLeft: 16,
    },
    detailLabel: {
        fontWeight: 'bold',
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
        backgroundColor: '#D32F2F',
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    supportButton: {
        marginTop: 10,
    },
    divider: {
        height: 1,
        backgroundColor: '#eee',
        marginVertical: 12,
    },
});
