/**
 * Hardware Status Badge Component
 * 
 * Compact badge showing overall hardware health.
 * Used in headers, list items, and cards.
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { 
    OverallHealthStatus,
    getStatusColor,
    getStatusIcon,
    getStatusText,
} from '../services/hardwareStatusService';

interface HardwareStatusBadgeProps {
    status: OverallHealthStatus;
    size?: 'small' | 'medium' | 'large';
    showText?: boolean;
    onPress?: () => void;
    loading?: boolean;
}

export function HardwareStatusBadge({
    status,
    size = 'medium',
    showText = true,
    onPress,
    loading = false,
}: HardwareStatusBadgeProps) {
    const color = getStatusColor(status);
    const icon = getStatusIcon(status);
    const text = getStatusText(status);

    const sizeStyles = {
        small: { 
            container: styles.containerSmall,
            icon: styles.iconSmall,
            text: styles.textSmall,
        },
        medium: {
            container: styles.containerMedium,
            icon: styles.iconMedium,
            text: styles.textMedium,
        },
        large: {
            container: styles.containerLarge,
            icon: styles.iconLarge,
            text: styles.textLarge,
        },
    };

    const currentSize = sizeStyles[size];

    const content = (
        <View style={[
            styles.container, 
            currentSize.container,
            { backgroundColor: `${color}20`, borderColor: color }
        ]}>
            {loading ? (
                <ActivityIndicator size="small" color={color} />
            ) : (
                <>
                    <Text style={currentSize.icon}>{icon}</Text>
                    {showText && (
                        <Text style={[currentSize.text, { color }]}>
                            {size === 'small' ? status.replace('_', ' ') : text}
                        </Text>
                    )}
                </>
            )}
        </View>
    );

    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
                {content}
            </TouchableOpacity>
        );
    }

    return content;
}

/**
 * Dot indicator for minimal display
 */
interface StatusDotProps {
    status: OverallHealthStatus;
    size?: number;
    pulse?: boolean;
}

export function StatusDot({ status, size = 10, pulse = false }: StatusDotProps) {
    const color = getStatusColor(status);

    return (
        <View style={[
            styles.dot,
            { 
                width: size, 
                height: size, 
                borderRadius: size / 2,
                backgroundColor: color,
            },
            pulse && status !== 'HEALTHY' && styles.pulse,
        ]} />
    );
}

/**
 * Status indicator for list items
 */
interface StatusIndicatorProps {
    status: OverallHealthStatus;
    label?: string;
}

export function StatusIndicator({ status, label }: StatusIndicatorProps) {
    const color = getStatusColor(status);
    const icon = getStatusIcon(status);

    return (
        <View style={styles.indicatorContainer}>
            <StatusDot status={status} size={8} />
            <Text style={[styles.indicatorIcon]}>{icon}</Text>
            {label && (
                <Text style={[styles.indicatorLabel, { color }]}>
                    {label}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 20,
        borderWidth: 1,
    },
    containerSmall: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    containerMedium: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    containerLarge: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    iconSmall: {
        fontSize: 12,
        marginRight: 4,
    },
    iconMedium: {
        fontSize: 16,
        marginRight: 6,
    },
    iconLarge: {
        fontSize: 20,
        marginRight: 8,
    },
    textSmall: {
        fontSize: 11,
        fontWeight: '500',
    },
    textMedium: {
        fontSize: 13,
        fontWeight: '600',
    },
    textLarge: {
        fontSize: 15,
        fontWeight: '600',
    },
    dot: {
        // Base styles set dynamically
    },
    pulse: {
        // Animation would need Animated API
        opacity: 0.8,
    },
    indicatorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    indicatorIcon: {
        fontSize: 12,
    },
    indicatorLabel: {
        fontSize: 12,
        fontWeight: '500',
    },
});

export default HardwareStatusBadge;
