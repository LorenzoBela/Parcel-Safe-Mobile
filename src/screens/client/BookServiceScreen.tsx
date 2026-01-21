import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Dimensions, Alert, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button, useTheme, Card, DefaultTheme } from 'react-native-paper';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
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

export default function BookServiceScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [pickupText, setPickupText] = useState('');
    const [dropoffText, setDropoffText] = useState('');

    // Coordinates
    const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);

    // Which input is currently focused/active for map selection
    const [activeField, setActiveField] = useState<'pickup' | 'dropoff'>('pickup');

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

    const handleMapPress = (e: any) => {
        const coords = {
            latitude: e.geometry.coordinates[1],
            longitude: e.geometry.coordinates[0],
        };
        if (activeField === 'pickup') {
            setPickupCoords(coords);
            setPickupText(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
        } else {
            setDropoffCoords(coords);
            setDropoffText(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
        }
    };

    const handleConfirm = () => {
        if (!pickupCoords || !dropoffCoords) {
            Alert.alert('Missing Location', 'Please select both Pickup and Dropoff locations.');
            return;
        }

        // TODO: Proceed to next step (e.g., select vehicle, price estimate)
        // Alert.alert('Booking Confirmed', `Pickup: ${pickupText}\nDropoff: ${dropoffText}`);

        // Navigate to Searching Screen with params
        navigation.navigate('SearchingRider', {
            pickup: pickupText,
            dropoff: dropoffText,
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

                        <TouchableOpacity
                            style={[
                                styles.inputWrapper,
                                { backgroundColor: theme.colors.background, borderColor: theme.colors.outline },
                                activeField === 'pickup' && { backgroundColor: theme.colors.secondaryContainer, borderColor: theme.colors.primary }
                            ]}
                            onPress={() => setActiveField('pickup')}
                        >
                            <MaterialCommunityIcons name="circle-slice-8" size={20} color="green" style={styles.inputIcon} />
                            <TextInput
                                mode="flat"
                                placeholder="Pickup Location"
                                value={pickupText}
                                onChangeText={setPickupText}
                                style={[styles.textInput, { backgroundColor: 'transparent' }]}
                                textColor={theme.colors.onSurface}
                                underlineColor="transparent"
                                activeUnderlineColor="transparent"
                                placeholderTextColor={theme.colors.onSurfaceVariant}
                                onFocus={() => setActiveField('pickup')}
                                right={<TextInput.Icon icon="crosshairs-gps" onPress={() => setActiveField('pickup')} />}
                            />
                        </TouchableOpacity>

                        <View style={styles.divider} />

                        <TouchableOpacity
                            style={[
                                styles.inputWrapper,
                                { backgroundColor: theme.colors.background, borderColor: theme.colors.outline },
                                activeField === 'dropoff' && { backgroundColor: theme.colors.secondaryContainer, borderColor: theme.colors.primary }
                            ]}
                            onPress={() => setActiveField('dropoff')}
                        >
                            <MaterialCommunityIcons name="map-marker" size={20} color="red" style={styles.inputIcon} />
                            <TextInput
                                mode="flat"
                                placeholder="Dropoff Location"
                                value={dropoffText}
                                onChangeText={setDropoffText}
                                style={[styles.textInput, { backgroundColor: 'transparent' }]}
                                textColor={theme.colors.onSurface}
                                underlineColor="transparent"
                                activeUnderlineColor="transparent"
                                placeholderTextColor={theme.colors.onSurfaceVariant}
                                onFocus={() => setActiveField('dropoff')}
                            />
                        </TouchableOpacity>

                        <View style={styles.helperTextContainer}>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                {activeField === 'pickup' ? 'Tap map to set Pickup' : 'Tap map to set Dropoff'}
                            </Text>
                        </View>

                        <Button
                            mode="contained"
                            onPress={handleConfirm}
                            style={styles.button}
                            contentStyle={{ paddingVertical: 4 }}
                        >
                            Confirm Booking
                        </Button>
                    </Card.Content>
                </Card>
            </View>

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
    }
});
