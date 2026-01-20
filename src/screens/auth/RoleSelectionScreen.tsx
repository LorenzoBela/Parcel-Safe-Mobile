import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme, Card, Avatar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function RoleSelectionScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const { role, user } = useAuthStore((state: any) => state);

    const handleNavigation = (targetApp: 'RiderApp' | 'CustomerApp' | 'AdminApp') => {
        navigation.replace(targetApp);
    };

    // Determine available options based on role
    // Admin gets everything
    // Rider gets Rider + Customer
    // Customer gets Customer (though logic should prevent them from landing here usually)

    // Check if role is effectively admin or rider
    const isAdmin = role === 'admin';
    const isRider = role === 'rider';
    const isCustomer = role === 'customer';

    return (
        <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.header}>
                <Avatar.Image
                    size={80}
                    source={user?.photo ? { uri: user.photo } : require('../../../assets/icon.png')} // Fallback if no photo
                    style={{ marginBottom: 16, backgroundColor: theme.colors.surfaceVariant }}
                />
                <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>
                    Welcome, {user?.name || 'User'}
                </Text>
                <Text variant="bodyLarge" style={styles.subtitle}>
                    Select your dashboard to continue.
                </Text>
            </View>

            <View style={styles.optionsContainer}>
                {/* Admin - Only for Admins */}
                {isAdmin && (
                    <RoleCard
                        title="Admin Dashboard"
                        icon="shield-account"
                        description="Access global map, security alerts, and photo audits."
                        onPress={() => handleNavigation('AdminApp')}
                        color="#F44336"
                    />
                )}

                {/* Rider - For Admins and Riders */}
                {(isAdmin || isRider) && (
                    <RoleCard
                        title="Rider Dashboard"
                        icon="motorbike"
                        description="Manage deliveries, view routes, and box controls."
                        onPress={() => handleNavigation('RiderApp')}
                        color="#4CAF50"
                    />
                )}

                {/* Customer - For Everyone */}
                <RoleCard
                    title="Customer Dashboard"
                    icon="account"
                    description="Track packages, book services, and view history."
                    onPress={() => handleNavigation('CustomerApp')}
                    color="#2196F3"
                />
            </View>
        </ScrollView>
    );
}

const RoleCard = ({ title, icon, description, onPress, color }: any) => (
    <Card style={styles.card} onPress={onPress}>
        <Card.Title
            title={title}
            titleVariant="titleLarge"
            left={(props) => <Avatar.Icon {...props} icon={icon} style={{ backgroundColor: color }} />}
        />
        <Card.Content>
            <Text variant="bodyMedium" style={{ color: '#555' }}>
                {description}
            </Text>
        </Card.Content>
    </Card>
);

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        backgroundColor: '#fff',
        padding: 20,
        justifyContent: 'center',
    },
    header: {
        alignItems: 'center',
        marginBottom: 30,
    },
    title: {
        fontWeight: 'bold',
        marginTop: 10,
    },
    subtitle: {
        textAlign: 'center',
        marginTop: 5,
        opacity: 0.7,
    },
    optionsContainer: {
        gap: 16,
    },
    card: {
        marginBottom: 10,
        elevation: 2,
        backgroundColor: 'white' // Ensure card stands out on potential dark background or colored bg
    },
});
