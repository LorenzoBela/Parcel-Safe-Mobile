import React from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export default function PrivacyPolicyScreen() {
    const theme = useTheme();
    const navigation = useNavigation();

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.content}>
                <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onSurface }]}>Privacy Policy</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 20 }}>Last Updated: January 2026</Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>1. Data Collection</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    We collect personal information such as name, phone number, and delivery address to facilitate our services. We also collect geolocation data during active deliveries.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>2. How We Use Data</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    Your data is used to match you with riders, calculate delivery fees, and ensure the security of your parcels. We do not sell your data to third parties.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>3. Data Security</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    We implement industry-standard encryption and security measures to protect your data. However, no method of transmission over the internet is 100% secure.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>4. Your Rights</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    You have the right to access, correct, or delete your personal data. Contact our support team to exercise these rights.
                </Text>

                <Button mode="contained" onPress={() => navigation.goBack()} style={styles.button}>
                    Close
                </Button>
                <View style={{ height: 40 }} />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 24,
    },
    title: {
        fontWeight: 'bold',
        marginBottom: 8,
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginTop: 16,
        marginBottom: 8,
    },
    paragraph: {
        marginBottom: 8,
        lineHeight: 22,
    },
    button: {
        marginTop: 32,
    }
});
