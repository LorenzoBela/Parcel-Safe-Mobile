import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme as NavDarkTheme } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from 'react-native-paper'; // Import useTheme
import { triggerDeliverySync } from '../services/deliverySyncService';
import { flushPendingNavigation, navigationRef } from './navigationService';

import AuthLoadingScreen from '../screens/auth/AuthLoadingScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OTPScreen from '../screens/auth/OTPScreen';
import DevRoleSelectionScreen from '../screens/auth/DevRoleSelectionScreen';
import RoleSelectionScreen from '../screens/auth/RoleSelectionScreen';
import BookServiceScreen from '../screens/client/BookServiceScreen';
import SearchingRiderScreen from '../screens/client/SearchingRiderScreen';
import RatesScreen from '../screens/client/RatesScreen';
import ReportScreen from '../screens/client/ReportScreen';

import CustomerDashboard from '../screens/client/CustomerDashboard';
import TrackOrderScreen from '../screens/client/TrackOrderScreen';
import DeliveryLogScreen from '../screens/client/DeliveryLogScreen';

import RiderDashboard from '../screens/rider/RiderDashboard';
import AssignedDeliveriesScreen from '../screens/rider/AssignedDeliveriesScreen';
import BoxControlsScreen from '../screens/rider/BoxControlsScreen';
import ArrivalScreen from '../screens/rider/ArrivalScreen';
import DeliveryCompletionScreen from '../screens/rider/DeliveryCompletionScreen';
import DeliveryRecordsScreen from '../screens/rider/DeliveryRecordsScreen'; // Force resolve
import TheftAlertScreen from '../screens/rider/TheftAlertScreen';
import TrackMyBoxScreen from '../screens/rider/TrackMyBoxScreen';
import CancellationConfirmationScreen from '../screens/rider/CancellationConfirmationScreen';
import ReturnPackageScreen from '../screens/rider/ReturnPackageScreen';
import JobDetailScreen from '../screens/rider/JobDetailScreen';
import PairBoxScreen from '../screens/rider/PairBoxScreen';
import RiderLoadingScreen from '../screens/rider/RiderLoadingScreen';

import AdminDashboard from '../screens/admin/AdminDashboard';
import AdminRecordsScreen from '../screens/admin/AdminRecordsScreen';
import GlobalMapScreen from '../screens/admin/GlobalMapScreen';
import TamperAlertsScreen from '../screens/admin/TamperAlertsScreen';
import PhotoAuditScreen from '../screens/admin/PhotoAuditScreen';
import AdminMoreScreen from '../screens/admin/AdminMoreScreen';

import ProfileScreen from '../screens/common/ProfileScreen';
import SettingsScreen from '../screens/common/SettingsScreen';
import DeliveryDetailScreen from '../screens/common/DeliveryDetailScreen';
import HelpCenterScreen from '../screens/common/HelpCenterScreen';
import TermsOfServiceScreen from '../screens/common/TermsOfServiceScreen';
import PrivacyPolicyScreen from '../screens/common/PrivacyPolicyScreen';
import EditProfileScreen from '../screens/common/EditProfileScreen';
import SavedAddressesScreen from '../screens/common/SavedAddressesScreen';
import SavedContactsScreen from '../screens/common/SavedContactsScreen';
import NotificationListScreen from '../screens/common/NotificationListScreen';
import NotificationPreferencesScreen from '../screens/common/NotificationPreferencesScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();
const AdminOperationsStack = createStackNavigator();
const AdminSecurityStack = createStackNavigator();
const AdminInsightsStack = createStackNavigator();
const AdminMoreStack = createStackNavigator();
const NAV_STATE_STORAGE_KEY = 'nav_state_v4';

const AdminEdgeCasesScreen = require('../screens/admin/AdminEdgeCasesScreen').default;
const AdminStolenBoxesScreen = require('../screens/admin/AdminStolenBoxesScreen').default;
const AdminReceiptsScreen = require('../screens/admin/AdminReceiptsScreen').default;
const AdminHardwareDiagnosticsScreen = require('../screens/admin/AdminHardwareDiagnosticsScreen').default;
const AdminTrackingHistoryScreen = require('../screens/admin/AdminTrackingHistoryScreen').default;
const AdminUsersManagementScreen = require('../screens/admin/AdminUsersManagementScreen').default;
const AdminSettingsScreen = require('../screens/admin/AdminSettingsScreen').default;

