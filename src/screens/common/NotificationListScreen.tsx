/**
 * NotificationListScreen – Full-screen list of in-app notifications.
 *
 * Features:
 * - Pull-to-refresh
 * - Mark individual / all as read
 * - Clear individual / all notifications
 * - Relative timestamps
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    View,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    RefreshControl,
    StatusBar,
    ScrollView,
    PanResponder,
    Animated,
    Easing,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
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

type NotificationTab = 'ORDER_UPDATES' | 'ADS' | 'OTHER';

const TAB_LABELS: Record<NotificationTab, string> = {
    ORDER_UPDATES: 'Order Updates',
    ADS: 'Ads',
    OTHER: 'Other',
};

const TAB_ORDER: NotificationTab[] = ['ORDER_UPDATES', 'ADS', 'OTHER'];

const SWIPE_DRAG_MAX = 76;
const SWIPE_SWITCH_DISTANCE = 58;
const SWIPE_SWITCH_VELOCITY = 0.32;
const SWIPE_EXIT_OFFSET = 104;
const SWIPE_ENTER_OFFSET = 78;

type AllowedRole = 'admin' | 'customer' | 'rider';

const TYPE_ALLOWED_ROLES: Record<string, AllowedRole[]> = {
    ORDER_ACCEPTED: ['customer'],
    PARCEL_PICKED_UP: ['customer'],
    RIDER_EN_ROUTE: ['customer'],
    RIDER_ARRIVED: ['customer'],
    DELIVERY_COMPLETED: ['customer'],
    ORDER_CANCELLED_BY_CUSTOMER: ['rider', 'admin'],
    ORDER_CANCELLED_BY_RIDER: ['customer', 'admin'],
    DELIVERY_CANCELLED_REFUND_PROCESSING: ['customer', 'admin'],
    TAMPER_DETECTED: ['admin', 'customer', 'rider'],
    SECURITY_HOLD: ['admin', 'customer', 'rider'],
    DELIVERY_RESUMED_AFTER_REVIEW: ['admin', 'customer', 'rider'],
    RIDER_EVIDENCE_SUBMITTED: ['admin', 'rider'],
    ADMIN_REVIEW_REQUIRED: ['admin'],
    THEFT_REPORTED: ['admin'],
    BOX_OFFLINE: ['admin'],
    LOW_BATTERY: ['admin'],
    GEOFENCE_BREACH: ['admin'],
    PROMO: ['customer', 'rider', 'admin'],
    // Rider dispatch tray notifications (server-side types) — mirror the
    // server `TYPE_ALLOWED_ROLES` so a customer who briefly acted as a rider
    // doesn't see stale dispatch entries in their "Order Updates" feed.
    INCOMING_ORDER: ['rider', 'admin'],
    ORDER_REASSIGNED: ['rider', 'admin'],
    NEW_POOL_ORDER: ['rider', 'admin'],
};

function isNotificationVisibleForRole(notification: AppNotification, role?: string): boolean {
    if (!role) return true;
    const normalizedRole = role.toLowerCase();
    if (normalizedRole !== 'admin' && normalizedRole !== 'customer' && normalizedRole !== 'rider') {
        return false;
    }

    // Admins see everything regardless of type
    if (normalizedRole === 'admin') return true;

    const allowedRoles = TYPE_ALLOWED_ROLES[notification.type];
    if (!allowedRoles) return true;

    return allowedRoles.includes(normalizedRole as AllowedRole);
}

// ── Icon mapping ───────────────────────────────────────────────────────────────

function notificationIcon(type: string): string {
    switch (type) {
        case 'ORDER_ACCEPTED': return 'check-circle-outline';
        case 'PARCEL_PICKED_UP': return 'package-variant-closed';
        case 'RIDER_EN_ROUTE': return 'motorbike';
        case 'RIDER_ARRIVED': return 'map-marker-check-outline';
        case 'DELIVERY_COMPLETED': return 'check-decagram-outline';
        case 'ORDER_CANCELLED_BY_CUSTOMER': return 'close-circle-outline';
        case 'ORDER_CANCELLED_BY_RIDER': return 'close-circle-outline';
        case 'DELIVERY_CANCELLED_REFUND_PROCESSING': return 'cash-refund';
        case 'TAMPER_DETECTED': return 'alert-decagram';
        case 'THEFT_REPORTED': return 'shield-alert-outline';
        case 'GEOFENCE_BREACH': return 'map-marker-alert-outline';
        case 'SECURITY_HOLD': return 'shield-lock-outline';
        case 'DELIVERY_RESUMED_AFTER_REVIEW': return 'shield-check-outline';
        case 'LOW_BATTERY': return 'battery-alert-variant-outline';
        case 'BOX_OFFLINE': return 'wifi-off';
        case 'PROMO': return 'bullhorn-outline';
        case 'DELIVERY_STATUS': return 'truck-delivery';
        case 'SYSTEM': return 'information-outline';
        case 'INCOMING_ORDER': return 'rocket-launch-outline';
        case 'ORDER_REASSIGNED': return 'backup-restore';
        case 'NEW_POOL_ORDER': return 'package-variant';
        default: return 'bell-outline';
    }
}

function notificationColor(type: string, colors: { green: string; red: string; orange: string; accent: string }): string {
    switch (type) {
        case 'ORDER_ACCEPTED':
        case 'PARCEL_PICKED_UP':
        case 'RIDER_EN_ROUTE':
        case 'RIDER_ARRIVED':
        case 'DELIVERY_COMPLETED':
        case 'DELIVERY_RESUMED_AFTER_REVIEW':
        case 'INCOMING_ORDER':
        case 'ORDER_REASSIGNED':
        case 'NEW_POOL_ORDER':
            return colors.green;
        case 'ORDER_CANCELLED_BY_CUSTOMER':
        case 'ORDER_CANCELLED_BY_RIDER':
        case 'DELIVERY_CANCELLED_REFUND_PROCESSING':
        case 'TAMPER_DETECTED':
        case 'THEFT_REPORTED':
        case 'SECURITY_HOLD':
            return colors.red;
        case 'GEOFENCE_BREACH':
        case 'LOW_BATTERY':
        case 'BOX_OFFLINE':
            return colors.orange;
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
    const role = useAuthStore((state: any) => state.role || state.user?.role) as string | undefined;
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [activeTab, setActiveTab] = useState<NotificationTab>('ORDER_UPDATES');
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const listTranslateX = useRef(new Animated.Value(0)).current;
    const swipeAnimatingRef = useRef(false);

    const resetListPosition = useCallback(() => {
        Animated.spring(listTranslateX, {
            toValue: 0,
            speed: 30,
            bounciness: 0,
            useNativeDriver: true,
        }).start();
    }, [listTranslateX]);

    const switchTabByOffset = useCallback((offset: -1 | 1) => {
        if (swipeAnimatingRef.current) return;

        const currentIndex = TAB_ORDER.indexOf(activeTab);
        const nextIndex = Math.max(0, Math.min(TAB_ORDER.length - 1, currentIndex + offset));
        if (nextIndex === currentIndex) {
            resetListPosition();
            return;
        }

        swipeAnimatingRef.current = true;
        const exitTarget = offset === 1 ? -SWIPE_EXIT_OFFSET : SWIPE_EXIT_OFFSET;
        const enterStart = offset === 1 ? SWIPE_ENTER_OFFSET : -SWIPE_ENTER_OFFSET;

        Haptics.selectionAsync().catch(() => { });

        Animated.timing(listTranslateX, {
            toValue: exitTarget,
            duration: 140,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start(() => {
            setActiveTab(TAB_ORDER[nextIndex]);
            listTranslateX.setValue(enterStart);

            Animated.timing(listTranslateX, {
                toValue: 0,
                duration: 200,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start(() => {
                swipeAnimatingRef.current = false;
            });
        });
    }, [activeTab, listTranslateX, resetListPosition]);

    const listOpacity = useMemo(
        () => listTranslateX.interpolate({
            inputRange: [-SWIPE_EXIT_OFFSET, 0, SWIPE_EXIT_OFFSET],
            outputRange: [0.84, 1, 0.84],
            extrapolate: 'clamp',
        }),
        [listTranslateX],
    );

    const listScale = useMemo(
        () => listTranslateX.interpolate({
            inputRange: [-SWIPE_EXIT_OFFSET, 0, SWIPE_EXIT_OFFSET],
            outputRange: [0.985, 1, 0.985],
            extrapolate: 'clamp',
        }),
        [listTranslateX],
    );

    const tabSwipeResponder = useMemo(
        () => PanResponder.create({
            onMoveShouldSetPanResponder: (_, gestureState) => {
                if (swipeAnimatingRef.current) return false;
                const horizontalDistance = Math.abs(gestureState.dx);
                const verticalDistance = Math.abs(gestureState.dy);
                return horizontalDistance > 18 && horizontalDistance > verticalDistance + 8;
            },
            onPanResponderMove: (_, gestureState) => {
                if (swipeAnimatingRef.current) return;

                const activeIndex = TAB_ORDER.indexOf(activeTab);
                const swipingBeyondBounds =
                    (activeIndex === 0 && gestureState.dx > 0)
                    || (activeIndex === TAB_ORDER.length - 1 && gestureState.dx < 0);

                const resistance = swipingBeyondBounds ? 0.35 : 1;
                const translated = Math.max(
                    -SWIPE_DRAG_MAX,
                    Math.min(SWIPE_DRAG_MAX, gestureState.dx * resistance),
                );
                listTranslateX.setValue(translated);
            },
            onPanResponderRelease: (_, gestureState) => {
                if (swipeAnimatingRef.current) return;

                const absDx = Math.abs(gestureState.dx);
                const absVx = Math.abs(gestureState.vx);
                const isSwipe = absDx > SWIPE_SWITCH_DISTANCE || (absDx > 28 && absVx > SWIPE_SWITCH_VELOCITY);

                if (!isSwipe) {
                    resetListPosition();
                    return;
                }

                if (gestureState.dx < 0) {
                    switchTabByOffset(1);
                } else if (gestureState.dx > 0) {
                    switchTabByOffset(-1);
                } else {
                    resetListPosition();
                }
            },
            onPanResponderTerminate: () => {
                resetListPosition();
            },
        }),
        [activeTab, listTranslateX, resetListPosition, switchTabByOffset],
    );

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

    const roleFilteredNotifications = useMemo(
        () => notifications.filter((notification) => isNotificationVisibleForRole(notification, role)),
        [notifications, role],
    );

    const tabNotifications = useMemo(
        () => roleFilteredNotifications.filter((notification) => notification.category === activeTab),
        [roleFilteredNotifications, activeTab],
    );

    const tabCounts = useMemo(() => {
        return roleFilteredNotifications.reduce<Record<NotificationTab, number>>((acc, notification) => {
            const category = notification.category as NotificationTab;
            if (category in acc) {
                acc[category] += 1;
            }
            return acc;
        }, {
            ORDER_UPDATES: 0,
            ADS: 0,
            OTHER: 0,
        });
    }, [roleFilteredNotifications]);

    // ── Actions ────────────────────────────────────────────────────────────────

    const handleMarkRead = useCallback(async (notifId: string) => {
        const target = notifications.find((notification) => notification.id === notifId);
        if (!target || target.read) return;

        // Optimistic update so unread UI clears immediately when opening/closing alert.
        setNotifications((prev) => prev.map((n) => (n.id === notifId ? { ...n, read: true } : n)));

        try {
            await markNotificationsRead({ notificationId: notifId });
        } catch (error) {
            console.warn('[NotificationList] markRead error:', error);
            // Revert on failure.
            setNotifications((prev) => prev.map((n) => (n.id === notifId ? { ...n, read: false } : n)));
        }
    }, [notifications]);

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
            <Text style={[styles.emptyTitle, { color: c.textSec }]}>No {TAB_LABELS[activeTab]}</Text>
            <Text style={[styles.emptySubtitle, { color: c.textTer }]}>
                You are all caught up!
            </Text>
        </View>
    );

    // ── Main ───────────────────────────────────────────────────────────────────

    const hasUnread = tabNotifications.some((n) => !n.read);

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

            <View style={[styles.tabsOuter, { borderBottomColor: c.border }]}>
                <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabsContainer}
                >
                    {(Object.keys(TAB_LABELS) as NotificationTab[]).map((tab) => {
                        const selected = activeTab === tab;
                        return (
                            <TouchableOpacity
                                key={tab}
                                onPress={() => setActiveTab(tab)}
                                activeOpacity={0.7}
                                style={[
                                    styles.tabButton,
                                    selected && { borderBottomColor: c.text }
                                ]}
                            >
                                <View style={styles.tabInner}>
                                    <Text style={[
                                        styles.tabLabel, 
                                        { color: selected ? c.text : c.textSec },
                                        selected && { fontFamily: 'Inter_700Bold' }
                                    ]}>
                                        {TAB_LABELS[tab]}
                                    </Text>
                                    {tabCounts[tab] > 0 && (
                                        <View style={[
                                            styles.tabCountPill, 
                                            { backgroundColor: selected ? c.text : c.card }
                                        ]}> 
                                            <Text style={[
                                                styles.tabCountText, 
                                                { color: selected ? c.bg : c.textSec }
                                            ]}>
                                                {tabCounts[tab]}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            <View style={styles.swipeHintWrap}>
                <View style={[styles.swipeHintPill, { backgroundColor: c.card, borderColor: c.border }]}> 
                    <MaterialCommunityIcons name="gesture-swipe-horizontal" size={14} color={c.textTer} />
                    <Text style={[styles.swipeHintText, { color: c.textTer }]}>Swipe left or right to switch tabs</Text>
                </View>
            </View>

            {/* ── List ────────────────────────────────────────────────────── */}
            <View style={styles.listGestureArea} {...tabSwipeResponder.panHandlers}>
                <Animated.View style={[styles.listAnimatedLayer, { opacity: listOpacity, transform: [{ translateX: listTranslateX }, { scale: listScale }] }]}> 
                    <FlatList
                        data={tabNotifications}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        ListEmptyComponent={!loading ? EmptyState : null}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                        }
                        contentContainerStyle={tabNotifications.length === 0 ? styles.emptyList : undefined}
                        showsVerticalScrollIndicator={false}
                    />
                </Animated.View>
            </View>
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
    topBarTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', flex: 1 },
    topBarActions: { flexDirection: 'row', gap: 8 },
    actionBtn: { padding: 6 },
    tabsOuter: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tabsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        gap: 24,
    },
    tabButton: {
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tabLabel: {
        fontSize: 14,
        fontFamily: 'Inter_500Medium',
        letterSpacing: 0.1,
    },
    tabCountPill: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabCountText: {
        fontSize: 11,
        fontFamily: 'Inter_700Bold',
    },

    swipeHintWrap: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 4,
    },
    swipeHintPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        gap: 6,
    },
    swipeHintText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },

    listGestureArea: {
        flex: 1,
    },
    listAnimatedLayer: {
        flex: 1,
    },

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
        paddingVertical: 18,
    },
    iconCircle: {
        width: 42,
        height: 42,
        borderRadius: 21,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
        marginTop: 0,
    },
    itemContent: { flex: 1 },
    itemHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    itemTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', flex: 1 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
    itemMessage: { fontSize: 14, lineHeight: 20 },
    itemTime: { fontSize: 12, marginTop: 6 },
    clearBtn: { padding: 16, alignSelf: 'center' },

    // ── Empty ──
    emptyList: { flex: 1 },
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },
    emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', marginTop: 16 },
    emptySubtitle: { fontSize: 14, marginTop: 6 },
});
