import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, ActivityIndicator, Keyboard, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { Text, TextInput, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../context/ThemeContext';
import MapboxGL, { StyleURL } from './map/MapboxWrapper';
import { calculateFare, PRICING } from '../services/pricingService';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const GOOGLE_MAPS_TOKEN = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const SERVICE_AREA_LABEL = 'Metro Manila and Cavite';

const SERVICE_AREA_BOUNDS = {
    north: 14.8,
    south: 13.6,
    east: 121.15,
    west: 120.55,
};

const isWithinServiceArea = (latitude: number, longitude: number): boolean => {
    return latitude >= SERVICE_AREA_BOUNDS.south && latitude <= SERVICE_AREA_BOUNDS.north && longitude >= SERVICE_AREA_BOUNDS.west && longitude <= SERVICE_AREA_BOUNDS.east;
};

type MapboxSuggestion = {
    id: string;
    name: string;
    address: string;
    coordinates?: [number, number];
};

export default function FareEstimator() {
    const { isDarkMode } = useAppTheme();
    const mono = {
        accent: isDarkMode ? '#F2F2F2' : '#111111',
        pickup: isDarkMode ? '#E4E4E7' : '#2E2E2E',
        dropoff: isDarkMode ? '#A1A1AA' : '#585858',
        route: isDarkMode ? '#E4E4E7' : '#2E2E2E',
        bg: isDarkMode ? '#000000' : '#FFFFFF',
        card: isDarkMode ? '#141414' : '#F6F6F6',
        border: isDarkMode ? '#2C2C2E' : '#E5E5EA',
        text: isDarkMode ? '#FFFFFF' : '#000000',
        textSec: isDarkMode ? '#8E8E93' : '#6B6B6B',
    };

    const [fromInput, setFromInput] = useState('');
    const [toInput, setToInput] = useState('');
    const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);

    const [fromCoords, setFromCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [toCoords, setToCoords] = useState<{ latitude: number; longitude: number } | null>(null);

    const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    
    const [routeData, setRouteData] = useState<{
        distance: number;
        duration: number;
        cost: number;
        route: any;
    } | null>(null);
    const [isEstimating, setIsEstimating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cameraRef = useRef<any>(null);

    const activeQuery = activeField === 'from' ? fromInput : activeField === 'to' ? toInput : '';

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, []);

    const GOOGLE_MAPS_TOKEN = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

    // Helper to reverse geocode using Google for better accuracy
    const reverseGeocodeGoogle = async (lat: number, lng: number): Promise<string | null> => {
        if (!GOOGLE_MAPS_TOKEN) return null;
        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_TOKEN}&result_type=street_address|premise|subpremise|point_of_interest`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.results && data.results.length > 0) {
                return data.results[0].formatted_address;
            }
        } catch (error) {
            console.error('Google Reverse Geocode Error', error);
        }
        return null;
    };

    const handleMyLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setError('Location permission denied.');
                return;
            }
            setIsSearching(true);
            const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            
            let addressString = 'My Location';
            const poiName = await reverseGeocodeGoogle(location.coords.latitude, location.coords.longitude);
            if (poiName) {
                addressString = poiName;
            } else {
                // Fallback to Expo location if Google fails
                try {
                    const [address] = await Location.reverseGeocodeAsync({
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude
                    });
                    if (address) {
                        const namePart = address.name || address.street || '';
                        const cityPart = address.city || address.subregion || '';
                        const combined = `${namePart} ${cityPart}`.trim();
                        if (combined.length > 0) addressString = combined;
                    }
                } catch (geocodeError) {
                    console.warn('Reverse geocoding fallback failed', geocodeError);
                }
            }

            if (!isWithinServiceArea(location.coords.latitude, location.coords.longitude)) {
                setError(`We only estimate fares within ${SERVICE_AREA_LABEL}.`);
                return;
            }

            setFromCoords({ latitude: location.coords.latitude, longitude: location.coords.longitude });
            setFromInput(addressString);
            setActiveField('to');
        } catch (e) {
            console.error('Error getting location', e);
            setError('Could not get your location.');
        } finally {
            setIsSearching(false);
        }
    };

    // Debounced search for Google Places
    useEffect(() => {
        if (!activeQuery || activeQuery.trim().length < 2 || !GOOGLE_MAPS_TOKEN) {
            setSuggestions([]);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            try {
                setIsSearching(true);
                setError(null);
                
                const response = await fetch(`https://places.googleapis.com/v1/places:autocomplete`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': GOOGLE_MAPS_TOKEN
                    },
                    body: JSON.stringify({
                        input: activeQuery.trim(),
                        includedRegionCodes: ["PH"],
                        locationBias: {
                            circle: {
                                center: { latitude: 14.5995, longitude: 120.9842 }, // Manila center
                                radius: 50000.0
                            }
                        }
                    }),
                    signal: controller.signal
                });

                if (!response.ok) throw new Error('Search failed');
                
                const data = await response.json();
                const features: MapboxSuggestion[] = Array.isArray(data?.suggestions)
                    ? data.suggestions.filter((s: any) => s.placePrediction).map((s: any) => {
                        const prediction = s.placePrediction;
                        return {
                            id: prediction.placeId,
                            name: prediction.structuredFormat?.mainText?.text || prediction.text?.text || 'Unknown',
                            address: prediction.structuredFormat?.secondaryText?.text || '',
                        };
                    }) : [];
                setSuggestions(features);
            } catch (err: any) {
                if (err?.name !== 'AbortError') {
                    console.error('Google Autocomplete Error:', err);
                }
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            clearTimeout(timeout);
            controller.abort();
        };
    }, [activeQuery]);

    const handleSelectSuggestion = async (item: MapboxSuggestion) => {
        if (!activeField || !GOOGLE_MAPS_TOKEN) return;
        Keyboard.dismiss();
        setSuggestions([]);

        let coords: { latitude: number; longitude: number } | null = null;

        if (item.coordinates && item.coordinates.length >= 2) {
            coords = { longitude: item.coordinates[0], latitude: item.coordinates[1] };
        } else {
            try {
                const url = `https://places.googleapis.com/v1/places/${item.id}?fields=location`;
                const response = await fetch(url, {
                    headers: { 'X-Goog-Api-Key': GOOGLE_MAPS_TOKEN }
                });
                const data = await response.json();
                if (data.location) {
                    coords = {
                        longitude: data.location.longitude,
                        latitude: data.location.latitude
                    };
                }
            } catch (e) {
                console.error("Failed to retrieve place details", e);
                setError("Network error while fetching location details.");
                return;
            }
        }

        if (!coords) return;

        if (!isWithinServiceArea(coords.latitude, coords.longitude)) {
            setError(`Please choose a location within ${SERVICE_AREA_LABEL}.`);
            return;
        }
        
        if (activeField === 'from') {
            setFromCoords(coords);
            setFromInput(item.name);
            setActiveField('to');
        } else {
            setToCoords(coords);
            setToInput(item.name);
            setActiveField(null);
        }
        setSuggestions([]);
    };

    const calculateRouteAndFare = async () => {
        if (!fromCoords || !toCoords || !MAPBOX_TOKEN) return;

        if (!isWithinServiceArea(fromCoords.latitude, fromCoords.longitude) || !isWithinServiceArea(toCoords.latitude, toCoords.longitude)) {
            setError(`We only estimate fares within ${SERVICE_AREA_LABEL}.`);
            setRouteData(null);
            return;
        }
        
        setIsEstimating(true);
        setError(null);
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromCoords.longitude},${fromCoords.latitude};${toCoords.longitude},${toCoords.latitude}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
            const response = await fetch(url);
            
            if (!response.ok) throw new Error('Could not calculate route');
            const data = await response.json();
            
            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                const distanceKm = route.distance / 1000;
                const durationMin = route.duration / 60;
                const cost = calculateFare(distanceKm, durationMin).total;

                setRouteData({
                    distance: distanceKm,
                    duration: durationMin,
                    cost,
                    route: {
                        type: 'Feature' as const,
                        geometry: route.geometry,
                        properties: {},
                    },
                });
            }
        } catch (err: any) {
            console.error('Route error:', err);
            setError('Failed to estimate fare. Please check your network.');
        } finally {
            setIsEstimating(false);
        }
    };

    useEffect(() => {
        if (fromCoords && toCoords) {
            calculateRouteAndFare();
        } else {
            setRouteData(null);
        }
    }, [fromCoords, toCoords]);



    return (
        <View style={[styles.container, { backgroundColor: mono.card, borderColor: mono.border }]}>
            <View style={styles.headerRow}>
                <MaterialCommunityIcons name="calculator-variant-outline" size={20} color={mono.accent} />
                <Text style={[styles.title, { color: mono.text }]}>Fare Estimator</Text>
            </View>
            <Text style={[styles.subtitle, { color: mono.textSec }]}>
                Get a live route estimate before you book.
            </Text>

            <View style={styles.inputsColumn}>
                <View style={[styles.inputWrapper, activeField === 'from' && { backgroundColor: isDarkMode ? '#1C1C1E' : '#F0F0F0' }]}>
                    <MaterialCommunityIcons name="map-marker" size={16} color="#34C759" style={styles.inputIcon} />
                    <TextInput
                        mode="flat"
                        placeholder="Pick-up point"
                        value={fromInput}
                        onChangeText={(t) => { setFromInput(t); setActiveField('from'); setFromCoords(null); }}
                        onFocus={() => setActiveField('from')}
                        style={styles.textInput}
                        textColor={mono.text}
                        placeholderTextColor={mono.textSec}
                        underlineColor="transparent"
                        activeUnderlineColor="transparent"
                        right={
                            fromInput.length > 0 ? (
                                <TextInput.Icon icon="close-circle" size={16} onPress={() => { setFromInput(''); setFromCoords(null); }} />
                            ) : (
                                <TextInput.Icon icon="crosshairs-gps" size={18} color="#0A84FF" onPress={handleMyLocation} />
                            )
                        }
                    />
                </View>
                <View style={[styles.divider, { backgroundColor: mono.border }]} />
                <View style={[styles.inputWrapper, activeField === 'to' && { backgroundColor: isDarkMode ? '#1C1C1E' : '#F0F0F0' }]}>
                    <MaterialCommunityIcons name="map-marker" size={16} color="#FF3B30" style={styles.inputIcon} />
                    <TextInput
                        mode="flat"
                        placeholder="Enter destination"
                        value={toInput}
                        onChangeText={(t) => { setToInput(t); setActiveField('to'); setToCoords(null); }}
                        onFocus={() => setActiveField('to')}
                        style={styles.textInput}
                        textColor={mono.text}
                        placeholderTextColor={mono.textSec}
                        underlineColor="transparent"
                        activeUnderlineColor="transparent"
                        right={toInput.length > 0 ? <TextInput.Icon icon="close-circle" size={16} onPress={() => { setToInput(''); setToCoords(null); }} /> : null}
                    />
                </View>
            </View>

            {/* Suggestions Dropdown */}
            {activeField && activeQuery.length >= 2 && (
                <View style={[styles.suggestionsBox, { backgroundColor: mono.bg, borderColor: mono.border }]}>
                    {isSearching ? (
                        <ActivityIndicator size="small" color={mono.accent} style={{ padding: 12 }} />
                    ) : suggestions.length === 0 ? (
                        <Text style={[styles.noSuggestions, { color: mono.textSec }]}>No suggestions found.</Text>
                    ) : (
                        <ScrollView 
                            nestedScrollEnabled={true} 
                            keyboardShouldPersistTaps="handled" 
                            style={{ maxHeight: 250 }}
                            // The onTouchStart block prevents the parent ScrollView from taking over the gesture
                            onTouchStart={(e) => e.stopPropagation()}
                        >
                            {suggestions.map((item, index) => (
                                <TouchableOpacity 
                                    key={item.id} 
                                    style={[styles.suggestionItem, index < suggestions.length - 1 && { borderBottomColor: mono.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
                                    onPress={() => handleSelectSuggestion(item)}
                                >
                                    <MaterialCommunityIcons name="map-marker-outline" size={16} color={mono.textSec} style={{ marginTop: 2 }} />
                                    <View style={{ flex: 1, marginLeft: 8 }}>
                                        <Text style={[styles.suggestionName, { color: mono.text }]} numberOfLines={1}>{item.name}</Text>
                                        {item.address ? (
                                            <Text style={[styles.suggestionAddress, { color: mono.textSec }]} numberOfLines={1}>{item.address}</Text>
                                        ) : null}
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    )}
                </View>
            )}

            {error && (
                <Text style={{ color: '#FF3B30', fontSize: 12, marginTop: 8 }}>{error}</Text>
            )}

            {isEstimating && (
                <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={mono.accent} />
                    <Text style={{ marginLeft: 8, color: mono.textSec, fontSize: 13 }}>Computing route...</Text>
                </View>
            )}

            {/* Map Preview & Results */}
            {routeData && !isEstimating && (
                <View style={[styles.resultsContainer, { borderColor: mono.border }]}>
                    <View style={[styles.mapContainer, { backgroundColor: mono.bg }]}>
                        {MAPBOX_TOKEN ? (
                            <MapboxGL.MapView
                                style={StyleSheet.absoluteFillObject}
                                styleURL={isDarkMode ? StyleURL.Dark : StyleURL.Light}
                                logoEnabled={false}
                                attributionEnabled={false}
                                scrollEnabled={false}
                                pitchEnabled={false}
                                rotateEnabled={false}
                                zoomEnabled={false}
                            >
                                <MapboxGL.Camera
                                    ref={cameraRef}
                                    defaultSettings={{
                                        centerCoordinate: [120.9842, 14.5995], // Manila default fallback
                                        zoomLevel: 10,
                                    }}
                                    animationMode="flyTo"
                                    animationDuration={1500}
                                    bounds={fromCoords && toCoords ? {
                                        // Mapbox expects [lng, lat]
                                        ne: [
                                            Math.max(fromCoords.longitude, toCoords.longitude),
                                            Math.max(fromCoords.latitude, toCoords.latitude)
                                        ],
                                        sw: [
                                            Math.min(fromCoords.longitude, toCoords.longitude),
                                            Math.min(fromCoords.latitude, toCoords.latitude)
                                        ],
                                        paddingTop: 60,
                                        paddingBottom: 60,
                                        paddingLeft: 60,
                                        paddingRight: 60,
                                    } : undefined}
                                />
                                {fromCoords && (
                                    <MapboxGL.PointAnnotation id="from-pin" coordinate={[fromCoords.longitude, fromCoords.latitude]}>
                                        <View style={[styles.pin, { backgroundColor: '#34C759', borderColor: mono.bg }]} />
                                    </MapboxGL.PointAnnotation>
                                )}
                                {toCoords && (
                                    <MapboxGL.PointAnnotation id="to-pin" coordinate={[toCoords.longitude, toCoords.latitude]}>
                                        <View style={[styles.pin, { backgroundColor: '#FF3B30', borderColor: mono.bg }]} />
                                    </MapboxGL.PointAnnotation>
                                )}
                                {routeData.route && (
                                    <MapboxGL.ShapeSource id="preview-route" shape={{ type: 'FeatureCollection' as const, features: [routeData.route] }}>
                                        <MapboxGL.LineLayer id="preview-route-layer" style={{ lineColor: '#0A84FF', lineWidth: 4, lineJoin: 'round', lineCap: 'round' }} />
                                    </MapboxGL.ShapeSource>
                                )}
                            </MapboxGL.MapView>
                        ) : (
                            <View style={styles.fallbackMap}>
                                <Text style={{ color: mono.textSec }}>Map unavailable</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.statsRow}>
                        <View style={styles.statBox}>
                            <Text style={[styles.statLabel, { color: mono.textSec }]}>Distance</Text>
                            <Text style={[styles.statValue, { color: mono.text }]}>{routeData.distance.toFixed(1)} km</Text>
                        </View>
                        <View style={[styles.statDivider, { backgroundColor: mono.border }]} />
                        <View style={styles.statBox}>
                            <Text style={[styles.statLabel, { color: mono.textSec }]}>Time</Text>
                            <Text style={[styles.statValue, { color: mono.text }]}>{Math.round(routeData.duration)} min</Text>
                        </View>
                        <View style={[styles.statDivider, { backgroundColor: mono.border }]} />
                        <View style={styles.statBox}>
                            <Text style={[styles.statLabel, { color: '#0A84FF' }]}>Estimated</Text>
                            <Text style={[styles.statValue, { color: '#0A84FF', fontSize: 16 }]}>₱{routeData.cost.toFixed(2)}</Text>
                        </View>
                    </View>

                    <View style={[styles.breakdownBox, { backgroundColor: isDarkMode ? '#1C1C1E' : '#F0F0F0' }]}>
                        <Text style={[styles.breakdownLabel, { color: mono.textSec }]}>Fare Breakdown</Text>
                        <Text style={[styles.breakdownText, { color: mono.text }]}>
                            Base ₱{PRICING.BASE_FARE} + {routeData.distance.toFixed(2)}km × ₱{PRICING.PER_KM} + {Math.round(routeData.duration)}m × ₱{PRICING.PER_MIN}
                        </Text>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 14,
        marginBottom: 24,
        marginHorizontal: 16,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    title: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    subtitle: {
        fontSize: 13,
        marginTop: 4,
        marginBottom: 14,
    },
    inputsColumn: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'transparent',
        overflow: 'hidden',
        backgroundColor: 'rgba(150, 150, 150, 0.1)',
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 12,
        height: 50,
    },
    inputIcon: {
        width: 20,
    },
    textInput: {
        flex: 1,
        backgroundColor: 'transparent',
        height: 50,
        fontSize: 14,
    },
    divider: {
        height: 1,
        marginLeft: 36,
    },
    suggestionsBox: {
        marginTop: 8,
        borderRadius: 10,
        borderWidth: 1,
        maxHeight: 200,
        overflow: 'hidden',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 12,
    },
    suggestionName: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 2,
    },
    suggestionAddress: {
        fontSize: 11,
    },
    noSuggestions: {
        fontSize: 12,
        padding: 12,
        textAlign: 'center',
    },
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 16,
    },
    resultsContainer: {
        marginTop: 16,
        borderRadius: 10,
        borderWidth: 1,
        overflow: 'hidden',
    },
    mapContainer: {
        height: 160,
        width: '100%',
        position: 'relative',
    },
    fallbackMap: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    pin: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
    },
    statsRow: {
        flexDirection: 'row',
        padding: 12,
    },
    statBox: {
        flex: 1,
        alignItems: 'center',
    },
    statDivider: {
        width: 1,
        marginVertical: 4,
    },
    statLabel: {
        fontSize: 11,
        marginBottom: 2,
        fontFamily: 'Inter_600SemiBold',
        textTransform: 'uppercase',
    },
    statValue: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    breakdownBox: {
        marginHorizontal: 12,
        marginBottom: 12,
        padding: 10,
        borderRadius: 8,
    },
    breakdownLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 4,
    },
    breakdownText: {
        fontSize: 12,
    },
});
