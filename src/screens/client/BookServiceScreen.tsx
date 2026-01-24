import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, Modal, Animated } from 'react-native';
import { Text, TextInput, Button, useTheme, Card, Divider } from 'react-native-paper';
import MapboxGL from '../../components/map/MapboxWrapper';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

// Fallback initial region (Manila)
const INITIAL_REGION = {
    latitude: 14.5995,
    longitude: 120.9842,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
};

type MapboxSuggestion = {
    id: string;
    name: string;
    coordinates?: [number, number];
};

export default function BookServiceScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [pickupText, setPickupText] = useState('');
    const [dropoffText, setDropoffText] = useState('');

    const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Coordinates
    const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);

    // Which input is currently focused/active for map selection
    const [activeField, setActiveField] = useState<'pickup' | 'dropoff'>('pickup');
    
    // Route data (auto-calculated)
    const [routeData, setRouteData] = useState<{
        distance: number;
        duration: number;
        cost: number;
        route: any;
    } | null>(null);
    const [loadingRoute, setLoadingRoute] = useState(false);

    const activeQuery = activeField === 'pickup' ? pickupText : dropoffText;

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                return;
            }

            let location = await Location.getCurrentPositionAsync({});

            // Auto-set pickup to current location initially
            setPickupCoords(location.coords);
            setPickupText('Current Location');
        })();
    }, []);

    useEffect(() => {
        if (!MAPBOX_TOKEN) return;
        if (!activeQuery || activeQuery.trim().length < 3) {
            setSuggestions([]);
            setSearchError(null);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            try {
                setIsSearching(true);
                setSearchError(null);

                const proximity = pickupCoords
                    ? `${pickupCoords.longitude},${pickupCoords.latitude}`
                    : undefined;

                const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
                url.searchParams.set('q', activeQuery.trim());
                url.searchParams.set('access_token', MAPBOX_TOKEN);
                url.searchParams.set('limit', '8');
                url.searchParams.set('types', 'address,place,locality,neighborhood,street,district');
                url.searchParams.set('country', 'PH');
                url.searchParams.set('language', 'en');
                url.searchParams.set('autocomplete', 'true');
                if (proximity) {
                    url.searchParams.set('proximity', proximity);
                }

                const response = await fetch(url.toString(), { signal: controller.signal });
                if (!response.ok) {
                    const errorData = await response.text();
                    console.error('Mapbox API error:', response.status, errorData);
                    throw new Error(`Search failed: ${response.status}`);
                }

                const data = await response.json();
                console.log('Mapbox response:', data);
                const features: MapboxSuggestion[] = Array.isArray(data?.features)
                    ? data.features.map((feature: any) => {
                        const props = feature.properties || {};
                        // Build a more descriptive name with context
                        let displayName = props.full_address || props.name || 'Unknown location';
                        
                        // If it's just a street/place name, add context
                        if (props.context) {
                            const locality = props.context.locality?.name;
                            const place = props.context.place?.name;
                            const region = props.context.region?.name;
                            
                            if (!props.full_address && (locality || place)) {
                                displayName = `${props.name || displayName}${locality ? ', ' + locality : ''}${place && place !== locality ? ', ' + place : ''}`;
                            }
                        }
                        
                        return {
                            id: feature.id,
                            name: displayName,
                            coordinates: feature.geometry?.coordinates,
                        };
                    })
                    : [];

                setSuggestions(features);
            } catch (error: any) {
                if (error?.name !== 'AbortError') {
                    console.error('Search error:', error);
                    setSearchError('Unable to load locations. Try again.');
                    setSuggestions([]);
                }
            } finally {
                setIsSearching(false);
            }
        }, 350);

        return () => {
            clearTimeout(timeout);
            controller.abort();
        };
    }, [activeQuery, MAPBOX_TOKEN, pickupCoords]);

    const handleMapPress = (e: any) => {
        const coords = {
            latitude: e.geometry.coordinates[1],
            longitude: e.geometry.coordinates[0],
        };
        setSuggestions([]);
        setSearchError(null);
        if (activeField === 'pickup') {
            setPickupCoords(coords);
            setPickupText(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
        } else {
            setDropoffCoords(coords);
            setDropoffText(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
        }
    };

    const handleSelectSuggestion = (item: MapboxSuggestion) => {
        if (!item.coordinates || item.coordinates.length < 2) return;
        const coords = { longitude: item.coordinates[0], latitude: item.coordinates[1] };

        if (activeField === 'pickup') {
            setPickupCoords(coords);
            setPickupText(item.name);
        } else {
            setDropoffCoords(coords);
            setDropoffText(item.name);
        }

        setSuggestions([]);
        setSearchError(null);
    };

    const calculateRoute = async () => {
        if (!pickupCoords || !dropoffCoords || !MAPBOX_TOKEN) {
            setRouteData(null);
            return;
        }

        setLoadingRoute(true);
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupCoords.longitude},${pickupCoords.latitude};${dropoffCoords.longitude},${dropoffCoords.latitude}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
            
            const response = await fetch(url);
            const data = await response.json();

            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                const distanceKm = route.distance / 1000;
                const durationMin = route.duration / 60;
                
                // Calculate cost: Base fare + per km + per minute
                const baseFare = 50;
                const perKm = 15;
                const perMin = 2;
                const cost = baseFare + (distanceKm * perKm) + (durationMin * perMin);

                setRouteData({
                    distance: distanceKm,
                    duration: durationMin,
                    cost: Math.round(cost),
                    route: route.geometry,
                });
            }
        } catch (error) {
            console.error('Route calculation error:', error);
            setRouteData(null);
        } finally {
            setLoadingRoute(false);
        }
    };

    // Auto-calculate route when both locations are selected
    useEffect(() => {
        calculateRoute();
    }, [pickupCoords, dropoffCoords, MAPBOX_TOKEN]);

    const handleConfirm = () => {
        if (!pickupCoords || !dropoffCoords) {
            Alert.alert('Missing Location', 'Please select both Pickup and Dropoff locations.');
            return;
        }

        if (!routeData) {
            Alert.alert('Calculating Route', 'Please wait while we calculate your route.');
            return;
        }

        navigation.navigate('SearchingRider', {
            pickup: pickupText,
            dropoff: dropoffText,
            pickupLat: pickupCoords?.latitude,
            pickupLng: pickupCoords?.longitude,
            dropoffLat: dropoffCoords?.latitude,
            dropoffLng: dropoffCoords?.longitude,
            estimatedCost: routeData?.cost,
        });
    };

    return (
        <View style={styles.container}>
            {/* Map Background */}
            {MAPBOX_TOKEN ? (
                <MapboxGL.MapView
                    style={StyleSheet.absoluteFillObject}
                    onPress={handleMapPress}
                    logoEnabled={false}
                    attributionEnabled={false}
                >
                    <MapboxGL.Camera
                        zoomLevel={14}
                        centerCoordinate={pickupCoords
                            ? [pickupCoords.longitude, pickupCoords.latitude]
                            : [INITIAL_REGION.longitude, INITIAL_REGION.latitude]}
                    />
                    <MapboxGL.UserLocation visible />

                    {pickupCoords && (
                        <MapboxGL.PointAnnotation
                            id="pickup-marker"
                            coordinate={[pickupCoords.longitude, pickupCoords.latitude]}
                            title="Pickup"
                        >
                            <View style={styles.markerContainer}>
                                <MaterialCommunityIcons name="map-marker" size={40} color="green" />
                            </View>
                        </MapboxGL.PointAnnotation>
                    )}

                    {dropoffCoords && (
                        <MapboxGL.PointAnnotation
                            id="dropoff-marker"
                            coordinate={[dropoffCoords.longitude, dropoffCoords.latitude]}
                            title="Dropoff"
                        >
                            <View style={styles.markerContainer}>
                                <MaterialCommunityIcons name="map-marker" size={40} color="red" />
                            </View>
                        </MapboxGL.PointAnnotation>
                    )}

                    {/* Route Line */}
                    {routeData && routeData.route && (
                        <MapboxGL.ShapeSource id="route-line" shape={routeData.route}>
                            <MapboxGL.LineLayer
                                id="route-layer"
                                style={{
                                    lineColor: theme.colors.primary,
                                    lineWidth: 4,
                                    lineOpacity: 0.8,
                                }}
                            />
                        </MapboxGL.ShapeSource>
                    )}
                </MapboxGL.MapView>
            ) : (
                <View style={[StyleSheet.absoluteFillObject, styles.mapFallback]}>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env
                    </Text>
                </View>
            )}

            {/* Floating Input Card */}
            <View style={styles.inputContainer}>
                <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                    <Card.Content>
                        <Text variant="titleMedium" style={[styles.title, { color: theme.colors.onSurface }]}>Book a Service</Text>

                        <View
                            style={[
                                styles.inputWrapper,
                                { backgroundColor: theme.colors.background, borderColor: theme.colors.outline },
                                activeField === 'pickup' && { backgroundColor: theme.colors.secondaryContainer, borderColor: theme.colors.primary }
                            ]}
                        >
                            <MaterialCommunityIcons name="circle-slice-8" size={20} color="green" style={styles.inputIcon} />
                            <TextInput
                                mode="flat"
                                placeholder="Pickup Location"
                                value={pickupText}
                                onChangeText={(text) => {
                                    setPickupText(text);
                                    setActiveField('pickup');
                                }}
                                style={[styles.textInput, { backgroundColor: 'transparent' }]}
                                textColor={theme.colors.onSurface}
                                underlineColor="transparent"
                                activeUnderlineColor="transparent"
                                placeholderTextColor={theme.colors.onSurfaceVariant}
                                onFocus={() => setActiveField('pickup')}
                                right={<TextInput.Icon icon="crosshairs-gps" onPress={() => setActiveField('pickup')} />}
                            />
                        </View>

                        <View style={styles.divider} />

                        <View
                            style={[
                                styles.inputWrapper,
                                { backgroundColor: theme.colors.background, borderColor: theme.colors.outline },
                                activeField === 'dropoff' && { backgroundColor: theme.colors.secondaryContainer, borderColor: theme.colors.primary }
                            ]}
                        >
                            <MaterialCommunityIcons name="map-marker" size={20} color="red" style={styles.inputIcon} />
                            <TextInput
                                mode="flat"
                                placeholder="Dropoff Location"
                                value={dropoffText}
                                onChangeText={(text) => {
                                    setDropoffText(text);
                                    setActiveField('dropoff');
                                }}
                                style={[styles.textInput, { backgroundColor: 'transparent' }]}
                                textColor={theme.colors.onSurface}
                                underlineColor="transparent"
                                activeUnderlineColor="transparent"
                                placeholderTextColor={theme.colors.onSurfaceVariant}
                                onFocus={() => setActiveField('dropoff')}
                            />
                        </View>

                        <View style={styles.helperTextContainer}>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                {activeField === 'pickup'
                                    ? 'Type to search or tap map to set Pickup'
                                    : 'Type to search or tap map to set Dropoff'}
                            </Text>
                        </View>

                        {(isSearching || searchError || suggestions.length > 0) && (
                            <View style={[styles.suggestionsContainer, { borderColor: theme.colors.outline }]}
                            >
                                {isSearching && (
                                    <View style={styles.suggestionLoading}>
                                        <ActivityIndicator size="small" color={theme.colors.primary} />
                                        <Text variant="bodySmall" style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>
                                            Searching locations...
                                        </Text>
                                    </View>
                                )}

                                {!!searchError && !isSearching && (
                                    <Text variant="bodySmall" style={{ color: theme.colors.error, paddingHorizontal: 12, paddingVertical: 8 }}>
                                        {searchError}
                                    </Text>
                                )}

                                {!isSearching && !searchError && suggestions.map((item) => (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={styles.suggestionItem}
                                        onPress={() => handleSelectSuggestion(item)}
                                    >
                                        <MaterialCommunityIcons name="map-marker-outline" size={18} color={theme.colors.primary} />
                                        <Text variant="bodyMedium" style={{ marginLeft: 8, color: theme.colors.onSurface }} numberOfLines={2}>
                                            {item.name}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                        <Button
                            mode="contained"
                            onPress={handleConfirm}
                            style={styles.button}
                            contentStyle={{ paddingVertical: 4 }}
                            disabled={!pickupCoords || !dropoffCoords || !routeData}
                        >
                            Confirm Booking
                        </Button>
                    </Card.Content>
                </Card>
            </View>

            {/* Bottom Route Preview Card */}
            {routeData && pickupCoords && dropoffCoords && (
                <View style={styles.bottomPreviewContainer}>
                    <Card style={[styles.bottomPreviewCard, { backgroundColor: theme.colors.surface }]} elevation={5}>
                        <Card.Content>
                            <View style={styles.previewHeader}>
                                <MaterialCommunityIcons name="routes" size={24} color={theme.colors.primary} />
                                <Text variant="titleMedium" style={{ marginLeft: 8, color: theme.colors.onSurface, fontWeight: 'bold' }}>
                                    Trip Details
                                </Text>
                            </View>

                            <View style={styles.previewStats}>
                                <View style={styles.statItem}>
                                    <MaterialCommunityIcons name="map-marker-distance" size={20} color={theme.colors.primary} />
                                    <View style={{ marginLeft: 8 }}>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Distance</Text>
                                        <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                                            {routeData.distance.toFixed(1)} km
                                        </Text>
                                    </View>
                                </View>

                                <View style={styles.statItem}>
                                    <MaterialCommunityIcons name="clock-outline" size={20} color={theme.colors.primary} />
                                    <View style={{ marginLeft: 8 }}>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Time</Text>
                                        <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                                            {Math.round(routeData.duration)} min
                                        </Text>
                                    </View>
                                </View>

                                <View style={styles.statItem}>
                                    <MaterialCommunityIcons name="cash" size={20} color={theme.colors.primary} />
                                    <View style={{ marginLeft: 8 }}>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Fare</Text>
                                        <Text variant="bodyLarge" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                                            ₱{routeData.cost}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </Card.Content>
                    </Card>
                </View>
            )}

            <TouchableOpacity style={[styles.backButton, { backgroundColor: theme.colors.surface }]} onPress={() => navigation.goBack()}>
                <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    mapFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f1f1f1',
    },
    inputContainer: {
        position: 'absolute',
        top: 60,
        left: 20,
        right: 20,
    },
    card: {
        borderRadius: 12,
        elevation: 4,
    },
    title: {
        fontWeight: 'bold',
        marginBottom: 16,
        textAlign: 'center',
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 8,
        borderWidth: 1,
    },
    activeInput: {
        borderColor: '#2196F3',
    },
    inputIcon: {
        marginLeft: 12,
    },
    textInput: {
        flex: 1,
        backgroundColor: 'transparent',
        height: 50,
        fontSize: 14,
    },
    divider: {
        height: 12,
    },
    button: {
        marginTop: 16,
        borderRadius: 8,
    },
    backButton: {
        position: 'absolute',
        top: 40, // Adjust for status bar
        left: 20,
        padding: 8,
        borderRadius: 20,
        elevation: 3,
    },
    helperTextContainer: {
        marginTop: 8,
        alignItems: 'center',
    },
    suggestionsContainer: {
        marginTop: 10,
        borderWidth: 1,
        borderRadius: 10,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        maxHeight: 180,
        overflow: 'hidden',
    },
    suggestionLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.08)',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
        maxHeight: '85%',
    },
    previewMapContainer: {
        height: 250,
        width: '100%',
    },
    previewMap: {
        flex: 1,
    },
    previewMarker: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    tripDetails: {
        padding: 20,
    },
    modalTitle: {
        fontWeight: 'bold',
        marginBottom: 20,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    detailText: {
        marginLeft: 16,
        flex: 1,
    },
    costRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
    },
    modalButton: {
        flex: 1,
    },
    bottomPreviewContainer: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
    },
    bottomPreviewCard: {
        borderRadius: 16,
    },
    previewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    previewStats: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    statItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
});