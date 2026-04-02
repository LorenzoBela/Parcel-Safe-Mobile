import React, { useRef, useState, useEffect } from 'react';
import dayjs from 'dayjs';
import * as Location from 'expo-location';
import { fetchWeather, WeatherData } from '../../services/weatherService';
import {
    View,
    StyleSheet,
    Pressable,
    Animated,
    Image,
    StatusBar
} from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { signOut } from '../../services/auth';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import { PremiumAlert } from '../../services/PremiumAlertService';
import { authenticateBiometricForSensitiveAction } from '../../services/biometricAuthService';

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
    const { isDarkMode: isDark } = useAppTheme();
    const { role, user, logout } = useAuthStore((state: any) => state);

    const [currentTime, setCurrentTime] = useState(dayjs());
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [locationName, setLocationName] = useState<string | null>(null);
    const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
    const [isAuthorizingRole, setIsAuthorizingRole] = useState(false);

    // Live clock
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(dayjs()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Weather & Location
    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            try {
                let location = await Location.getCurrentPositionAsync({});
                
                let address = await Location.reverseGeocodeAsync({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude
                });
                if (address && address.length > 0) {
                    const { city, region, name } = address[0];
                    setLocationName(city ? `${city}, ${region}` : name || 'Unknown Location');
                }

                const data = await fetchWeather(location.coords.latitude, location.coords.longitude);
                if (data) setWeather(data);
            } catch (err) {
                // Ignore gracefully
            }
        })();
    }, []);

    const colors = isDark ? COLORS.dark : COLORS.light;

    const handleNavigation = async (targetApp: 'RiderApp' | 'CustomerApp' | 'AdminApp') => {
        if (isAuthorizingRole) return;

        const requiresStepUp = targetApp === 'RiderApp' || targetApp === 'AdminApp';
        if (requiresStepUp) {
            try {
                setIsAuthorizingRole(true);
                const authResult = await authenticateBiometricForSensitiveAction('Authorize dashboard access');
                if (!authResult.success) {
                    PremiumAlert.alert(
                        'Authorization Required',
                        `${authResult.message} Dashboard switch was canceled.`
                    );
                    return;
                }
            } finally {
                setIsAuthorizingRole(false);
            }
        }

        if (targetApp === 'RiderApp') {
            // Route through the warmup/loading screen first
            navigation.replace('RiderLoading');
        } else {
            navigation.replace(targetApp);
        }
    };

    const handleSwitchAccount = async () => {
        if (isSwitchingAccount) return;

        try {
            setIsSwitchingAccount(true);
            await signOut();
            logout();
        } catch (error) {
            console.error('Switch account failed:', error);
        } finally {
            navigation.replace('Login');
            setIsSwitchingAccount(false);
        }
    };

    const isAdmin = role === 'admin';
    const isRider = role === 'rider';

    // Get first name only for cleaner display
    const firstName = user?.name?.split(' ')[0] || 'there';

    const headerAnim = useEntryAnimation(0);
    const cardAnims = useStaggerAnimation(3, 60, 80);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            {/* Header Section */}
            <Animated.View style={[styles.header, headerAnim.style]}>
                <View style={styles.headerTopRow}>
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

                    {/* Right-Aligned Minimalist Info Widget */}
                    <View style={styles.rightWidget}>
                        <Text style={[styles.timeText, { color: colors.text }]}>{currentTime.format('h:mm A')}</Text>
                        <Text style={[styles.dateText, { color: colors.textSecondary }]}>{currentTime.format('dddd, MMM D')}</Text>
                        
                        {locationName && (
                            <View style={styles.locationRow}>
                                <MaterialCommunityIcons name="map-marker-outline" size={12} color={colors.textSecondary} />
                                <Text style={[styles.locationText, { color: colors.textSecondary }]}>{locationName}</Text>
                            </View>
                        )}

                        {weather && (
                            <View style={styles.weatherRow}>
                                <MaterialCommunityIcons name={weather.icon as any} size={14} color={colors.textSecondary} />
                                <Text style={[styles.weatherText, { color: colors.textSecondary }]}>{weather.temp} • {weather.condition}</Text>
                            </View>
                        )}
                    </View>
                </View>

                <Text style={[styles.greeting, { color: colors.textSecondary }]}>
                    Welcome back,
                </Text>
                <Text style={[styles.name, { color: colors.text }]}>
                    {firstName}
                </Text>
            </Animated.View>

            {/* Dashboard Selection */}
            <View style={styles.content}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                    Choose dashboard
                </Text>

                <View style={styles.optionsContainer}>
                    {/* Admin - Only for Admins */}
                    {isAdmin && (
                        <Animated.View style={cardAnims[0].style}>
                            <DashboardCard
                                {...DASHBOARD_OPTIONS.admin}
                                colors={colors}
                                onPress={() => handleNavigation('AdminApp')}
                            />
                        </Animated.View>
                    )}

                    {/* Rider - For Admins and Riders */}
                    {(isAdmin || isRider) && (
                        <Animated.View style={cardAnims[1].style}>
                            <DashboardCard
                                {...DASHBOARD_OPTIONS.rider}
                                colors={colors}
                                onPress={() => handleNavigation('RiderApp')}
                            />
                        </Animated.View>
                    )}

                    {/* Customer - For Everyone */}
                    <Animated.View style={cardAnims[2].style}>
                        <DashboardCard
                            {...DASHBOARD_OPTIONS.customer}
                            colors={colors}
                            onPress={() => handleNavigation('CustomerApp')}
                        />
                    </Animated.View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
                <Pressable
                    onPress={handleSwitchAccount}
                    disabled={isSwitchingAccount}
                    style={({ pressed }) => [
                        styles.switchAccountButton,
                        {
                            borderColor: colors.border,
                            backgroundColor: pressed ? colors.surface : 'transparent',
                            opacity: isSwitchingAccount ? 0.6 : 1,
                        },
                    ]}
                >
                    <MaterialCommunityIcons
                        name="account-switch-outline"
                        size={16}
                        color={colors.textSecondary}
                    />
                    <Text style={[styles.switchAccountText, { color: colors.textSecondary }]}>
                        {isSwitchingAccount ? 'Switching...' : 'Switch account'}
                    </Text>
                </Pressable>

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
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    rightWidget: {
        alignItems: 'flex-end',
        justifyContent: 'flex-start',
        paddingTop: 4,
    },
    timeText: {
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.5,
    },
    dateText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        marginTop: 2,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        gap: 2,
    },
    locationText: {
        fontSize: 10,
        fontFamily: 'Inter_500Medium',
    },
    weatherRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        gap: 4,
    },
    weatherText: {
        fontSize: 11,
        fontFamily: 'Inter_500Medium',
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
        fontFamily: 'Inter_400Regular',
        letterSpacing: 0.2,
    },
    name: {
        fontSize: 34,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -1,
        marginTop: 4,
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
    },
    sectionTitle: {
        fontSize: 12,
        fontFamily: 'JetBrainsMono_700Bold',
        letterSpacing: 1.2,
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
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: -0.2,
    },
    cardSubtitle: {
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        marginTop: 2,
    },
    footer: {
        paddingVertical: 24,
        alignItems: 'center',
    },
    switchAccountButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 12,
    },
    switchAccountText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    footerText: {
        fontSize: 12,
        fontFamily: 'JetBrainsMono_500Medium',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
});
