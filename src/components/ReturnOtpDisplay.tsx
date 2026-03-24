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
    const theme = useTheme();
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
        PremiumAlert.alert('Copied!', 'OTP copied to clipboard');
        onCopy?.();
        setTimeout(() => setCopied(false), 3000);
    };

    if (compact) {
        return (
            <TouchableOpacity onPress={handleCopy} activeOpacity={0.7}>
                <Surface
                    style={[
                        styles.compactContainer,
                        {
                            backgroundColor: theme.dark ? '#1A237E' : '#E8EAF6',
                            borderColor: copied ? theme.colors.primary : 'transparent',
                            borderWidth: 1,
                        }
                    ]}
                    elevation={1}
                >
                    <MaterialCommunityIcons name="key-variant" size={16} color={theme.colors.primary} />
                    <Text
                        variant="labelLarge"
                        style={{
                            letterSpacing: 2,
                            fontFamily: 'Inter_700Bold',
                            color: theme.colors.primary,
                            marginLeft: 8,
                            fontFamily: 'monospace',
                        }}
                    >
                        {otp}
                    </Text>
                    <MaterialCommunityIcons
                        name={copied ? "check" : "content-copy"}
                        size={16}
                        color={theme.colors.primary}
                        style={{ marginLeft: 8 }}
                    />
                </Surface>
            </TouchableOpacity>
        );
    }

    return (
        <Surface style={[styles.container, { backgroundColor: theme.colors.surface }]} elevation={2}>
            <View style={styles.header}>
                <MaterialCommunityIcons name="key-variant" size={24} color={theme.colors.primary} />
                <Text variant="titleMedium" style={{ marginLeft: 8, fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>
                    Return Authorization OTP
                </Text>
            </View>

            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
                Give this code to the sender to retrieve their package from the box
            </Text>

            <TouchableOpacity onPress={handleCopy} activeOpacity={0.7}>
                <Surface
                    style={[
                        styles.otpBox,
                        {
                            backgroundColor: theme.dark ? '#1A237E' : '#E8EAF6',
                            borderColor: copied ? theme.colors.primary : 'transparent',
                            borderWidth: 2,
                        }
                    ]}
                    elevation={0}
                >
                    <Text
                        variant="displaySmall"
                        style={{
                            letterSpacing: 8,
                            fontFamily: 'Inter_700Bold',
                            color: theme.colors.primary,
                            fontFamily: 'monospace',
                        }}
                    >
                        {otp}
                    </Text>
                    <IconButton
                        icon={copied ? "check" : "content-copy"}
                        size={20}
                        iconColor={theme.colors.primary}
                        style={styles.copyButton}
                    />
                </Surface>
            </TouchableOpacity>

            {showValidity && (
                <View style={[styles.validityBadge, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]}>
                    <MaterialCommunityIcons name="clock-outline" size={16} color="#4CAF50" />
                    <Text variant="labelMedium" style={{ marginLeft: 6, color: '#4CAF50' }}>
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
        borderRadius: 16,
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
