import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, ScrollView, TouchableOpacity, Keyboard, ActivityIndicator } from 'react-native';
import { Portal, Modal, Button, Text, useTheme, Surface, TextInput, Divider } from 'react-native-paper';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeMapView, isMapboxNativeAvailable } from './map/MapboxWrapper';
import Mapbox from '@rnmapbox/maps';
import { PremiumAlert } from '../services/PremiumAlertService';

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

type MapboxSuggestion = {
    id: string;
    name: string;
    address?: string;
    coordinates?: [number, number];
};

export default function LocationPicker({
    visible,
    onDismiss,
    onLocationSelected,
    initialLocation,
    title = 'Select Location'
}: LocationPickerProps) {
    const theme = useTheme();
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [centerCoordinate, setCenterCoordinate] = useState<[number, number]>([
        initialLocation?.longitude || 120.9842, // Manila default [lng, lat]
        initialLocation?.latitude || 14.5995,
    ]);
    const [markerPosition, setMarkerPosition] = useState({
        latitude: initialLocation?.latitude || 14.5995,
        longitude: initialLocation?.longitude || 120.9842,
    });
    const [address, setAddress] = useState(initialLocation?.address || '');

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [sessionToken, setSessionToken] = useState('');
    const [isManualSelection, setIsManualSelection] = useState(false); // To prevent search while typing selected address

    useEffect(() => {
        if (visible) {
            // Generate new session token on open
            setSessionToken(Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2));
            if (!initialLocation) {
                getCurrentLocation();
            } else {
                setAddress(initialLocation.address);
                setSearchQuery(initialLocation.address);
                setIsManualSelection(true); // Don't trigger search for initial value
            }
        }
    }, [visible]);

    // Cleanup suggestions on dismiss
    useEffect(() => {
        if (!visible) {
            setSuggestions([]);
            setSearchQuery('');
            setIsManualSelection(false);
        }
    }, [visible]);

    const getCurrentLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                PremiumAlert.alert('Permission Denied', 'Please enable location permissions to use this feature.');
                return;
            }

            const location = await Location.getCurrentPositionAsync({});
            const newPosition = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
            };
            setMarkerPosition(newPosition);
            setCenterCoordinate([location.coords.longitude, location.coords.latitude]);

            // Use Mapbox reverse geocoding for consistency
            await reverseGeocode(location.coords.latitude, location.coords.longitude);
        } catch (error) {
            console.error('Error getting location:', error);
        }
    };

    const reverseGeocode = async (latitude: number, longitude: number) => {
        if (!MAPBOX_TOKEN) return;

        try {
            // Prioritize POIs (poi, poi.landmark) then addresses
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}&types=poi,poi.landmark,address,place&limit=1`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                const placeName = feature.text;
                const fullAddress = feature.place_name; // More complete address

                setAddress(fullAddress);
                setSearchQuery(fullAddress);
                setIsManualSelection(true); // Prevent search trigger
            }
        } catch (error) {
            console.error('Error reverse geocoding:', error);
        }
    };

    // Search Effect
    useEffect(() => {
        if (!MAPBOX_TOKEN || !searchQuery || isManualSelection || searchQuery.length < 2) {
            setSuggestions([]);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            try {
                setIsSearching(true);

                const proximity = `${markerPosition.longitude},${markerPosition.latitude}`;

                const queryParams = [
                    `q=${encodeURIComponent(searchQuery.trim())}`,
                    `access_token=${MAPBOX_TOKEN}`,
                    `session_token=${sessionToken}`,
                    `limit=8`,
                    `language=en`,
                    `country=PH`, // Restrict to Philippines
                    `types=poi,address,place,category,brand`, // Prioritize POIs
                    `proximity=${proximity}`
                ].join('&');

                const url = `https://api.mapbox.com/search/searchbox/v1/suggest?${queryParams}`;
                const response = await fetch(url, { signal: controller.signal });
                const data = await response.json();

                if (data.suggestions) {
                    const mapped = data.suggestions.map((s: any) => ({
                        id: s.mapbox_id,
                        name: s.name,
                        address: s.full_address || s.place_formatted,
                        // Coordinates not returned in suggest
                    }));
                    setSuggestions(mapped);
                }
            } catch (error: any) {
                if (error.name !== 'AbortError') {
                    console.error('Search error:', error);
                }
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            clearTimeout(timeout);
            controller.abort();
        };
    }, [searchQuery, MAPBOX_TOKEN, isManualSelection, sessionToken]);

    const handleSelectSuggestion = async (item: MapboxSuggestion) => {
        Keyboard.dismiss();
        setSearchQuery(item.name + (item.address ? `, ${item.address}` : ''));
        setIsManualSelection(true);
        setSuggestions([]);

        try {
            const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${item.id}?session_token=${sessionToken}&access_token=${MAPBOX_TOKEN}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.features && data.features.length > 0) {
                const coords = data.features[0].geometry.coordinates;
                const [lng, lat] = coords;

                setMarkerPosition({ latitude: lat, longitude: lng });
                setCenterCoordinate([lng, lat]);
                setAddress(item.name + (item.address ? `, ${item.address}` : ''));
            }
        } catch (error) {
            PremiumAlert.alert("Error", "Could not fetch location details.");
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
            PremiumAlert.alert('No Address', 'Please select a location on the map or enter an address manually.');
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
                        Search or tap on the map
                    </Text>
                </View>

                {/* Search Input */}
                <View style={styles.searchContainer}>
                    <TextInput
                        placeholder="Search for a place or address"
                        value={searchQuery}
                        onChangeText={(text) => {
                            setSearchQuery(text);
                            setAddress(text); // Fix: Sync address with search input
                            setIsManualSelection(false);
                        }}
                        mode="outlined"
                        dense
                        left={<TextInput.Icon icon="magnify" />}
                        right={searchQuery.length > 0 ? <TextInput.Icon icon="close" onPress={() => {
                            setSearchQuery('');
                            setAddress('');
                        }} /> : undefined}
                        style={styles.searchInput}
                    />

                    {/* Suggestions List */}
                    {(suggestions.length > 0 || isSearching) && (
                        <Surface style={styles.suggestionsList} elevation={4}>
                            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
                                {isSearching && <ActivityIndicator style={{ padding: 10 }} />}
                                {suggestions.map((item) => (
                                    <View key={item.id}>
                                        <TouchableOpacity
                                            style={styles.suggestionItem}
                                            onPress={() => handleSelectSuggestion(item)}
                                        >
                                            <MaterialCommunityIcons name="map-marker" size={20} color={theme.colors.primary} />
                                            <View style={styles.suggestionText}>
                                                <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>{item.name}</Text>
                                                {item.address && (
                                                    <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                                                        {item.address}
                                                    </Text>
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                        <Divider />
                                    </View>
                                ))}
                            </ScrollView>
                        </Surface>
                    )}
                </View>

                <Surface style={styles.mapContainer} elevation={2}>
                    {isMapboxNativeAvailable() ? (
                        <SafeMapView
                            style={styles.map}
                            styleURL={Mapbox.StyleURL.Street}
                            onPress={handleMapPress}
                        >
                            <Mapbox.Camera
                                zoomLevel={15}
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
        flex: 1, // Full height for map usability
        maxHeight: '90%',
    },
    header: {
        marginBottom: 10,
    },
    searchContainer: {
        zIndex: 10, // Ensure suggestions float above map
        marginBottom: 10,
        position: 'relative',
    },
    searchInput: {
        backgroundColor: 'white',
    },
    suggestionsList: {
        position: 'absolute',
        top: 50, // Below input
        left: 0,
        right: 0,
        backgroundColor: 'white',
        borderRadius: 8,
        maxHeight: 200,
        zIndex: 20,
    },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
    },
    suggestionText: {
        marginLeft: 10,
        flex: 1,
    },
    mapContainer: {
        flex: 1, // Take remaining space
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 16,
        position: 'relative',
        zIndex: 1,
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
        bottom: 10,
        right: 10,
    },
    actions: {
        flexDirection: 'row',
        zIndex: 1,
    },
});