function sanitizeMoreStackState(state: any) {
    if (!state || !Array.isArray(state.routes) || state.routes.length === 0) {
        return state;
    }

    const menuRoute = state.routes.find((route: any) => route?.name === 'MoreMenu') || state.routes[0];
    return {
        ...state,
        index: 0,
        routes: [{ ...menuRoute, params: undefined, state: undefined }],
        history: undefined,
    };
}

function sanitizeAdminState(state: any) {
    if (!state || !Array.isArray(state.routes) || state.routes.length === 0) {
        return state;
    }

    const nextRoutes = state.routes.map((route: any) => {
        if (route?.name !== 'AdminMoreTab') {
            return route;
        }

        return {
            ...route,
            state: sanitizeMoreStackState(route?.state),
        };
    });

    return {
        ...state,
        routes: nextRoutes,
        history: undefined,
    };
}

function enforceRiderStartupGate(restoredState: any) {
    if (!restoredState || !Array.isArray(restoredState.routes) || restoredState.routes.length === 0) {
        return restoredState;
    }

    const currentIndex = typeof restoredState.index === 'number' ? restoredState.index : restoredState.routes.length - 1;
    const activeRoute = restoredState.routes[currentIndex];

    // If cold-launch restore would jump straight into Rider tabs, route through RiderLoading first.
    if (activeRoute?.name === 'AdminApp') {
        const sanitizedActiveRoute = {
            ...activeRoute,
            state: sanitizeAdminState(activeRoute?.state),
        };

        return {
            ...restoredState,
            index: 0,
            routes: [sanitizedActiveRoute],
            history: undefined,
        };
    }

    if (activeRoute?.name !== 'RiderApp') {
        return restoredState;
    }

    const riderLoadingRoute = {
        ...activeRoute,
        name: 'RiderLoading',
        state: undefined,
        params: undefined,
    };

    return {
        ...restoredState,
        index: 0,
        routes: [riderLoadingRoute],
        history: undefined,
    };
}

const linking = {
    prefixes: ['parcelsafe://', 'parcel-safe://'],
    config: {
        screens: {
            TrackOrder: 'order/:bookingId',
            DeliveryDetail: 'delivery/:deliveryId',
            JobDetail: 'job/:jobId',
            BoxControls: 'box/:boxId',
            PairBox: 'pair',
            TheftAlert: 'theft/:boxId',
        },
    },
};

const TabIcon = ({ name, color, size }: { name: any; color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size} />
);

// Customer Tabs
const CustomerNavigator = () => {
    const theme = useTheme();
    const isDark = theme.dark;
    const tabBg = isDark ? '#000000' : '#FFFFFF';
    const tabBorder = isDark ? '#1C1C1E' : '#E5E5EA';
    const activeColor = isDark ? '#FFFFFF' : '#000000';
    const inactiveColor = '#8E8E93';
    return (
        <Tab.Navigator
            id="CustomerTabs"
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: activeColor,
                tabBarInactiveTintColor: inactiveColor,
                tabBarStyle: {
                    backgroundColor: tabBg,
                    borderTopColor: tabBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    elevation: 0,
                },
                tabBarLabelStyle: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
            }}
        >
            <Tab.Screen
                name="Home"
                component={CustomerDashboard}
                options={{ tabBarIcon: (props) => <TabIcon name="home" {...props} /> }}
            />
            <Tab.Screen
                name="History"
                component={DeliveryLogScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="history" {...props} /> }}
            />
            <Tab.Screen
                name="Settings"
                component={SettingsScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="cog" {...props} /> }}
            />
            <Tab.Screen
                name="Profile"
                component={ProfileScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="account" {...props} /> }}
            />
        </Tab.Navigator>
    );
};

