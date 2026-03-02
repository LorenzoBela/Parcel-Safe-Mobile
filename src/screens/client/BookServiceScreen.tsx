import { useNavigation, useFocusEffect } from '@react-navigation/native';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, Modal, Animated, ScrollView } from 'react-native';
import { Text, TextInput, Button, useTheme, Card, Divider, List } from 'react-native-paper';
import MapboxGL, { StyleURL } from '../../components/map/MapboxWrapper';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../services/supabaseClient'; // Import Supabase

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // metres
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
        Math.cos(p1) * Math.cos(p2) *
        Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

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

const normalizePhoneInput = (value: string) => {
    let digits = value.replace(/\D/g, '');

    if (!digits) return '';

    if (digits.startsWith('63')) {
        digits = `0${digits.slice(2)}`;
    }

    if (!digits.startsWith('09')) {
        if (digits.startsWith('9')) {
            digits = `0${digits}`;
        } else if (digits.startsWith('0')) {
            digits = `09${digits.slice(2)}`;
        } else {
            digits = `09${digits}`;
        }
    }

    return digits.slice(0, 11);
};

const isValidPhoneNumber = (value: string) => /^09\d{9}$/.test(value.trim());

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BookServiceScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    // EC-Update: Get userId and name for persistence check and booking
    const userId = useAuthStore((state: any) => state.user?.userId);
    const userFullName = useAuthStore((state: any) => state.user?.fullName || state.user?.name);
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
    const GOOGLE_MAPS_TOKEN = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

    const [isMapVisible, setIsMapVisible] = useState(false);
    const [bookingStep, setBookingStep] = useState<'location' | 'contacts'>('location');
    const [activeTab, setActiveTab] = useState<'suggested' | 'saved'>('saved');

    const [pickupText, setPickupText] = useState('');
    const [dropoffText, setDropoffText] = useState('');

    const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Dynamic Nodes for map
    const [nearbyNodes, setNearbyNodes] = useState<{ id: string, name: string, lat: number, lng: number }[]>([]);

    // Coordinates
    const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);

    // Saved Addresses
    const [savedAddresses, setSavedAddresses] = useState<any[]>([]);

    // Which input is currently focused/active for map selection
    const [activeField, setActiveField] = useState<'pickup' | 'dropoff'>('pickup');

    // Explicit cursor tracking to fix the TextInput scrolling
    const [focusedField, setFocusedField] = useState<'pickup' | 'dropoff' | null>(null);

    // Contact form state
    const [senderName, setSenderName] = useState('');
    const [senderPhone, setSenderPhone] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    const [deliveryNotes, setDeliveryNotes] = useState('');

    // Route data (auto-calculated)
    const [routeData, setRouteData] = useState<{
        distance: number;
        duration: number;
        cost: number;
        route: any;
        snappedPickupCoords?: [number, number]; // [lng, lat] from Mapbox waypoints
        snappedDropoffCoords?: [number, number];
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


    // Refs for advanced snapping & hysteresis
    const lastFetchedCoordinate = React.useRef<{ lat: number; lng: number } | null>(null);
    const lastGeocodedCoordinate = React.useRef<{ lat: number; lng: number, address: string } | null>(null);
    const lastHapticNodeId = React.useRef<string | null>(null);

    // Helper to reverse geocode using Google (much better exact address resolution)
    const reverseGeocodeGoogle = async (lat: number, lng: number): Promise<string | null> => {
        if (!GOOGLE_MAPS_TOKEN) return null;

        // Hyper-aggressive Reverse Geocoding Cache:
        // If the user only shifted the map by less than 20 meters and didn't snap, 
        // they are effectively looking at the same building/street segment.
        // Save $0.005 per micro-drag by reusing the last address.
        if (lastGeocodedCoordinate.current) {
            const dist = getDistance(
                lat, lng,
                lastGeocodedCoordinate.current.lat, lastGeocodedCoordinate.current.lng
            );
            if (dist < 20) {
                return lastGeocodedCoordinate.current.address;
            }
        }

        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_TOKEN}&result_type=street_address|premise|subpremise|point_of_interest`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                const formattedAddress = data.results[0].formatted_address;
                lastGeocodedCoordinate.current = { lat, lng, address: formattedAddress };
                return formattedAddress;
            }
        } catch (error) {
            console.error("Google Reverse Geocode Error", error);
        }
        return null;
    };

    const fetchNearbyNodesGoogle = async (lat: number, lng: number) => {
        if (!GOOGLE_MAPS_TOKEN) return;

        // Hyper-aggressive Places Cache:
        // Only fetch if we moved more than 1000m (1km) from last fetch.
        // This effectively fetches 20 nodes for a whole neighborhood ONCE.
        if (lastFetchedCoordinate.current) {
            const dist = getDistance(
                lat, lng,
                lastFetchedCoordinate.current.lat, lastFetchedCoordinate.current.lng
            );
            if (dist < 1000) {
                return; // Skip the $0.032 API call entirely
            }
        }

        try {
            const url = `https://places.googleapis.com/v1/places:searchNearby`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': GOOGLE_MAPS_TOKEN,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.routingLocations'
                },
                body: JSON.stringify({
                    maxResultCount: 20,
                    locationRestriction: {
                        circle: {
                            center: { latitude: lat, longitude: lng },
                            radius: 1000.0 // 1000 meters radius to match the hysteresis
                        }
                    }
                })
            });
            const data = await response.json();
            if (data.places) {
                const newNodes = data.places.map((p: any) => {
                    // Prefer street-level routing locations over the geometric center of the building
                    const hasRouting = p.routingLocations && p.routingLocations.length > 0;
                    const snappedLoc = hasRouting ? p.routingLocations[0].location : p.location;

                    return {
                        id: p.id,
                        name: p.displayName?.text || 'Point',
                        lat: snappedLoc.latitude,
                        lng: snappedLoc.longitude
                    };
                });

                // Append unique nodes
                setNearbyNodes(prev => {
                    const existingIds = new Set(prev.map(n => n.id));
                    const uniqueNewNodes = newNodes.filter((n: any) => !existingIds.has(n.id));
                    return [...prev, ...uniqueNewNodes];
                });

                lastFetchedCoordinate.current = { lat, lng };
            }
        } catch (e) {
            console.error(e);
        }
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

            // Reverse geocode current location using Google for best address accuracy
            const poiName = await reverseGeocodeGoogle(location.coords.latitude, location.coords.longitude);
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

                // Use Google Places Autocomplete API (NEW)
                const url = `https://places.googleapis.com/v1/places:autocomplete`;

                const response = await fetch(url, {
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
                                center: { latitude, longitude },
                                radius: 50000.0
                            }
                        }
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error('Google Autocomplete error:', response.status, errorData);
                    throw new Error(`Search failed: ${response.status}`);
                }

                const data = await response.json();

                if (data.error) {
                    console.error('Google Autocomplete API returned bad status:', data.error.message);
                }

                const features: MapboxSuggestion[] = Array.isArray(data?.suggestions)
                    ? data.suggestions.filter((s: any) => s.placePrediction).map((s: any) => {
                        const prediction = s.placePrediction;
                        const name = prediction.structuredFormat?.mainText?.text || prediction.text?.text || 'Unknown';
                        const address = prediction.structuredFormat?.secondaryText?.text || '';

                        return {
                            id: prediction.placeId, // We need placeId to get exact coordinates later
                            name: name,
                            address: address,
                            // Google Autocomplete does NOT return raw coordinates by design
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

    const handleRegionChange = async (e: any) => {
        const isUserInteraction = e?.properties?.isUserInteraction || e?.isUserInteraction;
        if (!isUserInteraction) return;

        const coords = {
            latitude: e.geometry.coordinates[1],
            longitude: e.geometry.coordinates[0],
        };

        if (activeField === 'pickup') {
            setPickupCoords(coords);
            setPickupText("Locating...");
        } else {
            setDropoffCoords(coords);
            setDropoffText("Locating...");
        }

        // Fetch nearby POI nodes around this new location for the map
        fetchNearbyNodesGoogle(coords.latitude, coords.longitude);

        // Check for magnetic snapping to nearby dynamic nodes
        let snappedNode = null;
        let minDistance = 40; // 40 meters snapping radius

        for (const node of nearbyNodes) {
            const dist = getDistance(coords.latitude, coords.longitude, node.lat, node.lng);
            if (dist < minDistance) {
                minDistance = dist;
                snappedNode = node;
            }
        }

        if (snappedNode) {
            coords.latitude = snappedNode.lat;
            coords.longitude = snappedNode.lng;

            setTimeout(() => {
                cameraRef.current?.setCamera({
                    centerCoordinate: [snappedNode.lng, snappedNode.lat],
                    animationDuration: 300,
                    animationMode: 'easeTo'
                });
            }, 10);

            if (activeField === 'pickup') {
                setPickupCoords({ latitude: snappedNode.lat, longitude: snappedNode.lng });
                setPickupText(snappedNode.name);
            } else {
                setDropoffCoords({ latitude: snappedNode.lat, longitude: snappedNode.lng });
                setDropoffText(snappedNode.name);
            }
            return; // Skip reverse geocode since we snapped to a known POI
        }

        const poiName = await reverseGeocodeGoogle(coords.latitude, coords.longitude);
        const addressText = poiName || `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;

        if (activeField === 'pickup') {
            setPickupText(addressText);
        } else {
            setDropoffText(addressText);
        }
    };

    const handleRegionIsChanging = (e: any) => {
        const isUserInteraction = e?.properties?.isUserInteraction || e?.isUserInteraction;
        if (!isUserInteraction) return;

        const lat = e.geometry.coordinates[1];
        const lng = e.geometry.coordinates[0];

        let isNearNode = false;
        let nearestNodeId: string | null = null;
        let minDistance = 40; // 40m snap radius

        for (const node of nearbyNodes) {
            const dist = getDistance(lat, lng, node.lat, node.lng);
            if (dist < minDistance) {
                isNearNode = true;
                nearestNodeId = node.id;
                break;
            }
        }

        if (isNearNode && nearestNodeId) {
            if (lastHapticNodeId.current !== nearestNodeId) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                lastHapticNodeId.current = nearestNodeId;
            }
        } else {
            lastHapticNodeId.current = null;
        }
    };

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

            // Auto-focus dropoff after a short delay
            setTimeout(() => {
                setActiveField('dropoff');
                dropoffInputRef.current?.focus();
            }, 800);
        } else {
            setDropoffCoords(coords);
            setDropoffText(addressText);
        }

        // Use Google for POI-aware reverse geocoding
        const poiName = await reverseGeocodeGoogle(coords.latitude, coords.longitude);

        if (poiName) {
            addressText = poiName;
        } else {
            addressText = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
        }

        if (activeField === 'pickup') {
            setPickupText(addressText);
        } else {
            setDropoffText(addressText);
        }

        // Fetch new nodes
        fetchNearbyNodesGoogle(coords.latitude, coords.longitude);
    };

    const handleSelectSuggestion = async (item: MapboxSuggestion) => {
        // If we already have coordinates (historical/cached), use them.
        // If not, we must RETRIEVE them using the Search Box Retrieve API.

        let coords: { latitude: number; longitude: number } | null = null;

        if (item.coordinates && item.coordinates.length >= 2) {
            coords = { longitude: item.coordinates[0], latitude: item.coordinates[1] };
        } else {
            // Need to fetch details from Google Places Details API (New) because autocomplete only returns placeId
            try {
                const url = `https://places.googleapis.com/v1/places/${item.id}?fields=location`;
                const response = await fetch(url, {
                    headers: {
                        'X-Goog-Api-Key': GOOGLE_MAPS_TOKEN
                    }
                });
                const data = await response.json();

                if (data.location) {
                    coords = {
                        longitude: data.location.longitude,
                        latitude: data.location.latitude
                    };
                } else {
                    console.error("Google Places Details API failed:", data.error?.message);
                    Alert.alert("Error", "Could not retrieve exact location coordinates.");
                    return;
                }
            } catch (e) {
                console.error("Failed to retrieve place details from Google", e);
                Alert.alert("Error", "Network error while fetching location details.");
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

        fetchNearbyNodesGoogle(coords.latitude, coords.longitude);
    };

    const handleSaveSuggestion = async (item: MapboxSuggestion) => {
        if (!userId) {
            Alert.alert('Sign In Required', 'Please sign in to save addresses.');
            return;
        }

        let coords: { latitude: number; longitude: number } | null = null;

        if (item.coordinates && item.coordinates.length >= 2) {
            coords = { longitude: item.coordinates[0], latitude: item.coordinates[1] };
        } else {
            try {
                const url = `https://places.googleapis.com/v1/places/${item.id}?fields=location`;
                const response = await fetch(url, {
                    headers: {
                        'X-Goog-Api-Key': GOOGLE_MAPS_TOKEN
                    }
                });
                const data = await response.json();

                if (data.location) {
                    coords = {
                        longitude: data.location.longitude,
                        latitude: data.location.latitude
                    };
                }
            } catch (error) {
                console.error('Failed to retrieve place coordinates for save', error);
            }
        }

        const existingIndex = savedAddresses.findIndex((addr: any) => addr.id === item.id || addr.address === (item.address || item.name));

        const savedAddressEntry = {
            id: item.id || Date.now().toString(),
            label: item.name || 'Saved Place',
            address: item.address || item.name,
            ...(coords && { latitude: coords.latitude, longitude: coords.longitude })
        };

        const nextSavedAddresses = existingIndex >= 0
            ? savedAddresses.map((addr: any, index: number) => index === existingIndex ? { ...addr, ...savedAddressEntry } : addr)
            : [savedAddressEntry, ...savedAddresses];

        const { error } = await supabase!
            .from('profiles')
            .update({ saved_addresses: nextSavedAddresses })
            .eq('id', userId);

        if (error) {
            Alert.alert('Save Failed', 'Unable to save this address right now.');
            return;
        }

        setSavedAddresses(nextSavedAddresses);
        setActiveTab('saved');
        Alert.alert('Saved', 'Address has been added to your saved addresses.');
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
                    snappedPickupCoords: data.waypoints?.[0]?.location,
                    snappedDropoffCoords: data.waypoints?.[1]?.location,
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

        if (!senderName.trim() || !senderPhone.trim() || !recipientName.trim() || !recipientPhone.trim()) {
            Alert.alert('Missing Details', 'Please fill in all contact names and phones before booking.');
            return;
        }

        if (!isValidPhoneNumber(senderPhone) || !isValidPhoneNumber(recipientPhone)) {
            Alert.alert('Invalid Phone Number', 'Phone numbers must start with 09 and be exactly 11 digits.');
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
            snappedPickupLat: routeData?.snappedPickupCoords?.[1],
            snappedPickupLng: routeData?.snappedPickupCoords?.[0],
            snappedDropoffLat: routeData?.snappedDropoffCoords?.[1],
            snappedDropoffLng: routeData?.snappedDropoffCoords?.[0],
            estimatedCost: routeData?.cost,
            distance: routeData?.distance, // EC-Fix: Added
            duration: routeData?.duration, // EC-Fix: Added
            customerName: userFullName, // EC-Fix: Pass customer name for rider preview
            senderName,
            senderPhone,
            recipientName,
            recipientPhone,
            deliveryNotes,
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

        // Use Google Reverse Geocode
        const poiName = await reverseGeocodeGoogle(coords.latitude, coords.longitude);
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
            {bookingStep === 'contacts' ? (
                // --- CONTACTS STEP ---
                <View style={[styles.contactStepContainer, { paddingTop: insets.top }]}>
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => setBookingStep('location')} style={styles.iconButton}>
                            <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
                        </TouchableOpacity>
                        <Text variant="titleMedium" style={{ fontWeight: '600', color: '#000' }}>Contact Details</Text>
                        <View style={{ width: 40 }} />
                    </View>
                    <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false}>
                        <View style={styles.formSection}>
                            <Text variant="titleSmall" style={styles.sectionTitle}>Pickup Contact</Text>
                            <View style={styles.inputRow}>
                                <TextInput mode="flat" placeholder="Sender Name" value={senderName} onChangeText={setSenderName} style={styles.modernInput} activeUnderlineColor="#000" underlineColor="#E0E0E0" />
                                <TextInput mode="flat" placeholder="09XXXXXXXXX" value={senderPhone} onChangeText={(value) => setSenderPhone(normalizePhoneInput(value))} keyboardType="phone-pad" style={styles.modernInput} activeUnderlineColor="#000" underlineColor="#E0E0E0" maxLength={11} />
                            </View>
                        </View>

                        <View style={styles.formSection}>
                            <Text variant="titleSmall" style={styles.sectionTitle}>Drop-off Contact</Text>
                            <View style={styles.inputRow}>
                                <TextInput mode="flat" placeholder="Recipient Name" value={recipientName} onChangeText={setRecipientName} style={styles.modernInput} activeUnderlineColor="#000" underlineColor="#E0E0E0" />
                                <TextInput mode="flat" placeholder="09XXXXXXXXX" value={recipientPhone} onChangeText={(value) => setRecipientPhone(normalizePhoneInput(value))} keyboardType="phone-pad" style={styles.modernInput} activeUnderlineColor="#000" underlineColor="#E0E0E0" maxLength={11} />
                            </View>
                        </View>

                        <View style={styles.formSection}>
                            <Text variant="titleSmall" style={styles.sectionTitle}>Delivery Notes (Optional)</Text>
                            <TextInput mode="flat" placeholder="E.g. Call upon arrival" value={deliveryNotes} onChangeText={setDeliveryNotes} style={[styles.modernInput, { marginBottom: 24 }]} multiline numberOfLines={2} activeUnderlineColor="#000" underlineColor="#E0E0E0" />
                        </View>

                        <View style={styles.previewHeader}>
                            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>
                                Total: ₱{routeData?.cost || 0}
                            </Text>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                {routeData?.distance?.toFixed(1) || 0}km • {Math.round(routeData?.duration || 0)}mins
                            </Text>
                        </View>

                        <Button
                            mode="contained"
                            onPress={handleConfirm}
                            style={{ marginTop: 12, borderRadius: 8, backgroundColor: '#000' }}
                            textColor="#FFF"
                            contentStyle={{ paddingVertical: 6 }}
                        >
                            Confirm Booking
                        </Button>
                    </ScrollView>
                </View>
            ) : isMapVisible ? (
                // --- MAP VIEW ---
                <View style={styles.container}>
                    {MAPBOX_TOKEN ? (
                        <MapboxGL.MapView
                            style={StyleSheet.absoluteFillObject}
                            styleURL={theme.dark ? StyleURL.Dark : StyleURL.Street}
                            onPress={handleMapPress}
                            onRegionIsChanging={handleRegionIsChanging}
                            onRegionDidChange={handleRegionChange}
                            logoEnabled={false}
                            attributionEnabled={false}
                            scaleBarEnabled={false}
                        >
                            <MapboxGL.Camera
                                ref={cameraRef}
                                zoomLevel={15}
                                centerCoordinate={pickupCoords
                                    ? [pickupCoords.longitude, pickupCoords.latitude]
                                    : [INITIAL_REGION.longitude, INITIAL_REGION.latitude]}
                                animationMode={'flyTo'}
                                animationDuration={1000}
                            />
                            <MapboxGL.UserLocation visible />


                            {nearbyNodes.map((node) => (
                                <MapboxGL.PointAnnotation
                                    key={node.id}
                                    id={node.id}
                                    coordinate={[node.lng, node.lat]}
                                    title={node.name}
                                >
                                    <View style={styles.poiNodeMarker}>
                                        <View style={styles.poiNodeInner} />
                                    </View>
                                </MapboxGL.PointAnnotation>
                            ))}

                            {pickupCoords && activeField !== 'pickup' && (
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

                            {dropoffCoords && activeField !== 'dropoff' && (
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

                    <View style={styles.fixedCenterMarker} pointerEvents="none">
                        <MaterialCommunityIcons
                            name="map-marker"
                            size={40}
                            color={activeField === 'pickup' ? "green" : "red"}
                        />
                    </View>

                    <TouchableOpacity style={[styles.backButton, { backgroundColor: theme.colors.surface, top: 10 + insets.top }]} onPress={() => setIsMapVisible(false)}>
                        <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.floatingActionBtn, { backgroundColor: theme.colors.surface, bottom: 180 + insets.bottom }]}
                        onPress={handleRecenter}
                    >
                        <MaterialCommunityIcons name="crosshairs-gps" size={24} color={theme.colors.primary} />
                    </TouchableOpacity>

                    <View style={[styles.bottomMapActionPanel, { bottom: 20 + insets.bottom }]}>
                        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 16, elevation: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, marginBottom: 12 }}>
                            <Text variant="labelMedium" style={{ color: '#757575', marginBottom: 4 }}>
                                {activeField === 'pickup' ? 'SELECT PICKUP LOCATION' : 'SELECT DROPOFF LOCATION'}
                            </Text>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', color: '#424242' }} numberOfLines={2}>
                                {activeField === 'pickup' ? (pickupText || 'Locating...') : (dropoffText || 'Locating...')}
                            </Text>
                        </View>
                        <Button mode="contained" onPress={() => setIsMapVisible(false)} style={{ borderRadius: 8, backgroundColor: '#000' }} textColor="#FFF" contentStyle={{ paddingVertical: 8 }}>
                            Confirm Location
                        </Button>
                    </View>
                </View>
            ) : (
                // --- SEARCH VIEW ---
                <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
                    <View style={[styles.searchHeader, { paddingTop: insets.top + 10 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 }}>
                            <TouchableOpacity onPress={() => navigation.goBack()}>
                                <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
                            </TouchableOpacity>
                            <Text variant="titleMedium" style={{ marginLeft: 16, fontWeight: 'bold' }}>Select an Address</Text>
                        </View>


                        <View style={[styles.minimalCard, { marginHorizontal: 20, backgroundColor: 'white', borderColor: '#000', borderWidth: 2, borderRadius: 8 }]}>
                            <View style={[styles.inputsColumn, { paddingRight: 0 }]}>
                                <View style={[styles.minimalInputWrapper, activeField === 'pickup' && { backgroundColor: '#f0f8ff' }]}>
                                    <TextInput
                                        mode="flat"
                                        placeholder="Pick-up point"
                                        value={pickupText}
                                        onChangeText={(text) => {
                                            setPickupText(text);
                                            setActiveField('pickup');
                                        }}
                                        style={[styles.minimalTextInput, { backgroundColor: 'transparent', flex: 1, paddingRight: 0 }]}
                                        textColor={theme.colors.onSurface}
                                        underlineColor="transparent"
                                        activeUnderlineColor="transparent"
                                        onFocus={() => { setActiveField('pickup'); setFocusedField('pickup'); }}
                                        left={<TextInput.Icon icon="map-marker" size={16} color="green" />}
                                        right={
                                            activeField === 'pickup' && pickupText.length === 0 ? (
                                                <TextInput.Icon icon="crosshairs-gps" size={18} color="#000" onPress={handleSetPickupToCurrent} />
                                            ) : pickupText.length > 0 ? (
                                                <TextInput.Icon icon="close-circle" size={16} onPress={() => { setPickupText(''); setPickupCoords(null); setRouteData(null); }} />
                                            ) : null
                                        }
                                        selection={focusedField === 'pickup' ? undefined : { start: 0, end: 0 }}
                                        onBlur={() => setFocusedField(null)}
                                    />
                                    <TouchableOpacity style={{ justifyContent: 'center', paddingRight: 12 }} onPress={() => setIsMapVisible(true)}>
                                        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' }}>
                                            <MaterialCommunityIcons name="map-search-outline" size={18} color="#000" />
                                        </View>
                                    </TouchableOpacity>
                                </View>

                                <View style={{ height: 1, backgroundColor: '#E0E0E0', marginLeft: 40 }} />

                                <View style={[styles.minimalInputWrapper, activeField === 'dropoff' && { backgroundColor: '#fff8f0' }]}>
                                    <TextInput
                                        ref={dropoffInputRef}
                                        mode="flat"
                                        placeholder="Enter destination"
                                        value={dropoffText}
                                        onChangeText={(text) => {
                                            setDropoffText(text);
                                            setActiveField('dropoff');
                                        }}
                                        style={[styles.minimalTextInput, { backgroundColor: 'transparent', flex: 1, paddingRight: 0 }]}
                                        textColor={theme.colors.onSurface}
                                        underlineColor="transparent"
                                        activeUnderlineColor="transparent"
                                        onFocus={() => { setActiveField('dropoff'); setFocusedField('dropoff'); }}
                                        left={<TextInput.Icon icon="map-marker" size={16} color="#ffb300" />}
                                        right={dropoffText.length > 0 ? <TextInput.Icon icon="close-circle" size={16} onPress={() => { setDropoffText(''); setDropoffCoords(null); setRouteData(null); }} /> : null}
                                        selection={focusedField === 'dropoff' ? undefined : { start: 0, end: 0 }}
                                        onBlur={() => setFocusedField(null)}
                                    />
                                    <TouchableOpacity style={{ justifyContent: 'center', paddingRight: 12 }} onPress={() => setIsMapVisible(true)}>
                                        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' }}>
                                            <MaterialCommunityIcons name="map-search-outline" size={18} color="#000" />
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    </View>

                    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>

                        {/* Always show fare card when route data is ready — regardless of search/suggestions state */}
                        {routeData && pickupCoords && dropoffCoords ? (
                            <View style={{ marginBottom: 24 }}>
                                <Card style={{ backgroundColor: theme.colors.surface, borderRadius: 16 }} elevation={2}>
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
                                            onPress={() => setBookingStep('contacts')}
                                            style={{ marginTop: 12, borderRadius: 8, backgroundColor: '#000' }}
                                            contentStyle={{ paddingVertical: 6 }}
                                            textColor="#FFF"
                                        >
                                            Proceed to Contact Details
                                        </Button>
                                    </Card.Content>
                                </Card>
                            </View>
                        ) : loadingRoute && pickupCoords && dropoffCoords ? (
                            <View style={{ marginBottom: 24 }}>
                                <Card style={{ backgroundColor: theme.colors.surface, borderRadius: 16 }} elevation={2}>
                                    <Card.Content>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 }}>
                                            <ActivityIndicator size="small" color={theme.colors.primary} />
                                            <Text variant="bodyMedium" style={{ marginLeft: 10, color: theme.colors.onSurfaceVariant }}>Calculating fare...</Text>
                                        </View>
                                    </Card.Content>
                                </Card>
                            </View>
                        ) : null}

                        {(!isSearching && suggestions.length === 0 && !routeData && !loadingRoute) ? (
                            <View style={{ flexDirection: 'row', marginBottom: 20, gap: 10 }}>
                                <TouchableOpacity
                                    style={activeTab === 'suggested' ? styles.pillButtonActive : styles.pillButton}
                                    onPress={() => setActiveTab('suggested')}
                                >
                                    <Text style={activeTab === 'suggested' ? styles.pillTextActive : styles.pillText}>Suggested</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={activeTab === 'saved' ? styles.pillButtonActive : styles.pillButton}
                                    onPress={() => setActiveTab('saved')}
                                >
                                    <Text style={activeTab === 'saved' ? styles.pillTextActive : styles.pillText}>Saved</Text>
                                </TouchableOpacity>
                            </View>
                        ) : null}

                        {activeTab === 'suggested' && !isSearching && suggestions.length === 0 && !routeData && !loadingRoute && (
                            <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 40 }}>
                                <MaterialCommunityIcons name="map-marker-star" size={80} color={theme.colors.surfaceVariant} />
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', marginTop: 16 }}>No suggestions yet</Text>
                                <Text variant="bodyMedium" style={{ textAlign: 'center', marginTop: 8, color: theme.colors.onSurfaceVariant }}>
                                    Your recent trips and suggested places will appear here.
                                </Text>
                            </View>
                        )}

                        {activeTab === 'saved' && !isSearching && suggestions.length === 0 && savedAddresses.length === 0 && !routeData && !loadingRoute && (
                            <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 40 }}>
                                <MaterialCommunityIcons name="bookmark-outline" size={80} color={theme.colors.surfaceVariant} />
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', marginTop: 16 }}>No saved addresses yet</Text>
                                <Text variant="bodyMedium" style={{ textAlign: 'center', marginTop: 8, color: theme.colors.onSurfaceVariant }}>
                                    Go to your profile to save addresses for quicker booking.
                                </Text>
                            </View>
                        )}

                        {activeTab === 'saved' && !isSearching && suggestions.length === 0 && savedAddresses.length > 0 && !routeData && !loadingRoute && (
                            <View>
                                {savedAddresses.map((addr: any) => (
                                    <TouchableOpacity
                                        key={addr.id}
                                        style={styles.suggestionItem}
                                        onPress={() => handleSelectSavedAddress(addr)}
                                    >
                                        <View style={[styles.iconCircle, { backgroundColor: '#f5f5f5' }]}>
                                            <MaterialCommunityIcons
                                                name={addr.label?.toLowerCase().includes('home') ? 'home' : addr.label?.toLowerCase().includes('office') ? 'office-building' : 'map-marker-outline'}
                                                size={20}
                                                color={'#757575'}
                                            />
                                        </View>
                                        <View style={{ marginLeft: 12, flex: 1 }}>
                                            <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: '#424242' }}>
                                                {addr.label}
                                            </Text>
                                            <Text variant="bodySmall" numberOfLines={1} style={{ color: '#757575' }}>
                                                {addr.address}
                                            </Text>
                                        </View>
                                        <MaterialCommunityIcons name="dots-vertical" size={20} color="#9e9e9e" />
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

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
                                <View style={[styles.iconCircle, { backgroundColor: '#f5f5f5' }]}>
                                    <MaterialCommunityIcons name="map-marker-outline" size={20} color="#757575" />
                                </View>
                                <View style={{ marginLeft: 12, flex: 1 }}>
                                    <Text variant="bodyMedium" style={{ color: '#424242', fontWeight: '600' }} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    {item.address ? (
                                        <Text variant="bodySmall" style={{ color: '#757575' }} numberOfLines={1}>
                                            {item.address}
                                        </Text>
                                    ) : null}
                                </View>
                                <TouchableOpacity onPress={() => handleSaveSuggestion(item)} style={{ padding: 4 }}>
                                    <MaterialCommunityIcons name="bookmark-outline" size={20} color="#9e9e9e" />
                                </TouchableOpacity>
                            </TouchableOpacity>
                        ))}

                        <View style={{ height: 80 }} />
                    </ScrollView>


                    <View style={styles.fixedBottomButtonContainer}>
                        <TouchableOpacity
                            style={styles.setOnMapBtn}
                            onPress={() => setIsMapVisible(true)}
                        >
                            <MaterialCommunityIcons name="map-outline" size={20} color="#424242" style={{ marginRight: 8 }} />
                            <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: '#424242' }}>
                                Set on map
                            </Text>
                        </TouchableOpacity>
                    </View>
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
    fixedCenterMarker: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginLeft: -20,
        marginTop: -20,
        zIndex: 5,
        alignItems: 'center',
        justifyContent: 'center',
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
        paddingLeft: 12
    },
    minimalInputWrapper: {
        height: 48,
        justifyContent: 'center',
        flexDirection: 'row',
        alignItems: 'center',
    },
    minimalTextInput: {
        backgroundColor: 'transparent',
        height: 44,
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
    contactStepContainer: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
        justifyContent: 'space-between'
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    poiNodeMarker: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#FFFFFF', // White outer ring like Grab/Indrive
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3,
        elevation: 4,
    },
    poiNodeInner: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#4A90E2', // Subtle blue inner dot
    },
    bottomMapActionPanel: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
        padding: 5,
        backgroundColor: 'transparent',
        borderRadius: 16,
        elevation: 0,
    },
    searchHeader: {
        backgroundColor: 'white',
        paddingBottom: 20,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        elevation: 0,
        zIndex: 5
    },
    pillButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#f5f5f5',
    },
    pillText: {
        color: '#757575',
        fontWeight: 'bold',
    },
    pillButtonActive: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#212121',
    },
    pillTextActive: {
        color: 'white',
        fontWeight: 'bold',
    },
    fixedBottomButtonContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'white',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
        alignItems: 'center',
    },
    setOnMapBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#f5f5f5',
        borderRadius: 24,
        paddingHorizontal: 24
    },
    formSection: {
        marginBottom: 16,
    },
    sectionTitle: {
        marginBottom: 8,
        color: '#424242',
        fontWeight: '600',
    },
    inputRow: {
        flexDirection: 'row',
        gap: 12,
    },
    modernInput: {
        flex: 1,
        backgroundColor: 'transparent',
        fontSize: 14,
        paddingHorizontal: 0,
    }
});