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
    const theme = useTheme();

    const isOtpValid = isReturnOtpValid(cancellation.returnOtpIssuedAt, Date.now());
    const remainingHours = getReturnOtpRemainingHours(cancellation.returnOtpIssuedAt, Date.now());

    if (compact) {
        return (
            <Surface
                style={[styles.compactCard, { backgroundColor: theme.colors.errorContainer }]}
                elevation={1}
            >
                <View style={styles.compactContent}>
                    <MaterialCommunityIcons name="cancel" size={20} color={theme.colors.error} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text variant="labelMedium" style={{ fontWeight: 'bold', color: theme.colors.error }}>
                            Delivery Cancelled
                        </Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onErrorContainer }}>
                            {formatCancellationReason(cancellation.reason)}
                        </Text>
                    </View>
                    {cancellation.packageRetrieved ? (
                        <Chip compact icon="check" style={{ backgroundColor: '#E8F5E9' }}>Retrieved</Chip>
                    ) : (
                        <Chip compact icon="clock-outline" style={{ backgroundColor: '#FFF3E0' }}>Pending</Chip>
                    )}
                </View>
            </Surface>
        );
    }

    return (
        <Surface style={[styles.container, { backgroundColor: theme.colors.surface }]} elevation={2}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.colors.errorContainer }]}>
                <MaterialCommunityIcons name="alert-circle" size={32} color={theme.colors.error} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.error }}>
                        Delivery Cancelled
                    </Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onErrorContainer }}>
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
                        <MaterialCommunityIcons name="motorbike" size={18} color={theme.colors.onSurfaceVariant} />
                        <Text variant="bodySmall" style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>
                            Cancelled by: <Text style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>{cancellation.riderName}</Text>
                        </Text>
                    </View>
                )}

                {/* Cancelled Time */}
                <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="clock-outline" size={18} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>
                        Cancelled at: <Text style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                            {parseUTCString(cancellation.cancelledAt).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' })}
                        </Text>
                    </Text>
                </View>

                {/* Package Status */}
                <View style={styles.detailRow}>
                    <MaterialCommunityIcons
                        name={cancellation.packageRetrieved ? 'check-circle' : 'package-variant'}
                        size={18}
                        color={cancellation.packageRetrieved ? '#4CAF50' : theme.colors.onSurfaceVariant}
                    />
                    <Text variant="bodySmall" style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>
                        Package: <Text style={{
                            fontWeight: 'bold',
                            color: cancellation.packageRetrieved ? '#4CAF50' : theme.colors.primary
                        }}>
                            {cancellation.packageRetrieved ? 'Retrieved' : 'Awaiting Pickup'}
                        </Text>
                    </Text>
                </View>
            </View>

            {/* Return OTP Section */}
            {showReturnOtp && !cancellation.packageRetrieved && (
                <View style={styles.otpSection}>
                    <View style={styles.divider} />

                    {variant === 'customer' ? (
                        <View style={styles.customerOtpInfo}>
                            <Text variant="titleSmall" style={{ fontWeight: 'bold', marginBottom: 8, color: theme.colors.onSurface }}>
                                Package Return Instructions
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
                                The rider will return your package to the pickup location. Use the code below to unlock the box and retrieve your package.
                            </Text>

                            <ReturnOtpDisplay
                                otp={cancellation.returnOtp}
                                issuedAt={cancellation.returnOtpIssuedAt}
                            />
                        </View>
                    ) : (
                        <View style={styles.riderOtpInfo}>
                            <Text variant="titleSmall" style={{ fontWeight: 'bold', marginBottom: 8, color: theme.colors.onSurface }}>
                                Package Return Instructions
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                                Please return the package to the pickup location. The sender will receive a Return OTP to unlock the box once you arrive.
                            </Text>

                            {onNavigateToReturn && (
                                <Button
                                    mode="contained"
                                    onPress={onNavigateToReturn}
                                    style={{ marginTop: 16 }}
                                    icon="navigation"
                                >
                                    Navigate to Return Location
                                </Button>
                            )}
                        </View>
                    )}
                </View>
            )}

            {/* Package Retrieved Success */}
            {cancellation.packageRetrieved && (
                <View style={[styles.retrievedBanner, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]}>
                    <MaterialCommunityIcons name="check-decagram" size={24} color="#4CAF50" />
                    <Text variant="bodyMedium" style={{ marginLeft: 12, color: '#4CAF50', fontWeight: 'bold' }}>
                        Package Retrieved Successfully
                    </Text>
                </View>
            )}

            {/* OTP Expired Warning */}
            {!cancellation.packageRetrieved && !isOtpValid && (
                <View style={[styles.expiredBanner, { backgroundColor: theme.colors.errorContainer }]}>
                    <MaterialCommunityIcons name="clock-alert" size={20} color={theme.colors.error} />
                    <Text variant="bodySmall" style={{ marginLeft: 8, color: theme.colors.error }}>
                        Return OTP has expired. Please contact support.
                    </Text>
                </View>
            )}
        </Surface>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 16,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    details: {
        padding: 16,
        paddingTop: 12,
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
