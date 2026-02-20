/**
 * NetworkStatusBanner
 *
 * Shared connectivity status banner for all dashboards.
 * Self-manages a NetInfo subscription and renders an offline banner
 * when the device loses network connectivity.
 *
 * Usage:
 *   <NetworkStatusBanner />                       // basic (Customer / Admin)
 *   <NetworkStatusBanner pendingSyncs={count} />   // with sync badge (Rider)
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Conditionally import NetInfo to prevent startup crashes on some devices
let NetInfo: any = null;
try {
    NetInfo = require('@react-native-community/netinfo').default;
} catch {
    if (__DEV__) console.log('[NetworkStatusBanner] NetInfo not available');
}

interface NetworkStatusBannerProps {
    /** Number of pending sync actions (shown as badge). Rider-specific. */
    pendingSyncs?: number;
}

export default function NetworkStatusBanner({ pendingSyncs = 0 }: NetworkStatusBannerProps) {
    const [isOffline, setIsOffline] = useState(false);

    useEffect(() => {
        if (!NetInfo) return;

        const unsubscribe = NetInfo.addEventListener((state: any) => {
            setIsOffline(!state.isConnected);
        });

        return () => unsubscribe();
    }, []);

    if (!isOffline) return null;

    return (
        <Surface style={styles.banner} elevation={3}>
            <MaterialCommunityIcons name="wifi-off" size={24} color="white" />
            <View style={styles.textContainer}>
                <Text style={styles.title}>OFFLINE</Text>
                <Text style={styles.subtitle}>
                    {pendingSyncs > 0
                        ? `${pendingSyncs} action${pendingSyncs > 1 ? 's' : ''} pending sync`
                        : 'Connect to internet to sync data'}
                </Text>
            </View>
            {pendingSyncs > 0 && (
                <View style={styles.syncBadge}>
                    <Text style={styles.syncBadgeText}>{pendingSyncs}</Text>
                </View>
            )}
        </Surface>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#475569',
        marginBottom: 12,
        padding: 14,
        borderRadius: 12,
    },
    textContainer: {
        flex: 1,
        marginLeft: 12,
    },
    title: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    subtitle: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 12,
    },
    syncBadge: {
        backgroundColor: '#EF4444',
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    syncBadgeText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
});
