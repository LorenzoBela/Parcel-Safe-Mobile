/**
 * EC-32: Cancellation Status Card Component
 * 
 * A reusable card component showing the cancellation status,
 * reason, and return OTP (if applicable).
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface, Button, useTheme, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    CancellationState,
    formatCancellationReason,
    getReturnOtpRemainingHours,
    isReturnOtpValid,
} from '../services/cancellationService';
import ReturnOtpDisplay from './ReturnOtpDisplay';
import { parseUTCString } from '../utils/date';
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

interface CancellationStatusCardProps {
    cancellation: CancellationState;
    variant?: 'customer' | 'rider';
    onNavigateToReturn?: () => void;
    showReturnOtp?: boolean;
    compact?: boolean;
}

export default function CancellationStatusCard({
    cancellation,
    variant = 'customer',
    onNavigateToReturn,
    showReturnOtp = true,
    compact = false,
}: CancellationStatusCardProps) {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;

    const isOtpValid = isReturnOtpValid(cancellation.returnOtpIssuedAt, Date.now());
    const remainingHours = getReturnOtpRemainingHours(cancellation.returnOtpIssuedAt, Date.now());

    if (compact) {
        return (
            <Surface
                style={[styles.compactCard, { backgroundColor: c.redBg }]}
                elevation={0}
            >
                <View style={styles.compactContent}>
                    <MaterialCommunityIcons name="cancel" size={20} color={c.redText} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={{ fontFamily: 'Inter_700Bold', color: c.redText, textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 }}>
                            Delivery Cancelled
                        </Text>
                        <Text style={{ color: c.redText, opacity: 0.8, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                            {formatCancellationReason(cancellation.reason)}
                        </Text>
                    </View>
                    {cancellation.packageRetrieved ? (
                        <View style={{ backgroundColor: c.greenBg, paddingHorizontal: 10, paddingVertical: 4 }}>
                            <Text style={{ color: c.greenText, fontFamily: 'Inter_700Bold', fontSize: 11, textTransform: 'uppercase' }}>Retrieved</Text>
                        </View>
                    ) : (
                        <View style={{ backgroundColor: c.orangeBg, paddingHorizontal: 10, paddingVertical: 4 }}>
                            <Text style={{ color: c.orangeText, fontFamily: 'Inter_700Bold', fontSize: 11, textTransform: 'uppercase' }}>Pending</Text>
                        </View>
                    )}
                </View>
            </Surface>
        );
    }

    return (
        <Surface style={[styles.container, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]} elevation={0}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: c.redBg, borderBottomWidth: 1, borderBottomColor: c.redText }]}>
                <MaterialCommunityIcons name="alert-circle" size={32} color={c.redText} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={{ fontFamily: 'Inter_900Black', color: c.redText, textTransform: 'uppercase', fontSize: 16, letterSpacing: 1 }}>
                        Delivery Cancelled
                    </Text>
                    <Text style={{ color: c.redText, fontFamily: 'Inter_500Medium', fontSize: 13, opacity: 0.9 }}>
                        {formatCancellationReason(cancellation.reason)}
                        {cancellation.reasonDetails ? ` - ${cancellation.reasonDetails}` : ''}
                    </Text>
                </View>
            </View>

            {/* Status Details */}
            <View style={styles.details}>
                {/* Rider Info (for customer view) */}
                {variant === 'customer' && cancellation.riderName && (
                    <View style={styles.detailRow}>
                        <MaterialCommunityIcons name="motorbike" size={18} color={c.textSec} />
                        <Text style={{ marginLeft: 8, color: c.textSec, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
                            Cancelled by: <Text style={{ fontFamily: 'Inter_700Bold', color: c.text }}>{cancellation.riderName}</Text>
                        </Text>
                    </View>
                )}

                {/* Cancelled Time */}
                <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="clock-outline" size={18} color={c.textSec} />
                    <Text style={{ marginLeft: 8, color: c.textSec, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
                        Cancelled at: <Text style={{ fontFamily: 'Inter_700Bold', color: c.text }}>
                            {parseUTCString(cancellation.cancelledAt).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' })}
                        </Text>
                    </Text>
                </View>

                {/* Package Status */}
                <View style={styles.detailRow}>
                    <MaterialCommunityIcons
                        name={cancellation.packageRetrieved ? 'check-circle' : 'package-variant'}
                        size={18}
                        color={cancellation.packageRetrieved ? c.greenText : c.textSec}
                    />
                    <Text style={{ marginLeft: 8, color: c.textSec, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
                        Package: <Text style={{
                            fontFamily: 'Inter_700Bold',
                            color: cancellation.packageRetrieved ? c.greenText : c.text
                        }}>
                            {cancellation.packageRetrieved ? 'RETRIEVED' : 'AWAITING PICKUP'}
                        </Text>
                    </Text>
                </View>
            </View>

            {/* Return OTP Section */}
            {showReturnOtp && !cancellation.packageRetrieved && (
                <View style={styles.otpSection}>
                    <View style={[styles.divider, { backgroundColor: c.border, height: 1, marginVertical: 16 }]} />

                    {variant === 'customer' ? (
                        <View style={styles.customerOtpInfo}>
                            <Text style={{ fontFamily: 'Inter_900Black', marginBottom: 8, color: c.text, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Package Return Instructions
                            </Text>
                            <Text style={{ color: c.textSec, marginBottom: 16, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 }}>
                                The rider will return your package to the pickup location. Use the code below to unlock the box and retrieve your package.
                            </Text>

                            <ReturnOtpDisplay
                                otp={cancellation.returnOtp}
                                issuedAt={cancellation.returnOtpIssuedAt}
                            />
                        </View>
                    ) : (
                        <View style={styles.riderOtpInfo}>
                            <Text style={{ fontFamily: 'Inter_900Black', marginBottom: 8, color: c.text, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Package Return Instructions
                            </Text>
                            <Text style={{ color: c.textSec, marginBottom: 20, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 }}>
                                Please return the package to the pickup location. The sender will receive a Return OTP to unlock the box once you arrive.
                            </Text>

                            {onNavigateToReturn && (
                                <TouchableOpacity 
                                    activeOpacity={0.8}
                                    style={{ padding: 16, backgroundColor: c.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                                    onPress={onNavigateToReturn}
                                >
                                    <MaterialCommunityIcons name="navigation" size={20} color={c.bg} />
                                    <Text style={{ fontFamily: 'Inter_700Bold', color: c.bg, textTransform: 'uppercase', fontSize: 14 }}>
                                        Navigate to Return Location
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    )}
                </View>
            )}

            {/* Package Retrieved Success */}
            {cancellation.packageRetrieved && (
                <View style={[styles.retrievedBanner, { backgroundColor: c.greenBg }]}>
                    <MaterialCommunityIcons name="check-decagram" size={24} color={c.greenText} />
                    <Text style={{ marginLeft: 12, color: c.greenText, fontFamily: 'Inter_900Black', fontSize: 14, textTransform: 'uppercase' }}>
                        Package Retrieved
                    </Text>
                </View>
            )}

            {/* OTP Expired Warning */}
            {!cancellation.packageRetrieved && !isOtpValid && (
                <View style={[styles.expiredBanner, { backgroundColor: c.redBg, padding: 12, flexDirection: 'row', alignItems: 'center' }]}>
                    <MaterialCommunityIcons name="clock-alert" size={20} color={c.redText} />
                    <Text style={{ marginLeft: 8, color: c.redText, fontFamily: 'Inter_700Bold', fontSize: 13, textTransform: 'uppercase' }}>
                        Return OTP EXPIRED. Contact Support.
                    </Text>
                </View>
            )}
        </Surface>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 0,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    details: {
        padding: 16,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    otpSection: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    divider: {
        height: 1,
        backgroundColor: '#E0E0E0',
        marginBottom: 16,
    },
    customerOtpInfo: {
        alignItems: 'flex-start',
    },
    riderOtpInfo: {
        alignItems: 'flex-start',
    },
    retrievedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        margin: 16,
        marginTop: 0,
        borderRadius: 12,
    },
    expiredBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        margin: 16,
        marginTop: 0,
        borderRadius: 8,
    },
    compactCard: {
        borderRadius: 12,
        overflow: 'hidden',
    },
    compactContent: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
    },
});
