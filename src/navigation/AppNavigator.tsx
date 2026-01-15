import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OTPScreen from '../screens/auth/OTPScreen';

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

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const TabIcon = ({ name, color, size }: { name: any; color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size} />
);

// Customer Tabs
const CustomerNavigator = () => (
    <Tab.Navigator id="CustomerTabs" screenOptions={{ headerShown: false, tabBarActiveTintColor: '#2196F3' }}>
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

// Rider Tabs
const RiderNavigator = () => (
    <Tab.Navigator id="RiderTabs" screenOptions={{ headerShown: false, tabBarActiveTintColor: '#4CAF50' }}>
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

// Admin Tabs
const AdminNavigator = () => (
    <Tab.Navigator id="AdminTabs" screenOptions={{ headerShown: false, tabBarActiveTintColor: '#F44336' }}>
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

export default function AppNavigator() {
    return (
        <NavigationContainer>
            <Stack.Navigator id="RootStack" initialRouteName="Login" screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Register" component={RegisterScreen} />

                {/* Main App Flows (Tabs) */}
                <Stack.Screen name="CustomerApp" component={CustomerNavigator} />
                <Stack.Screen name="RiderApp" component={RiderNavigator} />
                <Stack.Screen name="AdminApp" component={AdminNavigator} />

                {/* Common/Detail Screens (Stack) */}
                <Stack.Screen name="OTP" component={OTPScreen} />
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

                {/* EC-81: Theft Detection Screens */}
                <Stack.Screen name="TheftAlert" component={TheftAlertScreen} options={{ headerShown: true, title: 'Box Security' }} />
                <Stack.Screen name="TrackMyBox" component={TrackMyBoxScreen} options={{ headerShown: true, title: 'Track My Box' }} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}

