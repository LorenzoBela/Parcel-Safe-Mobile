import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, List, Switch, Divider, useTheme, Avatar, Surface, Button } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signOut, signInWithGoogleAndSyncProfile } from '../../services/auth';
import useAuthStore from '../../store/authStore';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SettingsScreen() {
    const theme = useTheme();
    const { isDarkMode, toggleTheme } = useAppTheme();
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

    useFocusEffect(
        useCallback(() => {
            fetchProfile();
        }, [])
    );

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
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={{
                paddingTop: insets.top,
                paddingBottom: insets.bottom + 40
            }}
        >
            {/* Profile Header */}
            <Surface style={[styles.profileHeader, { backgroundColor: theme.colors.surface }]} elevation={1}>
                <Avatar.Image
                    size={60}
                    source={{ uri: profile?.avatar_url || 'https://i.pravatar.cc/150?img=12' }}
                />
                <View style={styles.profileInfo}>
                    <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>
                        {profile?.full_name || 'Loading...'}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                        {profile?.email || 'User'}
                    </Text>
                </View>
            </Surface>

            <Text variant="headlineMedium" style={[styles.header, { color: theme.colors.onBackground }]}>Settings</Text>

            <List.Section>
                <List.Subheader>Preferences</List.Subheader>
                <List.Item
                    title="Push Notifications"
                    description="Receive updates about your deliveries"
                    left={props => <List.Icon {...props} icon="bell" />}
                    right={() => <Switch value={notifications} onValueChange={setNotifications} />}
                />
                <Divider />
                <Divider />
                <List.Item
                    title="Dark Mode"
                    description="Use dark theme for the app"
                    left={props => <List.Icon {...props} icon="theme-light-dark" />}
                    right={() => <Switch value={isDarkMode} onValueChange={toggleTheme} />}
                />

            </List.Section>

            <List.Section>
                <List.Subheader>Support</List.Subheader>
                <List.Item
                    title="Help Center"
                    left={props => <List.Icon {...props} icon="help-circle" />}
                    onPress={() => navigation.navigate('HelpCenter')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
                {profile?.role === 'RIDER' && (
                    <>
                        <List.Item
                            title="Rider Support"
                            left={props => <List.Icon {...props} icon="face-agent" />}
                            onPress={() => navigation.navigate('RiderSupport')}
                            right={props => <List.Icon {...props} icon="chevron-right" />}
                        />
                        <Divider />
                    </>
                )}
                <List.Item
                    title="Terms of Service"
                    left={props => <List.Icon {...props} icon="file-document" />}
                    onPress={() => navigation.navigate('TermsOfService')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
                <List.Item
                    title="Privacy Policy"
                    left={props => <List.Icon {...props} icon="shield-account" />}
                    onPress={() => navigation.navigate('PrivacyPolicy')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
            </List.Section>

            <View style={styles.logoutContainer}>
                {(role === 'rider' || role === 'admin') && (
                    <Button
                        mode="contained-tonal"
                        icon={() => <MaterialCommunityIcons name="view-dashboard" size={20} color={theme.colors.onSecondaryContainer} />}
                        onPress={() => navigation.replace('RoleSelection')}
                        style={styles.changeDashboardBtn}
                        textColor={theme.colors.onSecondaryContainer}
                    >
                        Change Dashboard
                    </Button>
                )}
                <Button
                    mode="outlined"
                    icon={() => <MaterialCommunityIcons name="google" size={20} color={theme.colors.onSurface} />}
                    onPress={handleSwitchAccount}
                    loading={isSwitching}
                    disabled={isSwitching}
                    style={styles.switchAccountBtn}
                    textColor={theme.colors.onSurface}
                >
                    Switch Account
                </Button>
                <Button mode="contained" buttonColor={theme.colors.error} onPress={handleLogout}>
                    Log Out
                </Button>
            </View>

            <View style={styles.versionContainer}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>App Version 1.0.1</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    profileHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginTop: 16,
        marginBottom: 8,
        borderRadius: 12,
    },
    profileInfo: {
        marginLeft: 16,
        flex: 1,
    },
    header: {
        padding: 24,
        paddingTop: 16,
        fontWeight: 'bold',
    },
    versionContainer: {
        alignItems: 'center',
        padding: 24,
    },
    logoutContainer: {
        marginTop: 20,
        paddingHorizontal: 16,
    },
    changeDashboardBtn: {
        marginBottom: 12,
    },
    switchAccountBtn: {
        marginBottom: 12,
        borderColor: '#ccc',
    }
});
