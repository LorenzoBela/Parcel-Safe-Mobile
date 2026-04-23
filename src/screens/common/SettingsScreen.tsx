import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ScrollView, TouchableOpacity, StatusBar, ActivityIndicator, Dimensions } from 'react-native';
import { useEntryAnimation, useStaggerAnimation, usePulseAnimation } from '../../hooks/useEntryAnimation';
import { Text, Switch, Avatar } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signOut, signInWithGoogleAndSyncProfile } from '../../services/auth';
import useAuthStore from '../../store/authStore';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import {
    clearNotificationPreferencesCache,
} from '../../services/pushNotificationService';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7',
    text: '#09090B', textSec: '#52525B', textTer: '#A1A1AA',
    accent: '#09090B', red: '#E11900', switchTrack: '#09090B',
};
const dark = {
    bg: '#000000', card: '#09090B', border: '#27272A',
    text: '#FFFFFF', textSec: '#A1A1AA', textTer: '#52525B',
    accent: '#FFFFFF', red: '#FF453A', switchTrack: '#FFFFFF',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
            <View style={[styles.rowIcon, { backgroundColor: c.accent + '10' }]}>
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
    const [profile, setProfile] = useState<any>(null);
    const [isSwitching, setIsSwitching] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateStatus, setUpdateStatus] = useState('Tap to check for updates');

    const logoPulse = usePulseAnimation(0.5, 800);
    const progressAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isSwitching) {
            progressAnim.setValue(0);
            Animated.timing(progressAnim, {
                toValue: 0.8,
                duration: 2000,
                useNativeDriver: false,
            }).start();
        }
    }, [isSwitching]);

    const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, SCREEN_WIDTH - 64],
    });

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

    useFocusEffect(useCallback(() => {
        fetchProfile();
    }, []));

    const handleManualUpdateCheck = async () => {
        if (isCheckingUpdate) return;

        if (__DEV__) {
            setUpdateStatus('Unavailable in development builds');
            return;
        }

        setIsCheckingUpdate(true);
        setUpdateStatus('Checking for updates...');

        try {
            const checkResult = await Updates.checkForUpdateAsync();

            if (!checkResult.isAvailable) {
                setUpdateStatus('You already have the latest version');
                return;
            }

            setUpdateStatus('Downloading update...');
            const fetchResult = await Updates.fetchUpdateAsync();

            if (fetchResult.isNew) {
                setUpdateStatus('Update ready. Restarting...');
            } else {
                setUpdateStatus('Update already downloaded. Restarting...');
            }

            await Updates.reloadAsync();
        } catch (error) {
            console.error('Manual OTA update check failed:', error);
            setUpdateStatus('Update check failed. Tap to retry.');
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    const appVersion = Application.nativeApplicationVersion || 'Unknown';
    const buildVersion = Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : '';
    const runtimeVersion = Updates.runtimeVersion || 'Unknown';

    const handleLogout = async () => {
        try {
            await clearNotificationPreferencesCache();
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
            
            Animated.timing(progressAnim, {
                toValue: 1,
                duration: 400,
                useNativeDriver: false,
            }).start(() => {
                if (result.role === 'customer') {
                    navigation.replace('CustomerApp');
                } else {
                    navigation.replace('RoleSelection');
                }
                setTimeout(() => setIsSwitching(false), 500);
            });
        } catch (error: any) {
            console.error('Switch account failed:', error);
            navigation.replace('Login');
            setIsSwitching(false);
        }
    };

    // ─── Animations ─────────────────────────────────────────────────────────
    const profileAnim = useEntryAnimation(0);
    const sectionAnims = useStaggerAnimation(4, 60, 80);
    const footerAnim = useEntryAnimation(340);

    if (isSwitching) {
        return (
            <SafeAreaView style={[styles.loadingContainer, { backgroundColor: c.bg }]}>
                <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
                
                <Animated.View style={[styles.loadingIconBox, { backgroundColor: c.card, borderColor: c.border }, logoPulse.style]}>
                    <MaterialCommunityIcons name="account-switch" size={36} color={c.text} />
                </Animated.View>

                <Text style={[styles.loadingTitle, { color: c.text }]}>Switching Accounts</Text>
                <Text style={[styles.loadingSubtitle, { color: c.textSec }]}>
                    Please wait a moment...
                </Text>

                <View style={styles.loadingProgressSection}>
                    <View style={[styles.loadingProgressTrack, { backgroundColor: c.border }]}>
                        <Animated.View
                            style={[
                                styles.loadingProgressFill,
                                { backgroundColor: c.text, width: progressWidth },
                            ]}
                        />
                    </View>
                    <View style={styles.loadingStatusRow}>
                        <ActivityIndicator size="small" color={c.textSec} />
                        <Text style={[styles.loadingStatusText, { color: c.textSec }]}>
                            Authenticating...
                        </Text>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <Animated.View style={[{ flex: 1 }, profileAnim.style]}>
        <ScrollView
            style={[styles.container, { backgroundColor: c.bg }]}
            contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 60 }}
            showsVerticalScrollIndicator={false}
        >
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

            {/* ── Profile Card ─────────────────────────────────────────── */}
            <TouchableOpacity
                style={[styles.profileCard, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => navigation.navigate('Profile')}
                activeOpacity={0.7}
            >
                <View style={[styles.avatarShadow, { shadowColor: c.accent }]}>
                    <Avatar.Image
                        size={56}
                        source={{ uri: profile?.avatar_url || 'https://i.pravatar.cc/150?img=12' }}
                    />
                </View>
                <View style={styles.profileInfo}>
                    <Text style={[styles.profileName, { color: c.text }]}>
                        {profile?.full_name || 'Loading...'}
                    </Text>
                    <Text style={[styles.profileEmail, { color: c.textSec }]}>
                        {profile?.email || 'User'}
                    </Text>
                </View>
                <View style={[styles.profileChevron, { backgroundColor: c.accent + '0A' }]}>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
                </View>
            </TouchableOpacity>

            {/* ── Notifications ────────────────────────────────────────── */}
            <Animated.View style={sectionAnims[0].style}>
                <Text style={[styles.sectionTitle, { color: c.textSec }]}>NOTIFICATIONS</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    <SettingsRow icon="bell-outline" label="Notification Preferences" subtitle="Manage alerts, promos & more" c={c} onPress={() => navigation.navigate('NotificationPreferences')} />
                </View>
            </Animated.View>

            {/* ── Preferences ──────────────────────────────────────────── */}
            <Animated.View style={sectionAnims[1].style}>
                <Text style={[styles.sectionTitle, { color: c.textSec }]}>PREFERENCES</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
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
                    <SettingsRow
                        icon="update"
                        label="Check for Updates"
                        subtitle={updateStatus}
                        c={c}
                        onPress={handleManualUpdateCheck}
                        right={
                            isCheckingUpdate ? (
                                <ActivityIndicator size="small" color={c.textSec} />
                            ) : (
                                <MaterialCommunityIcons name="refresh" size={20} color={c.textTer} />
                            )
                        }
                    />
                </View>
            </Animated.View>

            {/* ── Support ──────────────────────────────────────────────── */}
            <Animated.View style={sectionAnims[2].style}>
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
            </Animated.View>

            {/* ── Account ──────────────────────────────────────────────── */}
            <Animated.View style={sectionAnims[3].style}>
                <Text style={[styles.sectionTitle, { color: c.textSec }]}>ACCOUNT</Text>
                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    {(role === 'rider' || role === 'admin') && (
                        <SettingsRow icon="view-dashboard-outline" label="Change Dashboard" c={c} onPress={() => navigation.replace('RoleSelection')} />
                    )}
                    <SettingsRow icon="google" label="Switch Account" c={c} onPress={handleSwitchAccount} />
                </View>
            </Animated.View>

            {/* ── Footer ───────────────────────────────────────────────── */}
            <Animated.View style={footerAnim.style}>
                <TouchableOpacity
                    style={[styles.logoutBtn, { backgroundColor: c.red + '12', borderColor: c.red + '30' }]}
                    onPress={handleLogout}
                    activeOpacity={0.7}
                >
                    <MaterialCommunityIcons name="logout" size={18} color={c.red} />
                    <Text style={[styles.logoutText, { color: c.red }]}>Log Out</Text>
                </TouchableOpacity>

                <Text style={[styles.version, { color: c.textTer }]}>v{appVersion}{buildVersion}</Text>
            </Animated.View>
        </ScrollView>
        </Animated.View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1 },
    profileCard: {
        flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 24,
        padding: 16, borderRadius: 16, borderWidth: 1,
    },
    avatarShadow: {
        borderRadius: 30,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 6,
    },
    profileInfo: { flex: 1, marginLeft: 14 },
    profileName: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
    profileEmail: { fontSize: 13, marginTop: 4, fontFamily: 'Inter_400Regular' },
    profileChevron: {
        width: 32, height: 32, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center',
    },
    sectionTitle: {
        fontSize: 12, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.2, textTransform: 'uppercase',
        marginHorizontal: 20, marginBottom: 12, marginTop: 8,
    },
    section: {
        marginHorizontal: 16, borderRadius: 16, borderWidth: 1,
        overflow: 'hidden', marginBottom: 24,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    row: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
        paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowIcon: {
        width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    },
    rowContent: { flex: 1, marginLeft: 12 },
    rowLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.2 },
    rowSub: { fontSize: 13, marginTop: 2, fontFamily: 'Inter_400Regular' },
    logoutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        marginHorizontal: 16, paddingVertical: 14, borderRadius: 14, borderWidth: 1,
        gap: 8, marginBottom: 8,
    },
    logoutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
    version: { textAlign: 'center', fontSize: 12, marginTop: 16, fontFamily: 'Inter_400Regular', opacity: 0.6 },

    // Loading Screen Styles
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    loadingIconBox: {
        width: 72,
        height: 72,
        borderRadius: 20,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    loadingTitle: {
        fontSize: 26,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.5,
        marginBottom: 4,
    },
    loadingSubtitle: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
        letterSpacing: 0.1,
        marginBottom: 40,
    },
    loadingProgressSection: {
        width: '100%',
        alignItems: 'center',
    },
    loadingProgressTrack: {
        width: '100%',
        height: 3,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 12,
    },
    loadingProgressFill: {
        height: '100%',
        borderRadius: 2,
    },
    loadingStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    loadingStatusText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        letterSpacing: 0.1,
    },
});
