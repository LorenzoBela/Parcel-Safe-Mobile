import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, useColorScheme, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { supabase } from '../../services/supabaseClient';

const COLORS = {
    light: {
        background: '#FFFFFF',
        text: '#000000',
    },
    dark: {
        background: '#000000',
        text: '#FFFFFF',
    }
};

export default function AuthLoadingScreen() {
    const navigation = useNavigation<any>();
    const colorScheme = useColorScheme();
    const login = useAuthStore((state: any) => state.login);

    const isDark = colorScheme === 'dark';
    const colors = isDark ? COLORS.dark : COLORS.light;

    useEffect(() => {
        const restoreSession = async () => {
            try {
                // Check if a session exists
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('Session restoration error:', error);
                    navigation.replace('Login');
                    return;
                }

                if (session && session.user) {
                    // Fetch the user's profile to get the role
                    const { data: profile, error: profileError } = await supabase
                        .from('profiles')
                        .select('role, full_name, phone_number, avatar_url')
                        .eq('id', session.user.id)
                        .maybeSingle();

                    if (profileError) {
                        console.error('Profile fetch error:', profileError);
                        navigation.replace('Login');
                        return;
                    }

                    // Map role, defaulting to customer
                    const rawRole = profile?.role || 'CUSTOMER';
                    const role = rawRole.toLowerCase();

                    // Rehydrate the Zustand auth store
                    login({
                        userId: session.user.id,
                        email: session.user.email,
                        name: profile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name,
                        photo: profile?.avatar_url || session.user.user_metadata?.avatar_url,
                        role: role,
                        fullName: profile?.full_name || session.user.user_metadata?.full_name,
                        phone: profile?.phone_number
                    });

                    // Navigate to appropriate app flow
                    if (role === 'customer') {
                        navigation.replace('CustomerApp');
                    } else if (role === 'rider') {
                        navigation.replace('RiderApp');
                    } else if (role === 'admin') {
                        navigation.replace('AdminApp');
                    } else {
                        // Fallback to role selection if role is ambiguous or they need to choose a dev role
                        navigation.replace('RoleSelection');
                    }
                } else {
                    // No session found
                    navigation.replace('Login');
                }
            } catch (err) {
                console.error('Auth check error:', err);
                navigation.replace('Login');
            }
        };

        restoreSession();
    }, [login, navigation]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />
            <ActivityIndicator size="large" color={colors.text} />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
