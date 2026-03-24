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
import { PremiumAlert } from '../../services/PremiumAlertService';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';

export default function BookServiceScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    // EC-Update: Get userId and name for persistence check and booking
    const userId = useAuthStore((state: any) => state.user?.userId);
    const userFullName = useAuthStore((state: any) => {
        const name = state.user?.fullName || state.user?.name;
        if (name) return name;
        if (state.user?.email) return state.user.email.split('@')[0];
        if (state.user?.phone) return `User ${state.user.phone.slice(-4)}`;
        return 'Customer';
    });

    const [customerName, setCustomerName] = useState<string>(userFullName);

    useEffect(() => {
        const fetchFreshName = async () => {
            if (!userId) return;
            try {
                const { data } = await supabase
                    .from('profiles')
                    .select('full_name, phone_number')
                    .eq('id', userId)
                    .single();
                
                if (data) {
                    if (data.full_name) {
                        setCustomerName(data.full_name);
                    } else if (data.phone_number) {
                        setCustomerName(`User ${data.phone_number.slice(-4)}`);
                    }
                }
            } catch (err) {
                console.warn('[BookServiceScreen] Failed to fetch fresh customer name', err);
            }
        };
        fetchFreshName();
    }, [userId]);
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

    // Pending (staged) location — set by any map drag/pan, committed only on Confirm
    const [pendingCoords, setPendingCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [pendingAddress, setPendingAddress] = useState<string>('');

    // Saved Addresses
    const [savedAddresses, setSavedAddresses] = useState<any[]>([]);

    // Saved Contacts (synced from profiles.contact_defaults)
    const [savedContacts, setSavedContacts] = useState<{ id: string; name: string; phone: string }[]>([]);
    const [showSenderPicker, setShowSenderPicker] = useState(false);
    const [showReceiverPicker, setShowReceiverPicker] = useState(false);

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
    // In-flight geocode dedup: if two callers hit reverseGeocodeGoogle concurrently for the
    // same coordinates (e.g. handleRecenter + handleRegionChange race), the second caller
    // gets the same Promise instead of firing a second API request.
    const geocodeInFlightRef = React.useRef<{ lat: number; lng: number; promise: Promise<string | null> } | null>(null);
    // Prevents the auto-open from re-firing every time isMapVisible toggles (back-button loop fix)
    const hasAutoOpenedForRoute = React.useRef(false);

    // Snaps raw coordinates to the nearest drivable road using the Mapbox Directions API.
    // Falls back to the original coordinates silently if the API call fails.
    const snapToNearestRoad = async (lat: number, lng: number): Promise<{ latitude: number; longitude: number }> => {
        if (!MAPBOX_TOKEN) return { latitude: lat, longitude: lng };
        try {
            const res = await fetch(
                `https://api.mapbox.com/directions/v5/mapbox/driving/${lng},${lat};${lng},${lat}?access_token=${MAPBOX_TOKEN}`
            );
            const data = await res.json();
            if (data.waypoints && data.waypoints.length > 0) {
                const [snappedLng, snappedLat] = data.waypoints[0].location;
                return { latitude: snappedLat, longitude: snappedLng };
            }
        } catch (err) {
            console.error('Road snap error', err);
        }
        return { latitude: lat, longitude: lng };
    };

    // Helper to reverse geocode using Google (much better exact address resolution)
    const reverseGeocodeGoogle = (lat: number, lng: number): Promise<string | null> => {
        if (!GOOGLE_MAPS_TOKEN) return Promise.resolve(null);

        // 1. Resolved cache: same building/street within 20 m — reuse stored address, zero API cost.
        if (lastGeocodedCoordinate.current) {
            const dist = getDistance(lat, lng, lastGeocodedCoordinate.current.lat, lastGeocodedCoordinate.current.lng);
            if (dist < 20) return Promise.resolve(lastGeocodedCoordinate.current.address);
        }

        // 2. In-flight dedup: if a request is already running for nearby coords, share its Promise
        //    instead of firing a second API call (protects against concurrent callers like
        //    handleRecenter + handleRegionChange hitting the same GPS position simultaneously).
        if (geocodeInFlightRef.current) {
            const dist = getDistance(lat, lng, geocodeInFlightRef.current.lat, geocodeInFlightRef.current.lng);
            if (dist < 20) return geocodeInFlightRef.current.promise;
        }

        const promise = (async () => {
            try {
                const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_TOKEN}&result_type=street_address|premise|subpremise|point_of_interest`;
                const response = await fetch(url);
                const data = await response.json();
                if (data.results && data.results.length > 0) {
                    const formattedAddress = data.results[0].formatted_address;
                    lastGeocodedCoordinate.current = { lat, lng, address: formattedAddress };
                    return formattedAddress as string;
                }
            } catch (error) {
                console.error('Google Reverse Geocode Error', error);
            } finally {
                // Clear in-flight ref so the next call (different location) goes through normally
                geocodeInFlightRef.current = null;
            }
            return null;
        })();

        geocodeInFlightRef.current = { lat, lng, promise };
        return promise;
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
            if (status !== 'granted') return;

            // Last-known position is instant (device cache, no API cost); fresh fix only as fallback
            let location = await Location.getLastKnownPositionAsync({ maxAge: 30000, requiredAccuracy: 150 });
            if (!location) {
                location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            }

            // Auto-set pickup to current location initially
            setPickupCoords(location.coords);

            // Reverse geocode — uses the in-flight dedup so a simultaneous handleRecenter call
            // (if the user taps GPS before this resolves) won't fire a second API request
            const poiName = await reverseGeocodeGoogle(location.coords.latitude, location.coords.longitude);
            setPickupText(poiName || 'Current Location');
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
                .select('saved_addresses, contact_defaults')
                .eq('id', userId)
                .single();

            if (data?.saved_addresses) {
                const parsed = typeof data.saved_addresses === 'string'
                    ? JSON.parse(data.saved_addresses)
                    : data.saved_addresses;
                setSavedAddresses(Array.isArray(parsed) ? parsed : []);
            }

            // Also load saved contacts for quick-fill
            if (data?.contact_defaults) {
                const cd = typeof data.contact_defaults === 'string'
                    ? JSON.parse(data.contact_defaults)
                    : data.contact_defaults;
                setSavedContacts(Array.isArray(cd?.contacts) ? cd.contacts : []);
            }
        };
        fetchSavedAddresses();
    }, [userId]);

    // Quick-save a contact on the fly from the booking screen
    const handleQuickSaveContact = async (name: string, phone: string) => {
        if (!name.trim() || !phone.trim() || !userId) return;
        if (savedContacts.some(c => c.name === name.trim() && c.phone === phone.trim())) return;
        const newContact = { id: Date.now().toString(), name: name.trim(), phone: phone.trim() };
        const updated = [...savedContacts, newContact];
        setSavedContacts(updated);
        try {
            await supabase!.from('profiles').update({ contact_defaults: { contacts: updated } }).eq('id', userId);
        } catch (e) {
            console.error('Failed to save contact:', e);
        }
    };

    // Suggestion Selection Handler for Saved Addresses
    const handleSelectSavedAddress = async (addr: any) => {
        // Support both key formats for cross-platform sync (mobile: latitude/longitude, web: lat/lng)
        const rawCoords = {
            latitude: addr.latitude ?? addr.lat ?? 0,
            longitude: addr.longitude ?? addr.lng ?? 0,
        };

        if (!rawCoords.latitude || !rawCoords.longitude) {
            // If saved address lacks coords (old data), maybe run geocode, but for now just skip
            return;
        }

        // Snap to nearest road so the rider has a reachable waypoint
        const coords = await snapToNearestRoad(rawCoords.latitude, rawCoords.longitude);

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

        const rawCoords = {
            latitude: e.geometry.coordinates[1],
            longitude: e.geometry.coordinates[0],
        };

        // Show "Locating..." in the pending address while we resolve asynchronously
        setPendingAddress('Locating...');

        // Fetch nearby POI nodes around this new location for the map (runs in background)
        fetchNearbyNodesGoogle(rawCoords.latitude, rawCoords.longitude);

        // PRIORITY 1: Snap to the nearest drivable road (same as web) so the rider
        // always has a reachable waypoint regardless of where the pin was dropped.
        const snappedRoad = await snapToNearestRoad(rawCoords.latitude, rawCoords.longitude);
        let finalCoords = snappedRoad;
        let addressText: string | null = null;

        // PRIORITY 2 (backup): If a known POI node is within 40 m of the raw drop
        // point, upgrade to its coords+name — they already use Google routingLocations
        // so they are on-road by definition.
        let snappedNode = null;
        let minDistance = 40; // 40 metres snapping radius
        for (const node of nearbyNodes) {
            const dist = getDistance(rawCoords.latitude, rawCoords.longitude, node.lat, node.lng);
            if (dist < minDistance) {
                minDistance = dist;
                snappedNode = node;
            }
        }

        if (snappedNode) {
            finalCoords = { latitude: snappedNode.lat, longitude: snappedNode.lng };
            addressText = snappedNode.name;

            // Animate camera to the snapped POI node
            setTimeout(() => {
                cameraRef.current?.setCamera({
                    centerCoordinate: [snappedNode.lng, snappedNode.lat],
                    animationDuration: 300,
                    animationMode: 'easeTo'
                });
            }, 10);

            if (lastHapticNodeId.current !== snappedNode.id) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                lastHapticNodeId.current = snappedNode.id;
            }
        } else {
            lastHapticNodeId.current = null;
        }

        // Stage the final (road- or POI-snapped) coordinates as pending — not committed yet
        setPendingCoords(finalCoords);

        // Reverse geocode unless a POI already gave us a name
        if (!addressText) {
            const poiName = await reverseGeocodeGoogle(finalCoords.latitude, finalCoords.longitude);
            addressText = poiName || `${finalCoords.latitude.toFixed(4)}, ${finalCoords.longitude.toFixed(4)}`;
        }

        setPendingAddress(addressText);
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

    const handleMapPress = (e: any) => {
        // Tapping the map centers the camera on the tapped point.
        // Actual coord/address resolution happens in handleRegionChange after the camera settles.
        const lng = e.geometry.coordinates[0];
        const lat = e.geometry.coordinates[1];

        setSuggestions([]);
        setSearchError(null);

        cameraRef.current?.setCamera({
            centerCoordinate: [lng, lat],
            animationDuration: 600,
            animationMode: 'flyTo',
        });
    };

    // Commits the staged pending location to the active field.
    const handleConfirmPendingLocation = () => {
        if (!pendingCoords || pendingAddress === 'Locating...') return;

        const finalAddress = pendingAddress || `${pendingCoords.latitude.toFixed(4)}, ${pendingCoords.longitude.toFixed(4)}`;

        if (activeField === 'pickup') {
            setPickupCoords(pendingCoords);
            setPickupText(finalAddress);
            // Auto-advance to dropoff after confirming pickup
            setTimeout(() => {
                setActiveField('dropoff');
                dropoffInputRef.current?.focus();
            }, 300);
        } else {
            setDropoffCoords(pendingCoords);
            setDropoffText(finalAddress);
        }

        setPendingCoords(null);
        setPendingAddress('');
    };

    // Discards the staged pending location and flies back to the already-confirmed pin.
    const handleCancelPendingLocation = () => {
        setPendingCoords(null);
        setPendingAddress('');
        const existing = activeField === 'pickup' ? pickupCoords : dropoffCoords;
        if (existing) {
            cameraRef.current?.setCamera({
                centerCoordinate: [existing.longitude, existing.latitude],
                zoomLevel: 16,
                animationDuration: 600,
                animationMode: 'flyTo',
            });
        }
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
                    PremiumAlert.alert("Error", "Could not retrieve exact location coordinates.");
                    return;
                }
            } catch (e) {
                console.error("Failed to retrieve place details from Google", e);
                PremiumAlert.alert("Error", "Network error while fetching location details.");
                return;
            }
        }

        if (!coords) return;

        // Snap to nearest road so the rider can always reach the selected location
        const snappedRoad = await snapToNearestRoad(coords.latitude, coords.longitude);
        coords = snappedRoad;

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
            PremiumAlert.alert('Sign In Required', 'Please sign in to save addresses.');
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
            // Write both key formats for cross-platform sync (mobile: latitude/longitude, web: lat/lng)
            ...(coords && {
                latitude: coords.latitude,
                longitude: coords.longitude,
                lat: coords.latitude,
                lng: coords.longitude,
            })
        };

        const nextSavedAddresses = existingIndex >= 0
            ? savedAddresses.map((addr: any, index: number) => index === existingIndex ? { ...addr, ...savedAddressEntry } : addr)
            : [savedAddressEntry, ...savedAddresses];

        const { error } = await supabase!
            .from('profiles')
            .update({ saved_addresses: nextSavedAddresses })
            .eq('id', userId);

        if (error) {
            PremiumAlert.alert('Save Failed', 'Unable to save this address right now.');
            return;
        }

        setSavedAddresses(nextSavedAddresses);
        setActiveTab('saved');
        PremiumAlert.alert('Saved', 'Address has been added to your saved addresses.');
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

    // Clear any staged pending location whenever the active field or map visibility changes,
    // so stale pending state from a previous field can never bleed through.
    useEffect(() => {
        setPendingCoords(null);
        setPendingAddress('');
    }, [activeField, isMapVisible]);

    // Auto-fit camera to frame the full route when the preview is shown in map view.
    // Auto-opens the map once when route becomes ready from the search flow (typing addresses).
    // Uses a ref guard so pressing the back button doesn't re-trigger the open (loop fix).
    useEffect(() => {
        if (routeData && pickupCoords && dropoffCoords) {
            if (!isMapVisible) {
                // Only auto-open once per route calculation
                if (!hasAutoOpenedForRoute.current) {
                    hasAutoOpenedForRoute.current = true;
                    setIsMapVisible(true);
                    // fitBounds fires on the next effect run when isMapVisible becomes true
                }
                return;
            }
            const minLng = Math.min(pickupCoords.longitude, dropoffCoords.longitude);
            const maxLng = Math.max(pickupCoords.longitude, dropoffCoords.longitude);
            const minLat = Math.min(pickupCoords.latitude, dropoffCoords.latitude);
            const maxLat = Math.max(pickupCoords.latitude, dropoffCoords.latitude);
            cameraRef.current?.fitBounds(
                [maxLng, maxLat],
                [minLng, minLat],
                [80, 60, 320, 60],
                900
            );
        }
    }, [routeData, isMapVisible]);

    const handleConfirm = async () => {
        if (!pickupCoords || !dropoffCoords) {
            PremiumAlert.alert('Missing Location', 'Please select both Pickup and Dropoff locations.');
            return;
        }

        if (!routeData) {
            PremiumAlert.alert('Calculating Route', 'Please wait while we calculate your route.');
            return;
        }

        if (!senderName.trim() || !senderPhone.trim() || !recipientName.trim() || !recipientPhone.trim()) {
            PremiumAlert.alert('Missing Details', 'Please fill in all contact names and phones before booking.');
            return;
        }

        if (!isValidPhoneNumber(senderPhone) || !isValidPhoneNumber(recipientPhone)) {
            PremiumAlert.alert('Invalid Phone Number', 'Phone numbers must start with 09 and be exactly 11 digits.');
            return;
        }

        if (senderName.trim().toLowerCase() === recipientName.trim().toLowerCase() && senderPhone.trim() === recipientPhone.trim()) {
            PremiumAlert.alert('Same Contact', 'Sender and receiver cannot be the same person with the same number.');
            return;
        }

        // Block new bookings if there is already an active one
        if (hasActiveBooking) {
            PremiumAlert.alert(
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
                PremiumAlert.alert(
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
            customerName: customerName, // EC-Fix: Pass customer name for rider preview
            senderName,
            senderPhone,
            recipientName,
            recipientPhone,
            deliveryNotes,
        });
    };

    // FAB: recenters camera AND stages current location as pending so user can confirm it
    const handleRecenter = async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        // Try cached last-known first (instant), fall back to a fresh balanced-accuracy fix
        let location = await Location.getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 100 });
        if (!location) {
            location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        }
        const coords = location.coords;

        cameraRef.current?.setCamera({
            centerCoordinate: [coords.longitude, coords.latitude],
            zoomLevel: 15,
            animationDuration: 600,
        });

        // Stage as pending so the user just needs to tap Confirm
        setPendingCoords({ latitude: coords.latitude, longitude: coords.longitude });
        setPendingAddress('Locating...');
        // Reverse geocode in the background
        reverseGeocodeGoogle(coords.latitude, coords.longitude).then((name) => {
            setPendingAddress(name || `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
        });
    };

    // Existing handler: Sets Pickup to Current Location AND Centers
    const handleSetPickupToCurrent = async () => {
        setPickupText('Locating...');
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        // Try cached last-known first (instant), fall back to a fresh balanced-accuracy fix
        let location = await Location.getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 100 });
        if (!location) {
            location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        }
        const coords = location.coords;

        setPickupCoords(coords);

        // Update camera
        cameraRef.current?.setCamera({
            centerCoordinate: [coords.longitude, coords.latitude],
            zoomLevel: 15,
            animationDuration: 600,
        });

        // Use Google Reverse Geocode
        const poiName = await reverseGeocodeGoogle(coords.latitude, coords.longitude);
        setPickupText(poiName || 'Current Location');

        // Auto-advance
        setTimeout(() => {
            setActiveField('dropoff');
            dropoffInputRef.current?.focus();
        }, 600);
    };

    const pageAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, pageAnim.style]}>
            {bookingStep === 'contacts' ? (
                // --- CONTACTS STEP ---
                <View style={[styles.contactStepContainer, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
                    <View style={[styles.header, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
                        <TouchableOpacity onPress={() => setBookingStep('location')} style={styles.iconButton}>
                            <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
                        </TouchableOpacity>
                        <Text variant="titleMedium" style={{ fontFamily: 'Inter_600SemiBold', color: theme.colors.onSurface }}>Contact Details</Text>
                        <View style={{ width: 40 }} />
                    </View>
                    <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false}>
                        {/* Saved contacts quick-fill — compact dropdowns */}
                        {savedContacts.length > 0 ? (
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                                {/* Fill Sender dropdown */}
                                <View style={{ flex: 1 }}>
                                    <TouchableOpacity
                                        onPress={() => { setShowSenderPicker(!showSenderPicker); setShowReceiverPicker(false); }}
                                        style={{ backgroundColor: theme.colors.surfaceVariant, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                    >
                                        <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, fontFamily: 'Inter_600SemiBold' }}>Fill Sender</Text>
                                        <MaterialCommunityIcons name={showSenderPicker ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.onSurfaceVariant} />
                                    </TouchableOpacity>
                                    {showSenderPicker && (
                                        <View style={{ backgroundColor: theme.colors.background, borderRadius: 10, marginTop: 4, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.outlineVariant }}>
                                            {savedContacts.map((c) => (
                                                <TouchableOpacity
                                                    key={c.id}
                                                    onPress={() => { setSenderName(c.name); setSenderPhone(c.phone); setShowSenderPicker(false); }}
                                                    style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }}
                                                >
                                                    <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: theme.colors.onSurface }}>{c.name}</Text>
                                                    <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{c.phone}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    )}
                                </View>
                                {/* Fill Receiver dropdown */}
                                <View style={{ flex: 1 }}>
                                    <TouchableOpacity
                                        onPress={() => { setShowReceiverPicker(!showReceiverPicker); setShowSenderPicker(false); }}
                                        style={{ backgroundColor: theme.colors.surfaceVariant, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                    >
                                        <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, fontFamily: 'Inter_600SemiBold' }}>Fill Receiver</Text>
                                        <MaterialCommunityIcons name={showReceiverPicker ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.onSurfaceVariant} />
                                    </TouchableOpacity>
                                    {showReceiverPicker && (
                                        <View style={{ backgroundColor: theme.colors.background, borderRadius: 10, marginTop: 4, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.outlineVariant }}>
                                            {savedContacts.map((c) => (
                                                <TouchableOpacity
                                                    key={c.id}
                                                    onPress={() => { setRecipientName(c.name); setRecipientPhone(c.phone); setShowReceiverPicker(false); }}
                                                    style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }}
                                                >
                                                    <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: theme.colors.onSurface }}>{c.name}</Text>
                                                    <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{c.phone}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            </View>
                        ) : (
                            <View style={{ marginBottom: 12, padding: 12, backgroundColor: theme.colors.background, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <MaterialCommunityIcons name="account-plus-outline" size={18} color={theme.colors.onSurfaceVariant} />
                                <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flex: 1 }}>Fill in contacts below and tap "Save" to quick-fill next time.</Text>
                            </View>
                        )}

                        <View style={styles.formSection}>
                            <Text variant="titleSmall" style={styles.sectionTitle}>Pickup Contact</Text>
                            <View style={styles.inputRow}>
                                <TextInput mode="flat" placeholder="Sender Name" value={senderName} onChangeText={setSenderName} style={styles.modernInput} activeUnderlineColor={theme.colors.primary} underlineColor={theme.colors.outlineVariant} />
                                <TextInput mode="flat" placeholder="09XXXXXXXXX" value={senderPhone} onChangeText={(value) => setSenderPhone(normalizePhoneInput(value))} keyboardType="phone-pad" style={styles.modernInput} activeUnderlineColor={theme.colors.outlineVariant} maxLength={11} />
                            </View>
                            {senderName.trim() && senderPhone.length === 11 && !savedContacts.some(c => c.name === senderName.trim() && c.phone === senderPhone.trim()) && (
                                <TouchableOpacity
                                    onPress={() => handleQuickSaveContact(senderName, senderPhone)}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                                >
                                    <MaterialCommunityIcons name="content-save-outline" size={14} color={theme.colors.primary} />
                                    <Text style={{ fontSize: 11, color: theme.colors.primary, fontFamily: 'Inter_600SemiBold' }}>Save sender to contacts</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        <View style={styles.formSection}>
                            <Text variant="titleSmall" style={styles.sectionTitle}>Drop-off Contact</Text>
                            <View style={styles.inputRow}>
                                <TextInput mode="flat" placeholder="Recipient Name" value={recipientName} onChangeText={setRecipientName} style={styles.modernInput} activeUnderlineColor={theme.colors.primary} underlineColor={theme.colors.outlineVariant} />
                                <TextInput mode="flat" placeholder="09XXXXXXXXX" value={recipientPhone} onChangeText={(value) => setRecipientPhone(normalizePhoneInput(value))} keyboardType="phone-pad" style={styles.modernInput} activeUnderlineColor={theme.colors.outlineVariant} maxLength={11} />
                            </View>
                            {recipientName.trim() && recipientPhone.length === 11 && !savedContacts.some(c => c.name === recipientName.trim() && c.phone === recipientPhone.trim()) && (
                                <TouchableOpacity
                                    onPress={() => handleQuickSaveContact(recipientName, recipientPhone)}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                                >
                                    <MaterialCommunityIcons name="content-save-outline" size={14} color={theme.colors.error} />
                                    <Text style={{ fontSize: 11, color: theme.colors.error, fontFamily: 'Inter_600SemiBold' }}>Save receiver to contacts</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        <View style={styles.formSection}>
                            <Text variant="titleSmall" style={styles.sectionTitle}>Delivery Notes (Optional)</Text>
                            <TextInput mode="flat" placeholder="E.g. Call upon arrival" value={deliveryNotes} onChangeText={setDeliveryNotes} style={[styles.modernInput, { marginBottom: 24 }]} multiline numberOfLines={2} activeUnderlineColor={theme.colors.primary} underlineColor={theme.colors.outlineVariant} />
                        </View>

                        <View style={styles.previewHeader}>
                            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontFamily: 'Inter_700Bold' }}>
                                Total: ₱{routeData?.cost || 0}
                            </Text>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                {routeData?.distance?.toFixed(1) || 0}km • {Math.round(routeData?.duration || 0)}mins
                            </Text>
                        </View>

                        <Button
                            mode="contained"
                            onPress={handleConfirm}
                            style={{ marginTop: 12, borderRadius: 8, backgroundColor: theme.colors.onSurface }}
                            textColor={theme.colors.surface}
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

                            {/* Pickup marker — always shown when coords exist so the user can see
                                the confirmed pin while re-positioning (crosshair shows proposed new spot) */}
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

                            {/* Dropoff marker — same: always visible so the user sees the original
                                pin alongside the crosshair when re-positioning */}
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
                            <Text style={{ color: theme.colors.onSurface }}>Map unavailable</Text>
                        </View>
                    )}

                    {/* Fixed center crosshair — shown whenever there is no confirmed route.
                        Disappears when route preview is active; reappears immediately when
                        Edit Pickup / Edit Dropoff is pressed (those clear routeData). */}
                    {!routeData && (
                        <View style={styles.fixedCenterMarker} pointerEvents="none">
                            <MaterialCommunityIcons
                                name="map-marker"
                                size={40}
                                color={activeField === 'pickup' ? "green" : "red"}
                            />
                        </View>
                    )}

                    {/* Top overlay bar: back button (left) + GPS recenter button (right) */}
                    <View style={[styles.mapTopBar, { top: 10 + insets.top }]} pointerEvents="box-none">
                        <TouchableOpacity style={[styles.backButton, { backgroundColor: theme.colors.surface }]} onPress={() => setIsMapVisible(false)}>
                            <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.backButton, { backgroundColor: theme.colors.surface }]}
                            onPress={handleRecenter}
                        >
                            <MaterialCommunityIcons name="crosshairs-gps" size={24} color={theme.colors.primary} />
                        </TouchableOpacity>
                    </View>

                    {/* --- BOTTOM PANEL --- */}
                    {routeData && pickupCoords && dropoffCoords ? (
                        // Route Preview Panel (both pins confirmed)
                        <View style={[styles.bottomMapActionPanel, { bottom: 20 + insets.bottom }]}>
                            {routeData ? (
                                <View style={{ backgroundColor: theme.colors.surface, padding: 16, borderRadius: 16, elevation: 6, shadowColor: theme.colors.onSurface, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } }}>
                                    {/* Header label */}
                                    <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, marginBottom: 10 }}>ROUTE PREVIEW</Text>

                                    {/* Pickup row */}
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                        <MaterialCommunityIcons name="map-marker" size={18} color="#10b981" style={{ width: 24 }} />
                                        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13 }}>{pickupText || 'Pickup'}</Text>
                                    </View>

                                    {/* Connector */}
                                    <View style={{ width: 2, height: 10, backgroundColor: theme.colors.outlineVariant, marginLeft: 11, marginBottom: 4 }} />

                                    {/* Dropoff row */}
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                                        <MaterialCommunityIcons name="map-marker" size={18} color="#f43f5e" style={{ width: 24 }} />
                                        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13 }}>{dropoffText || 'Dropoff'}</Text>
                                    </View>

                                    {/* Stats row */}
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: theme.colors.background, borderRadius: 10, padding: 10, marginBottom: 14 }}>
                                        <View style={{ alignItems: 'center', flex: 1 }}>
                                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>Distance</Text>
                                            <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>{routeData.distance.toFixed(1)} km</Text>
                                        </View>
                                        <View style={{ width: 1, backgroundColor: theme.colors.outlineVariant }} />
                                        <View style={{ alignItems: 'center', flex: 1 }}>
                                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>Est. Time</Text>
                                            <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>{Math.round(routeData.duration)} min</Text>
                                        </View>
                                        <View style={{ width: 1, backgroundColor: theme.colors.outlineVariant }} />
                                        <View style={{ alignItems: 'center', flex: 1 }}>
                                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>Fare</Text>
                                            <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>₱{routeData.cost}</Text>
                                        </View>
                                    </View>

                                    {/* Action buttons */}
                                    {/* Row 1: per-pin edit buttons */}
                                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                                        <TouchableOpacity
                                            style={{ flex: 1, borderRadius: 8, borderWidth: 1.5, borderColor: '#10b981', paddingVertical: 9, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                                            onPress={() => {
                                                setActiveField('pickup');
                                                setRouteData(null); // immediately restore crosshair + single-pin panel
                                                hasAutoOpenedForRoute.current = false; // allow auto-open for the recalculated route
                                                // Fly camera back to the current pickup pin so user can reposition it
                                                if (pickupCoords) {
                                                    cameraRef.current?.setCamera({
                                                        centerCoordinate: [pickupCoords.longitude, pickupCoords.latitude],
                                                        zoomLevel: 16,
                                                        animationDuration: 600,
                                                        animationMode: 'flyTo',
                                                    });
                                                }
                                            }}
                                        >
                                            <MaterialCommunityIcons name="map-marker" size={15} color="#10b981" />
                                            <Text style={{ color: '#10b981', fontFamily: 'Inter_700Bold', fontSize: 13 }}>Edit Pickup</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={{ flex: 1, borderRadius: 8, borderWidth: 1.5, borderColor: '#f43f5e', paddingVertical: 9, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                                            onPress={() => {
                                                setActiveField('dropoff');
                                                setRouteData(null); // immediately restore crosshair + single-pin panel
                                                hasAutoOpenedForRoute.current = false; // allow auto-open for the recalculated route
                                                // Fly camera back to the current dropoff pin so user can reposition it
                                                if (dropoffCoords) {
                                                    cameraRef.current?.setCamera({
                                                        centerCoordinate: [dropoffCoords.longitude, dropoffCoords.latitude],
                                                        zoomLevel: 16,
                                                        animationDuration: 600,
                                                        animationMode: 'flyTo',
                                                    });
                                                }
                                            }}
                                        >
                                            <MaterialCommunityIcons name="map-marker" size={15} color="#f43f5e" />
                                            <Text style={{ color: '#f43f5e', fontFamily: 'Inter_700Bold', fontSize: 13 }}>Edit Dropoff</Text>
                                        </TouchableOpacity>
                                    </View>
                                    {/* Row 2: confirm */}
                                    <TouchableOpacity
                                        style={{ borderRadius: 8, backgroundColor: theme.colors.onSurface, paddingVertical: 11, alignItems: 'center' }}
                                        onPress={() => { setIsMapVisible(false); setBookingStep('contacts'); }}
                                    >
                                        <Text style={{ color: theme.colors.surface, fontFamily: 'Inter_700Bold', fontSize: 14 }}>Looks Good  →</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                // Calculating state
                                <View style={{ backgroundColor: theme.colors.surface, padding: 16, borderRadius: 16, elevation: 4, shadowColor: theme.colors.onSurface, shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}>
                                        <ActivityIndicator size="small" color={theme.colors.onSurface} />
                                        <Text style={{ marginLeft: 10, color: theme.colors.onSurfaceVariant, fontSize: 14 }}>Calculating route...</Text>
                                    </View>
                                </View>
                            )}
                        </View>
                    ) : (
                        // Single-pin selection panel — shows pending location until confirmed
                        <View style={[styles.bottomMapActionPanel, { bottom: 20 + insets.bottom }]}>
                            <View style={{ backgroundColor: theme.colors.surface, padding: 16, borderRadius: 16, elevation: 4, shadowColor: theme.colors.onSurface, shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, marginBottom: 12 }}>
                                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>
                                    {activeField === 'pickup' ? 'SELECT PICKUP LOCATION' : 'SELECT DROPOFF LOCATION'}
                                </Text>
                                <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: pendingCoords ? '#212121' : '#9e9e9e' }} numberOfLines={2}>
                                    {pendingCoords
                                        ? (pendingAddress || 'Locating...')
                                        : (activeField === 'pickup' ? (pickupText || 'Pan or tap to select') : (dropoffText || 'Pan or tap to select'))}
                                </Text>
                                {/* Warn the user when they are about to replace an already-confirmed pin */}
                                {pendingCoords && ((activeField === 'pickup' && !!pickupCoords) || (activeField === 'dropoff' && !!dropoffCoords)) && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 }}>
                                        <MaterialCommunityIcons name="alert-circle-outline" size={14} color="#f59e0b" />
                                        <Text style={{ fontSize: 11, color: '#f59e0b', fontFamily: 'Inter_600SemiBold' }}>
                                            This will replace your current {activeField} location
                                        </Text>
                                    </View>
                                )}
                            </View>

                            {/* Keep Current Location — only shown when repositioning an existing pin */}
                            {pendingCoords && ((activeField === 'pickup' && !!pickupCoords) || (activeField === 'dropoff' && !!dropoffCoords)) && (
                                <TouchableOpacity
                                    style={{ borderRadius: 8, borderWidth: 1.5, borderColor: theme.colors.onSurfaceVariant, paddingVertical: 10, alignItems: 'center', marginBottom: 8, backgroundColor: theme.colors.surface }}
                                    onPress={handleCancelPendingLocation}
                                >
                                    <Text style={{ color: theme.colors.onSurface, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Keep Current Location</Text>
                                </TouchableOpacity>
                            )}

                            <Button
                                mode="contained"
                                onPress={handleConfirmPendingLocation}
                                disabled={!pendingCoords || pendingAddress === 'Locating...'}
                                style={{ borderRadius: 8, backgroundColor: (!pendingCoords || pendingAddress === 'Locating...') ? '#bdbdbd' : theme.colors.onSurface }}
                                textColor={theme.colors.surface}
                                contentStyle={{ paddingVertical: 8 }}
                            >
                                {pendingAddress === 'Locating...' ? 'Locating…' : 'Confirm Location'}
                            </Button>
                        </View>
                    )}
                </View>
            ) : (
                // --- SEARCH VIEW ---
                <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                    <View style={[styles.searchHeader, { backgroundColor: theme.colors.surface, paddingTop: insets.top + 10 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 }}>
                            <TouchableOpacity onPress={() => navigation.goBack()}>
                                <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.onSurface} />
                            </TouchableOpacity>
                            <Text variant="titleMedium" style={{ marginLeft: 16, fontFamily: 'Inter_700Bold' }}>Select an Address</Text>
                        </View>


                        <View style={[styles.minimalCard, { marginHorizontal: 20, backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, borderWidth: 2, borderRadius: 8 }]}>
                            <View style={[styles.inputsColumn, { paddingRight: 0 }]}>
                                <View style={[styles.minimalInputWrapper, activeField === 'pickup' && { backgroundColor: theme.colors.surfaceVariant }]}>
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
                                                <TextInput.Icon icon="crosshairs-gps" size={18} color={theme.colors.onSurface} onPress={handleSetPickupToCurrent} />
                                            ) : pickupText.length > 0 ? (
                                                <TextInput.Icon icon="close-circle" size={16} onPress={() => { setPickupText(''); setPickupCoords(null); setRouteData(null); }} />
                                            ) : null
                                        }
                                        selection={focusedField === 'pickup' ? undefined : { start: 0, end: 0 }}
                                        onBlur={() => setFocusedField(null)}
                                    />
                                    <TouchableOpacity style={{ justifyContent: 'center', paddingRight: 12 }} onPress={() => setIsMapVisible(true)}>
                                        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }}>
                                            <MaterialCommunityIcons name="map-search-outline" size={18} color={theme.colors.onSurface} />
                                        </View>
                                    </TouchableOpacity>
                                </View>

                                <View style={{ height: 1, backgroundColor: theme.colors.outlineVariant, marginLeft: 40 }} />

                                <View style={[styles.minimalInputWrapper, activeField === 'dropoff' && { backgroundColor: theme.colors.surfaceVariant }]}>
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
                                        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }}>
                                            <MaterialCommunityIcons name="map-search-outline" size={18} color={theme.colors.onSurface} />
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
                                            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontFamily: 'Inter_700Bold' }}>
                                                Total: ₱{routeData.cost}
                                            </Text>
                                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                                {routeData.distance.toFixed(1)}km • {Math.round(routeData.duration)}mins
                                            </Text>
                                        </View>
                                        <Button
                                            mode="contained"
                                            onPress={() => setBookingStep('contacts')}
                                            style={{ marginTop: 12, borderRadius: 8, backgroundColor: theme.colors.primary }}
                                            contentStyle={{ paddingVertical: 6 }}
                                            textColor={theme.colors.onPrimary}
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
                                <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', marginTop: 16 }}>No suggestions yet</Text>
                                <Text variant="bodyMedium" style={{ textAlign: 'center', marginTop: 8, color: theme.colors.onSurfaceVariant }}>
                                    Your recent trips and suggested places will appear here.
                                </Text>
                            </View>
                        )}

                        {activeTab === 'saved' && !isSearching && suggestions.length === 0 && savedAddresses.length === 0 && !routeData && !loadingRoute && (
                            <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 40 }}>
                                <MaterialCommunityIcons name="bookmark-outline" size={80} color={theme.colors.surfaceVariant} />
                                <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', marginTop: 16 }}>No saved addresses yet</Text>
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
                                        style={[styles.suggestionItem, { borderBottomColor: theme.colors.outlineVariant }]}
                                        onPress={() => handleSelectSavedAddress(addr)}
                                    >
                                        <View style={[styles.iconCircle, { backgroundColor: theme.colors.background }]}>
                                            <MaterialCommunityIcons
                                                name={addr.label?.toLowerCase().includes('home') ? 'home' : addr.label?.toLowerCase().includes('office') ? 'office-building' : 'map-marker-outline'}
                                                size={20}
                                                color={'#757575'}
                                            />
                                        </View>
                                        <View style={{ marginLeft: 12, flex: 1 }}>
                                            <Text variant="bodyMedium" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>
                                                {addr.label}
                                            </Text>
                                            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                                                {addr.address}
                                            </Text>
                                        </View>
                                        <MaterialCommunityIcons name="dots-vertical" size={20} color={theme.colors.onSurfaceVariant} />
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
                                style={[styles.suggestionItem, { borderBottomColor: theme.colors.outlineVariant }]}
                                onPress={() => handleSelectSuggestion(item)}
                            >
                                <View style={[styles.iconCircle, { backgroundColor: theme.colors.background }]}>
                                    <MaterialCommunityIcons name="map-marker-outline" size={20} color={theme.colors.onSurfaceVariant} />
                                </View>
                                <View style={{ marginLeft: 12, flex: 1 }}>
                                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    {item.address ? (
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                                            {item.address}
                                        </Text>
                                    ) : null}
                                </View>
                                <TouchableOpacity onPress={() => handleSaveSuggestion(item)} style={{ padding: 4 }}>
                                    <MaterialCommunityIcons name="bookmark-outline" size={20} color={theme.colors.onSurfaceVariant} />
                                </TouchableOpacity>
                            </TouchableOpacity>
                        ))}

                        <View style={{ height: 80 }} />
                    </ScrollView>


                    <View style={[styles.fixedBottomButtonContainer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant }]}>
                        <TouchableOpacity
                            style={[styles.setOnMapBtn, { backgroundColor: theme.colors.surfaceVariant }]}
                            onPress={() => setIsMapVisible(true)}
                        >
                            <MaterialCommunityIcons name="map-outline" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
                            <Text variant="bodyMedium" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.primary }}>
                                Set on map
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </Animated.View>
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
        backgroundColor: '#FFFFFF',
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
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        zIndex: 20,
    },
    mapTopBar: {
        position: 'absolute',
        left: 12,
        right: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
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
        backgroundColor: '#FFFFFF',
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
        backgroundColor: '#FFFFFF',
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
        fontFamily: 'Inter_700Bold',
    },
    pillButtonActive: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#212121',
    },
    pillTextActive: {
        color: '#FFFFFF',
        fontFamily: 'Inter_700Bold',
    },
    fixedBottomButtonContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#FFFFFF',
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
        fontFamily: 'Inter_600SemiBold',
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