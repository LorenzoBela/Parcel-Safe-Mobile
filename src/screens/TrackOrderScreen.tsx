import React from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import MapView, { Marker, Circle, Polyline } from 'react-native-maps';
import { Text, Card, Avatar, Button, IconButton, Surface, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function TrackOrderScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();

    // Mock coordinates
    const boxLocation = { latitude: 14.5995, longitude: 120.9842 };
    const riderLocation = { latitude: 14.5990, longitude: 120.9830 };
    const destination = { latitude: 14.6000, longitude: 120.9850 };

    const riderDetails = {
        name: 'Juan Dela Cruz',
        vehicle: 'Yamaha NMAX (ABC-1234)',
        rating: 4.8,
        phone: '+63 912 345 6789',
    };

    return (
        <View style={styles.container}>
            <MapView
                style={styles.map}
                initialRegion={{
                    latitude: 14.5995,
                    longitude: 120.9842,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                }}
            >
                {/* Route Line */}
                <Polyline
                    coordinates={[riderLocation, boxLocation, destination]}
                    strokeColor={theme.colors.primary}
                    strokeWidth={4}
                />

                {/* Box Marker */}
                <Marker coordinate={boxLocation} title="Your Parcel" description="Smart Box">
                    <View style={styles.markerContainer}>
                        <Avatar.Icon size={40} icon="package-variant" style={{ backgroundColor: 'orange' }} />
                    </View>
                </Marker>

                {/* Rider Marker */}
                <Marker coordinate={riderLocation} title="Rider" description={riderDetails.name}>
                    <View style={styles.markerContainer}>
                        <Avatar.Icon size={40} icon="motorbike" style={{ backgroundColor: theme.colors.primary }} />
                    </View>
                </Marker>

                {/* Destination Marker */}
                <Marker coordinate={destination} title="Destination">
                    <View style={styles.markerContainer}>
                        <MaterialCommunityIcons name="map-marker" size={40} color="#F44336" />
                    </View>
                </Marker>

                {/* Geo-fence */}
                <Circle
                    center={destination}
                    radius={50}
                    strokeColor="rgba(76, 175, 80, 0.5)"
                    fillColor="rgba(76, 175, 80, 0.1)"
                />
            </MapView>

            {/* Header Actions */}
            <View style={styles.headerActions}>
                <Surface style={styles.iconButtonSurface} elevation={2}>
                    <IconButton icon="arrow-left" size={24} onPress={() => navigation.goBack()} />
                </Surface>
            </View>

            {/* Bottom Sheet Info */}
            <View style={styles.bottomSheet}>
                <View style={styles.handleBar} />

                <View style={styles.statusHeader}>
                    <View>
                        <Text variant="titleLarge" style={{ fontWeight: 'bold' }}>Arriving in 10 mins</Text>
                        <Text variant="bodyMedium" style={{ color: '#666' }}>On the way to your location</Text>
                    </View>
                    <Surface style={styles.etaBadge} elevation={0}>
                        <Text style={{ color: 'white', fontWeight: 'bold' }}>10 min</Text>
                    </Surface>
                </View>

                <View style={styles.divider} />

                <View style={styles.riderInfo}>
                    <Avatar.Image size={50} source={{ uri: 'https://i.pravatar.cc/150?img=11' }} />
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{riderDetails.name}</Text>
                        <Text variant="bodySmall" style={{ color: '#666' }}>{riderDetails.vehicle}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <MaterialCommunityIcons name="star" size={16} color="#FFC107" />
                            <Text variant="labelSmall" style={{ marginLeft: 4 }}>{riderDetails.rating}</Text>
                        </View>
                    </View>
                    <View style={styles.actionButtons}>
                        <IconButton
                            mode="contained"
                            icon="phone"
                            containerColor="#E3F2FD"
                            iconColor="#2196F3"
                            size={24}
                            onPress={() => console.log('Call')}
                        />
                        <IconButton
                            mode="contained"
                            icon="message-text"
                            containerColor="#E8F5E9"
                            iconColor="#4CAF50"
                            size={24}
                            onPress={() => console.log('Message')}
                        />
                    </View>
                </View>

                <Button
                    mode="contained"
                    style={styles.viewOtpBtn}
                    icon="lock-open"
                    onPress={() => navigation.navigate('OTP')}
                >
                    View Secure OTP
                </Button>
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
    headerActions: {
        position: 'absolute',
        top: 50,
        left: 20,
        zIndex: 10,
    },
    iconButtonSurface: {
        borderRadius: 25,
        backgroundColor: 'white',
    },
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'white',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingTop: 12,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    handleBar: {
        width: 40,
        height: 4,
        backgroundColor: '#E0E0E0',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 20,
    },
    statusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    etaBadge: {
        backgroundColor: '#4CAF50',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    divider: {
        height: 1,
        backgroundColor: '#F0F0F0',
        marginBottom: 20,
    },
    riderInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    actionButtons: {
        flexDirection: 'row',
    },
    viewOtpBtn: {
        borderRadius: 12,
        paddingVertical: 6,
    },
});
