import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { Text, Switch, Avatar, Button } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signOut, signInWithGoogleAndSyncProfile } from '../../services/auth';
import useAuthStore from '../../store/authStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', red: '#E11900', switchTrack: '#000000',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', red: '#FF453A', switchTrack: '#FFFFFF',
};

// ─── Row Component ──────────────────────────────────────────────────────────────
function SettingsRow({ icon, label, subtitle, onPress, right, c }: {
    icon: string; label: string; subtitle?: string;
    onPress?: () => void; right?: React.ReactNode;
    c: typeof light;
}) {
    const Wrapper = onPress ? TouchableOpacity : View;
    return (
        <Wrapper
            onPress={onPress}
            activeOpacity={0.6}
            style={[styles.row, { borderBottomColor: c.border }]}
        >
            <View style={[styles.rowIcon, { backgroundColor: c.card }]}>
                <MaterialCommunityIcons name={icon as any} size={20} color={c.accent} />
            </View>
            <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
                {subtitle ? <Text style={[styles.rowSub, { color: c.textSec }]}>{subtitle}</Text> : null}
            </View>
            {right ?? (onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} /> : null)}
        </Wrapper>
    );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
    const { isDarkMode, toggleTheme } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const login = useAuthStore((state: any) => state.login);
    const logout = useAuthStore((state: any) => state.logout);
    const role = useAuthStore((state: any) => state.role);
    const [notifications, setNotifications] = useState(true);
    const [profile, setProfile] = useState<any>(null);
    const [isSwitching, setIsSwitching] = useState(false);

    const fetchProfile = async () => {
        const { data: { user } } = await supabase!.auth.getUser();
        if (user) {
            const { data } = await supabase!
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();
            setProfile(data);
        }
    };

    useFocusEffect(useCallback(() => { fetchProfile(); }, []));

    const handleLogout = async () => {
        try {
            await signOut();
            logout();
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            navigation.replace('Login');
        }
    };

    const handleSwitchAccount = async () => {
        try {
            setIsSwitching(true);
            await signOut();
            logout();
            const result = await signInWithGoogleAndSyncProfile();
            login(result);
            if (result.role === 'customer') {
                navigation.replace('CustomerApp');
            } else {
                navigation.replace('RoleSelection');
            }
        } catch (error: any) {
            console.error('Switch account failed:', error);
            navigation.replace('Login');
        } finally {
            setIsSwitching(false);
        }
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: c.bg }]}
            contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 60 }}
        >
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

            {/* Profile Card */}
            <View style={[styles.profileCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Avatar.Image
                    size={56}
                    source={{ uri: profile?.avatar_url || 'https://i.pravatar.cc/150?img=12' }}
                />
                <View style={styles.profileInfo}>
                    <Text style={[styles.profileName, { color: c.text }]}>
                        {profile?.full_name || 'Loading...'}
                    </Text>
                    <Text style={[styles.profileEmail, { color: c.textSec }]}>
                        {profile?.email || 'User'}
                    </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
            </View>

            {/* Preferences */}
            <Text style={[styles.sectionTitle, { color: c.textSec }]}>PREFERENCES</Text>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                <SettingsRow
                    icon="bell-outline"
                    label="Push Notifications"
                    subtitle="Delivery updates & alerts"
                    c={c}
                    right={
                        <Switch
                            value={notifications}
                            onValueChange={setNotifications}
                            trackColor={{ false: c.border, true: c.switchTrack }}
                        />
                    }
                />
                <SettingsRow
                    icon="moon-waning-crescent"
                    label="Dark Mode"
                    subtitle="Use dark theme"
                    c={c}
                    right={
                        <Switch
                            value={isDarkMode}
                            onValueChange={toggleTheme}
                            trackColor={{ false: c.border, true: c.switchTrack }}
                        />
                    }
                />
            </View>

            {/* Support */}
            <Text style={[styles.sectionTitle, { color: c.textSec }]}>SUPPORT</Text>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                <SettingsRow icon="help-circle-outline" label="Help Center" c={c} onPress={() => navigation.navigate('HelpCenter')} />
                {((role && ['rider', 'admin'].includes(role.toLowerCase())) ||
                    (profile?.role && ['rider', 'admin'].includes(profile.role.toLowerCase()))) && (
                        <SettingsRow icon="face-agent" label="Rider Support" c={c} onPress={() => navigation.navigate('RiderSupport')} />
                    )}
                <SettingsRow icon="file-document-outline" label="Terms of Service" c={c} onPress={() => navigation.navigate('TermsOfService')} />
                <SettingsRow icon="shield-check-outline" label="Privacy Policy" c={c} onPress={() => navigation.navigate('PrivacyPolicy')} />
            </View>

            {/* Account */}
            <Text style={[styles.sectionTitle, { color: c.textSec }]}>ACCOUNT</Text>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                {(role === 'rider' || role === 'admin') && (
                    <SettingsRow icon="view-dashboard-outline" label="Change Dashboard" c={c} onPress={() => navigation.replace('RoleSelection')} />
                )}
                <SettingsRow icon="google" label="Switch Account" c={c} onPress={handleSwitchAccount} />
            </View>

            <TouchableOpacity
                style={[styles.logoutBtn, { backgroundColor: c.red + '12', borderColor: c.red + '30' }]}
                onPress={handleLogout}
                activeOpacity={0.7}
            >
                <MaterialCommunityIcons name="logout" size={18} color={c.red} />
                <Text style={[styles.logoutText, { color: c.red }]}>Log Out</Text>
            </TouchableOpacity>

            <Text style={[styles.version, { color: c.textTer }]}>App Version 1.0.1</Text>
        </ScrollView>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1 },
    profileCard: {
        flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 24,
        padding: 16, borderRadius: 16, borderWidth: 1,
    },
    profileInfo: { flex: 1, marginLeft: 14 },
    profileName: { fontSize: 18, fontWeight: '700' },
    profileEmail: { fontSize: 13, marginTop: 2 },
    sectionTitle: {
        fontSize: 12, fontWeight: '600', letterSpacing: 0.8,
        marginHorizontal: 20, marginBottom: 6, marginTop: 4,
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
        width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    },
    rowContent: { flex: 1, marginLeft: 12 },
    rowLabel: { fontSize: 15, fontWeight: '500' },
    rowSub: { fontSize: 12, marginTop: 1 },
    logoutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        marginHorizontal: 16, paddingVertical: 14, borderRadius: 14, borderWidth: 1,
        gap: 8, marginBottom: 8,
    },
    logoutText: { fontSize: 15, fontWeight: '600' },
    version: { textAlign: 'center', fontSize: 12, marginTop: 16 },
});
