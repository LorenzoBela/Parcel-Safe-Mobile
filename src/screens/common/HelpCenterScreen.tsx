import React from 'react';
import { Animated, StyleSheet, ScrollView, View } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, List, Button, Card, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

export default function HelpCenterScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation();

    const insets = useSafeAreaInsets();
    const screenAnim = useEntryAnimation(0);

    const FAQs = [
        {
            question: "How do I track my parcel?",
            answer: "Go to the Dashboard and tap 'Track Order' or enter your tracking number in the Delivery Log."
        },
        {
            question: "How do I use the Smart Top Box?",
            answer: "When the rider arrives, you will receive an OTP. Verify the parcel, then provide the OTP to the rider or use the app to unlock the box."
        },
        {
            question: "My parcel is damaged, what do I do?",
            answer: "Please report the issue immediately via the 'Report' button in the Delivery Log or Dashboard."
        }
    ];

    return (
        <Animated.View style={[{ flex: 1, backgroundColor: c.bg }, screenAnim.style]}>
        <ScrollView
            style={[styles.container, { backgroundColor: c.bg }]}
            contentContainerStyle={{
                paddingBottom: insets.bottom + 20,
                paddingTop: insets.top
            }}
        >
            <View style={styles.header}>
                <MaterialCommunityIcons name="lifebuoy" size={60} color={c.accent} />
                <Text variant="headlineMedium" style={[styles.title, { color: c.text }]}>Help Center</Text>
                <Text variant="bodyMedium" style={{ color: c.textSec, textAlign: 'center' }}>
                    We're here to help you with your deliveries.
                </Text>
            </View>

            <List.Section>
                <List.Subheader style={{ color: c.textSec, fontWeight: 'bold' }}>Frequently Asked Questions</List.Subheader>
                {FAQs.map((faq, index) => (
                    <Card key={index} style={[styles.card, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]} elevation={0}>
                        <Card.Content>
                            <Text variant="titleMedium" style={[styles.question, { color: c.text }]}>{faq.question}</Text>
                            <Text variant="bodyMedium" style={{ color: c.textSec }}>{faq.answer}</Text>
                        </Card.Content>
                    </Card>
                ))}
            </List.Section>

            <List.Section>
                <List.Subheader style={{ color: c.textSec, fontWeight: 'bold' }}>Contact Support</List.Subheader>
                <Card style={[styles.card, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]} elevation={0}>
                    <List.Item
                        title="Customer Hotline"
                        titleStyle={{ color: c.text, fontWeight: '500' }}
                        description="(02) 8-123-4567"
                        descriptionStyle={{ color: c.textSec }}
                        left={props => <List.Icon {...props} icon="phone" color={c.accent} />}
                        onPress={() => console.log('Call Hotline')}
                    />
                    <Divider style={{ backgroundColor: c.border }} />
                    <List.Item
                        title="Email Support"
                        titleStyle={{ color: c.text, fontWeight: '500' }}
                        description="support@parcelsafe.com"
                        descriptionStyle={{ color: c.textSec }}
                        left={props => <List.Icon {...props} icon="email" color={c.accent} />}
                        onPress={() => console.log('Email Support')}
                    />
                </Card>
            </List.Section>

            <Button mode="contained" onPress={() => navigation.goBack()} buttonColor={c.accent} textColor={c.bg} style={styles.button}>
                Back
            </Button>
            <View style={{ height: 20 }} />
        </ScrollView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    header: {
        alignItems: 'center',
        marginVertical: 20,
    },
    title: {
        fontWeight: 'bold',
        marginVertical: 8,
    },
    card: {
        marginBottom: 12,
        borderRadius: 16,
    },
    question: {
        fontWeight: 'bold',
        marginBottom: 8,
    },
    button: {
        marginTop: 20,
        borderRadius: 12,
        paddingVertical: 6,
    }
});
