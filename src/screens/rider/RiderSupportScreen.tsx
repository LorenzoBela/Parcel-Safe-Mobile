import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Linking, Alert } from 'react-native';
import { Text, Card, Button, useTheme, List, TextInput, Divider, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';

const lightC = {
    bg: '#F7F7F8', card: '#FFFFFF', text: '#111111', textSec: '#6B6B6B', textTer: '#9E9E9E',
    accent: '#111111', accentText: '#FFFFFF', border: '#E5E5E5', divider: '#F0F0F0',
    search: '#F2F2F3', redBg: '#FFF0F0', redText: '#D32F2F', blueBg: '#EEF4FF', blueText: '#1565C0',
};
const darkC = {
    bg: '#0D0D0D', card: '#1A1A1A', text: '#F5F5F5', textSec: '#A0A0A0', textTer: '#666666',
    accent: '#FFFFFF', accentText: '#000000', border: '#2A2A2A', divider: '#222222',
    search: '#1E1E1E', redBg: '#2C1616', redText: '#FF6B6B', blueBg: '#162040', blueText: '#64B5F6',
};

export default function RiderSupportScreen() {
    const theme = useTheme();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const navigation = useNavigation<any>();
    const [message, setMessage] = useState('');

    const handleCallAdmin = () => {
        Linking.openURL('tel:09171234567');
    };

    const handleEmailAdmin = () => {
        Linking.openURL('mailto:admin@parcelsafe.com?subject=Rider Support Request');
    };

    const handleSubmitTicket = () => {
        if (!message.trim()) {
            Alert.alert("Empty Message", "Please describe your issue.");
            return;
        }
        Alert.alert("Ticket Submitted", "Admin has been notified. We will contact you shortly.");
        setMessage('');
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
            <View style={styles.header}>
                <IconButton icon="arrow-left" iconColor={c.text} onPress={() => navigation.goBack()} />
                <Text variant="headlineSmall" style={{ fontWeight: 'bold', flex: 1, color: c.text }}>Rider Support</Text>
            </View>

            {/* Emergency Section */}
            <View style={[styles.card, { backgroundColor: c.redBg, borderWidth: 1, borderColor: c.redText }]}>
                <View style={{ alignItems: 'center', padding: 20 }}>
                    <MaterialCommunityIcons name="alert-decagram" size={40} color={c.redText} />
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.redText, marginTop: 8 }}>Emergency & Safety</Text>
                    <Text variant="bodyMedium" style={{ textAlign: 'center', marginBottom: 12, color: c.redText, opacity: 0.85 }}>
                        In case of accidents or immediate threats, contact emergency services or dispatch immediately.
                    </Text>
                    <Button mode="contained" buttonColor={c.redText} textColor={isDarkMode ? '#000' : '#FFF'} onPress={handleCallAdmin} icon="phone">
                        Call Dispatch SOS
                    </Button>
                </View>
            </View>

            {/* Direct Contact */}
            <Text variant="titleSmall" style={{ color: c.accent, fontWeight: 'bold', marginTop: 20, marginBottom: 8, marginLeft: 4 }}>Contact Admin</Text>
            <View style={[styles.card, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
                <List.Item
                    title="Rider Hotline"
                    description="(0917) 123-4567"
                    titleStyle={{ color: c.text }}
                    descriptionStyle={{ color: c.textSec }}
                    left={props => <List.Icon {...props} icon="phone" color={c.accent} />}
                    onPress={handleCallAdmin}
                />
                <View style={{ height: 1, backgroundColor: c.divider, marginHorizontal: 16 }} />
                <List.Item
                    title="Email Admin"
                    description="admin@parcelsafe.com"
                    titleStyle={{ color: c.text }}
                    descriptionStyle={{ color: c.textSec }}
                    left={props => <List.Icon {...props} icon="email" color={c.accent} />}
                    onPress={handleEmailAdmin}
                />
            </View>

            {/* Ticket Form */}
            <Text variant="titleSmall" style={{ color: c.accent, fontWeight: 'bold', marginTop: 20, marginBottom: 8, marginLeft: 4 }}>Submit a Ticket</Text>
            <View style={[styles.card, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, padding: 16 }]}>
                <TextInput
                    label="Describe your issue"
                    mode="outlined"
                    multiline
                    numberOfLines={4}
                    value={message}
                    onChangeText={setMessage}
                    style={{ backgroundColor: c.card }}
                    textColor={c.text}
                    outlineColor={c.border}
                    activeOutlineColor={c.accent}
                    placeholderTextColor={c.textTer}
                />
                <Button
                    mode="contained"
                    onPress={handleSubmitTicket}
                    style={{ marginTop: 12 }}
                    icon="send"
                    buttonColor={c.accent}
                    textColor={c.accentText}
                >
                    Submit Report
                </Button>
            </View>

            {/* Quick Helper Links */}
            <Text variant="titleSmall" style={{ color: c.accent, fontWeight: 'bold', marginTop: 20, marginBottom: 8, marginLeft: 4 }}>Common Topics</Text>
            <View style={[styles.card, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
                <List.Item
                    title="Hardware / Box Issues"
                    description="Unlock failures, battery connection"
                    titleStyle={{ color: c.text }}
                    descriptionStyle={{ color: c.textSec }}
                    left={props => <List.Icon {...props} icon="cube-scan" color={c.textSec} />}
                    right={props => <List.Icon {...props} icon="chevron-right" color={c.textTer} />}
                    onPress={() => Alert.alert("Tip", "Ensure Bluetooth is on and you are within 2 meters of the box.")}
                />
                <View style={{ height: 1, backgroundColor: c.divider, marginHorizontal: 16 }} />
                <List.Item
                    title="Earnings & Payouts"
                    description="Missing payments, discrepancies"
                    titleStyle={{ color: c.text }}
                    descriptionStyle={{ color: c.textSec }}
                    left={props => <List.Icon {...props} icon="cash" color={c.textSec} />}
                    right={props => <List.Icon {...props} icon="chevron-right" color={c.textTer} />}
                    onPress={() => navigation.navigate('DeliveryRecords')}
                />
            </View>

            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    card: {
        marginBottom: 12,
        borderRadius: 12,
        overflow: 'hidden',
    },
});
