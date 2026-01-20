import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, List, Switch, Divider, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';

export default function SettingsScreen() {
    const theme = useTheme();
    const { isDarkMode, toggleTheme } = useAppTheme();
    const navigation = useNavigation<any>();
    const [notifications, setNotifications] = useState(true);


    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Text variant="headlineMedium" style={[styles.header, { color: theme.colors.onBackground }]}>Settings</Text>

            <List.Section>
                <List.Subheader>Preferences</List.Subheader>
                <List.Item
                    title="Push Notifications"
                    description="Receive updates about your deliveries"
                    left={props => <List.Icon {...props} icon="bell" />}
                    right={() => <Switch value={notifications} onValueChange={setNotifications} />}
                />
                <Divider />
                <Divider />
                <List.Item
                    title="Dark Mode"
                    description="Use dark theme for the app"
                    left={props => <List.Icon {...props} icon="theme-light-dark" />}
                    right={() => <Switch value={isDarkMode} onValueChange={toggleTheme} />}
                />

            </List.Section>

            <List.Section>
                <List.Subheader>Support</List.Subheader>
                <List.Item
                    title="Help Center"
                    left={props => <List.Icon {...props} icon="help-circle" />}
                    onPress={() => navigation.navigate('HelpCenter')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
                <List.Item
                    title="Rider Support"
                    left={props => <List.Icon {...props} icon="face-agent" />}
                    onPress={() => navigation.navigate('RiderSupport')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
                <List.Item
                    title="Terms of Service"
                    left={props => <List.Icon {...props} icon="file-document" />}
                    onPress={() => navigation.navigate('TermsOfService')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
                <Divider />
                <List.Item
                    title="Privacy Policy"
                    left={props => <List.Icon {...props} icon="shield-account" />}
                    onPress={() => navigation.navigate('PrivacyPolicy')}
                    right={props => <List.Icon {...props} icon="chevron-right" />}
                />
            </List.Section>

            <View style={styles.versionContainer}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>App Version 1.0.0</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
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
