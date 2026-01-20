import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { Text, Button, useTheme, Surface, IconButton, TextInput, Portal, Modal, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface SavedAddress {
    id: string;
    label: string; // e.g., "Home", "Office"
    address: string;
    details?: string; // e.g., "Unit 402"
}

export default function SavedAddressesScreen() {
    const theme = useTheme();
    const navigation = useNavigation();
    const [loading, setLoading] = useState(false);
    const [addresses, setAddresses] = useState<SavedAddress[]>([]);

    // Modal State
    const [modalVisible, setModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [label, setLabel] = useState('');
    const [addressText, setAddressText] = useState('');
    const [details, setDetails] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchAddresses();
    }, []);

    const fetchAddresses = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase!
                .from('profiles')
                .select('saved_addresses')
                .eq('id', user.id)
                .single();

            if (error) throw error;

            if (data?.saved_addresses) {
                // Parse JSON if it's a string, otherwise use directly if it's already an object (Supabase client often auto-parses)
                const parsed = typeof data.saved_addresses === 'string'
                    ? JSON.parse(data.saved_addresses)
                    : data.saved_addresses;
                setAddresses(Array.isArray(parsed) ? parsed : []);
            }
        } catch (error) {
            console.error('Error fetching addresses:', error);
        } finally {
            setLoading(false);
        }
    };

    const saveAddressesToDB = async (newAddresses: SavedAddress[]) => {
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) throw new Error('No user');

            const { error } = await supabase!
                .from('profiles')
                .update({ saved_addresses: newAddresses })
                .eq('id', user.id);

            if (error) throw error;
            setAddresses(newAddresses);
            return true;
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to save address.');
            return false;
        }
    };

    const handleAddOrUpdate = async () => {
        if (!label || !addressText) {
            Alert.alert('Missing Fields', 'Please enter a label and address.');
            return;
        }

        setSaving(true);
        const newAddress: SavedAddress = {
            id: editingId || Date.now().toString(),
            label,
            address: addressText,
            details
        };

        let updatedList;
        if (editingId) {
            updatedList = addresses.map(a => a.id === editingId ? newAddress : a);
        } else {
            updatedList = [...addresses, newAddress];
        }

        const success = await saveAddressesToDB(updatedList);
        setSaving(false);

        if (success) {
            setModalVisible(false);
            resetForm();
        }
    };

    const handleDelete = (id: string) => {
        Alert.alert(
            'Delete Address',
            'Are you sure you want to delete this address?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        const updatedList = addresses.filter(a => a.id !== id);
                        await saveAddressesToDB(updatedList);
                    }
                }
            ]
        );
    };

    const openEdit = (addr: SavedAddress) => {
        setEditingId(addr.id);
        setLabel(addr.label);
        setAddressText(addr.address);
        setDetails(addr.details || '');
        setModalVisible(true);
    };

    const openAdd = () => {
        resetForm();
        setModalVisible(true);
    };

    const resetForm = () => {
        setEditingId(null);
        setLabel('');
        setAddressText('');
        setDetails('');
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {loading ? (
                    <Text style={{ textAlign: 'center', marginTop: 20 }}>Loading addresses...</Text>
                ) : addresses.length === 0 ? (
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="map-marker-off" size={48} color={theme.colors.outline} />
                        <Text style={{ marginTop: 16, color: theme.colors.onSurfaceVariant }}>No saved addresses yet.</Text>
                    </View>
                ) : (
                    addresses.map((addr) => (
                        <Surface key={addr.id} style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
                            <View style={styles.cardHeader}>
                                <View style={styles.labelContainer}>
                                    <MaterialCommunityIcons
                                        name={addr.label.toLowerCase().includes('home') ? 'home' : addr.label.toLowerCase().includes('office') ? 'office-building' : 'map-marker'}
                                        size={20}
                                        color={theme.colors.primary}
                                    />
                                    <Text variant="titleMedium" style={[styles.cardLabel, { color: theme.colors.onSurface }]}>{addr.label}</Text>
                                </View>
                                <View style={{ flexDirection: 'row' }}>
                                    <IconButton icon="pencil" size={20} onPress={() => openEdit(addr)} />
                                    <IconButton icon="delete" size={20} iconColor={theme.colors.error} onPress={() => handleDelete(addr.id)} />
                                </View>
                            </View>
                            <Divider style={{ marginBottom: 12 }} />
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>{addr.address}</Text>
                            {addr.details ? (
                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Note: {addr.details}</Text>
                            ) : null}
                        </Surface>
                    ))
                )}
            </ScrollView>

            <Button
                mode="contained"
                icon="plus"
                onPress={openAdd}
                style={styles.addButton}
                contentStyle={{ paddingVertical: 8 }}
            >
                Add New Address
            </Button>

            <Portal>
                <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                    <Text variant="headlineSmall" style={{ marginBottom: 16, fontWeight: 'bold' }}>
                        {editingId ? 'Edit Address' : 'New Address'}
                    </Text>

                    <TextInput
                        label="Label (e.g. Home, Work)"
                        value={label}
                        onChangeText={setLabel}
                        mode="outlined"
                        style={styles.input}
                    />

                    <TextInput
                        label="Full Address"
                        value={addressText}
                        onChangeText={setAddressText}
                        mode="outlined"
                        multiline
                        style={styles.input}
                    />

                    <TextInput
                        label="Additional Details (Optional)"
                        value={details}
                        onChangeText={setDetails}
                        mode="outlined"
                        placeholder="Landmarks, Unit No, etc."
                        style={styles.input}
                    />

                    <View style={styles.modalActions}>
                        <Button onPress={() => setModalVisible(false)} style={{ flex: 1, marginRight: 8 }}>Cancel</Button>
                        <Button mode="contained" onPress={handleAddOrUpdate} loading={saving} style={{ flex: 1 }}>Save</Button>
                    </View>
                </Modal>
            </Portal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 100,
    },
    emptyState: {
        alignItems: 'center',
        marginTop: 60,
    },
    card: {
        borderRadius: 12,
        marginBottom: 16,
        padding: 16,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    labelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cardLabel: {
        marginLeft: 8,
        fontWeight: 'bold',
    },
    addButton: {
        position: 'absolute',
        bottom: 24,
        left: 20,
        right: 20,
        borderRadius: 12,
        elevation: 4,
    },
    modalContent: {
        margin: 20,
        padding: 24,
        borderRadius: 16,
    },
    input: {
        marginBottom: 16,
        backgroundColor: 'transparent',
    },
    modalActions: {
        flexDirection: 'row',
        marginTop: 8,
    }
});
