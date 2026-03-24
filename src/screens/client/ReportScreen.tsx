import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, TouchableOpacity, TextInput, StatusBar, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabaseClient';
import { parseUTCString } from '../../utils/date';
import { PremiumAlert } from '../../services/PremiumAlertService';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', red: '#E11900', inputBg: '#F2F2F7',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', red: '#FF453A', inputBg: '#1C1C1E',
};

const formatDate = (iso: string) => {
    const d = parseUTCString(iso);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
        + ', '
        + d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true });
};

const formatStatus = (s: string): string => {
    switch (s) {
        case 'PENDING': return 'Pending';
        case 'ASSIGNED': return 'Assigned';
        case 'IN_TRANSIT': return 'In Transit';
        case 'PICKED_UP': return 'Picked Up';
        case 'ARRIVED': return 'Arrived';
        case 'COMPLETED': return 'Delivered';
        case 'CANCELLED': return 'Cancelled';
        case 'TAMPERED': return 'Tampered';
        case 'RETURNING': return 'Returning';
        case 'RETURNED': return 'Returned';
        default: return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
};

const ISSUE_CATEGORIES = ['Late Delivery', 'Damaged Item', 'Rude Rider', 'App Issue', 'Other'];

interface Order {
    id: string;
    tracking_number: string;
    created_at: string;
    package_description: string;
    status: string;
    dropoff_address: string;
}

export default function ReportScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();

    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [orders, setOrders] = useState<Order[]>([]);
    const [fetchingOrders, setFetchingOrders] = useState(true);

    useEffect(() => { fetchOrders(); }, []);

    const fetchOrders = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setFetchingOrders(false); return; }
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
        } finally { setFetchingOrders(false); }
    };

    const handleSubmit = async () => {
        if (!selectedOrder) { PremiumAlert.alert('Missing Info', 'Please select the order.'); return; }
        if (!selectedCategory) { PremiumAlert.alert('Missing Info', 'Please select an issue category.'); return; }
        if (!description.trim()) { PremiumAlert.alert('Missing Info', 'Please describe the issue.'); return; }
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');
            const { error } = await supabase.from('issue_reports').insert({
                user_id: user.id, order_id: selectedOrder,
                category: selectedCategory, description: description.trim(), status: 'OPEN',
            });
            if (error) throw error;
            PremiumAlert.alert('Report Submitted', 'We\'ll investigate shortly.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        } catch {
            PremiumAlert.alert('Error', 'Failed to submit. Please try again.');
        } finally { setLoading(false); }
    };

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
            <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }}>

                {/* Header */}
                <View style={styles.header}>
                    <View style={[styles.headerIcon, { backgroundColor: c.red + '14' }]}>
                        <MaterialCommunityIcons name="file-document-edit-outline" size={32} color={c.red} />
                    </View>
                    <Text style={[styles.headerTitle, { color: c.text }]}>Report an Issue</Text>
                    <Text style={[styles.headerSub, { color: c.textSec }]}>We're sorry you had a problem. Tell us what happened.</Text>
                </View>

                {/* Select Order */}
                <Text style={[styles.sectionLabel, { color: c.textSec }]}>SELECT ORDER</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    {fetchingOrders ? (
                        <ActivityIndicator style={{ padding: 20 }} color={c.accent} />
                    ) : orders.length > 0 ? (
                        orders.map(order => {
                            const selected = selectedOrder === order.id;
                            return (
                                <TouchableOpacity
                                    key={order.id}
                                    style={[styles.orderRow, { borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent + '08' : 'transparent' }]}
                                    onPress={() => setSelectedOrder(order.id)}
                                    activeOpacity={0.7}
                                >
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.orderTrk, { color: c.text }]}>{order.tracking_number || 'Order #' + order.id.slice(0, 8)}</Text>
                                        <Text style={[styles.orderMeta, { color: c.textSec }]}>
                                            {order.package_description || 'No description'} • {formatDate(order.created_at)}
                                        </Text>
                                        <Text style={[styles.orderStatus, { color: c.textTer }]}>{formatStatus(order.status)}</Text>
                                    </View>
                                    {selected && <MaterialCommunityIcons name="check-circle" size={22} color={c.accent} />}
                                </TouchableOpacity>
                            );
                        })
                    ) : (
                        <Text style={[styles.emptyText, { color: c.textSec }]}>No recent orders found.</Text>
                    )}
                </View>

                {/* Issue Category */}
                <Text style={[styles.sectionLabel, { color: c.textSec }]}>WHAT WENT WRONG?</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    <View style={styles.chipWrap}>
                        {ISSUE_CATEGORIES.map(cat => {
                            const active = selectedCategory === cat;
                            return (
                                <TouchableOpacity
                                    key={cat}
                                    style={[styles.chip, {
                                        backgroundColor: active ? c.accent : 'transparent',
                                        borderColor: active ? c.accent : c.border,
                                    }]}
                                    onPress={() => setSelectedCategory(cat)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.chipText, { color: active ? c.bg : c.textSec }]}>{cat}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>

                {/* Description */}
                <Text style={[styles.sectionLabel, { color: c.textSec }]}>TELL US MORE</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    <TextInput
                        placeholder="Describe the incident..."
                        placeholderTextColor={c.textTer}
                        multiline
                        numberOfLines={5}
                        value={description}
                        onChangeText={setDescription}
                        style={[styles.textArea, { backgroundColor: c.inputBg, color: c.text, borderColor: c.border }]}
                        textAlignVertical="top"
                    />
                </View>

                {/* Submit */}
                <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: c.accent, opacity: loading ? 0.6 : 1 }]}
                    onPress={handleSubmit}
                    disabled={loading}
                    activeOpacity={0.8}
                >
                    {loading ? (
                        <ActivityIndicator color={c.bg} />
                    ) : (
                        <Text style={[styles.submitBtnText, { color: c.bg }]}>Submit Report</Text>
                    )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
                    <Text style={[styles.cancelBtnText, { color: c.red }]}>Cancel</Text>
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    header: { alignItems: 'center', marginBottom: 24, marginTop: 8 },
    headerIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold' },
    headerSub: { fontSize: 14, textAlign: 'center', marginTop: 4, lineHeight: 20 },
    sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, marginLeft: 4, marginBottom: 6, marginTop: 4 },
    section: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 20 },
    orderRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
    orderTrk: { fontSize: 14, fontFamily: 'Inter_700Bold' },
    orderMeta: { fontSize: 12, marginTop: 1 },
    orderStatus: { fontSize: 11, marginTop: 1 },
    emptyText: { textAlign: 'center', padding: 20, fontSize: 14 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
    chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
    textArea: { borderRadius: 10, borderWidth: 1, padding: 12, minHeight: 110, fontSize: 14, lineHeight: 20 },
    submitBtn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 4 },
    submitBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
    cancelBtn: { alignItems: 'center', marginTop: 12 },
    cancelBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
