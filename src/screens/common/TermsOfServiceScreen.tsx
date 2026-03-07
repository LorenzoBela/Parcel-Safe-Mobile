import React from 'react';
import { Animated, StyleSheet, ScrollView, View } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Button, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export default function TermsOfServiceScreen() {
    const theme = useTheme();
    const navigation = useNavigation();
    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[{ flex: 1 }, screenAnim.style]}>
        <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.content}>
                <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onSurface }]}>Terms of Service</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 20 }}>Last Updated: January 2026</Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>1. Introduction</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    Welcome to Parcel Safe. By using our app and services, you agree to these Terms of Service. Please read them carefully.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>2. Service Description</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    Parcel Safe provides a secure delivery platform utilizing IoT-enabled top boxes. We act as an intermediary between riders and customers to ensure secure parcel handling.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>3. User Responsibilities</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    You agree to provide accurate location and contact information. You are responsible for the security of your account and OTP codes. Sharing OTP codes remotely voids our security guarantee.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>4. Liability</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: theme.colors.onSurfaceVariant }]}>
                    We are not liable for delays caused by traffic, weather, or force majeure events. Our liability for damaged items is limited to the declared value of the shipment.
                </Text>

                <Button mode="contained" onPress={() => navigation.goBack()} style={styles.button}>
                    I Agree & Close
                </Button>
                <View style={{ height: 40 }} />
            </View>
        </ScrollView>
        </Animated.View>
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
