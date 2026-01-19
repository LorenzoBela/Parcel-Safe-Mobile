import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, Alert } from 'react-native';
import { Text, Button, Surface, useTheme, Avatar } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function SearchingRiderScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const [statusText, setStatusText] = useState('Contacting nearby riders...');

    // Animation constants
    const pulseAnim = useRef(new Animated.Value(0)).current;

    // booking details passed from previous screen
    const { pickup, dropoff } = route.params || {};

    useEffect(() => {
        // Start Pulse Animation
        const startAnimation = () => {
            pulseAnim.setValue(0);
            Animated.loop(
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 2000,
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: true,
                })
            ).start();
        };

        startAnimation();

        // Simulate Matching Process
        const timer1 = setTimeout(() => {
            setStatusText('Rider found! Waiting for acceptance...');
        }, 2000);

        const timer2 = setTimeout(() => {
            // Success! Navigate to TrackOrder (or a "Found" modal first)
            // For now, let's go directly to TrackOrder to simulate flow
            navigation.replace('TrackOrder', { bookingId: 'TEMP-BOOKING-123' });
        }, 5000);

        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
        };
    }, []);

    const handleCancel = () => {
        Alert.alert(
            'Cancel Booking',
            'Are you sure you want to cancel?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Yes',
                    style: 'destructive',
                    onPress: () => navigation.goBack()
                },
            ]
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.content}>

                {/* Radar/Pulse Animation Container */}
                <View style={styles.radarContainer}>
                    {/* Multiple expanding circles for radar effect */}
                    {[0, 1, 2].map((i) => {
                        const opacity = pulseAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.6, 0],
                        });

                        const scale = pulseAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 2 + i * 0.5], // Staggered expansion
                        });

                        return (
                            <Animated.View
                                key={i}
                                style={[
                                    styles.pulseCircle,
                                    {
                                        borderColor: theme.colors.primary,
                                        opacity,
                                        transform: [{ scale }],
                                    },
                                ]}
                            />
                        );
                    })}

                    <Surface style={styles.centerIcon} elevation={4}>
                        <MaterialCommunityIcons name="moped" size={40} color={theme.colors.primary} />
                    </Surface>
                </View>

                <Text variant="headlineSmall" style={[styles.statusTitle, { color: theme.colors.primary }]}>
                    Searching for Riders
                </Text>
                <Text variant="bodyMedium" style={styles.statusSubtitle}>
                    {statusText}
                </Text>

                <View style={styles.locationSummary}>
                    <View style={styles.row}>
                        <MaterialCommunityIcons name="circle-slice-8" size={16} color="green" />
                        <Text style={styles.locationText} numberOfLines={1}>{pickup || 'Pickup Location'}</Text>
                    </View>
                    <View style={[styles.verticalLine, { backgroundColor: '#ddd' }]} />
                    <View style={styles.row}>
                        <MaterialCommunityIcons name="map-marker" size={16} color="red" />
                        <Text style={styles.locationText} numberOfLines={1}>{dropoff || 'Dropoff Location'}</Text>
                    </View>
                </View>

            </View>

            <View style={styles.footer}>
                <Button
                    mode="contained-tonal"
                    onPress={handleCancel}
                    textColor={theme.colors.error}
                    style={styles.cancelButton}
                >
                    Cancel Search
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    radarContainer: {
        width: 200,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 40,
    },
    pulseCircle: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 2,
    },
    centerIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'white',
        zIndex: 10,
    },
    statusTitle: {
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
    },
    statusSubtitle: {
        color: '#666',
        marginBottom: 32,
        textAlign: 'center',
    },
    locationSummary: {
        width: '100%',
        padding: 16,
        backgroundColor: '#f9f9f9',
        borderRadius: 12,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
    },
    locationText: {
        marginLeft: 12,
        color: '#444',
        flex: 1,
    },
    verticalLine: {
        width: 2,
        height: 16,
        marginLeft: 7,
        marginVertical: 2,
    },
    footer: {
        padding: 24,
        paddingBottom: 40,
    },
    cancelButton: {
        borderColor: '#ffdddd',
    },
});
