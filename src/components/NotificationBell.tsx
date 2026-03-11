/**
 * NotificationBell – reusable header icon for in-app notifications.
 *
 * Shows a bell icon with an unread badge counter. Tapping it navigates to
 * the NotificationList screen. The count refreshes every time the parent
 * screen comes into focus via `useFocusEffect`.
 */

import React, { useCallback, useState } from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Badge } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import useAuthStore from '../store/authStore';
import { fetchNotifications } from '../services/notificationService';

interface NotificationBellProps {
    /** Icon color, defaults to white — suitable for dark overlays / headers */
    color?: string;
    /** Icon size, defaults to 24 */
    size?: number;
}

export default function NotificationBell({ color = '#FFFFFF', size = 24 }: NotificationBellProps) {
    const navigation = useNavigation<any>();
    const userId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const [unreadCount, setUnreadCount] = useState(0);

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;

            async function load() {
                if (!userId) return;
                try {
                    const data = await fetchNotifications(userId, 1);
                    if (!cancelled) setUnreadCount(data.unreadCount);
                } catch (error) {
                    console.warn('[NotificationBell] Failed to fetch unread count:', error);
                }
            }

            load();
            return () => { cancelled = true; };
        }, [userId]),
    );

    return (
        <TouchableOpacity
            onPress={() => navigation.navigate('NotificationList')}
            style={styles.container}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Notifications"
            accessibilityRole="button"
        >
            <MaterialCommunityIcons name="bell-outline" size={size} color={color} />
            {unreadCount > 0 && (
                <Badge size={16} style={styles.badge}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        marginLeft: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -6,
        backgroundColor: '#FF3B30',
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '700',
    },
});
