import React, { useState, useEffect } from 'react';
import { View, Animated, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Button, useTheme, Surface, IconButton, TextInput, Portal, Modal, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
interface SavedContact {
    id: string;
    name: string;
    phone: string;
}

export default function SavedContactsScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
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
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenAnim.style]}>
            <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20, paddingBottom: 100 + insets.bottom }]}>
                {loading ? (
                    <Text style={{ textAlign: 'center', marginTop: 20, color: c.textSec }}>Loading contacts...</Text>
                ) : contacts.length === 0 ? (
                    <View style={styles.emptyState}>
                        <View style={[styles.emptyIconBox, { backgroundColor: c.accent + '10' }]}>
                            <MaterialCommunityIcons name="account-outline" size={48} color={c.textTer} />
                        </View>
                        <Text variant="titleMedium" style={{ marginTop: 16, fontFamily: 'Inter_700Bold', color: c.text }}>No Contacts Found</Text>
                        <Text variant="bodyMedium" style={{ color: c.textSec, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }}>
                            Save contacts here to quickly fill in sender or recipient details when booking.
                        </Text>
                    </View>
                ) : (
                    contacts.map((contact) => (
                        <Surface key={contact.id} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} elevation={0}>
                            <View style={styles.cardHeader}>
                                <View style={styles.labelContainer}>
                                    <View style={[styles.avatarCircle, { backgroundColor: c.accent + '14' }]}>
                                        <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: c.accent }}>
                                            {contact.name.charAt(0).toUpperCase()}
                                        </Text>
                                    </View>
                                    <View style={{ marginLeft: 14, flex: 1, justifyContent: 'center' }}>
                                        <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>{contact.name}</Text>
                                        <Text variant="bodyMedium" style={{ color: c.textSec, marginTop: 2, letterSpacing: 0.5 }}>{contact.phone}</Text>
                                    </View>
                                </View>
                                <View style={{ flexDirection: 'row', marginLeft: -8 }}>
                                    <IconButton icon="pencil" size={20} iconColor={c.accent} onPress={() => openEdit(contact)} />
                                    <IconButton icon="delete" size={20} iconColor={c.error} onPress={() => handleDelete(contact.id)} />
                                </View>
                            </View>
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
                <Text style={{ color: c.bg, fontFamily: 'Inter_600SemiBold', marginLeft: 6 }}>Add New Contact</Text>
            </TouchableOpacity>

            <Portal>
                <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={[styles.modalContent, { backgroundColor: c.bg }]}>
                    <Text variant="headlineSmall" style={{ marginBottom: 16, fontFamily: 'Inter_700Bold', color: c.text }}>
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
                        <Button onPress={() => setModalVisible(false)} textColor={c.textSec} style={{ flex: 1, marginRight: 8, backgroundColor: c.card }}>Cancel</Button>
                        <Button mode="contained" onPress={handleAddOrUpdate} loading={saving} buttonColor={c.accent} textColor={c.bg} style={{ flex: 1 }}>Save</Button>
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
        padding: 16,
        borderWidth: 1,
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
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
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
    modalActions: {
        flexDirection: 'row',
        marginTop: 8,
    },
});
