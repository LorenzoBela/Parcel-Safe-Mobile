import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, List, Switch, Divider, useTheme, Avatar, Surface } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabaseClient';

export default function SettingsScreen() {
    const theme = useTheme();
    const { isDarkMode, toggleTheme } = useAppTheme();
    const navigation = useNavigation<any>();
    const [notifications, setNotifications] = useState(true);
    const [profile, setProfile] = useState<any>(null);

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

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
                <List.Item
                    title="Rider Support"
                    left={props => <List.Icon {...props} icon="face-agent" />}
                    onPress={() => navigation.navigate('RiderSupport')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
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

            <View style={styles.versionContainer}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>App Version 1.0.0</Text>
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
    }
});
