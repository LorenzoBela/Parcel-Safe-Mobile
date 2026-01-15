/**
 * CustomerHardwareBanner Component
 * 
 * EC-86: Gentle info banner for display failure notifications.
 * Shows helpful suggestions to customers when keypad display isn't working.
 * 
 * Design Philosophy:
 * - Blue info theme (not red/yellow warnings)
 * - Friendly, helpful language
 * - Optional dismissibility
 * - Lightbulb icon for "helpful tip" aesthetic
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface CustomerHardwareBannerProps {
    displayStatus: 'OK' | 'DEGRADED' | 'FAILED';
    onDismiss?: () => void;
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface BannerConfig {
    icon: IconName;
    title: string;
    message: string;
    backgroundColor: string;
    borderColor: string;
    textColor: string;
}

export default function CustomerHardwareBanner({ displayStatus, onDismiss }: CustomerHardwareBannerProps) {
    // Only show for non-OK statuses
    if (displayStatus === 'OK') {
        return null;
    }

    const config: BannerConfig = displayStatus === 'FAILED' ? {
        icon: 'lightbulb-on',
        title: 'Use Your Phone to Unlock',
        message: 'The keypad display isn\'t available right now. No problem - unlock directly from this app!',
        backgroundColor: '#E3F2FD',
        borderColor: '#1976D2',
        textColor: '#0D47A1',
    } : {
        icon: 'information',
        title: 'Display May Be Hard to Read',
        message: 'The box screen is working but may have some display issues. Listen for beeps when entering your code.',
        backgroundColor: '#FFF9C4',
        borderColor: '#F57C00',
        textColor: '#E65100',
    };

    return (
        <Surface style={[styles.banner, { backgroundColor: config.backgroundColor, borderLeftColor: config.borderColor }]} elevation={2}>
            <View style={styles.content}>
                <MaterialCommunityIcons name={config.icon} size={24} color={config.borderColor} style={styles.icon} />
                <View style={styles.textContainer}>
                    <Text style={[styles.title, { color: config.textColor }]}>{config.title}</Text>
                    <Text style={[styles.message, { color: config.textColor }]}>{config.message}</Text>
                </View>
            </View>
        </Surface>
    );
}

const styles = StyleSheet.create({
    banner: {
        borderLeftWidth: 4,
        borderRadius: 8,
        marginBottom: 16,
        overflow: 'hidden',
    },
    content: {
        flexDirection: 'row',
        padding: 16,
        alignItems: 'flex-start',
    },
    icon: {
        marginRight: 12,
        marginTop: 2,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    message: {
        fontSize: 14,
        lineHeight: 20,
        opacity: 0.9,
    },
});
