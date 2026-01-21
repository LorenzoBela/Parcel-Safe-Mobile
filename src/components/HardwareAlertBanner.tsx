/**
 * Hardware Alert Banner Component
 * 
 * Shows hardware status alerts for EC-21, EC-22, EC-23, EC-25.
 * Used in rider and delivery screens.
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Animated,
} from 'react-native';
import { HardwareAlert } from '../services/hardwareStatusService';

interface HardwareAlertBannerProps {
    alert: HardwareAlert;
    onDismiss?: () => void;
    showAction?: boolean;
}

const severityColors = {
    info: {
        bg: '#dbeafe',
        border: '#3b82f6',
        text: '#1e40af',
        icon: 'ℹ️',
    },
    warning: {
        bg: '#fef3c7',
        border: '#f59e0b',
        text: '#92400e',
        icon: '⚠️',
    },
    error: {
        bg: '#fee2e2',
        border: '#ef4444',
        text: '#991b1b',
        icon: '❌',
    },
    critical: {
        bg: '#fecaca',
        border: '#dc2626',
        text: '#7f1d1d',
        icon: '🚨',
    },
};

export function HardwareAlertBanner({ 
    alert, 
    onDismiss,
    showAction = true,
}: HardwareAlertBannerProps) {
    const colors = severityColors[alert.severity];

    return (
        <View style={[styles.container, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <View style={styles.content}>
                <Text style={styles.icon}>{colors.icon}</Text>
                <View style={styles.textContainer}>
                    <Text style={[styles.title, { color: colors.text }]}>
                        {alert.title}
                    </Text>
                    <Text style={[styles.message, { color: colors.text }]}>
                        {alert.message}
                    </Text>
                    {showAction && alert.action && (
                        <Text style={[styles.action, { color: colors.text }]}>
                            {alert.action}
                        </Text>
                    )}
                </View>
                {onDismiss && alert.severity !== 'critical' && (
                    <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
                        <Text style={[styles.dismissText, { color: colors.text }]}>✕</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

/**
 * Multiple alerts container
 */
interface HardwareAlertListProps {
    alerts: HardwareAlert[];
    onDismiss?: (alertId: string) => void;
    showAction?: boolean;
}

export function HardwareAlertList({ alerts, onDismiss, showAction = true }: HardwareAlertListProps) {
    if (alerts.length === 0) return null;

    return (
        <View style={styles.listContainer}>
            {alerts.map((alert) => (
                <HardwareAlertBanner
                    key={alert.id}
                    alert={alert}
                    onDismiss={onDismiss ? () => onDismiss(alert.id) : undefined}
                    showAction={showAction}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        marginVertical: 6,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    icon: {
        fontSize: 20,
        marginRight: 10,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 4,
    },
    message: {
        fontSize: 13,
        opacity: 0.9,
        lineHeight: 18,
    },
    action: {
        fontSize: 13,
        fontWeight: '500',
        marginTop: 6,
    },
    dismissButton: {
        padding: 4,
        marginLeft: 8,
    },
    dismissText: {
        fontSize: 16,
        opacity: 0.6,
    },
    listContainer: {
        marginVertical: 8,
    },
});

export default HardwareAlertBanner;
