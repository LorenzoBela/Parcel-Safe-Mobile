import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from 'react-native-paper'; // Import useTheme

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OTPScreen from '../screens/auth/OTPScreen';
import DevRoleSelectionScreen from '../screens/auth/DevRoleSelectionScreen';
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
import DeliveryRecordsScreen from '../screens/rider/DeliveryRecordsScreen';
import TheftAlertScreen from '../screens/rider/TheftAlertScreen';
import TrackMyBoxScreen from '../screens/rider/TrackMyBoxScreen';

import AdminDashboard from '../screens/admin/AdminDashboard';
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

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const TabIcon = ({ name, color, size }: { name: any; color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size} />
);

// Customer Tabs
const CustomerNavigator = () => {
    const theme = useTheme();
    return (
        <Tab.Navigator
            id="CustomerTabs"
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: theme.colors.primary,
                tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
                tabBarStyle: {
                    backgroundColor: theme.colors.surface,
                    borderTopColor: theme.colors.outline,
                }
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
    return (
        <Tab.Navigator
            id="RiderTabs"
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#4CAF50', // Keep specific rider color or use theme? keeping specific for identity
                tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
                tabBarStyle: {
                    backgroundColor: theme.colors.surface,
                    borderTopColor: theme.colors.outline,
                }
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

// Admin Tabs
const AdminNavigator = () => {
    const theme = useTheme();
    return (
        <Tab.Navigator
            id="AdminTabs"
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#F44336',
                tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
                tabBarStyle: {
                    backgroundColor: theme.colors.surface,
                    borderTopColor: theme.colors.outline,
                }
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
                name="Profile"
                component={ProfileScreen}
                options={{ tabBarIcon: (props) => <TabIcon name="account" {...props} /> }}
            />
        </Tab.Navigator>
    );
};

export default function AppNavigator() {
    return (
        <NavigationContainer>
            <Stack.Navigator id="RootStack" initialRouteName="Login" screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Register" component={RegisterScreen} />
                <Stack.Screen name="DevRoleSelection" component={DevRoleSelectionScreen} />

                {/* Main App Flows (Tabs) */}
                <Stack.Screen name="CustomerApp" component={CustomerNavigator} />
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
                <Stack.Screen name="BoxControls" component={BoxControlsScreen} />
                <Stack.Screen name="Arrival" component={ArrivalScreen} />
                <Stack.Screen name="DeliveryCompletion" component={DeliveryCompletionScreen} />
                <Stack.Screen name="GlobalMap" component={GlobalMapScreen} />
                <Stack.Screen name="TamperAlerts" component={TamperAlertsScreen} />
                <Stack.Screen name="DeliveryRecords" component={DeliveryRecordsScreen} />

                {/* Common Info Screens */}
                <Stack.Screen name="HelpCenter" component={HelpCenterScreen} options={{ headerShown: true, title: 'Help Center' }} />
                <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ headerShown: true, title: 'Terms of Service' }} />
                <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ headerShown: true, title: 'Privacy Policy' }} />
                <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ headerShown: true, title: 'Edit Profile' }} />
                <Stack.Screen name="SavedAddresses" component={SavedAddressesScreen} options={{ headerShown: true, title: 'Saved Addresses' }} />

                {/* EC-81: Theft Detection Screens */}
                <Stack.Screen name="TheftAlert" component={TheftAlertScreen} options={{ headerShown: true, title: 'Box Security' }} />
                <Stack.Screen name="TrackMyBox" component={TrackMyBoxScreen} options={{ headerShown: true, title: 'Track My Box' }} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}

