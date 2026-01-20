import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Linking, Alert } from 'react-native';
import { Text, Card, Button, useTheme, List, TextInput, Divider, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function RiderSupportScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const [message, setMessage] = useState('');

    const handleCallAdmin = () => {
        Linking.openURL('tel:09171234567');
    };

    const handleEmailAdmin = () => {
        Linking.openURL('mailto:admin@parcelsafe.com?subject=Rider Support Request');
    };

    const handleSubmitTicket = () => {
        if (!message.trim()) {
            Alert.alert("Empty Message", "Please describe your issue.");
            return;
        }
        // Logic to submit ticket to backend would go here
        Alert.alert("Ticket Submitted", "Admin has been notified. We will contact you shortly.");
        setMessage('');
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.header}>
                <IconButton icon="arrow-left" onPress={() => navigation.goBack()} />
                <Text variant="headlineSmall" style={{ fontWeight: 'bold', flex: 1 }}>Rider Support</Text>
            </View>

            {/* Emergency Section */}
            <Card style={[styles.card, { backgroundColor: theme.colors.errorContainer }]} mode="elevated">
                <Card.Content style={{ alignItems: 'center' }}>
                    <MaterialCommunityIcons name="alert-decagram" size={40} color={theme.colors.error} />
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.error, marginTop: 8 }}>Emergency & Safety</Text>
                    <Text variant="bodyMedium" style={{ textAlign: 'center', marginBottom: 12, color: theme.colors.onSurfaceVariant }}>
                        In case of accidents or immediate threats, contact emergency services or dispatch immediately.
                    </Text>
                    <Button mode="contained" buttonColor={theme.colors.error} onPress={handleCallAdmin} icon="phone">
                        Call Dispatch SOS
                    </Button>
                </Card.Content>
            </Card>

            {/* Direct Contact */}
            <List.Section>
                <List.Subheader style={{ color: theme.colors.primary }}>Contact Admin</List.Subheader>
                <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                    <List.Item
                        title="Rider Hotline"
                        description="(0917) 123-4567"
                        left={props => <List.Icon {...props} icon="phone" color={theme.colors.primary} />}
                        onPress={handleCallAdmin}
                    />
                    <Divider />
                    <List.Item
                        title="Email Admin"
                        description="admin@parcelsafe.com"
                        left={props => <List.Icon {...props} icon="email" color={theme.colors.primary} />}
                        onPress={handleEmailAdmin}
                    />
                </Card>
            </List.Section>

            {/* Ticket Form */}
            <List.Section>
                <List.Subheader style={{ color: theme.colors.primary }}>Submit a Ticket</List.Subheader>
                <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                    <Card.Content>
                        <TextInput
                            label="Describe your issue"
                            mode="outlined"
                            multiline
                            numberOfLines={4}
                            value={message}
                            onChangeText={setMessage}
                            style={{ backgroundColor: theme.colors.surface }}
                        />
                        <Button
                            mode="contained"
                            onPress={handleSubmitTicket}
                            style={{ marginTop: 12 }}
                            icon="send"
                        >
                            Submit Report
                        </Button>
                    </Card.Content>
                </Card>
            </List.Section>

            {/* Quick Helper Links */}
            <List.Section>
                <List.Subheader style={{ color: theme.colors.primary }}>Common Topics</List.Subheader>
                <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                    <List.Item
                        title="Hardware / Box Issues"
                        description="Unlock failures, battery connection"
                        left={props => <List.Icon {...props} icon="cube-scan" />}
                        right={props => <List.Icon {...props} icon="chevron-right" />}
                        onPress={() => Alert.alert("Tip", "Ensure Bluetooth is on and you are within 2 meters of the box.")}
                    />
                    <Divider />
                    <List.Item
                        title="Earnings & Payouts"
                        description="Missing payments, discrepancies"
                        left={props => <List.Icon {...props} icon="cash" />}
                        right={props => <List.Icon {...props} icon="chevron-right" />}
                        onPress={() => navigation.navigate('DeliveryRecords')} // Navigate to history
                    />
                </Card>
            </List.Section>

            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    card: {
        marginBottom: 12,
        borderRadius: 12,
    },
});
