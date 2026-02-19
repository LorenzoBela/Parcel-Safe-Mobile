import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, useTheme, Chip, Surface, Card, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../services/supabaseClient';
/** Format a UTC ISO timestamp to PH-local display using the device clock.
 *  The device is in Asia/Manila, so native Date handles the conversion. */
const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        + ', '
        + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const formatStatus = (status: string): string => {
    switch (status) {
        case 'PENDING': return 'Pending';
        case 'ASSIGNED': return 'Assigned';
        case 'IN_TRANSIT': return 'In Transit';
        case 'PICKED_UP': return 'Picked Up';
        case 'ARRIVED': return 'Arrived';
        case 'COMPLETED': return 'Delivered';
        case 'CANCELLED': return 'Cancelled';
        case 'TAMPERED': return 'Tampered';
        default: return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
};

const ISSUE_CATEGORIES = [
    'Late Delivery',
    'Damaged Item',
    'Rude Rider',
    'App Issue',
    'Other'
];

interface Order {
    id: string;
    tracking_number: string;
    created_at: string;
    package_description: string;
    status: string;
    dropoff_address: string;
}

export default function ReportScreen() {
    const theme = useTheme();
    const navigation = useNavigation();
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [orders, setOrders] = useState<Order[]>([]);
    const [fetchingOrders, setFetchingOrders] = useState(true);

    useEffect(() => {
        fetchOrders();
    }, []);

    const fetchOrders = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setFetchingOrders(false);
                return;
            }

            const { data, error } = await supabase
                .from('deliveries')
                .select('id, tracking_number, created_at, package_description, status, dropoff_address')
                .eq('customer_id', user.id)
                .order('created_at', { ascending: false })
                .limit(5);

            if (error) throw error;
            setOrders(data || []);
        } catch (error) {
            console.error('Error fetching orders:', error);
            // Don't alert on mount, just show empty or error state
        } finally {
            setFetchingOrders(false);
        }
    };

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
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('User not authenticated');

            const { error } = await supabase
                .from('issue_reports')
                .insert({
                    user_id: user.id,
                    order_id: selectedOrder,
                    category: selectedCategory,
                    description: description.trim(),
                    status: 'OPEN'
                });

            if (error) throw error;

            Alert.alert('Report Submitted', 'We have received your report and will investigate shortly.', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);
        } catch (error) {
            console.error('Error submitting report:', error);
            Alert.alert('Error', 'Failed to submit report. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const insets = useSafeAreaInsets();

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView contentContainerStyle={[styles.content, {
                paddingBottom: insets.bottom + 20,
                paddingTop: insets.top + 20
            }]}>
                <View style={styles.header}>
                    <MaterialCommunityIcons name="file-document-edit-outline" size={48} color={theme.colors.error} />
                    <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.error }]}>Report an Issue</Text>
                    <Text variant="bodyMedium" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
                        We're sorry you experienced a problem. {'\n'}Please let us know what happened.
                    </Text>
                </View>

                <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Select Order</Text>
                    {fetchingOrders ? (
                        <ActivityIndicator style={{ padding: 20 }} />
                    ) : orders.length > 0 ? (
                        orders.map((order) => (
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
                                    <View style={{ flex: 1 }}>
                                        <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>{order.tracking_number || 'Order #' + order.id.slice(0, 8)}</Text>
                                        <Text variant="bodySmall" numberOfLines={1}>{order.package_description || 'No description'} • {formatDate(order.created_at)}</Text>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{formatStatus(order.status)}</Text>
                                    </View>
                                    {selectedOrder === order.id && (
                                        <MaterialCommunityIcons name="check-circle" size={24} color={theme.colors.primary} />
                                    )}
                                </Card.Content>
                            </Card>
                        ))
                    ) : (
                        <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, padding: 20 }}>No recent orders found.</Text>
                    )}
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
