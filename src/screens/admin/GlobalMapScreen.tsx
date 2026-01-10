import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Text, Card, Avatar } from 'react-native-paper';

export default function GlobalMapScreen() {
    // Mock active boxes
    const activeBoxes = [
        { id: 1, lat: 14.5995, lng: 120.9842, status: 'In Transit' },
        { id: 2, lat: 14.6010, lng: 120.9860, status: 'Idle' },
        { id: 3, lat: 14.5980, lng: 120.9820, status: 'Tampered', alert: true },
    ];

    return (
        <View style={styles.container}>
            <MapView
                style={styles.map}
                initialRegion={{
                    latitude: 14.5995,
                    longitude: 120.9842,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                }}
            >
                {activeBoxes.map((box) => (
                    <Marker
                        key={box.id}
                        coordinate={{ latitude: box.lat, longitude: box.lng }}
                        title={`Box #${box.id}`}
                        description={box.status}
                        pinColor={box.alert ? 'red' : 'green'}
                    />
                ))}
            </MapView>

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
    overlay: {
        position: 'absolute',
        top: 50,
        left: 20,
        right: 20,
    },
});