// Rider Tabs
const RiderNavigator = () => {
    const theme = useTheme();
    const isDark = theme.dark;
    const tabBg = isDark ? '#000000' : '#FFFFFF';
    const tabBorder = isDark ? '#1C1C1E' : '#E5E5EA';
    const activeColor = isDark ? '#FFFFFF' : '#000000';
    const inactiveColor = '#8E8E93';
    return (
        <Tab.Navigator
            id="RiderTabs"
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: activeColor,
                tabBarInactiveTintColor: inactiveColor,
                tabBarStyle: {
                    backgroundColor: tabBg,
                    borderTopColor: tabBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    elevation: 0,
                },
                tabBarLabelStyle: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
            }}
        >
            <Tab.Screen
                name="Dashboard"
                component={RiderDashboard}
                options={{ tabBarIcon: (props) => <TabIcon name="view-dashboard" {...props} /> }}
            />
            <Tab.Screen
                name="Deliveries"
                component={AssignedDeliveriesScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="clipboard-list" {...props} /> }}
            />
            <Tab.Screen
                name="RiderSettings"
                component={SettingsScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="cog" {...props} />, tabBarLabel: 'Settings' }}
            />
            <Tab.Screen
                name="Profile"
                component={ProfileScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="account" {...props} /> }}
            />
        </Tab.Navigator>
    );
};

const AdminOperationsNavigator = () => (
    <AdminOperationsStack.Navigator id="AdminOperationsStack" screenOptions={{ headerShown: false }}>
        <AdminOperationsStack.Screen name="OpsRecords" component={AdminRecordsScreen} />
        <AdminOperationsStack.Screen name="OpsGlobalMap" component={GlobalMapScreen} />
        <AdminOperationsStack.Screen name="OpsEdgeCases" component={AdminEdgeCasesScreen} />
    </AdminOperationsStack.Navigator>
);

const AdminSecurityNavigator = () => (
    <AdminSecurityStack.Navigator id="AdminSecurityStack" screenOptions={{ headerShown: false }}>
        <AdminSecurityStack.Screen name="SecurityAlerts" component={TamperAlertsScreen} />
        <AdminSecurityStack.Screen name="SecurityStolenBoxes" component={AdminStolenBoxesScreen} />
        <AdminSecurityStack.Screen name="SecurityPhotoAudit" component={PhotoAuditScreen} />
    </AdminSecurityStack.Navigator>
);

const AdminInsightsNavigator = () => (
    <AdminInsightsStack.Navigator id="AdminInsightsStack" screenOptions={{ headerShown: false }}>
        <AdminInsightsStack.Screen name="InsightsReceipts" component={AdminReceiptsScreen} />
        <AdminInsightsStack.Screen name="InsightsHardwareDiagnostics" component={AdminHardwareDiagnosticsScreen} />
        <AdminInsightsStack.Screen name="InsightsTrackingHistory" component={AdminTrackingHistoryScreen} />
    </AdminInsightsStack.Navigator>
);

const AdminMoreNavigator = () => (
    <AdminMoreStack.Navigator id="AdminMoreStack" screenOptions={{ headerShown: false }}>
        <AdminMoreStack.Screen name="MoreMenu" component={AdminMoreScreen} />
        <AdminMoreStack.Screen name="MoreUsers" component={AdminUsersManagementScreen} />
        <AdminMoreStack.Screen name="MoreCommonSettings" component={SettingsScreen} />
        <AdminMoreStack.Screen name="MoreSettings" component={AdminSettingsScreen} />
        <AdminMoreStack.Screen name="MoreProfile" component={ProfileScreen} />
    </AdminMoreStack.Navigator>
);

