import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { Text, Card, Button, Surface, ProgressBar, useTheme, IconButton, Divider } from 'react-native-paper';
import LottieView from 'lottie-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';

export default function BoxControlsScreen() {
    const theme = useTheme();
    const animationRef = useRef<LottieView>(null);
    const [isLocked, setIsLocked] = useState(true);
    const [rebooting, setRebooting] = useState(false);
    const [logs, setLogs] = useState<{ time: string; message: string; type: string }[]>([]);

    // Telemetry State
    const [telemetry, setTelemetry] = useState({
        voltage: '12.4V',
        temp: '28°C',
        signal: '-85 dBm',
        sync: 'Just now'
    });

    // Initialize Logs
    useEffect(() => {
        addLog("Control Panel accessed", "info");
        addLog("Telemetry stream connected", "success");
    }, []);

    // Animation Control
    useEffect(() => {
        if (animationRef.current) {
            if (isLocked) {
                animationRef.current.play(0, 60);
            } else {
                animationRef.current.play(60, 120);
            }
        }
    }, [isLocked]);

    const addLog = (message: string, type: string = 'info') => {
        setLogs(prev => [{ time: dayjs().format('HH:mm:ss'), message, type }, ...prev]);
    };

    const toggleLock = () => {
        const action = !isLocked ? "LOCKED" : "UNLOCKED";
        setIsLocked(!isLocked);
        addLog(`Manual Override: Box ${action}`, action === 'LOCKED' ? 'success' : 'warning');
    };

    const handleEmergencyOpen = () => {
        Alert.alert(
            "Emergency Open",
            "This will force the lock open and trigger an incident report. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "FORCE OPEN",
                    style: "destructive",
                    onPress: () => {
                        setIsLocked(false);
                        addLog("EMERGENCY OPEN TRIGGERED", "error");
                        addLog("Incident Report #9921 created", "info");
                    }
                }
            ]
        );
    };

    const handleReboot = () => {
        Alert.alert(
            "Reboot System",
            "This will restart the smart box. Connection will be lost for 30 seconds.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reboot",
                    onPress: () => {
                        setRebooting(true);
                        addLog("System Reboot Initiated...", "warning");
                        setTimeout(() => {
                            setRebooting(false);
                            addLog("System Online. All systems nominal.", "success");
                        }, 3000);
                    }
                }
            ]
        );
    };

    const TelemetryItem = ({ icon, label, value, color }) => (
        <Surface style={styles.telemetryCard} elevation={1}>
            <MaterialCommunityIcons name={icon} size={24} color={color} />
            <Text variant="labelSmall" style={{ marginTop: 4, color: '#666' }}>{label}</Text>
            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{value}</Text>
        </Surface>
    );

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>

                {/* Header Animation */}
                <View style={styles.headerContainer}>
                    <MaterialCommunityIcons
                        name={isLocked ? "shield-check" : "shield-alert"}
                        size={100}
                        color={isLocked ? "#4CAF50" : "#F44336"}
                        style={{ marginBottom: 10 }}
                    />
                    <Text variant="headlineSmall" style={{ fontWeight: 'bold', marginTop: 10 }}>
                        {isLocked ? "System Secure" : "System Unlocked"}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: isLocked ? '#4CAF50' : '#F44336' }}>
                        {isLocked ? "Lock Engaged" : "Lock Disengaged"}
                    </Text>
                </View>

                {/* Telemetry Grid */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Live Telemetry</Text>
                <View style={styles.grid}>
                    <TelemetryItem icon="car-battery" label="Voltage" value={telemetry.voltage} color="#2196F3" />
                    <TelemetryItem icon="thermometer" label="Temp" value={telemetry.temp} color="#FF9800" />
                    <TelemetryItem icon="wifi" label="Signal" value={telemetry.signal} color="#4CAF50" />
                    <TelemetryItem icon="sync" label="Last Sync" value={telemetry.sync} color="#9C27B0" />
                </View>

                {/* Controls */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Advanced Actions</Text>
                <Card style={styles.controlsCard}>
                    <Card.Content>
                        <Button
                            mode="contained"
                            onPress={toggleLock}
                            style={[styles.button, { backgroundColor: isLocked ? '#4CAF50' : '#F44336' }]}
                            icon={isLocked ? "lock" : "lock-open"}
                        >
                            {isLocked ? "Unlock Box" : "Lock Box"}
                        </Button>

                        <View style={styles.row}>
                            <Button
                                mode="outlined"
                                onPress={handleReboot}
                                loading={rebooting}
                                disabled={rebooting}
                                style={[styles.button, { flex: 1, marginRight: 8, borderColor: '#FF9800' }]}
                                textColor="#FF9800"
                                icon="restart"
                            >
                                Reboot
                            </Button>
                            <Button
                                mode="outlined"
                                onLongPress={handleEmergencyOpen}
                                delayLongPress={1000}
                                style={[styles.button, { flex: 1, borderColor: '#D32F2F' }]}
                                textColor="#D32F2F"
                                icon="alert"
                            >
                                Emergency
                            </Button>
                        </View>
                        <Text style={styles.hintText}>* Long press "Emergency" to force open</Text>
                    </Card.Content>
                </Card>

                {/* Detailed Logs */}
                <Text variant="titleMedium" style={styles.sectionTitle}>System Event Log</Text>
                <Surface style={styles.logContainer} elevation={2}>
                    {logs.map((log, index) => (
                        <View key={index} style={styles.logRow}>
                            <Text style={styles.logTime}>{log.time}</Text>
                            <Text style={[styles.logMessage, {
                                color: log.type === 'error' ? '#D32F2F' :
                                    log.type === 'warning' ? '#FF9800' :
                                        log.type === 'success' ? '#388E3C' : '#333'
                            }]}>
                                {log.message}
                            </Text>
                        </View>
                    ))}
                </Surface>

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    scrollContent: {
        padding: 20,
    },
    headerContainer: {
        alignItems: 'center',
        marginBottom: 24,
        backgroundColor: 'white',
        padding: 20,
        borderRadius: 16,
        elevation: 2,
    },
    lottie: {
        width: 120,
        height: 120,
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#333',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    telemetryCard: {
        width: '48%',
        backgroundColor: 'white',
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
        alignItems: 'center',
    },
    controlsCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        marginBottom: 24,
    },
    button: {
        marginBottom: 12,
        borderRadius: 8,
    },
    row: {
        flexDirection: 'row',
    },
    hintText: {
        fontSize: 10,
        color: '#999',
        textAlign: 'center',
        marginTop: -4,
    },
    logContainer: {
        backgroundColor: '#1E1E1E', // Terminal style
        borderRadius: 12,
        padding: 16,
        minHeight: 200,
    },
    logRow: {
        flexDirection: 'row',
        marginBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
        paddingBottom: 4,
    },
    logTime: {
        color: '#888',
        fontFamily: 'monospace',
        fontSize: 11,
        width: 60,
    },
    logMessage: {
        flex: 1,
        fontFamily: 'monospace',
        fontSize: 11,
    },
});
