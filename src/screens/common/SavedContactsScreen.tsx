import React, { useState, useEffect } from 'react';
import { View, Animated, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Button, useTheme, Surface, IconButton, TextInput, Portal, Modal, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumAlert } from '../../services/PremiumAlertService';

interface SavedContact {
    id: string;
    name: string;
    phone: string;
}

export default function SavedContactsScreen() {
    const theme = useTheme();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(false);
    const [contacts, setContacts] = useState<SavedContact[]>([]);

    // Modal State
    const [modalVisible, setModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchContacts();
    }, []);

    const fetchContacts = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase!
                .from('profiles')
                .select('contact_defaults')
                .eq('id', user.id)
                .single();

            if (error) throw error;

            if (data?.contact_defaults) {
                const cd = typeof data.contact_defaults === 'string'
                    ? JSON.parse(data.contact_defaults)
                    : data.contact_defaults;
                setContacts(Array.isArray(cd?.contacts) ? cd.contacts : []);
            }
        } catch (error) {
            console.error('Error fetching contacts:', error);
        } finally {
            setLoading(false);
        }
    };

    const saveContactsToDB = async (newContacts: SavedContact[]) => {
        try {
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user) throw new Error('No user');

            const { error } = await supabase!
                .from('profiles')
                .update({ contact_defaults: { contacts: newContacts } })
                .eq('id', user.id);

            if (error) throw error;
            setContacts(newContacts);
            return true;
        } catch (error: any) {
            PremiumAlert.alert('Error', error.message || 'Failed to save contact.');
            return false;
        }
    };

    const normalizePhone = (value: string): string => {
        const digits = value.replace(/\D/g, '').slice(0, 11);
        if (digits === '' || digits.startsWith('0')) return digits;
        return digits;
    };

    const handleAddOrUpdate = async () => {
        if (!name.trim() || !phone.trim()) {
            PremiumAlert.alert('Missing Fields', 'Please enter both name and phone number.');
            return;
        }

        if (phone.length !== 11 || !phone.startsWith('09')) {
            PremiumAlert.alert('Invalid Phone', 'Phone must be 11 digits starting with 09.');
            return;
        }

        setSaving(true);
        const entry: SavedContact = {
            id: editingId || Date.now().toString(),
            name: name.trim(),
            phone: phone.trim(),
        };

        let updatedList: SavedContact[];
        if (editingId) {
            updatedList = contacts.map(c => c.id === editingId ? entry : c);
        } else {
            updatedList = [...contacts, entry];
        }

        const success = await saveContactsToDB(updatedList);
        setSaving(false);

        if (success) {
            setModalVisible(false);
            resetForm();
        }
    };

    const handleDelete = (id: string) => {
        PremiumAlert.alert(
            'Delete Contact',
            'Are you sure you want to delete this contact?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        const updatedList = contacts.filter(c => c.id !== id);
                        await saveContactsToDB(updatedList);
                    }
                }
            ]
        );
    };

    const openEdit = (contact: SavedContact) => {
        setEditingId(contact.id);
        setName(contact.name);
        setPhone(contact.phone);
        setModalVisible(true);
    };

    const openAdd = () => {
        resetForm();
        setModalVisible(true);
    };

    const resetForm = () => {
        setEditingId(null);
        setName('');
        setPhone('');
    };

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: theme.colors.background }, screenAnim.style]}>
            <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20, paddingBottom: 100 + insets.bottom }]}>
                {loading ? (
                    <Text style={{ textAlign: 'center', marginTop: 20 }}>Loading contacts...</Text>
                ) : contacts.length === 0 ? (
                    <View style={styles.emptyState}>
                        <MaterialCommunityIcons name="account-outline" size={48} color={theme.colors.outline} />
                        <Text style={{ marginTop: 16, color: theme.colors.onSurfaceVariant }}>No saved contacts yet.</Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, textAlign: 'center', paddingHorizontal: 40 }}>
                            Save contacts here to quickly fill in sender or recipient details when booking.
                        </Text>
                    </View>
                ) : (
                    contacts.map((contact) => (
                        <Surface key={contact.id} style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
                            <View style={styles.cardHeader}>
                                <View style={styles.labelContainer}>
                                    <View style={[styles.avatarCircle, { backgroundColor: theme.colors.primaryContainer }]}>
                                        <Text style={{ fontSize: 16, fontWeight: 'bold', color: theme.colors.primary }}>
                                            {contact.name.charAt(0).toUpperCase()}
                                        </Text>
                                    </View>
                                    <View style={{ marginLeft: 12, flex: 1 }}>
                                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>{contact.name}</Text>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{contact.phone}</Text>
                                    </View>
                                </View>
                                <View style={{ flexDirection: 'row' }}>
                                    <IconButton icon="pencil" size={20} onPress={() => openEdit(contact)} />
                                    <IconButton icon="delete" size={20} iconColor={theme.colors.error} onPress={() => handleDelete(contact.id)} />
                                </View>
                            </View>
                        </Surface>
                    ))
                )}
            </ScrollView>

            <Button
                mode="contained"
                icon="plus"
                onPress={openAdd}
                style={[styles.addButton, { bottom: 24 + insets.bottom }]}
                contentStyle={{ paddingVertical: 8 }}
            >
                Add New Contact
            </Button>

            <Portal>
                <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                    <Text variant="headlineSmall" style={{ marginBottom: 16, fontWeight: 'bold' }}>
                        {editingId ? 'Edit Contact' : 'New Contact'}
                    </Text>

                    <TextInput
                        label="Full Name"
                        value={name}
                        onChangeText={setName}
                        mode="outlined"
                        style={styles.input}
                    />

                    <TextInput
                        label="Phone Number"
                        value={phone}
                        onChangeText={(val) => setPhone(normalizePhone(val))}
                        mode="outlined"
                        keyboardType="phone-pad"
                        placeholder="09XX XXX XXXX"
                        maxLength={11}
                        style={styles.input}
                    />

                    <View style={styles.modalActions}>
                        <Button onPress={() => setModalVisible(false)} style={{ flex: 1, marginRight: 8 }}>Cancel</Button>
                        <Button mode="contained" onPress={handleAddOrUpdate} loading={saving} style={{ flex: 1 }}>Save</Button>
                    </View>
                </Modal>
            </Portal>
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
    card: {
        borderRadius: 12,
        marginBottom: 12,
        padding: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    labelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    avatarCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
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
    },
});
