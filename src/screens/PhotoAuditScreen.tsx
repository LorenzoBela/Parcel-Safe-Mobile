import React from 'react';
import { View, StyleSheet, Image, ScrollView, Dimensions } from 'react-native';
import { Text, Card } from 'react-native-paper';

export default function PhotoAuditScreen({ route }) {
    const { logId } = route.params || {};
    const width = Dimensions.get('window').width;

    // Mock photos
    const photos = [
        'https://via.placeholder.com/300x200?text=Delivery+Photo+1',
        'https://via.placeholder.com/300x200?text=Delivery+Photo+2',
    ];

    return (
        <ScrollView style={styles.container}>
            <Text variant="headlineSmall" style={styles.title}>Audit Logs for ID: {logId}</Text>

            <Card style={styles.card}>
                <Card.Content>
                    <Text variant="bodyMedium">Time: 14:30</Text>
                    <Text variant="bodyMedium">Location: 14.5995, 120.9842</Text>
                    <Text variant="bodyMedium">Status: Successful Unlock</Text>
                </Card.Content>
            </Card>

            <Text variant="titleMedium" style={styles.sectionTitle}>Captured Photos</Text>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                {photos.map((photo, index) => (
                    <View key={index} style={{ width, alignItems: 'center' }}>
                        <Image source={{ uri: photo }} style={styles.image} resizeMode="cover" />
                    </View>
                ))}
            </ScrollView>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    title: {
        padding: 16,
    },
    card: {
        margin: 16,
    },
    sectionTitle: {
        padding: 16,
        paddingBottom: 0,
    },
    image: {
        width: Dimensions.get('window').width - 32,
        height: 200,
        borderRadius: 8,
        margin: 16,
    },
});
