/**
 * EC-32: Cancellation Confirmation Screen
 * 
 * Shown to riders after successfully cancelling a delivery.
 * Displays the return OTP and next steps for returning the package.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, BackHandler } from 'react-native';
import { Text, Surface, Button, Card, Avatar, useTheme, IconButton, Divider } from 'react-native-paper';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';
import LottieView from 'lottie-react-native';
import {
    formatCancellationReason,
    CancellationReason,
    getReturnOtpRemainingHours,
    RETURN_OTP_VALIDITY_MS
} from '../../services/cancellationService';

interface RouteParams {
    deliveryId: string;
    returnOtp: string;
    reason: CancellationReason;
    reasonDetails?: string;
    senderName?: string;
    pickupAddress?: string;
}

export default function CancellationConfirmationScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const theme = useTheme();
    const params = route.params as RouteParams;

    const [remainingHours, setRemainingHours] = useState(24);
    const [otpCopied, setOtpCopied] = useState(false);

    const {
        deliveryId = 'TRK-XXXX-XXXX',
        returnOtp = '------',
        reason = CancellationReason.OTHER,
        reasonDetails = '',
        senderName = 'Sender',
        pickupAddress = 'Return to pickup location',
    } = params || {};

    // Calculate remaining OTP validity
    useEffect(() => {
        const updateRemaining = () => {
            const hours = getReturnOtpRemainingHours(Date.now(), Date.now());
            setRemainingHours(hours > 0 ? hours : 24);
        };

        updateRemaining();
        const interval = setInterval(updateRemaining, 60000); // Update every minute
        return () => clearInterval(interval);
    }, []);

    // Prevent accidental back navigation
    useFocusEffect(
        useCallback(() => {
            const onBackPress = () => {
                Alert.alert(
                    'Return to Dashboard?',
                    'Make sure you have noted down the return OTP before leaving.',
                    [
                        { text: 'Stay', style: 'cancel' },
                        { text: 'Leave', onPress: () => navigation.navigate('RiderDashboard') },
                    ]
                );
                return true;
            };

            const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            return () => subscription.remove();
        }, [navigation])
    );

    const copyOtp = async () => {
        await Clipboard.setStringAsync(returnOtp);
        setOtpCopied(true);
        Alert.alert('Copied!', 'Return OTP copied to clipboard');
        setTimeout(() => setOtpCopied(false), 3000);
    };

    const handleStartReturn = () => {
        navigation.navigate('ReturnPackage', {
            deliveryId,
            returnOtp,
            pickupAddress,
            senderName,
        });
    };

    const handleDone = () => {
        navigation.navigate('RiderDashboard');
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>

                {/* Success/Warning Header */}
                <Surface style={[styles.headerCard, { backgroundColor: theme.colors.errorContainer }]} elevation={0}>
                    <View style={styles.headerContent}>
                        <MaterialCommunityIcons
                            name="alert-circle-check"
                            size={64}
                            color={theme.colors.error}
                        />
                        <Text variant="headlineSmall" style={[styles.headerTitle, { color: theme.colors.onErrorContainer }]}>
                            Delivery Cancelled
                        </Text>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer, textAlign: 'center' }}>
                            {formatCancellationReason(reason)}
                            {reasonDetails ? ` - ${reasonDetails}` : ''}
                        </Text>
                    </View>
                </Surface>

                {/* Delivery ID Card */}
                <Surface style={[styles.infoCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={styles.infoRow}>
                        <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.primary} />
                        <Text variant="bodyMedium" style={{ marginLeft: 12, color: theme.colors.onSurface }}>
                            Tracking Number
                        </Text>
                    </View>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', marginTop: 4, color: theme.colors.onSurface }}>
                        {deliveryId}
                    </Text>
                </Surface>

                {/* Return OTP Card - Most Important */}
                <Surface style={[styles.otpCard, { backgroundColor: theme.colors.surface }]} elevation={3}>
                    <View style={styles.otpHeader}>
                        <MaterialCommunityIcons name="key-variant" size={24} color={theme.colors.primary} />
                        <Text variant="titleMedium" style={{ marginLeft: 8, fontWeight: 'bold', color: theme.colors.onSurface }}>
                            Return Authorization OTP
                        </Text>
                    </View>

                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
                        Give this code to the sender to retrieve the package from the box
                    </Text>

                    <TouchableOpacity onPress={copyOtp} activeOpacity={0.7}>
                        <Surface
                            style={[
                                styles.otpDisplay,
                                {
                                    backgroundColor: theme.dark ? '#1A237E' : '#E8EAF6',
                                    borderColor: otpCopied ? theme.colors.primary : 'transparent',
                                    borderWidth: 2,
                                }
                            ]}
                            elevation={0}
                        >
                            <Text
                                variant="displaySmall"
                                style={{
                                    letterSpacing: 8,
                                    fontWeight: 'bold',
                                    color: theme.colors.primary,
                                    fontFamily: 'monospace',
                                }}
                            >
                                {returnOtp}
                            </Text>
                            <IconButton
                                icon={otpCopied ? "check" : "content-copy"}
                                size={20}
                                iconColor={theme.colors.primary}
                                style={styles.copyButton}
                            />
                        </Surface>
                    </TouchableOpacity>

                    <View style={[styles.validityBadge, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]}>
                        <MaterialCommunityIcons name="clock-outline" size={16} color="#4CAF50" />
                        <Text variant="labelMedium" style={{ marginLeft: 6, color: '#4CAF50' }}>
                            Valid for {remainingHours} hours
                        </Text>
                    </View>
                </Surface>

                {/* Next Steps Card */}
                <Surface style={[styles.stepsCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 16, color: theme.colors.onSurface }}>
                        Next Steps
                    </Text>

                    <View style={styles.stepRow}>
                        <Avatar.Text size={28} label="1" style={{ backgroundColor: theme.colors.primary }} />
                        <View style={styles.stepContent}>
                            <Text variant="bodyMedium" style={{ fontWeight: '600', color: theme.colors.onSurface }}>
                                Return to Pickup Location
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                Navigate back to where you picked up the package
                            </Text>
                        </View>
                    </View>

                    <View style={styles.stepConnector} />

                    <View style={styles.stepRow}>
                        <Avatar.Text size={28} label="2" style={{ backgroundColor: theme.colors.primary }} />
                        <View style={styles.stepContent}>
                            <Text variant="bodyMedium" style={{ fontWeight: '600', color: theme.colors.onSurface }}>
                                Meet the Sender
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                Contact the sender and arrange handover
                            </Text>
                        </View>
                    </View>

                    <View style={styles.stepConnector} />

                    <View style={styles.stepRow}>
                        <Avatar.Text size={28} label="3" style={{ backgroundColor: theme.colors.primary }} />
                        <View style={styles.stepContent}>
                            <Text variant="bodyMedium" style={{ fontWeight: '600', color: theme.colors.onSurface }}>
                                Sender Retrieves Package
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                The sender enters the Return OTP on the box keypad to unlock
                            </Text>
                        </View>
                    </View>
                </Surface>

                {/* Return Address Card */}
                <Surface style={[styles.addressCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={styles.addressHeader}>
                        <MaterialCommunityIcons name="map-marker-radius" size={24} color={theme.colors.error} />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                RETURN DESTINATION
                            </Text>
                            <Text variant="bodyMedium" style={{ fontWeight: '600', color: theme.colors.onSurface }}>
                                {senderName}
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                                {pickupAddress}
                            </Text>
                        </View>
                    </View>
                </Surface>

            </ScrollView>

            {/* Bottom Actions */}
            <Surface style={[styles.bottomActions, { backgroundColor: theme.colors.surface }]} elevation={4}>
                <Button
                    mode="outlined"
                    onPress={handleDone}
                    style={{ flex: 1, marginRight: 8 }}
                    textColor={theme.colors.primary}
                >
                    Back to Dashboard
                </Button>
                <Button
                    mode="contained"
                    onPress={handleStartReturn}
                    style={{ flex: 1 }}
                    icon="navigation"
                >
                    Start Navigation
                </Button>
            </Surface>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 100,
    },
    headerCard: {
        padding: 24,
        borderRadius: 16,
        marginBottom: 16,
    },
    headerContent: {
        alignItems: 'center',
    },
    headerTitle: {
        fontWeight: 'bold',
        marginTop: 12,
        marginBottom: 8,
    },
    infoCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    otpCard: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
    },
    otpHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    otpDisplay: {
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
    stepsCard: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    stepContent: {
        marginLeft: 16,
        flex: 1,
    },
    stepConnector: {
        width: 2,
        height: 24,
        backgroundColor: '#E0E0E0',
        marginLeft: 13,
        marginVertical: 4,
    },
    addressCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    addressHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    bottomActions: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        padding: 16,
        paddingBottom: 24,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
});
