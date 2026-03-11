/**
 * NotificationListScreen – Full-screen list of in-app notifications.
 *
 * Features:
 * - Pull-to-refresh
 * - Mark individual / all as read
 * - Clear individual / all notifications
 * - Relative timestamps
 */

import React, { useCallback, useState } from 'react';
import {
    View,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    RefreshControl,
    StatusBar,
    Alert,
} from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { PremiumAlert } from '../../services/PremiumAlertService';
import useAuthStore from '../../store/authStore';
import { useAppTheme } from '../../context/ThemeContext';
import {
    AppNotification,
    fetchNotifications,
    markNotificationsRead,
    clearNotifications,
} from '../../services/notificationService';

dayjs.extend(relativeTime);

// ── Icon mapping ───────────────────────────────────────────────────────────────

function notificationIcon(type: string): string {
    switch (type) {
        case 'DELIVERY_STATUS': return 'truck-delivery';
        case 'ORDER_ACCEPTED': return 'check-circle-outline';
        case 'ORDER_CANCELLED': return 'close-circle-outline';
        case 'TAMPER_ALERT': return 'alert-decagram';
        case 'SYSTEM': return 'information-outline';
        default: return 'bell-outline';
    }
}

function notificationColor(type: string, colors: { green: string; red: string; orange: string; accent: string }): string {
    switch (type) {
        case 'ORDER_ACCEPTED': return colors.green;
        case 'ORDER_CANCELLED': return colors.red;
        case 'TAMPER_ALERT': return colors.red;
        default: return colors.accent;
    }
}

// ── Colors ─────────────────────────────────────────────────────────────────────

const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    accent: '#000000', text: '#000000', textSec: '#6B6B6B', textTer: '#999999',
    red: '#FF3B30', green: '#34C759', orange: '#FF9500', unreadDot: '#007AFF',
    statusBar: 'dark-content' as const,
};

