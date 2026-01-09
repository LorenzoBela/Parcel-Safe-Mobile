import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Button, Avatar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export default function TamperAlertsScreen() {
    const navigation = useNavigation<any>();

    // Mock alerts
    const alerts = [
        { id: '1', boxId: 'BOX-001', time: '10:30 AM', location: 'Manila', photo: true },
        { id: '2', boxId: 'BOX-005', time: '11:15 AM', location: 'Quezon City', photo: true },
    ];

    const renderItem = ({ item }) => (
        <Card style={styles.card}>
            <Card.Title
                title={`Tamper Alert: ${item.boxId}`}
                subtitle={item.time}
                left={(props) => <Avatar.Icon {...props} icon="alert" style={{ backgroundColor: 'red' }} />}
            />
            <Card.Content>
                <Text variant="bodyMedium">Location: {item.location}</Text>
            </Card.Content>
            <Card.Actions>
                <Button onPress={() => navigation.navigate('PhotoAudit', { logId: item.id })}>View Photos</Button>
                <Button onPress={() => console.log('Resolve')}>Resolve</Button>
            </Card.Actions>
        </Card>
    );

    return (
        <View style={styles.container}>
            <Text variant="headlineSmall" style={styles.header}>Tamper Alerts</Text>
            <FlatList
                data={alerts}
                renderItem={renderItem}
                keyExtractor={item => item.id}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        backgroundColor: '#fff',
    },
    header: {
        marginBottom: 16,
        color: 'red',
    },
    card: {
        marginBottom: 10,
        borderColor: 'red',
        borderWidth: 1,
    },
});