// Admin Tabs
const AdminNavigator = () => {
    const theme = useTheme();
    // Dynamic dark/light admin tab bar — Uber-style
    const isDark = theme.dark;
    const tabBg = isDark ? '#000000' : '#FFFFFF';
    const tabBorder = isDark ? '#1C1C1E' : '#E5E5EA';
    const activeColor = isDark ? '#FFFFFF' : '#000000';
    const inactiveColor = isDark ? '#8E8E93' : '#8E8E93';
    return (
        <Tab.Navigator
            id="AdminTabs"
            initialRouteName="AdminDashboardTab"
            backBehavior="initialRoute"
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: activeColor,
                tabBarInactiveTintColor: inactiveColor,
                tabBarStyle: {
                    backgroundColor: tabBg,
                    borderTopColor: tabBorder,
                    borderTopWidth: 0.5,
                    elevation: 0,
                    height: 56,
                    paddingBottom: 6,
                },
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontFamily: 'Inter_600SemiBold',
                    letterSpacing: 0.1,
                },
            }}
        >
            <Tab.Screen
                name="AdminDashboardTab"
                component={AdminDashboard}
                options={{ tabBarLabel: 'Dashboard', tabBarIcon: (props) => <TabIcon name="view-dashboard" {...props} /> }}
            />
            <Tab.Screen
                name="AdminOperationsTab"
                component={AdminOperationsNavigator}
                options={{ tabBarLabel: 'Ops', tabBarIcon: (props) => <TabIcon name="clipboard-list" {...props} /> }}
            />
            <Tab.Screen
                name="AdminSecurityTab"
                component={AdminSecurityNavigator}
                options={{ tabBarLabel: 'Security', tabBarIcon: (props) => <TabIcon name="shield-alert-outline" {...props} /> }}
            />
            <Tab.Screen
                name="AdminInsightsTab"
                component={AdminInsightsNavigator}
                options={{ tabBarLabel: 'Insights', tabBarIcon: (props) => <TabIcon name="chart-line" {...props} /> }}
            />
            <Tab.Screen
                name="AdminMoreTab"
                component={AdminMoreNavigator}
                options={{ tabBarLabel: 'More', tabBarIcon: (props) => <TabIcon name="dots-horizontal-circle-outline" {...props} /> }}
            />
        </Tab.Navigator>
    );
};

