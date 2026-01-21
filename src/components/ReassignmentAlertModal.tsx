import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Vibration } from 'react-native';
import { Text, Button, Surface, useTheme, IconButton, ProgressBar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ReassignmentState, getRemainingAutoAckSeconds, getReassignmentAlertMessage, formatRemainingTime } from '../services/deliveryReassignmentService';

interface ReassignmentAlertModalProps {
    visible: boolean;
    state: ReassignmentState | null;
    type: 'outgoing' | 'incoming' | null;
    onAcknowledge: () => void;
}

export default function ReassignmentAlertModal({
    visible,
    state,
    type,
    onAcknowledge,
}: ReassignmentAlertModalProps) {
    const theme = useTheme();
    const [timeLeft, setTimeLeft] = useState(30);
    const slideAnim = useRef(new Animated.Value(-300)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;

    const isOutgoing = type === 'outgoing';
    const mainColor = isOutgoing ? '#F44336' : '#4CAF50'; // Red for outgoing, Green for incoming
    const iconName = isOutgoing ? 'swap-horizontal' : 'account-switch';

    // Handle visibility animation and vibration
    useEffect(() => {
        if (visible && state) {
            // Calculate initial time left
            const remaining = getRemainingAutoAckSeconds(state);
            setTimeLeft(remaining);

            // Slide in animation
            Animated.spring(slideAnim, {
                toValue: 0,
                useNativeDriver: true,
                tension: 50,
                friction: 8,
            }).start();

            // Vibrate to alert rider
            Vibration.vibrate([0, 500, 200, 500]);

            // Start pulse animation for urgency if time is low or just general attention
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.05,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            // Slide out animation
            Animated.timing(slideAnim, {
                toValue: -300,
                duration: 200,
                useNativeDriver: true,
            }).start();
        }
    }, [visible, state]);

    // Countdown timer
    useEffect(() => {
        if (!visible || !state) return;

        const timer = setInterval(() => {
            const remaining = getRemainingAutoAckSeconds(state);
            setTimeLeft(remaining);

            if (remaining <= 0) {
                clearInterval(timer);
                // The service handles the actual auto-ack logic, 
                // but we can ensure the UI reflects 0
                return 0;
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [visible, state]);

    if (!state || !type) return null;

    const progress = Math.max(0, timeLeft / 30);
    const progressColor = timeLeft <= 10 ? '#F44336' : timeLeft <= 20 ? '#FF9800' : mainColor;

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    transform: [{ translateY: slideAnim }],
                },
            ]}
            pointerEvents={visible ? 'auto' : 'none'}
        >
            <Animated.View style={{ transform: [{ scale: timeLeft <= 10 ? pulseAnim : 1 }] }}>
                <Surface style={[styles.card, { borderLeftColor: mainColor, borderLeftWidth: 6 }]} elevation={5}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <MaterialCommunityIcons
                                name={iconName}
                                size={32}
                                color={mainColor}
                            />
                            <View style={styles.headerText}>
                                <Text variant="titleMedium" style={styles.title}>
                                    {isOutgoing ? 'Delivery Reassignment' : 'New Assignment'}
                                </Text>
                                <Text variant="bodySmall" style={{ color: timeLeft <= 10 ? '#F44336' : '#666' }}>
                                    Auto-acknowledge in {formatRemainingTime(timeLeft)}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Content */}
                    <View style={styles.content}>
                        <Text variant="bodyMedium" style={styles.message}>
                            {getReassignmentAlertMessage(state, type)}
                        </Text>
                    </View>

                    {/* Timer Progress Bar */}
                    <View style={styles.timerContainer}>
                        <ProgressBar progress={progress} color={progressColor} style={styles.progressBar} />
                    </View>

                    {/* Actions */}
                    <View style={styles.actions}>
                        <Button
                            mode="contained"
                            onPress={onAcknowledge}
                            style={[styles.button, { backgroundColor: mainColor }]}
                            icon="check-circle-outline"
                        >
                            Acknowledge
                        </Button>
                    </View>
                </Surface>
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2000, // Higher than other modals if needed
        padding: 16,
        paddingTop: 60, // Account for status bar
    },
    card: {
        borderRadius: 12,
        backgroundColor: '#fff',
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        paddingBottom: 8,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerText: {
        marginLeft: 12,
    },
    title: {
        fontWeight: 'bold',
    },
    content: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    message: {
        color: '#333',
        lineHeight: 20,
    },
    timerContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    progressBar: {
        height: 6,
        borderRadius: 3,
    },
    actions: {
        padding: 16,
        paddingTop: 0,
    },
    button: {
        borderRadius: 8,
    },
});
