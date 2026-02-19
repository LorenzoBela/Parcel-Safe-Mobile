import { useNavigation, useFocusEffect } from '@react-navigation/native';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, Modal, Animated, ScrollView } from 'react-native';
import { Text, TextInput, Button, useTheme, Card, Divider, List } from 'react-native-paper';
import MapboxGL, { StyleURL } from '../../components/map/MapboxWrapper';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../services/supabaseClient'; // Import Supabase

// Fallback initial region (Manila)
const INITIAL_REGION = {
    latitude: 14.5995,
    longitude: 120.9842,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
};

// Start of EC-Update: Imports for persistence
import { checkActiveBookings } from '../../services/riderMatchingService';
import useAuthStore from '../../store/authStore';
// End of EC-Update

type MapboxSuggestion = {
    id: string;
    name: string;
    address?: string; // Subtitle for UI
    coordinates?: [number, number];
};

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BookServiceScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    // EC-Update: Get userId and name for persistence check and booking
    const userId = useAuthStore((state: any) => state.user?.userId);
    const userFullName = useAuthStore((state: any) => state.user?.fullName || state.user?.name);
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [pickupText, setPickupText] = useState('');
    const [dropoffText, setDropoffText] = useState('');

    const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Coordinates
    const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);

    // Saved Addresses
    const [savedAddresses, setSavedAddresses] = useState<any[]>([]);

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

    // Active booking guard — prevents spam bookings
    const [hasActiveBooking, setHasActiveBooking] = useState(false);

    const activeQuery = activeField === 'pickup' ? pickupText : dropoffText;

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    // EC-Update: Check for active bookings on focus to restore state AND block spam
    useFocusEffect(
        useCallback(() => {
            if (!userId) return;

            const checkPersistence = async () => {
                try {
                    // Check for any active booking for this user
                    const activeBooking = await checkActiveBookings(userId);

                    if (activeBooking) {
                        setHasActiveBooking(true);
                        console.log('[BookService] Active booking detected:', activeBooking.bookingId, activeBooking.status);

                        if (activeBooking.status === 'PENDING') {
                            // Restore "Searching Rider" screen
                            navigation.navigate('SearchingRider', {
                                pickup: activeBooking.pickupAddress,
                                dropoff: activeBooking.dropoffAddress,
                                pickupLat: activeBooking.pickupLat,
                                pickupLng: activeBooking.pickupLng,
                                dropoffLat: activeBooking.dropoffLat,
                                dropoffLng: activeBooking.dropoffLng,
                                estimatedFare: activeBooking.estimatedFare,
                                existingBookingId: activeBooking.bookingId, // Pass ID to resume
                                shareToken: activeBooking.shareToken
                            });
                        } else if (['ASSIGNED', 'IN_TRANSIT', 'ARRIVED', 'PICKED_UP'].includes(activeBooking.status)) {
                            // Restore "Track Order" screen
                            navigation.navigate('TrackOrder', {
                                bookingId: activeBooking.bookingId,
                                riderId: activeBooking.riderId,
                                shareToken: activeBooking.shareToken
                            });
                        }
                    } else {
                        setHasActiveBooking(false);
                    }
                } catch (error) {
                    console.error('[BookService] Error checking persistence:', error);
                    setHasActiveBooking(false);
                }
            };

            checkPersistence();
        }, [userId, navigation])
    );
    // End of EC-Update


    // Helper to get nicer names (POIs) from Mapbox
    const reverseGeocodeMapbox = async (lat: number, lng: number): Promise<string | null> => {
        if (!MAPBOX_TOKEN) return null;
        try {
            // Added 'poi' and 'poi.landmark' to types to prioritize specific places over just streets
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=poi,poi.landmark,address,place&limit=1`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.features && data.features.length > 0) {
                // Mapbox returns the most relevant feature first based on types
                // We prefer the specific POI name (e.g. "Adamson University") over the address if available
                return data.features[0].text;
            }
        } catch (error) {
            console.error("Mapbox Reverse Geocode Error", error);
        }
        return null;
    };

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                return;
            }

            let location = await Location.getCurrentPositionAsync({});

            // Auto-set pickup to current location initially
            setPickupCoords(location.coords);

            // Reverse geocode current location using Mapbox for better POI support
            const poiName = await reverseGeocodeMapbox(location.coords.latitude, location.coords.longitude);
            if (poiName) {
                setPickupText(poiName);
            } else {
                // Fallback to Expo if Mapbox fails or returns nothing (unlikely)
                try {
                    let address = await Location.reverseGeocodeAsync({
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude
                    });
                    if (address && address.length > 0) {
                        const { city, region, name, street } = address[0];
                        const locString = street || name || city || 'Current Location';
                        setPickupText(locString);
                    } else {
                        setPickupText('Current Location');
                    }
                } catch (e) {
                    setPickupText('Current Location');
                }
            }
        })();
    }, []);

    // Session Token for Search Box API (UUID v4-like random string)
    const [sessionToken, setSessionToken] = useState<string>('');

    useEffect(() => {
        // Simple random token generator
        setSessionToken(Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2));
    }, []);

    // Fetch saved addresses
    useEffect(() => {
        const fetchSavedAddresses = async () => {
            // Only fetch if we have a userId, we might also want to re-fetch on focus if user adds new address
            if (!userId) return;

            const { data } = await supabase!
                .from('profiles')
                .select('saved_addresses')
                .eq('id', userId)
                .single();

            if (data?.saved_addresses) {
                const parsed = typeof data.saved_addresses === 'string'
                    ? JSON.parse(data.saved_addresses)
                    : data.saved_addresses;
                setSavedAddresses(Array.isArray(parsed) ? parsed : []);
            }
        };
        fetchSavedAddresses();
    }, [userId]);

    // Suggestion Selection Handler for Saved Addresses
    const handleSelectSavedAddress = (addr: any) => {
        const coords = {
            latitude: addr.latitude || 0,
            longitude: addr.longitude || 0,
        };

        if (!coords.latitude || !coords.longitude) {
            // If saved address lacks coords (old data), maybe run geocode, but for now just skip
            return;
        }

        cameraRef.current?.setCamera({
            centerCoordinate: [coords.longitude, coords.latitude],
            zoomLevel: 15,
            animationDuration: 1000,
        });

        if (activeField === 'pickup') {
            setPickupCoords(coords);
            setPickupText(addr.address);
            setActiveField('dropoff');
            dropoffInputRef.current?.focus();
        } else {
            setDropoffCoords(coords);
            setDropoffText(addr.address);
        }

        // Hide suggestions by clearing focus (optional, but effectively we want to close the list)
        // Actually we just hide it by ensuring list logic handles it.
        // We might want to clear search text if any? 
        // But activeQuery depends on input text.
    };

    useEffect(() => {
        if (!MAPBOX_TOKEN) return;

        // If text is empty/short, clear suggestions
        if (!activeQuery || activeQuery.trim().length < 2) {
            setSuggestions([]);
            setSearchError(null);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            try {
                setIsSearching(true);
                setSearchError(null);

                // Use current pickup coords for proximity bias, or Manila default if null
                const longitude = pickupCoords ? pickupCoords.longitude : 120.9842;
                const latitude = pickupCoords ? pickupCoords.latitude : 14.5995;
                const proximity = `${longitude},${latitude}`;

                // Search Box API Suggest Endpoint
                // Supports POIs, Brands, Addresses
                const baseUrl = 'https://api.mapbox.com/search/searchbox/v1/suggest';
                const queryParams = [
                    `q=${encodeURIComponent(activeQuery.trim())}`,
                    `access_token=${MAPBOX_TOKEN}`,
                    `session_token=${sessionToken}`,
                    `limit=10`, // Increased to 10 for better variety
                    `language=en`,
                    `country=PH`,
                    `types=poi,address,brand,place,locality,neighborhood,street`, // Added 'poi' for Grab-like feeling
                    `proximity=${proximity}`
                ].join('&');

                const url = `${baseUrl}?${queryParams}`;

                const response = await fetch(url, { signal: controller.signal });

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error('Mapbox Suggest error:', response.status, errorData);
                    throw new Error(`Search failed: ${response.status}`);
                }

                const data = await response.json();

                const features: MapboxSuggestion[] = Array.isArray(data?.suggestions)
                    ? data.suggestions.map((suggestion: any) => {
                        // Search Box API returns 'name' and 'address'/'full_address'
                        // We map this to our UI model
                        const name = suggestion.name || 'Unknown';
                        let address = suggestion.full_address || suggestion.place_formatted || '';

                        // Fallback context logic if address is missing or same as name
                        if ((!address || address === name) && suggestion.context) {
                            const parts = [];
                            if (suggestion.street?.name) parts.push(suggestion.street.name);
                            if (suggestion.context.place?.name) parts.push(suggestion.context.place.name);
                            if (suggestion.context.region?.name) parts.push(suggestion.context.region.name);
                            address = parts.join(', ');
                        }

                        return {
                            id: suggestion.mapbox_id, // Important: Use mapbox_id for retrieval
                            name: name,
                            address: address,
                            // Note: Suggest API does NOT return coordinates. 
                            // We must fetch them in handleSelectSuggestion using the ID.
                            coordinates: undefined
                        };
                    })
                    : [];

                setSuggestions(features);
            } catch (error: any) {
                if (error?.name !== 'AbortError') {
                    console.error('Search error:', error);
                }
            } finally {
                setIsSearching(false);
            }
        }, 300); // 300ms debounce

        return () => {
            clearTimeout(timeout);
            controller.abort();
        };
    }, [activeQuery, MAPBOX_TOKEN, pickupCoords, sessionToken]);

    // Refs for auto-focus
    const dropoffInputRef = React.useRef<any>(null);

    // Camera ref for manual updates
    const cameraRef = React.useRef<any>(null);

    const handleMapPress = async (e: any) => {
        const coords = {
            latitude: e.geometry.coordinates[1],
            longitude: e.geometry.coordinates[0],
        };
        setSuggestions([]);
        setSearchError(null);

        // Animate camera to the pressed location
        cameraRef.current?.setCamera({
            centerCoordinate: [coords.longitude, coords.latitude],
            animationDuration: 1000,
            animationMode: 'flyTo',
        });

        // Optimistic update - show coordinates first then loading
        let addressText = "Locating...";

        if (activeField === 'pickup') {
            setPickupCoords(coords);
            setPickupText(addressText);

            // Auto-focus dropoff after a short delay to let user see the pickup is set
            setTimeout(() => {
                setActiveField('dropoff');
                dropoffInputRef.current?.focus();
            }, 800);
        } else {
            setDropoffCoords(coords);
            setDropoffText(addressText);
        }

        // Use Mapbox for POI-aware reverse geocoding
        // Note: Reverse geocoding might still use standard Geocoding API or Search Box Retrieve
        // For simplicity reusing existing helper for now, but commonly Reverse Geocoding v5 is used
        const poiName = await reverseGeocodeMapbox(coords.latitude, coords.longitude);

        if (poiName) {
            addressText = poiName;
        } else {
            // Fallback to coordinates or Expo
            addressText = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
        }

        if (activeField === 'pickup') {
            setPickupText(addressText);
        } else {
            setDropoffText(addressText);
        }
    };

    const handleSelectSuggestion = async (item: MapboxSuggestion) => {
        // If we already have coordinates (historical/cached), use them.
        // If not, we must RETRIEVE them using the Search Box Retrieve API.

        let coords: { latitude: number; longitude: number } | null = null;

        if (item.coordinates && item.coordinates.length >= 2) {
            coords = { longitude: item.coordinates[0], latitude: item.coordinates[1] };
        } else {
            // Need to fetch details
            try {
                // Show some loading indicator? For now just await.
                // Ideally we'd show a spinner on the item but we'll do optimistic transition

                const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${item.id}?session_token=${sessionToken}&access_token=${MAPBOX_TOKEN}`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.features && data.features.length > 0) {
                    const geometry = data.features[0].geometry;
                    if (geometry && geometry.coordinates) {
                        coords = {
                            longitude: geometry.coordinates[0],
                            latitude: geometry.coordinates[1]
                        };
                    }
                }
            } catch (e) {
                console.error("Failed to retrieve place details", e);
                Alert.alert("Error", "Could not fetch location details.");
                return;
            }
        }

        if (!coords) return;

        // Animate camera
        cameraRef.current?.setCamera({
            centerCoordinate: [coords.longitude, coords.latitude],
            zoomLevel: 15,
            animationDuration: 1000,
        });

        if (activeField === 'pickup') {
            setPickupCoords(coords);
            setPickupText(item.name);
            // Auto-advance
            setActiveField('dropoff');
            dropoffInputRef.current?.focus();
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

            if (!response.ok) {
                const errText = await response.text();
                console.error('[Mapbox Directions] Error:', response.status, errText);
                console.error('[Mapbox Directions] URL:', url); // Log URL to check coords
                setRouteData(null);
                return;
            }

            const data = await response.json();

            if (data.code !== 'Ok' && data.code !== 'Success') {
                console.error('[Mapbox Directions] API returned error code:', data.code, data.message);
                setRouteData(null);
                return;
            }

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

    const handleConfirm = async () => {
        if (!pickupCoords || !dropoffCoords) {
            Alert.alert('Missing Location', 'Please select both Pickup and Dropoff locations.');
            return;
        }

        if (!routeData) {
            Alert.alert('Calculating Route', 'Please wait while we calculate your route.');
            return;
        }

        // Block new bookings if there is already an active one
        if (hasActiveBooking) {
            Alert.alert(
                'Active Delivery Exists',
                'You already have an active delivery in progress. Please wait for it to complete before creating a new booking.'
            );
            return;
        }

        // Double-check with a fresh query to prevent race conditions
        if (userId) {
            const activeBooking = await checkActiveBookings(userId);
            if (activeBooking) {
                setHasActiveBooking(true);
                Alert.alert(
                    'Active Delivery Exists',
                    'You already have an active delivery in progress. Please wait for it to complete before creating a new booking.'
                );
                return;
            }
        }

        console.log('[BookService] Confirmed Booking - Route Data:', routeData);
        console.log('[BookService] Estimated Cost:', routeData.cost);

        navigation.navigate('SearchingRider', {
            pickup: pickupText,
            dropoff: dropoffText,
            pickupLat: pickupCoords?.latitude,
            pickupLng: pickupCoords?.longitude,
            dropoffLat: dropoffCoords?.latitude,
            dropoffLng: dropoffCoords?.longitude,
            estimatedCost: routeData?.cost,
            distance: routeData?.distance, // EC-Fix: Added
            duration: routeData?.duration, // EC-Fix: Added
            customerName: userFullName, // EC-Fix: Pass customer name for rider preview
        });
    };

    // Add the FAB handler for strictly just recentering (no input change)
    const handleRecenter = async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        let location = await Location.getCurrentPositionAsync({});
        const coords = location.coords;

        cameraRef.current?.setCamera({
            centerCoordinate: [coords.longitude, coords.latitude],
            zoomLevel: 15,
            animationDuration: 1000,
        });
    };

    // Existing handler: Sets Pickup to Current Location AND Centers
    const handleSetPickupToCurrent = async () => {
        setPickupText("Locating...");
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        let location = await Location.getCurrentPositionAsync({});
        const coords = location.coords;

        setPickupCoords(coords);

        // Update camera
        cameraRef.current?.setCamera({
            centerCoordinate: [coords.longitude, coords.latitude],
            zoomLevel: 15,
            animationDuration: 1000,
        });

        // Use Mapbox POI Reverse Geocode
        const poiName = await reverseGeocodeMapbox(coords.latitude, coords.longitude);
        if (poiName) {
            setPickupText(poiName);
        } else {
            // Fallback
            setPickupText('Current Location');
        }

        // Auto-advance
        setTimeout(() => {
            setActiveField('dropoff');
            dropoffInputRef.current?.focus();
        }, 800);
    };

    return (
        <View style={styles.container}>
            {/* Map Background */}
            {MAPBOX_TOKEN ? (
                <MapboxGL.MapView
                    style={StyleSheet.absoluteFillObject}
                    styleURL={theme.dark ? StyleURL.Dark : StyleURL.Street}
                    onPress={handleMapPress}
                    logoEnabled={false}
                    attributionEnabled={false}
                    scaleBarEnabled={false}
                >
                    <MapboxGL.Camera
                        ref={cameraRef}
                        zoomLevel={15} // Slightly closer
                        centerCoordinate={pickupCoords
                            ? [pickupCoords.longitude, pickupCoords.latitude]
                            : [INITIAL_REGION.longitude, INITIAL_REGION.latitude]}
                        animationMode={'flyTo'}
                        animationDuration={1000}
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
                                    lineCap: 'round',
                                    lineJoin: 'round',
                                }}
                            />
                        </MapboxGL.ShapeSource>
                    )}
                </MapboxGL.MapView>
            ) : (
                <View style={[StyleSheet.absoluteFillObject, styles.mapFallback]}>
                    <Text>Map unavailable</Text>
                </View>
            )}

            {/* Back Button */}
            <TouchableOpacity style={[styles.backButton, { backgroundColor: theme.colors.surface, top: 50 + insets.top }]} onPress={() => navigation.goBack()}>
                <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
            </TouchableOpacity>

            {/* Float Input Panel */}
            <View style={[styles.inputContainer, { top: 45 + insets.top }]}>
                <View style={[styles.minimalCard, { backgroundColor: theme.dark ? '#1E1E1E' : 'white', shadowColor: '#000' }]}>

                    {/* Visual Connector */}
                    <View style={styles.connectorColumn}>
                        <View style={[styles.dot, { backgroundColor: '#4CAF50' }]} />
                        <View style={styles.connectorLine} />
                        <View style={[styles.square, { backgroundColor: '#F44336' }]} />
                    </View>

                    {/* Inputs */}
                    <View style={styles.inputsColumn}>

                        {/* Pickup */}
                        <View style={[styles.minimalInputWrapper, activeField === 'pickup' && styles.minimalActiveInput]}>
                            <TextInput
                                mode="flat"
                                placeholder="Current Location"
                                placeholderTextColor={theme.colors.primary}
                                value={pickupText}
                                onChangeText={(text) => {
                                    setPickupText(text);
                                    setActiveField('pickup');
                                }}
                                style={[styles.minimalTextInput, { backgroundColor: 'transparent' }]}
                                textColor={theme.colors.onSurface}
                                underlineColor="transparent"
                                activeUnderlineColor="transparent"
                                onFocus={() => setActiveField('pickup')}
                                right={pickupText.length > 0 ? <TextInput.Icon icon="close-circle" size={16} onPress={() => setPickupText('')} /> : null}
                            />
                        </View>

                        {/* Divider */}
                        <View style={{ height: 1, backgroundColor: '#E0E0E0', marginLeft: 10, marginRight: 10 }} />

                        {/* Dropoff */}
                        <View style={[styles.minimalInputWrapper, activeField === 'dropoff' && styles.minimalActiveInput]}>
                            <TextInput
                                ref={dropoffInputRef}
                                mode="flat"
                                placeholder="Where to?"
                                value={dropoffText}
                                onChangeText={(text) => {
                                    setDropoffText(text);
                                    setActiveField('dropoff');
                                }}
                                style={[styles.minimalTextInput, { backgroundColor: 'transparent' }]}
                                textColor={theme.colors.onSurface}
                                underlineColor="transparent"
                                activeUnderlineColor="transparent"
                                placeholderTextColor={theme.colors.onSurfaceVariant}
                                onFocus={() => setActiveField('dropoff')}
                                right={dropoffText.length > 0 ? <TextInput.Icon icon="close-circle" size={16} onPress={() => setDropoffText('')} /> : null}
                            />
                        </View>
                    </View>
                </View>
            </View>

            {/* Helper text removed */}

            {/* Suggestions List */}
            {/* Logic: Show if searching OR if we have valid saved addresses and inputs are focused (implied by this rendering conditionally if activeField set?) */}
            {/* Actually we want to show this overlay if there is a query OR if the field is empty (to show saved/recent) */}
            {/* We need to tweak the conditional. Let's say: if isSearching OR suggestions>0 OR (activeField && !routeData) */}
            {/* Simplest: If the query > 2 chars, we show suggestions. If query is empty, we show saved addresses + current location option. */}
            {(isSearching || searchError || suggestions.length > 0 || (activeQuery.length === 0 && !routeData)) && (
                <View style={[styles.suggestionsContainer, { top: 160 + insets.top, backgroundColor: theme.colors.elevation.level3 }]}>
                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ flexGrow: 1 }}
                    >
                        {/* Saved Addresses Section - Visible when NOT searching provided we have some */}
                        {!isSearching && suggestions.length === 0 && savedAddresses.length > 0 && (
                            <View>
                                <List.Subheader style={{ color: theme.colors.primary }}>Saved Locations</List.Subheader>
                                {savedAddresses.map((addr: any) => (
                                    <TouchableOpacity
                                        key={addr.id}
                                        style={[styles.suggestionItem, { borderBottomColor: theme.colors.outlineVariant }]}
                                        onPress={() => handleSelectSavedAddress(addr)}
                                    >
                                        <View style={[styles.iconCircle, { backgroundColor: theme.dark ? theme.colors.secondaryContainer : '#FFF3E0' }]}>
                                            <MaterialCommunityIcons
                                                name={addr.label.toLowerCase().includes('home') ? 'home' : addr.label.toLowerCase().includes('office') ? 'office-building' : 'star'}
                                                size={20}
                                                color={theme.dark ? theme.colors.onSecondaryContainer : '#F57C00'}
                                            />
                                        </View>
                                        <View style={{ marginLeft: 12 }}>
                                            <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: theme.dark ? theme.colors.primary : '#F57C00' }}>
                                                {addr.label}
                                            </Text>
                                            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                                                {addr.address}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                                <Divider style={{ marginVertical: 8 }} />
                            </View>
                        )}


                        {/* "My Current Location" - Only for pickup */}
                        {/* Show "Set location on map" - Always visible when searching or if query is empty */}
                        <TouchableOpacity
                            style={styles.suggestionItem}
                            onPress={() => {
                                // Hide suggestions
                                setSuggestions([]);
                                // Just focus the map
                            }}
                        >
                            <View style={[styles.iconCircle, { backgroundColor: theme.colors.secondaryContainer }]}>
                                <MaterialCommunityIcons name="map-marker-radius" size={20} color={theme.colors.onSecondaryContainer} />
                            </View>
                            <View style={{ marginLeft: 12 }}>
                                <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: theme.colors.primary }}>
                                    Set location on map
                                </Text>
                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                    Choose specific point
                                </Text>
                            </View>
                        </TouchableOpacity>

                        {/* "My Current Location" - Only for pickup */}
                        {activeField === 'pickup' && !isSearching && (
                            <TouchableOpacity
                                style={styles.suggestionItem}
                                onPress={handleSetPickupToCurrent}
                            >
                                <View style={[styles.iconCircle, { backgroundColor: theme.colors.tertiaryContainer }]}>
                                    <MaterialCommunityIcons name="crosshairs-gps" size={20} color={theme.colors.onTertiaryContainer} />
                                </View>
                                <View style={{ marginLeft: 12 }}>
                                    <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: theme.colors.tertiary }}>
                                        Use Current Location
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        <Divider />

                        {isSearching && (
                            <View style={styles.suggestionLoading}>
                                <ActivityIndicator size="small" color={theme.colors.primary} />
                                <Text variant="bodySmall" style={{ marginLeft: 8 }}>Searching nearby places...</Text>
                            </View>
                        )}

                        {suggestions.map((item) => (
                            <TouchableOpacity
                                key={item.id}
                                style={styles.suggestionItem}
                                onPress={() => handleSelectSuggestion(item)}
                            >
                                <View style={[styles.iconCircle, { backgroundColor: theme.colors.surfaceVariant }]}>
                                    <MaterialCommunityIcons name="map-marker-outline" size={20} color={theme.colors.onSurfaceVariant} />
                                </View>
                                <View style={{ marginLeft: 12, flex: 1 }}>
                                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    {item.address ? (
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                                            {item.address}
                                        </Text>
                                    ) : null}
                                </View>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            )}

            {/* Recenter / Get Location FAB */}
            {/* Recenter / Get Location FAB */}
            <TouchableOpacity
                style={[styles.floatingActionBtn, { backgroundColor: theme.colors.primary, bottom: 240 + insets.bottom }]}
                onPress={handleSetPickupToCurrent}
            >
                <MaterialCommunityIcons name="crosshairs-gps" size={24} color={theme.colors.onPrimary} />
            </TouchableOpacity>

            {/* Bottom Sheet / Trip Details */}
            {routeData && (
                <View style={[styles.bottomPreviewContainer, { bottom: 20 + insets.bottom }]}>
                    <Card style={[styles.bottomPreviewCard, { backgroundColor: theme.colors.surface }]} elevation={5}>
                        <Card.Content>
                            <View style={styles.previewHeader}>
                                <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>
                                    Total: ₱{routeData.cost}
                                </Text>
                                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                    {routeData.distance.toFixed(1)}km • {Math.round(routeData.duration)}mins
                                </Text>
                            </View>

                            <Button
                                mode="contained"
                                onPress={handleConfirm}
                                style={{ marginTop: 12, borderRadius: 8 }}
                                contentStyle={{ paddingVertical: 6 }}
                            >
                                Confirm Booking
                            </Button>
                        </Card.Content>
                    </Card>
                </View>
            )}
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
        top: 45,
        left: 70,
        right: 20,
        zIndex: 10,
    },
    minimalCard: {
        borderRadius: 12,
        backgroundColor: 'white',
        flexDirection: 'row',
        overflow: 'hidden',
        paddingVertical: 4,
        elevation: 4, // Android shadow
        shadowOpacity: 0.1, // iOS shadow
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
    connectorColumn: {
        width: 40,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginBottom: 4,
    },
    connectorLine: {
        width: 2,
        flex: 1,
        backgroundColor: '#E0E0E0',
        marginVertical: 4,
        borderRadius: 1,
    },
    square: {
        width: 8,
        height: 8,
        marginTop: 4,
        borderRadius: 1,
    },
    inputsColumn: {
        flex: 1,
        justifyContent: 'center',
        paddingRight: 8,
    },
    minimalInputWrapper: {
        height: 40,
        justifyContent: 'center',
    },
    minimalTextInput: {
        backgroundColor: 'transparent',
        height: 40,
        fontSize: 14,
        paddingHorizontal: 0,
    },
    minimalActiveInput: {
        backgroundColor: 'transparent', // Changed from grey to transparent to keep it white
        borderRadius: 8,
    },
    backButton: {
        position: 'absolute',
        top: 50,
        left: 15,
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        zIndex: 20,
    },
    suggestionsContainer: {
        position: 'absolute',
        left: 20,
        right: 20,
        top: 160,
        backgroundColor: '#fff', // Will be overridden dynamically
        borderRadius: 12,
        elevation: 5,
        paddingVertical: 4,
        maxHeight: 260,
        zIndex: 15,
    },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
    },
    suggestionLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    floatingActionBtn: {
        position: 'absolute',
        right: 20,
        bottom: 240,
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 5,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        zIndex: 5,
    },
    bottomPreviewContainer: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
        zIndex: 10,
    },
    bottomPreviewCard: {
        borderRadius: 16,
    },
    previewHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    iconCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
});