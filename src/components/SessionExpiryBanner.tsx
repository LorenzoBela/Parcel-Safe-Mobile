/**
 * EC-89: Session Expiry Banner
 * 
 * Displays warning banner when Firebase auth token is expiring or has failed.
 * Shows countdown timer and re-login button when necessary.
 */

import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Animated,
} from 'react-native';
import {
    TokenStatus,
    getTokenStatus,
    formatTimeUntilExpiry,
    forceTokenRefresh,
} from '../services/tokenRefreshService';

interface SessionExpiryBannerProps {
    /** Current token status from tokenRefreshService */
    status: TokenStatus;
    /** Callback when user needs to re-login */
    onReloginRequired?: () => void;
    /** Optional custom style */
    style?: object;
}

export const SessionExpiryBanner: React.FC<SessionExpiryBannerProps> = ({
    status,
    onReloginRequired,
    style,
}) => {
    const [timeRemaining, setTimeRemaining] = useState(formatTimeUntilExpiry());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const slideAnim = useState(new Animated.Value(-100))[0];

    // Update countdown every second when expiring
    useEffect(() => {
        if (status === 'EXPIRING' || status === 'EXPIRED') {
            const interval = setInterval(() => {
                setTimeRemaining(formatTimeUntilExpiry());
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [status]);

    // Animate banner in/out
    useEffect(() => {
        if (status === 'HEALTHY') {
            Animated.timing(slideAnim, {
                toValue: -100,
                duration: 300,
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start();
        }
    }, [status, slideAnim]);

    // Don't render anything if healthy
    if (status === 'HEALTHY') {
        return null;
    }

    const handleRefresh = async () => {
        setIsRefreshing(true);
        await forceTokenRefresh();
        setIsRefreshing(false);
    };

    const handleRelogin = () => {
        onReloginRequired?.();
    };

    const getBannerStyle = () => {
        switch (status) {
            case 'EXPIRING':
                return styles.warningBanner;
            case 'REFRESHING':
                return styles.infoBanner;
            case 'EXPIRED':
            case 'FAILED':
                return styles.errorBanner;
            default:
                return styles.warningBanner;
        }
    };

    const getStatusMessage = () => {
        switch (status) {
            case 'EXPIRING':
                return `Session expiring in ${timeRemaining}`;
            case 'REFRESHING':
                return 'Refreshing session...';
            case 'EXPIRED':
                return 'Session expired';
            case 'FAILED':
                return 'Session refresh failed';
            default:
                return 'Session issue detected';
        }
    };

    const getIcon = () => {
        switch (status) {
            case 'EXPIRING':
                return '⏱️';
            case 'REFRESHING':
                return '🔄';
            case 'EXPIRED':
            case 'FAILED':
                return '⚠️';
            default:
                return '⚠️';
        }
    };

    return (
        <Animated.View
            style={[
                styles.container,
                getBannerStyle(),
                { transform: [{ translateY: slideAnim }] },
                style,
            ]}
        >
            <View style={styles.content}>
                <Text style={styles.icon}>{getIcon()}</Text>
                <Text style={styles.message}>{getStatusMessage()}</Text>

                {status === 'REFRESHING' && (
                    <ActivityIndicator size="small" color="#FFFFFF" style={styles.spinner} />
                )}
            </View>

            <View style={styles.actions}>
                {status === 'EXPIRING' && !isRefreshing && (
                    <TouchableOpacity
                        style={styles.refreshButton}
                        onPress={handleRefresh}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.buttonText}>Refresh Now</Text>
                    </TouchableOpacity>
                )}

                {(status === 'EXPIRED' || status === 'FAILED') && (
                    <TouchableOpacity
                        style={styles.reloginButton}
                        onPress={handleRelogin}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.buttonText}>Sign In Again</Text>
                    </TouchableOpacity>
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    warningBanner: {
        backgroundColor: '#F59E0B', // Amber
    },
    infoBanner: {
        backgroundColor: '#3B82F6', // Blue
    },
    errorBanner: {
        backgroundColor: '#EF4444', // Red
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    icon: {
        fontSize: 18,
        marginRight: 8,
    },
    message: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
    },
    spinner: {
        marginLeft: 8,
    },
    actions: {
        flexDirection: 'row',
        marginLeft: 8,
    },
    refreshButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    reloginButton: {
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 4,
    },
    buttonText: {
        color: '#1F2937',
        fontSize: 12,
        fontWeight: '600',
    },
});

export default SessionExpiryBanner;
