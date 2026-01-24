import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Portal, Modal, Button, Text, useTheme, Surface, TextInput } from 'react-native-paper';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeMapView, isMapboxNativeAvailable } from './map/MapboxWrapper';
import Mapbox from '@rnmapbox/maps';

interface LocationPickerProps {
    visible: boolean;
    onDismiss: () => void;
    onLocationSelected: (location: LocationData) => void;
    initialLocation?: LocationData;
    title?: string;
}

export interface LocationData {
    address: string;
    latitude: number;
    longitude: number;
}

export default function LocationPicker({
    visible,
    onDismiss,
    onLocationSelected,
    initialLocation,
    title = 'Select Location'
}: LocationPickerProps) {
    const theme = useTheme();
    const [centerCoordinate, setCenterCoordinate] = useState<[number, number]>([
        initialLocation?.longitude || 120.9842, // Manila default [lng, lat]
        initialLocation?.latitude || 14.5995,
    ]);
    const [markerPosition, setMarkerPosition] = useState({
        latitude: initialLocation?.latitude || 14.5995,
        longitude: initialLocation?.longitude || 120.9842,
    });
    const [address, setAddress] = useState(initialLocation?.address || '');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (visible && !initialLocation) {
            getCurrentLocation();
        }
    }, [visible]);

    const getCurrentLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Please enable location permissions to use this feature.');
                return;
            }

            const location = await Location.getCurrentPositionAsync({});
            const newPosition = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
            };
            setMarkerPosition(newPosition);
            setCenterCoordinate([location.coords.longitude, location.coords.latitude]);
            await reverseGeocode(location.coords.latitude, location.coords.longitude);
        } catch (error) {
            console.error('Error getting location:', error);
        }
    };

    const reverseGeocode = async (latitude: number, longitude: number) => {
        setLoading(true);
        try {
            const results = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (results.length > 0) {
                const result = results[0];
                const addressStr = [
                    result.street,
                    result.district,
                    result.city,
                    result.region,
                    result.country
                ].filter(Boolean).join(', ');
                setAddress(addressStr);
            }
        } catch (error) {
            console.error('Error reverse geocoding:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleMapPress = (event: any) => {
        const { geometry } = event;
        if (geometry && geometry.coordinates) {
            const [longitude, latitude] = geometry.coordinates;
            setMarkerPosition({ latitude, longitude });
            reverseGeocode(latitude, longitude);
        }
    };

    const handleConfirm = () => {
        if (!address) {
            Alert.alert('No Address', 'Please select a location on the map or enter an address manually.');
            return;
        }
        onLocationSelected({
            address,
            latitude: markerPosition.latitude,
            longitude: markerPosition.longitude,
        });
        onDismiss();
    };

    return (
        <Portal>
            <Modal
                visible={visible}
                onDismiss={onDismiss}
                contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}
            >
                <View style={styles.header}>
                    <Text variant="headlineSmall" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                        {title}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                        Tap on the map to select a location
                    </Text>
                </View>

                <Surface style={styles.mapContainer} elevation={2}>
                    {isMapboxNativeAvailable() ? (
                        <SafeMapView
                            style={styles.map}
                            styleURL={Mapbox.StyleURL.Street}
                            onPress={handleMapPress}
                        >
                            <Mapbox.Camera
                                zoomLevel={14}
                                centerCoordinate={centerCoordinate}
                                animationMode="flyTo"
                                animationDuration={1000}
                            />
                            
                            <Mapbox.PointAnnotation
                                id="marker"
                                coordinate={[markerPosition.longitude, markerPosition.latitude]}
                            >
                                <View style={styles.markerContainer}>
                                    <MaterialCommunityIcons
                                        name="map-marker"
                                        size={40}
                                        color={theme.colors.primary}
                                    />
                                </View>
                            </Mapbox.PointAnnotation>
                        </SafeMapView>
                    ) : (
                        <View style={[styles.map, styles.fallbackMap]}>
                            <MaterialCommunityIcons name="map-marker-off" size={64} color="#666" />
                            <Text style={styles.fallbackText}>
                                Map requires a development build
                            </Text>
                            <Text style={styles.fallbackSubtext}>
                                Please enter address manually below
                            </Text>
                        </View>
                    )}

                    <Button
                        mode="contained-tonal"
                        icon="crosshairs-gps"
                        onPress={getCurrentLocation}
                        style={styles.currentLocationButton}
                        compact
                    >
                        My Location
                    </Button>
                </Surface>

                <TextInput
                    label="Address"
                    value={address}
                    onChangeText={setAddress}
                    mode="outlined"
                    multiline
                    numberOfLines={2}
                    style={styles.addressInput}
                    right={loading ? <TextInput.Icon icon="loading" /> : undefined}
                />

                <View style={styles.actions}>
                    <Button
                        onPress={onDismiss}
                        style={{ flex: 1, marginRight: 8 }}
                        mode="outlined"
                    >
                        Cancel
                    </Button>
                    <Button
                        mode="contained"
                        onPress={handleConfirm}
                        style={{ flex: 1 }}
                    >
                        Confirm
                    </Button>
                </View>
            </Modal>
        </Portal>
    );
}

const styles = StyleSheet.create({
    modalContent: {
        margin: 20,
        borderRadius: 16,
        padding: 20,
        maxHeight: '90%',
    },
    header: {
        marginBottom: 16,
    },
    mapContainer: {
        height: 300,
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 16,
        position: 'relative',
    },
    map: {
        ...StyleSheet.absoluteFillObject,
    },
    fallbackMap: {
        backgroundColor: '#1a1a2e',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    fallbackText: {
        color: '#888',
        fontSize: 16,
        marginTop: 16,
        textAlign: 'center',
    },
    fallbackSubtext: {
        color: '#666',
        fontSize: 12,
        marginTop: 8,
        textAlign: 'center',
    },
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    currentLocationButton: {
        position: 'absolute',
        top: 10,
        right: 10,
    },
    addressInput: {
        marginBottom: 16,
        backgroundColor: 'transparent',
    },
    actions: {
        flexDirection: 'row',
    },
});
