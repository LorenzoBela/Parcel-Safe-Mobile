import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, List, Switch, Divider, useTheme } from 'react-native-paper';

export default function SettingsScreen() {
    const theme = useTheme();
    const [notifications, setNotifications] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    const [locationAccess, setLocationAccess] = useState(true);

    return (
        <ScrollView style={styles.container}>
            <Text variant="headlineMedium" style={styles.header}>Settings</Text>

            <List.Section>
                <List.Subheader>Preferences</List.Subheader>
                <List.Item
                    title="Push Notifications"
                    description="Receive updates about your deliveries"
                    left={props => <List.Icon {...props} icon="bell" />}
                    right={() => <Switch value={notifications} onValueChange={setNotifications} />}
                />
                <Divider />
                <List.Item
                    title="Dark Mode"
                    description="Use dark theme for the app"
                    left={props => <List.Icon {...props} icon="theme-light-dark" />}
                    right={() => <Switch value={darkMode} onValueChange={setDarkMode} />}
                />
                <Divider />
                <List.Item
                    title="Location Access"
                    description="Allow app to access your location"
                    left={props => <List.Icon {...props} icon="crosshairs-gps" />}
                    right={() => <Switch value={locationAccess} onValueChange={setLocationAccess} />}
                />
            </List.Section>

            <List.Section>
                <List.Subheader>Support</List.Subheader>
                <List.Item
                    title="Help Center"
                    left={props => <List.Icon {...props} icon="help-circle" />}
                    onPress={() => console.log('Help Center')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
                <List.Item
                    title="Terms of Service"
                    left={props => <List.Icon {...props} icon="file-document" />}
                    onPress={() => console.log('Terms')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
                <List.Item
                    title="Privacy Policy"
                    left={props => <List.Icon {...props} icon="shield-account" />}
                    onPress={() => console.log('Privacy')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
            </List.Section>

            <View style={styles.versionContainer}>
                <Text variant="bodySmall" style={{ color: '#999' }}>App Version 1.0.0</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    header: {
        padding: 24,
        fontWeight: 'bold',
    },
    versionContainer: {
        alignItems: 'center',
        padding: 24,
    }
});