const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    accent: '#FFFFFF', text: '#FFFFFF', textSec: '#8E8E93', textTer: '#48484A',
    red: '#FF453A', green: '#30D158', orange: '#FF9F0A', unreadDot: '#0A84FF',
    statusBar: 'light-content' as const,
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function NotificationListScreen() {
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;

    const userId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);

    // ── Fetch ──────────────────────────────────────────────────────────────────

    const loadNotifications = useCallback(async () => {
        if (!userId) return;
        try {
            const data = await fetchNotifications(userId, 50);
            setNotifications(data.notifications);
        } catch (error) {
            console.warn('[NotificationList] load error:', error);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useFocusEffect(
        useCallback(() => {
            loadNotifications();
        }, [loadNotifications]),
    );

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadNotifications();
        setRefreshing(false);
    }, [loadNotifications]);

    // ── Actions ────────────────────────────────────────────────────────────────

    const handleMarkRead = useCallback(async (notifId: string) => {
        try {
            await markNotificationsRead({ notificationId: notifId });
            setNotifications((prev) =>
                prev.map((n) => (n.id === notifId ? { ...n, read: true } : n)),
            );
        } catch (error) {
            console.warn('[NotificationList] markRead error:', error);
        }
    }, []);

    const handleMarkAllRead = useCallback(async () => {
        if (!userId) return;
        try {
            await markNotificationsRead({ userId, all: true });
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        } catch (error) {
            console.warn('[NotificationList] markAllRead error:', error);
        }
    }, [userId]);

    const handleClear = useCallback(async (notifId: string) => {
        // Optimistic UI update
        const previousNotifications = [...notifications];
        setNotifications((prev) => prev.filter((n) => n.id !== notifId));

        try {
            await clearNotifications({ notificationId: notifId });
        } catch (error) {
            console.warn('[NotificationList] clear error:', error);
            // Revert UI on failure
            setNotifications(previousNotifications);
            PremiumAlert.alert('Error', 'Failed to clear notification. Please try again.');
        }
    }, [notifications]);

    const handleClearAll = useCallback(async () => {
        if (!userId) return;
        
        // Optimistic UI update
        const previousNotifications = [...notifications];
        setNotifications([]);

        try {
            await clearNotifications({ userId, all: true });
        } catch (error) {
            console.warn('[NotificationList] clearAll error:', error);
            // Revert UI on failure
            setNotifications(previousNotifications);
            PremiumAlert.alert('Error', 'Failed to clear all notifications. Please try again.');
        }
    }, [userId, notifications]);

    const handleOpenNotification = useCallback((item: AppNotification) => {
        if (!item.read) {
            handleMarkRead(item.id);
        }
        setTimeout(() => {
            const iconName = notificationIcon(item.type);
            const iconColor = notificationColor(item.type, c);
            
            PremiumAlert.alert(
                item.title,
                item.message,
                [{ text: 'Close', style: 'cancel' }],
                undefined,
                iconName,
                iconColor
            );
        }, 100);
    }, [handleMarkRead, c]);

    // ── Render Item ────────────────────────────────────────────────────────────

    const renderItem = ({ item }: { item: AppNotification }) => {
        const iconName = notificationIcon(item.type);
        const iconColor = notificationColor(item.type, c);

        return (
            <View
                style={[
                    styles.item,
                    { backgroundColor: item.read ? c.bg : (isDarkMode ? '#0A0A14' : '#F0F4FF'), borderBottomColor: c.border },
                ]}
            >
                <TouchableOpacity
                    onPress={() => handleOpenNotification(item)}
                    activeOpacity={0.7}
                    style={styles.itemTouchableArea}
                >
                    {/* Icon */}
                    <View style={[styles.iconCircle, { backgroundColor: iconColor + '1A' }]}>
                        <MaterialCommunityIcons name={iconName as any} size={20} color={iconColor} />
                    </View>

                    {/* Content */}
                    <View style={styles.itemContent}>
                        <View style={styles.itemHeader}>
                            <Text style={[styles.itemTitle, { color: c.text }]} numberOfLines={1}>
                                {item.title}
                            </Text>
                            {!item.read && <View style={[styles.unreadDot, { backgroundColor: c.unreadDot }]} />}
                        </View>
                        <Text style={[styles.itemMessage, { color: c.textSec }]} numberOfLines={2}>
                            {item.message}
                        </Text>
                        <Text style={[styles.itemTime, { color: c.textTer }]}>
                            {dayjs(item.createdAt).fromNow()}
                        </Text>
                    </View>
                </TouchableOpacity>

                {/* Clear button */}
                <TouchableOpacity
                    onPress={() => handleClear(item.id)}
                    hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                    style={styles.clearBtn}
                >
                    <MaterialCommunityIcons name="close" size={20} color={c.textTer} />
                </TouchableOpacity>
            </View>
        );
    };

    // ── Empty state ────────────────────────────────────────────────────────────

    const EmptyState = () => (
        <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="bell-off-outline" size={64} color={c.textTer} />
            <Text style={[styles.emptyTitle, { color: c.textSec }]}>No Notifications</Text>
            <Text style={[styles.emptySubtitle, { color: c.textTer }]}>
                You're all caught up!
            </Text>
        </View>
    );

    // ── Main ───────────────────────────────────────────────────────────────────

    const hasUnread = notifications.some((n) => !n.read);

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
            <StatusBar barStyle={c.statusBar} />

            {/* ── Top Bar ─────────────────────────────────────────────────── */}
            <View style={[styles.topBar, { borderBottomColor: c.border }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <MaterialCommunityIcons name="arrow-left" size={24} color={c.accent} />
                </TouchableOpacity>
                <Text style={[styles.topBarTitle, { color: c.accent }]}>Notifications</Text>
                <View style={styles.topBarActions}>
                    {hasUnread && (
                        <TouchableOpacity onPress={handleMarkAllRead} style={styles.actionBtn}>
                            <MaterialCommunityIcons name="email-open-outline" size={20} color={c.accent} />
                        </TouchableOpacity>
                    )}
                    {notifications.length > 0 && (
                        <TouchableOpacity onPress={handleClearAll} style={styles.actionBtn}>
                            <MaterialCommunityIcons name="trash-can-outline" size={20} color={c.red} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* ── List ────────────────────────────────────────────────────── */}
            <FlatList
                data={notifications}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                ListEmptyComponent={!loading ? EmptyState : null}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
                contentContainerStyle={notifications.length === 0 ? styles.emptyList : undefined}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    backBtn: { marginRight: 12 },
    topBarTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
    topBarActions: { flexDirection: 'row', gap: 8 },
    actionBtn: { padding: 6 },

    // ── List item ──
    item: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    itemTouchableArea: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    iconCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
        marginTop: 2,
    },
    itemContent: { flex: 1 },
    itemHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
    itemTitle: { fontSize: 14, fontWeight: '600', flex: 1 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 6 },
    itemMessage: { fontSize: 13, lineHeight: 18 },
    itemTime: { fontSize: 11, marginTop: 4 },
    clearBtn: { padding: 14, alignSelf: 'center' },

    // ── Empty ──
    emptyList: { flex: 1 },
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },
    emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
    emptySubtitle: { fontSize: 14, marginTop: 6 },
});
