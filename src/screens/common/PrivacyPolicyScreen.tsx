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

export default function PrivacyPolicyScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation();
    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[{ flex: 1, backgroundColor: c.bg }, screenAnim.style]}>
        <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
            <View style={styles.content}>
                <Text variant="headlineMedium" style={[styles.title, { color: c.text }]}>Privacy Policy</Text>
                <Text variant="bodySmall" style={{ color: c.textTer, marginBottom: 20 }}>Last Updated: January 2026</Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>1. Data Collection</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    We collect personal information such as name, phone number, and delivery address to facilitate our services. We also collect geolocation data during active deliveries.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>2. How We Use Data</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    Your data is used to match you with riders, calculate delivery fees, and ensure the security of your parcels. We do not sell your data to third parties.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>3. Data Security</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    We implement industry-standard encryption and security measures to protect your data. However, no method of transmission over the internet is 100% secure.
                </Text>

                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>4. Your Rights</Text>
                <Text variant="bodyMedium" style={[styles.paragraph, { color: c.textSec }]}>
                    You have the right to access, correct, or delete your personal data. Contact our support team to exercise these rights.
                </Text>

                <Button mode="contained" onPress={() => navigation.goBack()} buttonColor={c.accent} textColor={c.bg} style={styles.button}>
                    Close
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
