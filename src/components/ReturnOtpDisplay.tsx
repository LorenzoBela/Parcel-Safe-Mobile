/**
 * EC-32: Return OTP Display Component
 * 
 * A prominent, reusable component for displaying the return OTP
 * with copy functionality.
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { PremiumAlert } from '../services/PremiumAlertService';
import { useAppTheme } from '../context/ThemeContext';

const lightC = {
    bg: '#f6f4f1',
    card: '#ffffff',
    panel: '#f7f5f2',
    text: '#1c1917',
    textSec: '#57534e',
    textTer: '#a8a29e',
    border: '#e7e5e4',
    accent: '#111827',
    accentText: '#ffffff',
    gold: '#b45309',
    goldSoft: 'rgba(180, 83, 9, 0.1)',
    green: '#16a34a',
};
const darkC = {
    bg: '#0b0c10',
    card: '#0f172a',
    panel: '#111827',
    text: '#f8fafc',
    textSec: '#94a3b8',
    textTer: '#64748b',
    border: '#1f2937',
    accent: '#f8fafc',
    accentText: '#0b0c10',
    gold: '#f59e0b',
    goldSoft: 'rgba(245, 158, 11, 0.15)',
    green: '#22c55e',
};

interface ReturnOtpDisplayProps {
    otp: string;
    issuedAt?: number;
    compact?: boolean;
    showValidity?: boolean;
    onCopy?: () => void;
}

export default function ReturnOtpDisplay({
    otp,
    compact = false,
    onCopy,
}: ReturnOtpDisplayProps) {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await Clipboard.setStringAsync(otp);
        setCopied(true);
        PremiumAlert.alert('COPIED!', 'OTP COPIED TO CLIPBOARD');
        onCopy?.();
        setTimeout(() => setCopied(false), 2000);
    };

    if (compact) {
        return (
            <TouchableOpacity onPress={handleCopy} activeOpacity={0.85}>
                <Surface
                    style={[
                        styles.compactContainer,
                        {
                            backgroundColor: copied ? c.accent : c.panel,
                            borderColor: copied ? c.gold : c.border,
                            borderWidth: 1,
                        }
                    ]}
                    elevation={0}
                >
                    <MaterialCommunityIcons name="key-variant" size={16} color={copied ? c.accentText : c.gold} />
                    <Text
                        style={{
                            letterSpacing: 4,
                            color: copied ? c.accentText : c.text,
                            marginLeft: 8,
                            fontFamily: 'Inter_900Black',
                            fontSize: 16,
                        }}
                    >
                        {otp}
                    </Text>
                </Surface>
            </TouchableOpacity>
        );
    }

    return (
        <Surface style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]} elevation={0}>
            <View style={[styles.accentBar, { backgroundColor: c.gold }]} />
            <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                    <View style={[styles.iconHalo, { backgroundColor: c.goldSoft }]}>
                        <MaterialCommunityIcons name="shield-key-outline" size={20} color={c.gold} />
                    </View>
                    <View style={{ marginLeft: 10 }}>
                        <Text style={{ fontFamily: 'Inter_800ExtraBold', color: c.text, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                            Return OTP
                        </Text>
                        <Text style={{ color: c.textSec, fontFamily: 'Inter_500Medium', fontSize: 12 }}>
                            Use at pickup for return authorization
                        </Text>
                    </View>
                </View>
            </View>

            <TouchableOpacity onPress={handleCopy} activeOpacity={0.9}>
                <Surface
                    style={[
                        styles.otpBox,
                        {
                            backgroundColor: copied ? c.gold : c.accent,
                            borderColor: copied ? c.gold : c.border,
                        }
                    ]}
                    elevation={0}
                >
                    <Text
                        style={[
                            styles.otpText,
                            { color: copied ? c.accentText : c.accentText }
                        ]}
                    >
                        {otp}
                    </Text>
                </Surface>
            </TouchableOpacity>
        </Surface>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 18,
        borderRadius: 18,
        borderWidth: 1,
    },
    accentBar: {
        height: 3,
        borderRadius: 999,
        marginBottom: 14,
        opacity: 0.9,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconHalo: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    otpBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
        paddingHorizontal: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    otpText: {
        letterSpacing: 10,
        fontFamily: 'Inter_900Black',
        fontSize: 30,
        textAlign: 'center',
    },
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
});
