import React, { useState, useEffect } from 'react';
import { View, Animated, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Button, useTheme, Surface, IconButton, TextInput, Portal, Modal, Divider, Checkbox } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import LocationPicker, { LocationData } from '../../components/LocationPicker';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumAlert } from '../../services/PremiumAlertService';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', error: '#FF3B30',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', error: '#FF453A',
};
interface SavedAddress {
    id: string;
    label: string; // e.g., "Home", "Office"
    address: string;
    details?: string; // e.g., "Unit 402"
    latitude?: number;
    longitude?: number;
    isDefault?: boolean;
}

export default function SavedAddressesScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const theme = useTheme();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(false);
    const [addresses, setAddresses] = useState<SavedAddress[]>([]);

    // Modal State
    const [modalVisible, setModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [label, setLabel] = useState('');
    const [addressText, setAddressText] = useState('');
    const [details, setDetails] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [saving, setSaving] = useState(false);
    const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number } | null>(null);

    // Location Picker State
    const [showLocationPicker, setShowLocationPicker] = useState(false);

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
            PremiumAlert.alert('Error', error.message || 'Failed to save address.');
            return false;
        }
    };

    const handleAddOrUpdate = async () => {
        if (!label || !addressText) {
            PremiumAlert.alert('Missing Fields', 'Please enter a label and address.');
            return;
        }

        setSaving(true);
        const newAddress: SavedAddress = {
            id: editingId || Date.now().toString(),
            label,
            address: addressText,
            details,
            isDefault: isDefault,
            // Write both key formats for cross-platform sync (mobile uses latitude/longitude, web uses lat/lng)
            ...(locationCoords && {
                latitude: locationCoords.latitude,
                longitude: locationCoords.longitude,
                lat: locationCoords.latitude,
                lng: locationCoords.longitude,
            })
        };

        let updatedList;
        if (editingId) {
            updatedList = addresses.map(a => a.id === editingId ? newAddress : a);
        } else {
            updatedList = [...addresses, newAddress];
        }

        // If setting as default, unset others
        if (isDefault) {
            updatedList = updatedList.map(a =>
                a.id === newAddress.id ? a : { ...a, isDefault: false }
            );
        }

        // Check if there's no default at all, maybe force first one? Optional.

        const success = await saveAddressesToDB(updatedList);
        setSaving(false);

        if (success) {
            setModalVisible(false);
            resetForm();
        }
    };

    const handleDelete = (id: string) => {
        PremiumAlert.alert(
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
        setIsDefault(!!addr.isDefault);
        if (addr.latitude && addr.longitude) {
            setLocationCoords({ latitude: addr.latitude, longitude: addr.longitude });
        } else {
            setLocationCoords(null);
        }
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
        setIsDefault(false);
        setLocationCoords(null);
    };

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenAnim.style]}>
            <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20, paddingBottom: 100 + insets.bottom }]}>
                {loading ? (
                    <Text style={{ textAlign: 'center', marginTop: 20, color: c.textSec }}>Loading addresses...</Text>
                ) : addresses.length === 0 ? (
                    <View style={styles.emptyState}>
                        <View style={[styles.emptyIconBox, { backgroundColor: c.accent + '10' }]}>
                            <MaterialCommunityIcons name="map-marker-off" size={48} color={c.textTer} />
                        </View>
                        <Text variant="titleMedium" style={{ marginTop: 16, fontWeight: 'bold', color: c.text }}>No Addresses Found</Text>
                        <Text variant="bodyMedium" style={{ marginTop: 8, color: c.textSec, textAlign: 'center', paddingHorizontal: 32 }}>
                            Add your home, office, or other frequently used addresses for faster booking.
                        </Text>
                    </View>
                ) : (
                    addresses.map((addr) => (
                        <Surface key={addr.id} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} elevation={0}>
                            <View style={styles.cardHeader}>
                                <View style={styles.labelContainer}>
                                    <View style={[styles.iconBox, { backgroundColor: c.accent + '14' }]}>
                                        <MaterialCommunityIcons
                                            name={addr.label.toLowerCase().includes('home') ? 'home' : addr.label.toLowerCase().includes('office') ? 'office-building' : 'map-marker'}
                                            size={22}
                                            color={c.accent}
                                        />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text variant="titleMedium" style={[styles.cardLabel, { color: c.text }]}>{addr.label}</Text>
                                            {addr.isDefault && (
                                                <View style={[styles.defaultBadge, { backgroundColor: c.accent + '10', borderColor: c.accent }]}>
                                                    <Text style={{ fontSize: 9, color: c.accent, fontWeight: 'bold', letterSpacing: 0.5 }}>DEFAULT</Text>
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                </View>
                                <View style={{ flexDirection: 'row', marginLeft: -8 }}>
                                    <IconButton icon="pencil" size={20} iconColor={c.accent} onPress={() => openEdit(addr)} />
                                    <IconButton icon="delete" size={20} iconColor={c.error} onPress={() => handleDelete(addr.id)} />
                                </View>
                            </View>
                            <Divider style={{ marginVertical: 12, backgroundColor: c.border, opacity: 0.8 }} />
                            <Text variant="bodyMedium" style={{ color: c.text, lineHeight: 20 }}>{addr.address}</Text>
                            {addr.details ? (
                                <Text variant="bodySmall" style={{ color: c.textSec, marginTop: 6, fontStyle: 'italic' }}>Note: {addr.details}</Text>
                            ) : null}
                            {addr.latitude && addr.longitude ? (
                                <View style={styles.locationTag}>
                                    <MaterialCommunityIcons name="map-marker-check" size={14} color={c.accent} />
                                    <Text variant="bodySmall" style={{ color: c.accent, marginLeft: 4, fontWeight: '500' }}>Location coordinates verified</Text>
                                </View>
                            ) : null}
                        </Surface>
                    ))
                )}
            </ScrollView>

            <TouchableOpacity
                onPress={openAdd}
                activeOpacity={0.8}
                style={[styles.addButton, { bottom: 24 + insets.bottom, backgroundColor: c.accent }]}
            >
                <MaterialCommunityIcons name="plus" size={20} color={c.bg} />
                <Text style={{ color: c.bg, fontWeight: '600', marginLeft: 6 }}>Add New Address</Text>
            </TouchableOpacity>

            <Portal>
                <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={[styles.modalContent, { backgroundColor: c.bg }]}>
                    <Text variant="headlineSmall" style={{ marginBottom: 16, fontWeight: 'bold', color: c.text }}>
                        {editingId ? 'Edit Address' : 'New Address'}
                    </Text>

                    <TextInput
                        label="Label (e.g. Home, Work)"
                        value={label}
                        onChangeText={setLabel}
                        mode="outlined"
                        style={styles.input}
                    />

                    <View>
                        <TextInput
                            label="Full Address (Tap map icon)"
                            value={addressText}
                            onChangeText={setAddressText}
                            mode="outlined"
                            multiline
                            style={styles.input}
                            right={
                                <TextInput.Icon
                                    icon="map"
                                    onPress={() => setShowLocationPicker(true)}
                                />
                            }
                        />
                        {locationCoords && (
                            <View style={styles.locationIndicator}>
                                <MaterialCommunityIcons
                                    name="check-circle"
                                    size={16}
                                    color={c.accent}
                                />
                                <Text variant="bodySmall" style={{ color: c.accent, marginLeft: 4 }}>
                                    Location coordinates saved
                                </Text>
                            </View>
                        )}
                    </View>

                    <TextInput
                        label="Additional Details (Optional)"
                        value={details}
                        onChangeText={setDetails}
                        mode="outlined"
                        placeholder="Landmarks, Unit No, etc."
                        style={styles.input}
                    />

                    <TouchableOpacity
                        style={styles.checkboxContainer}
                        onPress={() => setIsDefault(!isDefault)}
                        activeOpacity={0.7}
                    >
                        <Checkbox.Android
                            status={isDefault ? 'checked' : 'unchecked'}
                            onPress={() => setIsDefault(!isDefault)}
                            color={c.accent}
                        />
                        <Text variant="bodyMedium" style={{ marginLeft: 8, color: c.text }}>Set as default address</Text>
                    </TouchableOpacity>

                    <View style={styles.modalActions}>
                        <Button onPress={() => setModalVisible(false)} textColor={c.textSec} style={{ flex: 1, marginRight: 8, backgroundColor: c.card }}>Cancel</Button>
                        <Button mode="contained" onPress={handleAddOrUpdate} loading={saving} buttonColor={c.accent} textColor={c.bg} style={{ flex: 1 }}>Save</Button>
                    </View>
                </Modal>
            </Portal>

            <LocationPicker
                visible={showLocationPicker}
                onDismiss={() => setShowLocationPicker(false)}
                onLocationSelected={(location: LocationData) => {
                    setAddressText(location.address);
                    setLocationCoords({
                        latitude: location.latitude,
                        longitude: location.longitude,
                    });
                }}
                initialLocation={
                    locationCoords && addressText
                        ? { ...locationCoords, address: addressText }
                        : undefined
                }
                title="Select Address"
            />
        </Animated.View>
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
    emptyIconBox: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    card: {
        borderRadius: 16,
        marginBottom: 16,
        padding: 18,
        borderWidth: 1,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    labelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconBox: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    cardLabel: {
        fontWeight: 'bold',
    },
    defaultBadge: {
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 8,
        marginLeft: 8,
        borderWidth: StyleSheet.hairlineWidth,
    },
    addButton: {
        position: 'absolute',
        bottom: 24,
        left: 20,
        right: 20,
        borderRadius: 14,
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
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
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        marginLeft: -8, // Align checkbox with input left edge roughly
    },
    modalActions: {
        flexDirection: 'row',
        marginTop: 8,
    },
    locationTag: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    locationIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -12,
        marginBottom: 8,
        marginLeft: 12,
    },
});
