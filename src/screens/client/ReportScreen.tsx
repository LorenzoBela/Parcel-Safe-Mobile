import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, useTheme, Chip, Divider, Surface, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const ISSUE_CATEGORIES = [
    'Late Delivery',
    'Damaged Item',
    'Rude Rider',
    'App Issue',
    'Other'
];

export default function ReportScreen() {
    const theme = useTheme();
    const navigation = useNavigation();
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);

    // Mock Orders for selection
    const RECENT_ORDERS = [
        { id: 'ORD-2024-001', date: 'Today, 2:30 PM', summary: 'Grocery Delivery', status: 'Active' },
        { id: 'ORD-2024-002', date: 'Yesterday', summary: 'Document Parcel', status: 'Completed' },
    ];

    const handleSubmit = async () => {
        if (!selectedOrder) {
            Alert.alert('Missing Info', 'Please select the order you are reporting.');
            return;
        }
        if (!selectedCategory) {
            Alert.alert('Missing Info', 'Please select an issue category.');
            return;
        }
        if (!description.trim()) {
            Alert.alert('Missing Info', 'Please describe the issue.');
            return;
        }

        setLoading(true);
        // Simulate API call
        setTimeout(() => {
            setLoading(false);
            Alert.alert('Report Submitted', 'We have received your report and will investigate shortly.', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);
        }, 1500);
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.header}>
                    <MaterialCommunityIcons name="file-document-edit-outline" size={48} color={theme.colors.error} />
                    <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.error }]}>Report an Issue</Text>
                    <Text variant="bodyMedium" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
                        We're sorry you experienced a problem. {'\n'}Please let us know what happened.
                    </Text>
                </View>

                <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Select Order</Text>
                    {RECENT_ORDERS.map((order) => (
                        <Card
                            key={order.id}
                            style={[
                                styles.orderCard,
                                { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline },
                                selectedOrder === order.id && { borderColor: theme.colors.primary, backgroundColor: theme.colors.secondaryContainer }
                            ]}
                            onPress={() => setSelectedOrder(order.id)}
                            mode="outlined"
                        >
                            <Card.Content style={styles.orderCardContent}>
                                <View>
                                    <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>{order.id}</Text>
                                    <Text variant="bodySmall">{order.summary} • {order.date}</Text>
                                </View>
                                {selectedOrder === order.id && (
                                    <MaterialCommunityIcons name="check-circle" size={24} color={theme.colors.primary} />
                                )}
                            </Card.Content>
                        </Card>
                    ))}
                </Surface>

                <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>What went wrong?</Text>
                    <View style={styles.chipContainer}>
                        {ISSUE_CATEGORIES.map((cat) => (
                            <Chip
                                key={cat}
                                selected={selectedCategory === cat}
                                onPress={() => setSelectedCategory(cat)}
                                style={styles.chip}
                                showSelectedOverlay
                            >
                                {cat}
                            </Chip>
                        ))}
                    </View>
                </Surface>

                <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Tell us more</Text>
                    <TextInput
                        mode="outlined"
                        placeholder="Describe the incident..."
                        multiline
                        numberOfLines={6}
                        value={description}
                        onChangeText={setDescription}
                        style={[styles.input, { backgroundColor: theme.colors.background }]}
                        textColor={theme.colors.onSurface}
                        placeholderTextColor={theme.colors.onSurfaceVariant}
                    />
                </Surface>

                <Button
                    mode="contained"
                    onPress={handleSubmit}
                    loading={loading}
                    disabled={loading}
                    style={styles.button}
                    buttonColor={theme.colors.error}
                >
                    Submit Report
                </Button>

                <Button
                    mode="text"
                    onPress={() => navigation.goBack()}
                    style={styles.cancelButton}
                >
                    Cancel
                </Button>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 20,
    },
    header: {
        alignItems: 'center',
        marginVertical: 24,
    },
    title: {
        fontWeight: 'bold',
        marginVertical: 8,
    },
    section: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 20,
    },
    sectionTitle: {
        marginBottom: 12,
        fontWeight: 'bold',
    },
    chipContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        marginBottom: 4,
    },
    input: {
        // backgroundColor handled inline
    },
    button: {
        marginTop: 8,
        paddingVertical: 4,
    },
    cancelButton: {
        marginTop: 8,
    },
    orderCard: {
        marginBottom: 8,
        borderWidth: 1,
    },
    orderCardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    }
});
