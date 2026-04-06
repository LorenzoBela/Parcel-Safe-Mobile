import React, { useCallback } from 'react';
import { BackHandler, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, useTheme } from 'react-native-paper';

type MoreItem = {
    key: string;
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    onPress: () => void;
};

function MoreRow({ item, dark }: { item: MoreItem; dark: boolean }) {
    return (
        <TouchableOpacity style={[styles.row, { borderBottomColor: dark ? '#2C2C2E' : '#E5E5EA' }]} onPress={item.onPress}>
            <View style={[styles.iconWrap, { backgroundColor: dark ? '#1C1C1E' : '#F2F2F7' }]}>
                <MaterialCommunityIcons name={item.icon} size={20} color={dark ? '#FFFFFF' : '#000000'} />
            </View>
            <View style={styles.copyWrap}>
                <Text style={[styles.rowTitle, { color: dark ? '#FFFFFF' : '#000000' }]}>{item.title}</Text>
                <Text style={[styles.rowSubtitle, { color: dark ? '#8E8E93' : '#6B6B6B' }]}>{item.subtitle}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={dark ? '#8E8E93' : '#8E8E93'} />
        </TouchableOpacity>
    );
}

export default function AdminMoreScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const dark = theme.dark;
    const [refreshing, setRefreshing] = React.useState(false);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setRefreshing(false);
    }, []);

    useFocusEffect(
        useCallback(() => {
            const onHardwareBackPress = () => {
                const parent = navigation.getParent();
                if (parent) {
                    parent.navigate('AdminDashboardTab');
                    return true;
                }
                return false;
            };

            const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);
            return () => subscription.remove();
        }, [navigation])
    );

    const accountItems: MoreItem[] = [
        {
            key: 'profile',
            title: 'Profile',
            subtitle: 'View and edit admin profile details',
            icon: 'account-circle-outline',
            onPress: () => navigation.navigate('MoreProfile'),
        },
        {
            key: 'shared-settings',
            title: 'App Settings',
            subtitle: 'Shared settings page used across the app',
            icon: 'tune-variant',
            onPress: () => navigation.navigate('MoreCommonSettings'),
        },
        {
            key: 'admin-settings',
            title: 'Admin Settings',
            subtitle: 'Thresholds and admin-only controls',
            icon: 'cog-outline',
            onPress: () => navigation.navigate('MoreSettings'),
        },
        {
            key: 'users',
            title: 'Users & Roles',
            subtitle: 'Manage users and role assignments',
            icon: 'account-group-outline',
            onPress: () => navigation.navigate('MoreUsers'),
        },
    ];

    const modules: MoreItem[] = [
        {
            key: 'records',
            title: 'Records',
            subtitle: 'Delivery records and activity logs',
            icon: 'file-document-outline',
            onPress: () => navigation.navigate('AdminOperationsTab', { screen: 'OpsRecords' }),
        },
        {
            key: 'map',
            title: 'Global Map',
            subtitle: 'Live map and fleet locations',
            icon: 'map-marker-radius',
            onPress: () => navigation.navigate('AdminOperationsTab', { screen: 'OpsGlobalMap' }),
        },
        {
            key: 'edge',
            title: 'Edge Cases',
            subtitle: 'Handle waiting and reassignment edge cases',
            icon: 'timer-alert-outline',
            onPress: () => navigation.navigate('AdminOperationsTab', { screen: 'OpsEdgeCases' }),
        },
        {
            key: 'alerts',
            title: 'Tamper Alerts',
            subtitle: 'Monitor and respond to tamper events',
            icon: 'alert-octagon-outline',
            onPress: () => navigation.navigate('AdminSecurityTab', { screen: 'SecurityAlerts' }),
        },
        {
            key: 'stolen',
            title: 'Stolen Boxes',
            subtitle: 'Track stolen box incidents and lockdown state',
            icon: 'shield-alert-outline',
            onPress: () => navigation.navigate('AdminSecurityTab', { screen: 'SecurityStolenBoxes' }),
        },
        {
            key: 'audit',
            title: 'Photo Audit',
            subtitle: 'Review proof and audit trail photos',
            icon: 'camera-metering-matrix',
            onPress: () => navigation.navigate('AdminSecurityTab', { screen: 'SecurityPhotoAudit' }),
        },
        {
            key: 'receipts',
            title: 'Receipts',
            subtitle: 'Review completed jobs and send receipts',
            icon: 'receipt-text-outline',
            onPress: () => navigation.navigate('AdminInsightsTab', { screen: 'InsightsReceipts' }),
        },
        {
            key: 'diag',
            title: 'Hardware Diagnostics',
            subtitle: 'Live hardware telemetry and health checks',
            icon: 'tools',
            onPress: () => navigation.navigate('AdminInsightsTab', { screen: 'InsightsHardwareDiagnostics' }),
        },
        {
            key: 'history',
            title: 'Tracking History',
            subtitle: 'View historical tracking sessions',
            icon: 'chart-timeline-variant',
            onPress: () => navigation.navigate('AdminInsightsTab', { screen: 'InsightsTrackingHistory' }),
        },
    ];

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: dark ? '#000000' : '#FFFFFF' }]}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={dark ? '#FFFFFF' : '#000000'} />}
        >
            <Text style={[styles.header, { color: dark ? '#FFFFFF' : '#000000' }]}>More</Text>
            <Text style={[styles.subheader, { color: dark ? '#8E8E93' : '#6B6B6B' }]}>Quick access to account, settings, and all admin modules.</Text>

            <Text style={[styles.sectionTitle, { color: dark ? '#8E8E93' : '#6B6B6B' }]}>Account</Text>
            <View style={[styles.card, { backgroundColor: dark ? '#141414' : '#F6F6F6' }]}>
                {accountItems.map((item) => (
                    <MoreRow key={item.key} item={item} dark={dark} />
                ))}
            </View>

            <Text style={[styles.sectionTitle, { color: dark ? '#8E8E93' : '#6B6B6B' }]}>Admin Modules</Text>
            <View style={[styles.card, { backgroundColor: dark ? '#141414' : '#F6F6F6' }]}>
                {modules.map((item) => (
                    <MoreRow key={item.key} item={item} dark={dark} />
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 28,
    },
    header: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 6,
    },
    subheader: {
        fontSize: 14,
        marginBottom: 18,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        marginBottom: 8,
        marginTop: 12,
    },
    card: {
        borderRadius: 14,
        overflow: 'hidden',
    },
    row: {
        minHeight: 68,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    iconWrap: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    copyWrap: {
        flex: 1,
    },
    rowTitle: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 2,
    },
    rowSubtitle: {
        fontSize: 12,
    },
});
