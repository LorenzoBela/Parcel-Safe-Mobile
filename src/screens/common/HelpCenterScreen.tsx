import React from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text, List, Button, useTheme, Card, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function HelpCenterScreen() {
    const theme = useTheme();
    const navigation = useNavigation();

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
        <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.header}>
                <MaterialCommunityIcons name="lifebuoy" size={60} color={theme.colors.primary} />
                <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onSurface }]}>Help Center</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                    We're here to help you with your deliveries.
                </Text>
            </View>

            <List.Section>
                <List.Subheader style={{ color: theme.colors.primary }}>Frequently Asked Questions</List.Subheader>
                {FAQs.map((faq, index) => (
                    <Card key={index} style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={[styles.question, { color: theme.colors.onSurface }]}>{faq.question}</Text>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{faq.answer}</Text>
                        </Card.Content>
                    </Card>
                ))}
            </List.Section>

            <List.Section>
                <List.Subheader style={{ color: theme.colors.primary }}>Contact Support</List.Subheader>
                <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                    <List.Item
                        title="Customer Hotline"
                        description="(02) 8-123-4567"
                        left={props => <List.Icon {...props} icon="phone" color={theme.colors.primary} />}
                        onPress={() => console.log('Call Hotline')}
                    />
                    <Divider />
                    <List.Item
                        title="Email Support"
                        description="support@parcelsafe.com"
                        left={props => <List.Icon {...props} icon="email" color={theme.colors.primary} />}
                        onPress={() => console.log('Email Support')}
                    />
                </Card>
            </List.Section>

            <Button mode="contained" onPress={() => navigation.goBack()} style={styles.button}>
                Back to Settings
            </Button>
            <View style={{ height: 20 }} />
        </ScrollView>
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
        borderRadius: 8,
    },
    question: {
        fontWeight: 'bold',
        marginBottom: 4,
    },
    button: {
        marginTop: 10,
    }
});
