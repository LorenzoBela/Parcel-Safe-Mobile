import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export default function ArrivalScreen() {
    const navigation = useNavigation<any>();
    const [isInsideGeoFence, setIsInsideGeoFence] = useState(false);

    // Mock geo-fence check
    const checkLocation = () => {
        setIsInsideGeoFence(!isInsideGeoFence); // Toggle for demo
    };

    return (
        <View style={styles.container}>
            <Text variant="headlineMedium" style={styles.title}>Arrival & Verification</Text>

            <View style={[styles.statusBox, { borderColor: isInsideGeoFence ? 'green' : 'red' }]}>
                <Text variant="titleLarge" style={{ color: isInsideGeoFence ? 'green' : 'red' }}>
                    {isInsideGeoFence ? 'INSIDE GEO-FENCE' : 'OUTSIDE GEO-FENCE'}
                </Text>
                <Text variant="bodyMedium">
                    {isInsideGeoFence ? 'You can now request OTP from customer.' : 'Please move closer to the delivery point.'}
                </Text>
            </View>

            <Button mode="contained" onPress={checkLocation} style={styles.button}>
                Simulate GPS Check
            </Button>

            <Button
                mode="contained"
                disabled={!isInsideGeoFence}
                onPress={() => navigation.navigate('DeliveryCompletion')}
                style={styles.button}
            >
                Proceed to Handover
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        justifyContent: 'center',
        backgroundColor: '#fff',
    },
    title: {
        textAlign: 'center',
        marginBottom: 40,
    },
    statusBox: {
        padding: 20,
        borderWidth: 4,
        borderRadius: 10,
        alignItems: 'center',
        marginBottom: 30,
    },
    button: {
        marginBottom: 10,
    },
});
