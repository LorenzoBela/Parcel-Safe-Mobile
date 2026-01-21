import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import MapboxGL, { isMapboxNativeAvailable, MapFallback } from '../../components/map/MapboxWrapper';
import { Text, Card, Avatar } from 'react-native-paper';

export default function GlobalMapScreen() {
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    // Mock active boxes
    const activeBoxes = [
        { id: 1, lat: 14.5995, lng: 120.9842, status: 'In Transit' },
        { id: 2, lat: 14.6010, lng: 120.9860, status: 'Idle' },
        { id: 3, lat: 14.5980, lng: 120.9820, status: 'Tampered', alert: true },
    ];

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    return (
        <View style={styles.container}>
            {MAPBOX_TOKEN ? (
                <MapboxGL.MapView
                    style={styles.map}
                    logoEnabled={false}
                    attributionEnabled={false}
                >
                    <MapboxGL.Camera
                        zoomLevel={13}
                        centerCoordinate={[120.9842, 14.5995]}
                    />

                    {activeBoxes.map((box) => (
                        <MapboxGL.PointAnnotation
                            key={box.id}
                            id={`box-${box.id}`}
                            coordinate={[box.lng, box.lat]}
                            title={`Box #${box.id}`}
                        >
                            <View style={[styles.markerDot, { backgroundColor: box.alert ? '#F44336' : '#4CAF50' }]} />
                        </MapboxGL.PointAnnotation>
                    ))}
                </MapboxGL.MapView>
            ) : (
                <View style={[styles.map, styles.mapFallback]}>
                    <Text style={{ color: '#666' }}>Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env</Text>
                </View>
            )}

            <View style={styles.overlay}>
                <Card>
                    <Card.Content>
                        <Text variant="titleMedium">Active Fleet: {activeBoxes.length}</Text>
                        <Text variant="bodySmall" style={{ color: 'red' }}>1 Tamper Alert Active</Text>
                    </Card.Content>
                </Card>
            </View>
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
        backgroundColor: '#f1f1f1',
    },
    markerDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: 'white',
    },
    overlay: {
        position: 'absolute',
        top: 50,
        left: 20,
        right: 20,
    },
});
