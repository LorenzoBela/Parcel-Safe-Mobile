import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, useTheme, Card, Avatar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import useAuthStore from '../../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function DevRoleSelectionScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const login = useAuthStore((state: any) => state.login);

    const handleLogin = (role: 'rider' | 'customer' | 'admin') => {
        const mockUser = {
            email: `dev-${role}@example.com`,
            role: role,
            name: `Dev ${role.charAt(0).toUpperCase() + role.slice(1)}`,
            photo: null,
            idToken: 'mock-id-token',
            userId: `dev-${role}-id`,
            provider: 'dev',
        };

        login(mockUser);

        if (role === 'customer') {
            navigation.replace('CustomerApp');
        } else {
            // For Dev Mode: We want to test the RoleSelection screen too
            navigation.replace('RoleSelection');
        }
    };

    return (
        <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.header}>
                <MaterialCommunityIcons name="tools" size={60} color={theme.colors.primary} />
                <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>
                    Dev Mode
                </Text>
                <Text variant="bodyLarge" style={styles.subtitle}>
                    Bypass Google Sign-In and select a role to test.
                </Text>
            </View>

            <View style={styles.optionsContainer}>
                <RoleCard
                    title="Rider"
                    icon="motorbike"
                    description="Delivery personnel interface. Manage deliveries, view map, unlock box."
                    onPress={() => handleLogin('rider')}
                    color="#4CAF50"
                />

                <RoleCard
                    title="Customer"
                    icon="account"
                    description="End-user interface. Track packages, view history, manage profile."
                    onPress={() => handleLogin('customer')}
                    color="#2196F3"
                />

                <RoleCard
                    title="Admin"
                    icon="shield-account"
                    description="Administrator interface. Global map, alerts, photo audit."
                    onPress={() => handleLogin('admin')}
                    color="#F44336"
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
            <Text variant="bodyMedium" style={{ color: useTheme().colors.onSurfaceVariant }}>
                {description}
            </Text>
        </Card.Content>
    </Card>
);

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        backgroundColor: '#f5f5f5',
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
    },
});
