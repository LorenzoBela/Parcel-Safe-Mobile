import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Title, Paragraph, DataTable, useTheme, Button, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function RatesScreen() {
    const theme = useTheme();
    const navigation = useNavigation();

    const insets = useSafeAreaInsets();

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={[
                styles.content,
                { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }
            ]}
        >
            <View style={styles.header}>
                <MaterialCommunityIcons name="tag-multiple" size={40} color={theme.colors.primary} />
                <Text variant="headlineMedium" style={[styles.headerTitle, { color: theme.colors.primary }]}>
                    System Rates
                </Text>
                <Text variant="bodyMedium" style={[styles.headerSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                    Transparent, affordable pricing for secure deliveries.
                </Text>
            </View>

            {/* Base Fare Section */}
            <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                <Card.Content>
                    <View style={styles.cardHeader}>
                        <MaterialCommunityIcons name="moped" size={24} color={theme.colors.secondary} />
                        <Title style={[styles.cardTitle, { color: theme.colors.onSurface }]}>Standard Delivery</Title>
                    </View>
                    <Paragraph style={[styles.cardDescription, { color: theme.colors.onSurfaceVariant }]}>
                        Ideal for documents, small parcels, and food items. Includes Smart Top Box security.
                    </Paragraph>

                    <View style={styles.priceRow}>
                        <Text variant="titleLarge" style={[styles.price, { color: theme.colors.onSurface }]}>₱49.00</Text>
                        <Text variant="bodyMedium" style={[styles.unit, { color: theme.colors.onSurfaceVariant }]}>Base Fare</Text>
                    </View>
                    <View style={styles.priceRow}>
                        <Text variant="titleMedium" style={[styles.price, { color: theme.colors.onSurface }]}>+ ₱10.00</Text>
                        <Text variant="bodyMedium" style={[styles.unit, { color: theme.colors.onSurfaceVariant }]}>per km (after 1st km)</Text>
                    </View>
                </Card.Content>
            </Card>

            {/* Surcharges Table */}
            <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                <Card.Content>
                    <View style={styles.cardHeader}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={24} color="#F57C00" />
                        <Title style={[styles.cardTitle, { color: theme.colors.onSurface }]}>Add-ons & Surcharges</Title>
                    </View>

                    <DataTable>
                        <DataTable.Header>
                            <DataTable.Title>Item</DataTable.Title>
                            <DataTable.Title numeric>Fee</DataTable.Title>
                        </DataTable.Header>

                        <DataTable.Row>
                            <DataTable.Cell>High Value Surcharge (Insured)</DataTable.Cell>
                            <DataTable.Cell numeric>+ ₱50.00</DataTable.Cell>
                        </DataTable.Row>

                        <DataTable.Row>
                            <DataTable.Cell>Wait Time (per 5 mins)</DataTable.Cell>
                            <DataTable.Cell numeric>+ ₱15.00</DataTable.Cell>
                        </DataTable.Row>

                        <DataTable.Row>
                            <DataTable.Cell>Night Service (10PM - 6AM)</DataTable.Cell>
                            <DataTable.Cell numeric>+ 20%</DataTable.Cell>
                        </DataTable.Row>
                        <DataTable.Row>
                            <DataTable.Cell>Holiday Surcharge</DataTable.Cell>
                            <DataTable.Cell numeric>+ 15%</DataTable.Cell>
                        </DataTable.Row>
                    </DataTable>
                </Card.Content>
            </Card>

            {/* Smart Security Value Prop */}
            <Card style={[styles.card, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]} mode="contained">
                <Card.Content>
                    <View style={styles.cardHeader}>
                        <MaterialCommunityIcons name="shield-check" size={24} color={theme.dark ? '#A5D6A7' : '#2E7D32'} />
                        <Title style={[styles.cardTitle, { color: theme.dark ? '#A5D6A7' : '#2E7D32' }]}>Included Security</Title>
                    </View>
                    <Paragraph style={{ color: theme.dark ? '#E8F5E9' : '#1B5E20' }}>
                        Every delivery includes:
                    </Paragraph>
                    <View style={styles.bulletPoint}>
                        <MaterialCommunityIcons name="check" size={16} color={theme.dark ? '#A5D6A7' : '#2E7D32'} />
                        <Text style={[styles.bulletText, { color: theme.dark ? '#E8F5E9' : '#2E7D32' }]}>GPS Real-time Tracking</Text>
                    </View>
                    <View style={styles.bulletPoint}>
                        <MaterialCommunityIcons name="check" size={16} color={theme.dark ? '#A5D6A7' : '#2E7D32'} />
                        <Text style={[styles.bulletText, { color: theme.dark ? '#E8F5E9' : '#2E7D32' }]}>Photographic Proof of Delivery</Text>
                    </View>
                    <View style={styles.bulletPoint}>
                        <MaterialCommunityIcons name="check" size={16} color={theme.dark ? '#A5D6A7' : '#2E7D32'} />
                        <Text style={[styles.bulletText, { color: theme.dark ? '#E8F5E9' : '#2E7D32' }]}>Smart Lock Tamper Alerts</Text>
                    </View>
                </Card.Content>
            </Card>

            <View style={{ height: 20 }} />
            <Button mode="outlined" onPress={() => navigation.goBack()}>
                Close
            </Button>

        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    content: {
        padding: 20,
    },
    header: {
        alignItems: 'center',
        marginBottom: 24,
        marginTop: 10,
    },
    headerTitle: {
        fontWeight: 'bold',
        marginTop: 8,
    },
    headerSubtitle: {
        color: '#666',
        textAlign: 'center',
    },
    card: {
        marginBottom: 16,
        backgroundColor: 'white',
        borderRadius: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    cardTitle: {
        marginLeft: 8,
        fontSize: 18,
        fontWeight: 'bold',
    },
    cardDescription: {
        color: '#555',
        marginBottom: 16,
    },
    priceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: 4,
    },
    price: {
        fontWeight: 'bold',
        color: '#333',
        marginRight: 8,
    },
    unit: {
        color: '#777',
    },
    bulletPoint: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    bulletText: {
        marginLeft: 8,
        color: '#2E7D32',
    }
});
