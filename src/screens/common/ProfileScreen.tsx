import React, { useState, useCallback } from 'react';
import { View, Animated, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, StatusBar } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { Text, Avatar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF',
};

// ─── Row ────────────────────────────────────────────────────────────────────────
function InfoRow({ icon, label, value, onPress, c }: {
    icon: string; label: string; value: string;
    onPress?: () => void; c: typeof light;
}) {
    const Wrapper = onPress ? TouchableOpacity : View;
    return (
        <Wrapper
            onPress={onPress}
            activeOpacity={0.6}
            style={[styles.row, { borderBottomColor: c.border }]}
        >
            <View style={[styles.rowIcon, { backgroundColor: c.accent + '14' }]}>
                <MaterialCommunityIcons name={icon as any} size={18} color={c.accent} />
            </View>
            <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: c.textSec }]}>{label}</Text>
                <Text style={[styles.rowValue, { color: c.text }]} numberOfLines={2}>{value}</Text>
            </View>
            {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} /> : null}
        </Wrapper>
    );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
    const navigation = useNavigation<any>();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const [profile, setProfile] = useState<any>(null);
    const [defaultAddress, setDefaultAddress] = useState<string>('Not set');
    const [refreshing, setRefreshing] = useState(false);
    const insets = useSafeAreaInsets();

    const fetchProfile = async () => {
        const { data: { user } } = await supabase!.auth.getUser();
        if (user) {
            const { data } = await supabase!
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();
            setProfile(data);

            if (data?.saved_addresses) {
                try {
                    const addresses = typeof data.saved_addresses === 'string'
                        ? JSON.parse(data.saved_addresses)
                        : data.saved_addresses;
                    if (Array.isArray(addresses)) {
                        const def = addresses.find((a: any) => a.isDefault);
                        setDefaultAddress(def ? def.address : (data.home_address || 'Not set'));
                    }
                } catch (e) {
                    console.error('Error parsing addresses', e);
                    setDefaultAddress(data.home_address || 'Not set');
                }
            } else {
                setDefaultAddress(data?.home_address || 'Not set');
            }
        }
    };

    useFocusEffect(useCallback(() => { fetchProfile(); }, []));

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchProfile();
        setRefreshing(false);
    }, []);

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[{ flex: 1 }, screenAnim.style]}>
        <ScrollView
            style={[styles.container, { backgroundColor: c.bg }]}
            contentContainerStyle={{ paddingBottom: insets.bottom + 60, paddingTop: insets.top + 8 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

            {/* Avatar Hero */}
            <View style={styles.hero}>
                <View style={[styles.avatarRing, { borderColor: c.accent }]}>
                    <Avatar.Image size={96} source={{ uri: profile?.avatar_url || 'https://i.pravatar.cc/150?img=12' }} />
                </View>
                <Text style={[styles.name, { color: c.text }]}>
                    {profile?.full_name || 'Loading...'}
                </Text>
                <Text style={[styles.email, { color: c.textSec }]}>
                    {profile?.email || 'User'}
                </Text>
                <TouchableOpacity
                    style={[styles.editBtn, { backgroundColor: c.accent }]}
                    onPress={() => navigation.navigate('EditProfile')}
                    activeOpacity={0.8}
                >
                    <MaterialCommunityIcons name="pencil" size={14} color="#FFFFFF" />
                    <Text style={styles.editBtnText}>Edit Profile</Text>
                </TouchableOpacity>
            </View>

            {/* Account Info */}
            <Text style={[styles.sectionTitle, { color: c.textSec }]}>ACCOUNT INFO</Text>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                <InfoRow icon="phone-outline" label="Phone Number" value={profile?.phone_number || 'Not set'} c={c} />
                <InfoRow icon="map-marker-star-outline" label="Default Address" value={defaultAddress} c={c} />
                <InfoRow
                    icon="bookmark-multiple-outline"
                    label="Saved Addresses"
                    value="Manage pickup/dropoff locations"
                    c={c}
                    onPress={() => navigation.navigate('SavedAddresses')}
                />
                <InfoRow
                    icon="account-multiple-outline"
                    label="Saved Contacts"
                    value="Quick-fill sender/recipient"
                    c={c}
                    onPress={() => navigation.navigate('SavedContacts')}
                />
            </View>
        </ScrollView>
        </Animated.View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1 },
    hero: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 16 },
    avatarRing: { borderWidth: 3, borderRadius: 54, padding: 3 },
    name: { fontSize: 22, fontWeight: '700', marginTop: 14 },
    email: { fontSize: 14, marginTop: 3, marginBottom: 14 },
    editBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24,
    },
    editBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
    sectionTitle: {
        fontSize: 12, fontWeight: '600', letterSpacing: 0.8,
        marginHorizontal: 20, marginBottom: 6,
    },
    section: {
        marginHorizontal: 16, borderRadius: 14, borderWidth: 1,
        overflow: 'hidden', marginBottom: 20,
    },
    row: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
        paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowIcon: {
        width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    },
    rowContent: { flex: 1, marginLeft: 12 },
    rowLabel: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 },
    rowValue: { fontSize: 14, fontWeight: '500', marginTop: 1 },
});
