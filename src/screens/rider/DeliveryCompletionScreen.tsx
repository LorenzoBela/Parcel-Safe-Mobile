import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Avatar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export default function DeliveryCompletionScreen() {
    const navigation = useNavigation<any>();

    const handleComplete = () => {
        console.log('Delivery Completed');
        navigation.navigate('Dashboard');
    };

    return (
        <View style={styles.container}>
            <Avatar.Icon size={100} icon="check-circle" style={styles.icon} color="white" />
            <Text variant="headlineMedium" style={styles.title}>Delivery Successful!</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
                Parcel has been unlocked and handed over.
            </Text>

            <Button mode="contained" onPress={handleComplete} style={styles.button}>
                Back to Dashboard
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#4CAF50', // Green background
        padding: 20,
    },
    icon: {
        backgroundColor: 'transparent',
        marginBottom: 20,
    },
    title: {
        color: 'white',
        fontWeight: 'bold',
        marginBottom: 10,
    },
    subtitle: {
        color: 'white',
        marginBottom: 40,
        textAlign: 'center',
    },
    button: {
        backgroundColor: 'white',
        width: '100%',
    },
});
