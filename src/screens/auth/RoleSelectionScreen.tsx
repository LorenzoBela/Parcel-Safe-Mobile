import React, { useRef } from 'react';
import {
    View,
    StyleSheet,
    Pressable,
    Animated,
    Image,
    useColorScheme,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Uber-inspired minimalist colors
const COLORS = {
    light: {
        background: '#FFFFFF',
        surface: '#F6F6F6',
        text: '#000000',
        textSecondary: '#6B6B6B',
        border: '#E8E8E8',
        accent: '#000000',
    },
    dark: {
        background: '#000000',
        surface: '#1C1C1E',
        text: '#FFFFFF',
        textSecondary: '#8E8E93',
        border: '#2C2C2E',
        accent: '#FFFFFF',
    }
};

// Dashboard option configurations
const DASHBOARD_OPTIONS = {
    admin: {
        id: 'AdminApp',
        title: 'Admin',
        subtitle: 'Global map, alerts & audits',
        icon: 'shield-check-outline' as const,
    },
    rider: {
        id: 'RiderApp',
        title: 'Rider',
        subtitle: 'Deliveries, routes & controls',
        icon: 'motorbike' as const,
    },
    customer: {
        id: 'CustomerApp',
        title: 'Customer',
        subtitle: 'Track packages & history',
        icon: 'package-variant' as const,
    },
};

export default function RoleSelectionScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const colorScheme = useColorScheme();
    const { role, user } = useAuthStore((state: any) => state);

    const isDark = colorScheme === 'dark';
    const colors = isDark ? COLORS.dark : COLORS.light;

    const handleNavigation = (targetApp: 'RiderApp' | 'CustomerApp' | 'AdminApp') => {
        navigation.replace(targetApp);
    };

    const isAdmin = role === 'admin';
    const isRider = role === 'rider';

    // Get first name only for cleaner display
    const firstName = user?.name?.split(' ')[0] || 'there';

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            {/* Header Section */}
            <View style={styles.header}>
                <View style={styles.avatarContainer}>
                    {user?.photo ? (
                        <Image
                            source={{ uri: user.photo }}
                            style={styles.avatar}
                        />
                    ) : (
                        <View style={[styles.avatarPlaceholder, { backgroundColor: colors.surface }]}>
                            <MaterialCommunityIcons
                                name="account"
                                size={32}
                                color={colors.textSecondary}
                            />
                        </View>
                    )}
                </View>

                <Text style={[styles.greeting, { color: colors.textSecondary }]}>
                    Welcome back,
                </Text>
                <Text style={[styles.name, { color: colors.text }]}>
                    {firstName}
                </Text>
            </View>

            {/* Dashboard Selection */}
            <View style={styles.content}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                    Choose dashboard
                </Text>

                <View style={styles.optionsContainer}>
                    {/* Admin - Only for Admins */}
                    {isAdmin && (
                        <DashboardCard
                            {...DASHBOARD_OPTIONS.admin}
                            colors={colors}
                            onPress={() => handleNavigation('AdminApp')}
                        />
                    )}

                    {/* Rider - For Admins and Riders */}
                    {(isAdmin || isRider) && (
                        <DashboardCard
                            {...DASHBOARD_OPTIONS.rider}
                            colors={colors}
                            onPress={() => handleNavigation('RiderApp')}
                        />
                    )}

                    {/* Customer - For Everyone */}
                    <DashboardCard
                        {...DASHBOARD_OPTIONS.customer}
                        colors={colors}
                        onPress={() => handleNavigation('CustomerApp')}
                    />
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
                <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                    Parcel Safe
                </Text>
            </View>
        </SafeAreaView>
    );
}

interface DashboardCardProps {
    id: string;
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    colors: typeof COLORS.light;
    onPress: () => void;
}

const DashboardCard = ({ title, subtitle, icon, colors, onPress }: DashboardCardProps) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        Animated.spring(scaleAnim, {
            toValue: 0.98,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const handlePressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    return (
        <Pressable
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
        >
            <Animated.View
                style={[
                    styles.card,
                    {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        transform: [{ scale: scaleAnim }]
                    }
                ]}
            >
                <View style={styles.cardContent}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.background }]}>
                        <MaterialCommunityIcons
                            name={icon}
                            size={26}
                            color={colors.text}
                        />
                    </View>

                    <View style={styles.cardText}>
                        <Text style={[styles.cardTitle, { color: colors.text }]}>
                            {title}
                        </Text>
                        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                            {subtitle}
                        </Text>
                    </View>
                </View>

                <MaterialCommunityIcons
                    name="chevron-right"
                    size={24}
                    color={colors.textSecondary}
                />
            </Animated.View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 24,
        paddingTop: 40,
        paddingBottom: 32,
    },
    avatarContainer: {
        marginBottom: 24,
    },
    avatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
    },
    avatarPlaceholder: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    greeting: {
        fontSize: 16,
        fontWeight: '400',
        letterSpacing: 0.2,
    },
    name: {
        fontSize: 32,
        fontWeight: '700',
        letterSpacing: -0.5,
        marginTop: 4,
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 16,
    },
    optionsContainer: {
        gap: 12,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    cardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconContainer: {
        width: 52,
        height: 52,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    cardText: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    cardSubtitle: {
        fontSize: 14,
        fontWeight: '400',
        marginTop: 2,
    },
    footer: {
        paddingVertical: 24,
        alignItems: 'center',
    },
    footerText: {
        fontSize: 12,
        fontWeight: '500',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
});
