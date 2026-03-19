import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from 'react-native-paper'; // Import useTheme
import { triggerDeliverySync } from '../services/deliverySyncService';

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

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

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
                tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
                tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
                    fontSize: 11,
                    fontWeight: '600',
                    letterSpacing: 0.1,
                },
            }}
        >
            <Tab.Screen
                name="Dashboard"
                component={AdminDashboard}
                options={{ tabBarIcon: (props) => <TabIcon name="view-dashboard" {...props} /> }}
            />
            <Tab.Screen
                name="Map"
                component={GlobalMapScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="map" {...props} /> }}
            />
            <Tab.Screen
                name="Alerts"
                component={TamperAlertsScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="alert" {...props} /> }}
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

export default function AppNavigator() {
    // Layer 4: Trigger Firebase-to-Supabase sync on app startup
    useEffect(() => {
        triggerDeliverySync().catch(() => { });
    }, []);

    return (
        <NavigationContainer>
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

