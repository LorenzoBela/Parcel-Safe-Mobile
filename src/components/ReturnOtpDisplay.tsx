/**
 * EC-32: Return OTP Display Component
 * 
 * A prominent, reusable component for displaying the return OTP
 * with copy functionality and validity timer.
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface, IconButton, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { getReturnOtpRemainingHours } from '../services/cancellationService';
import { PremiumAlert } from '../services/PremiumAlertService';
import { useAppTheme } from '../context/ThemeContext';

// ── Uber-style dual palette ──
const lightC = {
    bg: '#FFFFFF', card: '#FFFFFF', search: '#F2F2F7',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    border: '#E5E5EA', accent: '#000000', accentText: '#FFFFFF',
    divider: '#F2F2F7',
    greenBg: '#ECFDF5', greenText: '#059669',
    redBg: '#FEF2F2', redText: '#DC2626',
    orangeBg: '#FFF7ED', orangeText: '#EA580C',
    blueBg: '#EFF6FF', blueText: '#2563EB',
    purpleBg: '#F5F3FF', purpleText: '#7C3AED',
};
const darkC = {
    bg: '#000000', card: '#1C1C1E', search: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    border: '#38383A', accent: '#FFFFFF', accentText: '#000000',
    divider: '#2C2C2E',
    greenBg: '#052E16', greenText: '#4ADE80',
    redBg: '#450A0A', redText: '#FCA5A5',
    orangeBg: '#431407', orangeText: '#FDBA74',
    blueBg: '#172554', blueText: '#93C5FD',
    purpleBg: '#2E1065', purpleText: '#C4B5FD',
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
    issuedAt,
    compact = false,
    showValidity = true,
    onCopy,
}: ReturnOtpDisplayProps) {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const [copied, setCopied] = useState(false);
    const [remainingHours, setRemainingHours] = useState(24);

    useEffect(() => {
        if (issuedAt && showValidity) {
            const updateRemaining = () => {
                const hours = getReturnOtpRemainingHours(issuedAt, Date.now());
                setRemainingHours(hours);
            };

            updateRemaining();
            const interval = setInterval(updateRemaining, 60000);
            return () => clearInterval(interval);
        }
    }, [issuedAt, showValidity]);

    const handleCopy = async () => {
        await Clipboard.setStringAsync(otp);
        setCopied(true);
        PremiumAlert.alert('COPIED!', 'OTP COPIED TO CLIPBOARD');
        onCopy?.();
        setTimeout(() => setCopied(false), 2000);
    };

    if (compact) {
        return (
            <TouchableOpacity onPress={handleCopy} activeOpacity={0.8}>
                <Surface
                    style={[
                        styles.compactContainer,
                        {
                            backgroundColor: copied ? c.text : c.search,
                            borderColor: copied ? c.text : c.border,
                            borderWidth: 1,
                            borderRadius: 0,
                        }
                    ]}
                    elevation={0}
                >
                    <MaterialCommunityIcons name="key-variant" size={16} color={copied ? c.bg : c.text} />
                    <Text
                        style={{
                            letterSpacing: 4,
                            color: copied ? c.bg : c.text,
                            marginLeft: 8,
                            fontFamily: 'Inter_900Black',
                            fontSize: 16
                        }}
                    >
                        {otp}
                    </Text>
                    <MaterialCommunityIcons
                        name={copied ? "check" : "content-copy"}
                        size={16}
                        color={copied ? c.bg : c.text}
                        style={{ marginLeft: 8 }}
                    />
                </Surface>
            </TouchableOpacity>
        );
    }

    return (
        <Surface style={[styles.container, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]} elevation={0}>
            <View style={styles.header}>
                <MaterialCommunityIcons name="key-variant" size={24} color={c.text} />
                <Text style={{ marginLeft: 8, fontFamily: 'Inter_900Black', color: c.text, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 14 }}>
                    Return Authorization OTP
                </Text>
            </View>

            <Text style={{ color: c.textSec, marginBottom: 16, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 }}>
                Give this code to the sender to retrieve their package from the box.
            </Text>

            <TouchableOpacity onPress={handleCopy} activeOpacity={0.9}>
                <Surface
                    style={[
                        styles.otpBox,
                        {
                            backgroundColor: c.text,
                            borderRadius: 0,
                            paddingVertical: 24,
                        }
                    ]}
                    elevation={0}
                >
                    <Text
                        style={{
                            letterSpacing: 12,
                            color: c.bg,
                            fontFamily: 'Inter_900Black',
                            fontSize: 32,
                            textAlign: 'center'
                        }}
                    >
                        {otp}
                    </Text>
                    <IconButton
                        icon={copied ? "check" : "content-copy"}
                        size={24}
                        iconColor={copied ? c.greenText : c.bg}
                        style={styles.copyButton}
                    />
                </Surface>
            </TouchableOpacity>

            {showValidity && (
                <View style={[styles.validityBadge, { backgroundColor: c.search, borderRadius: 0, marginTop: 12 }]}>
                    <MaterialCommunityIcons name="clock-outline" size={16} color={c.text} />
                    <Text style={{ marginLeft: 6, color: c.text, fontFamily: 'Inter_700Bold', fontSize: 12, textTransform: 'uppercase' }}>
                        Valid for {remainingHours} hours
                    </Text>
                </View>
            )}
        </Surface>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 20,
        borderRadius: 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    otpBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        borderRadius: 12,
        marginBottom: 12,
    },
    copyButton: {
        position: 'absolute',
        right: 8,
    },
    validityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        alignSelf: 'center',
    },
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
});
