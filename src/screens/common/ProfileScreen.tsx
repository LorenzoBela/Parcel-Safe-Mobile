import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Avatar, Button, List, Divider, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export default function ProfileScreen() {
    const navigation = useNavigation<any>();
    const theme = useTheme();

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Avatar.Image size={100} source={{ uri: 'https://i.pravatar.cc/150?img=12' }} />
                <Text variant="headlineSmall" style={styles.name}>Lorenzo Bela</Text>
                <Text variant="bodyMedium" style={styles.email}>lorenzo.bela@example.com</Text>
                <Button mode="outlined" style={styles.editBtn} onPress={() => console.log('Edit Profile')}>
                    Edit Profile
                </Button>
            </View>

            <View style={styles.section}>
                <List.Section>
                    <List.Subheader>Account Info</List.Subheader>
                    <List.Item
                        title="Phone Number"
                        description="+63 912 345 6789"
                        left={props => <List.Icon {...props} icon="phone" />}
                    />
                    <Divider />
                    <List.Item
                        title="Address"
                        description="123 Rizal Park, Manila"
                        left={props => <List.Icon {...props} icon="map-marker" />}
                    />
                </List.Section>

                <List.Section>
                    <List.Subheader>Security</List.Subheader>
                    <List.Item
                        title="Change Password"
                        left={props => <List.Icon {...props} icon="lock" />}
                        onPress={() => console.log('Change Password')}
                        right={props => <List.Icon {...props} icon="chevron-right" />}
                    />
                </List.Section>

                <View style={styles.logoutContainer}>
                    <Button mode="contained" buttonColor={theme.colors.error} onPress={() => navigation.replace('Login')}>
                        Log Out
                    </Button>
                </View>
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
        alignItems: 'center',
        padding: 24,
        backgroundColor: '#f5f5f5',
    },
    name: {
        marginTop: 16,
        fontWeight: 'bold',
    },
    email: {
        color: '#666',
        marginBottom: 16,
    },
    editBtn: {
        borderRadius: 20,
    },
    section: {
        padding: 16,
    },
    logoutContainer: {
        marginTop: 20,
        paddingHorizontal: 16,
    }
});
