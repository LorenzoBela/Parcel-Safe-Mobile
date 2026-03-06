import React, { useState } from 'react';
import { View, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { Text, TextInput, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { triggerAdminOverride } from '../../services/adminOverrideService';
import { getCurrentUser } from '../../services/supabaseClient';
import { useAppTheme } from '../../context/ThemeContext';
import { PremiumAlert } from '../../services/PremiumAlertService';

const lightC = {
    bg: '#FFFFFF', card: '#F6F6F6', card2: '#EEEEEE', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#999999',
    accent: '#000000', red: '#FF3B30', green: '#34C759',
    warnBg: '#FEF2F2', successBg: '#F0FDF4',
};
const darkC = {
    bg: '#000000', card: '#141414', card2: '#1C1C1E', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#48484A',
    accent: '#FFFFFF', red: '#FF453A', green: '#30D158',
    warnBg: '#2A1515', successBg: '#152A15',
};

export default function AdminRemoteUnlockScreen() {
    const navigation = useNavigation();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;

    const [boxId, setBoxId] = useState('');
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    const handleUnlock = async () => {
        if (!boxId.trim()) {
            PremiumAlert.alert('Error', 'Please enter a Box ID');
            return;
        }
        if (!reason.trim()) {
            PremiumAlert.alert('Error', 'Please provide a reason for the override');
            return;
        }

        setIsSubmitting(true);
        setSuccessMessage('');

        try {
            const user = await getCurrentUser();
            const adminId = user?.id || 'admin-unknown';
            await triggerAdminOverride(boxId.trim(), adminId, reason.trim());

            setSuccessMessage(`Unlock command sent to ${boxId.trim()} successfully.`);
            setBoxId('');
            setReason('');
        } catch (error: any) {
            PremiumAlert.alert('Error', `Failed to trigger unlock: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: c.bg }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.header}>
                    <IconButton icon="arrow-left" iconColor={c.text} onPress={() => navigation.goBack()} />
                    <Text style={[styles.title, { color: c.text }]}>Remote Box Unlock</Text>
                </View>

                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                    {/* Warning icon */}
                    <View style={[styles.iconContainer, { backgroundColor: c.warnBg }]}>
                        <MaterialCommunityIcons name="lock-open-alert" size={40} color={c.red} />
                    </View>

                    <Text style={[styles.warningText, { color: c.textSec }]}>
                        Warning: This will force the box to unlock immediately.
                        Use only in emergencies or when the user cannot unlock it themselves.
                    </Text>

                    <TextInput
                        label="Box ID / MAC Address"
                        value={boxId}
                        onChangeText={setBoxId}
                        mode="outlined"
                        placeholder="e.g., BOX-001"
                        style={[styles.input, { backgroundColor: c.card2 }]}
                        autoCapitalize="characters"
                        left={<TextInput.Icon icon="cube-outline" />}
                        outlineColor={c.border}
                        activeOutlineColor={c.accent}
                        textColor={c.text}
                        theme={{ colors: { onSurfaceVariant: c.textSec, surface: c.card2 } }}
                    />

                    <TextInput
                        label="Reason for Override"
                        value={reason}
                        onChangeText={setReason}
                        mode="outlined"
                        placeholder="e.g., Battery failure, User lockout"
                        placeholderTextColor={c.textTer}
                        multiline
                        numberOfLines={3}
                        style={[styles.input, { backgroundColor: c.card2 }]}
                        outlineColor={c.border}
                        activeOutlineColor={c.accent}
                        textColor={c.text}
                        theme={{ colors: { onSurfaceVariant: c.textSec, surface: c.card2 } }}
                    />

                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: c.red }, isSubmitting && { opacity: 0.5 }]}
                        onPress={handleUnlock}
                        disabled={isSubmitting}
                        activeOpacity={0.7}
                    >
                        <MaterialCommunityIcons name="lock-open-variant" size={18} color="#FFF" />
                        <Text style={styles.buttonText}>
                            {isSubmitting ? 'Unlocking…' : 'Force Unlock'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {successMessage ? (
                    <View style={[styles.successBanner, { backgroundColor: c.successBg, borderColor: isDarkMode ? '#1A3A1A' : '#BBF7D0' }]}>
                        <MaterialCommunityIcons name="check-circle" size={22} color={c.green} />
                        <Text style={[styles.successText, { color: c.green }]}>{successMessage}</Text>
                    </View>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 20 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 30,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        marginLeft: 4,
        letterSpacing: -0.3,
    },
    card: {
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        borderWidth: 1,
    },
    iconContainer: {
        marginBottom: 16,
        padding: 16,
        borderRadius: 50,
    },
    warningText: {
        textAlign: 'center',
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 24,
    },
    input: {
        width: '100%',
        marginBottom: 16,
    },
    button: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
    },
    buttonText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 15,
    },
    successBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 14,
        marginTop: 24,
        borderWidth: 1,
    },
    successText: {
        marginLeft: 12,
        fontWeight: '700',
        flex: 1,
        fontSize: 14,
    },
});
