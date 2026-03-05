import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { Text, Avatar, Button, List, Divider, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ProfileScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
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

            // Parse saved_addresses to find default
            if (data?.saved_addresses) {
                try {
                    const addresses = typeof data.saved_addresses === 'string'
                        ? JSON.parse(data.saved_addresses)
                        : data.saved_addresses;

                    if (Array.isArray(addresses)) {
                        const def = addresses.find((a: any) => a.isDefault);
                        if (def) {
                            setDefaultAddress(def.address);
                        } else {
                            setDefaultAddress(data.home_address || 'Not set');
                        }
                    }
                } catch (e) {
                    console.error("Error parsing addresses", e);
                    setDefaultAddress(data.home_address || 'Not set');
                }
            } else {
                setDefaultAddress(data?.home_address || 'Not set');
            }
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchProfile();
        }, [])
    );

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchProfile();
        setRefreshing(false);
    }, []);

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={{
                paddingBottom: insets.bottom + 20,
                paddingTop: insets.top
            }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
            <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
                <Avatar.Image size={100} source={{ uri: profile?.avatar_url || 'https://i.pravatar.cc/150?img=12' }} />
                <Text variant="headlineSmall" style={[styles.name, { color: theme.colors.onSurface }]}>
                    {profile?.full_name || 'Loading...'}
                </Text>
                <Text variant="bodyMedium" style={[styles.email, { color: theme.colors.onSurfaceVariant }]}>
                    {profile?.email || 'User'}
                </Text>
                <Button
                    mode="outlined"
                    style={styles.editBtn}
                    onPress={() => navigation.navigate('EditProfile')}
                    textColor={theme.colors.primary}
                >
                    Edit Profile
                </Button>
            </View>

            <View style={styles.section}>
                <List.Section>
                    <List.Subheader>Account Info</List.Subheader>
                    <List.Item
                        title="Phone Number"
                        description={profile?.phone_number || 'Not set'}
                        left={props => <List.Icon {...props} icon="phone" />}
                    />
                    <Divider />
                    <List.Item
                        title="Default Address"
                        description={defaultAddress}
                        descriptionNumberOfLines={2}
                        left={props => <List.Icon {...props} icon="map-marker-star" />}
                    />
                    <List.Item
                        title="Saved Addresses"
                        description="Manage your pickup/dropoff locations"
                        left={props => <List.Icon {...props} icon="bookmark-multiple" />}
                        right={props => <List.Icon {...props} icon="chevron-right" />}
                        onPress={() => navigation.navigate('SavedAddresses')}
                    />
                    <List.Item
                        title="Saved Contacts"
                        description="Quick-fill sender/recipient when booking"
                        left={props => <List.Icon {...props} icon="account-multiple" />}
                        right={props => <List.Icon {...props} icon="chevron-right" />}
                        onPress={() => navigation.navigate('SavedContacts')}
                    />
                </List.Section>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        alignItems: 'center',
        padding: 24,
    },
    name: {
        marginTop: 16,
        fontWeight: 'bold',
    },
    email: {
        marginBottom: 16,
    },
    editBtn: {
        borderRadius: 20,
    },
    section: {
        padding: 16,
    }
});