export default function AppNavigator() {
    const paperTheme = useTheme();
    const isDark = paperTheme.dark;
    const [initialNavState, setInitialNavState] = useState<any>(undefined);
    
    // Create a nav theme that automatically styles all Stack Headers globally based on dark mode.
    const navTheme = isDark ? {
        ...NavDarkTheme,
        colors: {
            ...NavDarkTheme.colors,
            background: '#000000',
            card: '#000000', // Header background (full black to match our style)
            text: '#FFFFFF', // Header title text
            border: '#2C2C2E', // Header bottom border
            primary: '#FFFFFF', // Back button color
        }
    } : {
        ...DefaultTheme,
        colors: {
            ...DefaultTheme.colors,
            background: '#FFFFFF',
            card: '#FFFFFF', // Light mode header
            text: '#000000',
            border: '#E5E5EA',
            primary: '#000000',
        }
    };

    // Layer 4: Trigger Firebase-to-Supabase sync on app startup
    useEffect(() => {
        triggerDeliverySync().catch(() => { });
    }, []);

    useEffect(() => {
        AsyncStorage.getItem(NAV_STATE_STORAGE_KEY)
            .then((stateString) => {
                if (stateString) {
                    const restoredState = JSON.parse(stateString);
                    setInitialNavState(enforceRiderStartupGate(restoredState));
                }
            })
            .catch(() => {
                // Best-effort restore only.
            });
    }, []);

    return (
        <NavigationContainer
            ref={navigationRef}
            theme={navTheme}
            linking={linking}
            initialState={initialNavState}
            onReady={() => {
                flushPendingNavigation();
            }}
            onStateChange={(state) => {
                AsyncStorage.setItem(NAV_STATE_STORAGE_KEY, JSON.stringify(state)).catch(() => {
                    // Navigation persistence is best-effort.
                });
            }}
        >
            <Stack.Navigator id="RootStack" initialRouteName="AuthLoading" screenOptions={{ headerShown: false, cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter }}>
                <Stack.Screen name="AuthLoading" component={AuthLoadingScreen} />
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Register" component={RegisterScreen} />
                <Stack.Screen name="DevRoleSelection" component={DevRoleSelectionScreen} />
                <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />

                {/* Main App Flows (Tabs) */}
                <Stack.Screen name="CustomerApp" component={CustomerNavigator} />
                <Stack.Screen name="RiderLoading" component={RiderLoadingScreen} />
                <Stack.Screen name="RiderApp" component={RiderNavigator} />
                <Stack.Screen name="AdminApp" component={AdminNavigator} />

                {/* Common/Detail Screens (Stack) */}
                <Stack.Screen name="OTP" component={OTPScreen} />
                <Stack.Screen name="BookService" component={BookServiceScreen} />
                <Stack.Screen name="SearchingRider" component={SearchingRiderScreen} />
                <Stack.Screen name="Rates" component={RatesScreen} />
                <Stack.Screen name="Report" component={ReportScreen} />
                <Stack.Screen name="TrackOrder" component={TrackOrderScreen} />
                <Stack.Screen name="DeliveryLog" component={DeliveryLogScreen} />
                <Stack.Screen name="DeliveryDetail" component={DeliveryDetailScreen} />
                <Stack.Screen name="PhotoAudit" component={PhotoAuditScreen} />
                <Stack.Screen name="AssignedDeliveries" component={AssignedDeliveriesScreen} />
                <Stack.Screen name="JobDetail" component={JobDetailScreen} options={{ headerShown: false }} />
                <Stack.Screen name="BoxControls" component={BoxControlsScreen} />
                <Stack.Screen name="PairBox" component={PairBoxScreen} />
                <Stack.Screen name="Arrival" component={ArrivalScreen} />
                <Stack.Screen name="DeliveryCompletion" component={DeliveryCompletionScreen} />
                <Stack.Screen name="GlobalMap" component={GlobalMapScreen} />
                <Stack.Screen name="TamperAlerts" component={TamperAlertsScreen} />
                <Stack.Screen name="AdminRecords" component={AdminRecordsScreen} />
                <Stack.Screen name="DeliveryRecords" component={DeliveryRecordsScreen} />
                <Stack.Screen name="RiderSupport" component={require('../screens/rider/RiderSupportScreen').default} options={{ headerShown: false }} />
                <Stack.Screen name="AdminRemoteUnlock" component={require('../screens/admin/AdminRemoteUnlockScreen').default} options={{ headerShown: false }} />

                {/* Common Info Screens */}
                <Stack.Screen name="HelpCenter" component={HelpCenterScreen} options={{ headerShown: true, title: 'Help Center' }} />
                <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ headerShown: true, title: 'Terms of Service' }} />
                <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ headerShown: true, title: 'Privacy Policy' }} />
                <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ headerShown: true, title: 'Edit Profile' }} />
                <Stack.Screen name="SavedAddresses" component={SavedAddressesScreen} options={{ headerShown: true, title: 'Saved Addresses' }} />
                <Stack.Screen name="SavedContacts" component={SavedContactsScreen} options={{ headerShown: true, title: 'Saved Contacts' }} />
                <Stack.Screen name="NotificationList" component={NotificationListScreen} options={{ headerShown: false }} />
                <Stack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} options={{ headerShown: true, title: 'Notification Preferences' }} />

                {/* EC-81: Theft Detection Screens */}
                <Stack.Screen name="TheftAlert" component={TheftAlertScreen} options={{ headerShown: true, title: 'Box Security' }} />
                <Stack.Screen name="TrackMyBox" component={TrackMyBoxScreen} options={{ headerShown: true, title: 'Track My Box' }} />

                {/* EC-32: Cancellation Screens */}
                <Stack.Screen name="CancellationConfirmation" component={CancellationConfirmationScreen} options={{ headerShown: true, title: 'Cancellation Confirmed' }} />
                <Stack.Screen name="ReturnPackage" component={ReturnPackageScreen} options={{ headerShown: true, title: 'Return Package' }} />
                <Stack.Screen name="CustomerCancellationConfirm" component={require('../screens/client/CustomerCancellationConfirmScreen').default} options={{ headerShown: true, title: 'Order Cancelled' }} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}

