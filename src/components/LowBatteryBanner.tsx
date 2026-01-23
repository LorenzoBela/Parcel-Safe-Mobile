/**
 * EC-90: Low Battery Banner
 * 
 * Displays warning banner when box battery is low and solenoid actuation is blocked.
 * Shows voltage level and explains why unlock is unavailable.
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
} from 'react-native';
import { PowerStatus } from '../services/firebaseClient';

interface LowBatteryBannerProps {
    /** Current voltage level */
    voltage: number;
    /** Power status from Firebase */
    status: PowerStatus;
    /** Whether solenoid is blocked */
    solenoidBlocked: boolean;
    /** Optional custom style */
    style?: object;
}

export const LowBatteryBanner: React.FC<LowBatteryBannerProps> = ({
    voltage,
    status,
    solenoidBlocked,
    style,
}) => {
    // Only show banner for WARNING or worse
    if (status === 'HEALTHY') {
        return null;
    }

    const getBannerStyle = () => {
        switch (status) {
            case 'WARNING':
                return styles.warningBanner;
            case 'CRITICAL':
                return styles.criticalBanner;
            case 'DEAD':
                return styles.deadBanner;
            default:
                return styles.warningBanner;
        }
    };

    const getIcon = () => {
        switch (status) {
            case 'WARNING':
                return '🔋';
            case 'CRITICAL':
                return '⚠️';
            case 'DEAD':
                return '🪫';
            default:
                return '🔋';
        }
    };

    const getMessage = () => {
        if (status === 'DEAD') {
            return 'Battery critically low - Box offline';
        }

        if (solenoidBlocked) {
            return `Battery too low to unlock (${voltage.toFixed(1)}V) - Charge required`;
        }

        if (status === 'CRITICAL') {
            return `Critical battery level (${voltage.toFixed(1)}V)`;
        }

        return `Low battery warning (${voltage.toFixed(1)}V)`;
    };

    const getVoltageBar = () => {
        // Map voltage 10.5V-14V to 0-100%
        const minVoltage = 10.5;
        const maxVoltage = 14.0;
        const percentage = Math.max(0, Math.min(100,
            ((voltage - minVoltage) / (maxVoltage - minVoltage)) * 100
        ));

        // Determine bar color based on status
        const barColor = status === 'WARNING' ? '#F59E0B' : '#EF4444';

        return (
            <View style={styles.voltageBarContainer}>
                <View
                    style={[
                        styles.voltageBarFill,
                        {
                            width: `${percentage}%`,
                            backgroundColor: barColor
                        }
                    ]}
                />
            </View>
        );
    };

    return (
        <View style={[styles.container, getBannerStyle(), style]}>
            <View style={styles.header}>
                <Text style={styles.icon}>{getIcon()}</Text>
                <Text style={styles.message}>{getMessage()}</Text>
            </View>

            {getVoltageBar()}

            {solenoidBlocked && (
                <View style={styles.blockedInfo}>
                    <Text style={styles.blockedIcon}>🔒</Text>
                    <Text style={styles.blockedText}>Unlock disabled until battery charged</Text>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 16,
        marginVertical: 8,
        borderRadius: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    warningBanner: {
        backgroundColor: '#FEF3C7', // Amber-100
        borderWidth: 1,
        borderColor: '#F59E0B', // Amber-500
    },
    criticalBanner: {
        backgroundColor: '#FEE2E2', // Red-100
        borderWidth: 1,
        borderColor: '#EF4444', // Red-500
    },
    deadBanner: {
        backgroundColor: '#FEE2E2',
        borderWidth: 2,
        borderColor: '#DC2626', // Red-600
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    icon: {
        fontSize: 20,
        marginRight: 8,
    },
    message: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1F2937',
        flex: 1,
    },
    voltageBarContainer: {
        height: 6,
        backgroundColor: '#E5E7EB',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 8,
    },
    voltageBarFill: {
        height: '100%',
        borderRadius: 3,
    },
    blockedInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        padding: 8,
        borderRadius: 4,
        marginTop: 4,
    },
    blockedIcon: {
        fontSize: 14,
        marginRight: 8,
    },
    blockedText: {
        fontSize: 12,
        color: '#6B7280',
        flex: 1,
    },
});

export default LowBatteryBanner;
