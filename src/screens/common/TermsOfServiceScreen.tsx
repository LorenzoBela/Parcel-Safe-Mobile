import React from 'react';
import { Animated, StyleSheet, ScrollView, View } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', error: '#FF3B30',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', error: '#FF453A',
};

export default function TermsOfServiceScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation();
    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[{ flex: 1, backgroundColor: c.bg }, screenAnim.style]}>
        <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
            <View style={styles.content}>
                <Text variant="headlineMedium" style={[styles.title, { color: c.text }]}>Terms of Service</Text>
                <Text variant="bodySmall" style={{ color: c.textTer, marginBottom: 20 }}>Last Updated: January 2026</Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>1. Introduction</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    Welcome to Parcel Safe. By using our app and services, you agree to these Terms of Service. Please read them carefully.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>2. Service Description</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    Parcel Safe provides a secure delivery platform utilizing IoT-enabled top boxes. We act as an intermediary between riders and customers to ensure secure parcel handling.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>3. User Responsibilities</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    You agree to provide accurate location and contact information. You are responsible for the security of your account and OTP codes. Sharing OTP codes remotely voids our security guarantee.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>4. Liability</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    We are not liable for delays caused by traffic, weather, or force majeure events. Our liability for damaged items is limited to the declared value of the shipment.
                </Text>

                <Button mode="contained" onPress={() => navigation.goBack()} buttonColor={c.accent} textColor={c.bg} style={styles.button}>
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
        borderRadius: 12,
        paddingVertical: 6,
    }
});
