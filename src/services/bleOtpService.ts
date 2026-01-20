/**
 * EC-02: BLE OTP Transfer Service
 * 
 * Handles Bluetooth Low Energy communication with the Smart Top Box
 * for transferring OTP when the box was offline during delivery assignment.
 * 
 * This is the PRIMARY fallback when box never received the delivery assignment
 * (e.g., box was in underground parking when delivery was assigned).
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';

// BLE Service UUIDs (must match hardware/src/main.cpp)
const BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BLE_OTP_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const BLE_STATUS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';
const BLE_DEVICE_NAME_PREFIX = 'ParcelSafe-';

// Connection timeouts
const SCAN_TIMEOUT_MS = 15000;  // 15 seconds to find device
const CONNECT_TIMEOUT_MS = 10000;  // 10 seconds to connect
const WRITE_TIMEOUT_MS = 5000;  // 5 seconds for write operation

// Helper for Expo Go compatibility
let BleManager: any;
let State: any;
let isBleSupported = false;

try {
    const bleModule = require('react-native-ble-plx');
    BleManager = bleModule.BleManager;
    State = bleModule.State;
    isBleSupported = true;
} catch (error) {
    console.log('[BLE] react-native-ble-plx not available (likely running in Expo Go)');
    // Mock State enum to prevent undefined errors
    State = {
        PoweredOn: 'PoweredOn',
        PoweredOff: 'PoweredOff',
        Unauthorized: 'Unauthorized',
        Unsupported: 'Unsupported',
        Unknown: 'Unknown',
    };

    // Mock BleManager class
    BleManager = class {
        state() { return Promise.resolve(State.Unsupported); }
        startDeviceScan() { console.log('[BLE Mock] Scanning...'); }
        stopDeviceScan() { console.log('[BLE Mock] Scan stopped'); }
        connectToDevice() { return Promise.reject(new Error('BLE not supported in Expo Go')); }
        destroy() { }
    };

    isBleSupported = false;
}

// BLE Transfer Result
export interface BleTransferResult {
    success: boolean;
    message: string;
    deviceName?: string;
    error?: Error;
}

// BLE Device Info
export interface BleBoxDevice {
    id: string;
    name: string;
    rssi: number | null;
    isConnectable: boolean;
}

// Callbacks for UI updates
export interface BleCallbacks {
    onScanStart?: () => void;
    onDeviceFound?: (device: BleBoxDevice) => void;
    onConnecting?: (deviceName: string) => void;
    onConnected?: (deviceName: string) => void;
    onTransferring?: () => void;
    onSuccess?: (deviceName: string) => void;
    onError?: (error: string) => void;
}

class BleOtpService {
    private manager: any; // Type as any to handle mock
    private connectedDevice: any | null = null;
    private isScanning: boolean = false;

    constructor() {
        this.manager = new BleManager();
    }

    /**
     * Check if Bluetooth is available and enabled
     */
    async checkBluetoothState(): Promise<{ available: boolean; enabled: boolean; message: string }> {
        if (!isBleSupported) {
            return { available: false, enabled: false, message: 'Bluetooth not supported in Expo Go' };
        }

        try {
            const state = await this.manager.state();

            switch (state) {
                case State.PoweredOn:
                    return { available: true, enabled: true, message: 'Bluetooth is ready' };
                case State.PoweredOff:
                    return { available: true, enabled: false, message: 'Please enable Bluetooth' };
                case State.Unauthorized:
                    return { available: true, enabled: false, message: 'Bluetooth permission denied' };
                case State.Unsupported:
                    return { available: false, enabled: false, message: 'Bluetooth not supported on this device' };
                default:
                    return { available: false, enabled: false, message: 'Bluetooth unavailable' };
            }
        } catch (error) {
            return { available: false, enabled: false, message: 'Failed to check Bluetooth state' };
        }
    }

    /**
     * Request necessary permissions for BLE on Android
     */
    async requestPermissions(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true; // iOS handles permissions differently
        }

        try {
            const apiLevel = Platform.Version as number;

            if (apiLevel >= 31) {
                // Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT
                const scanResult = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                    {
                        title: 'Bluetooth Scan Permission',
                        message: 'ParcelSafe needs to scan for nearby Smart Boxes',
                        buttonNeutral: 'Ask Later',
                        buttonNegative: 'Cancel',
                        buttonPositive: 'OK',
                    }
                );

                const connectResult = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                    {
                        title: 'Bluetooth Connect Permission',
                        message: 'ParcelSafe needs to connect to Smart Boxes',
                        buttonNeutral: 'Ask Later',
                        buttonNegative: 'Cancel',
                        buttonPositive: 'OK',
                    }
                );

                return (
                    scanResult === PermissionsAndroid.RESULTS.GRANTED &&
                    connectResult === PermissionsAndroid.RESULTS.GRANTED
                );
            } else {
                // Android 11 and below requires FINE_LOCATION for BLE
                const result = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    {
                        title: 'Location Permission',
                        message: 'ParcelSafe needs location access to scan for Bluetooth devices',
                        buttonNeutral: 'Ask Later',
                        buttonNegative: 'Cancel',
                        buttonPositive: 'OK',
                    }
                );

                return result === PermissionsAndroid.RESULTS.GRANTED;
            }
        } catch (error) {
            console.error('[BLE] Permission request error:', error);
            return false;
        }
    }

    /**
     * Scan for nearby ParcelSafe boxes
     */
    async scanForBoxes(
        targetBoxId?: string,
        callbacks?: BleCallbacks
    ): Promise<BleBoxDevice[]> {
        if (this.isScanning) {
            console.log('[BLE] Scan already in progress');
            return [];
        }

        if (!isBleSupported) {
            console.log('[BLE] Scanning simulated in Expo Go');
            callbacks?.onScanStart?.();

            // Simulate finding a device
            const scanPromise = new Promise<BleBoxDevice[]>(resolve => {
                setTimeout(() => {
                    const simulatedDevice = {
                        id: 'SIMULATED_DEVICE_ID',
                        name: 'ParcelSafe-001',
                        rssi: -65,
                        isConnectable: true
                    };
                    callbacks?.onDeviceFound?.(simulatedDevice);
                    resolve([simulatedDevice]);
                }, 2000);
            });

            return scanPromise;
        }

        const foundDevices: BleBoxDevice[] = [];
        this.isScanning = true;
        callbacks?.onScanStart?.();

        return new Promise((resolve) => {
            const scanTimeout = setTimeout(() => {
                this.manager.stopDeviceScan();
                this.isScanning = false;
                console.log(`[BLE] Scan complete. Found ${foundDevices.length} devices`);
                resolve(foundDevices);
            }, SCAN_TIMEOUT_MS);

            this.manager.startDeviceScan(
                [BLE_SERVICE_UUID],
                { allowDuplicates: false },
                (error: any, device: any) => {
                    if (error) {
                        console.error('[BLE] Scan error:', error);
                        callbacks?.onError?.(error.message);
                        clearTimeout(scanTimeout);
                        this.manager.stopDeviceScan();
                        this.isScanning = false;
                        resolve(foundDevices);
                        return;
                    }

                    if (device && device.name?.startsWith(BLE_DEVICE_NAME_PREFIX)) {
                        // Check if this is the target box (if specified)
                        const boxId = device.name.replace(BLE_DEVICE_NAME_PREFIX, '');

                        if (!targetBoxId || boxId === targetBoxId) {
                            const bleDevice: BleBoxDevice = {
                                id: device.id,
                                name: device.name,
                                rssi: device.rssi,
                                isConnectable: device.isConnectable ?? true,
                            };

                            // Avoid duplicates
                            if (!foundDevices.find(d => d.id === device.id)) {
                                foundDevices.push(bleDevice);
                                console.log(`[BLE] Found: ${device.name} (RSSI: ${device.rssi})`);
                                callbacks?.onDeviceFound?.(bleDevice);

                                // If we found the specific target box, stop scanning
                                if (targetBoxId && boxId === targetBoxId) {
                                    clearTimeout(scanTimeout);
                                    this.manager.stopDeviceScan();
                                    this.isScanning = false;
                                    resolve(foundDevices);
                                }
                            }
                        }
                    }
                }
            );
        });
    }

    /**
     * Connect to a Smart Top Box by device ID
     */
    async connectToBox(deviceId: string, callbacks?: BleCallbacks): Promise<any | null> {
        if (!isBleSupported) {
            callbacks?.onConnecting?.(deviceId);
            await new Promise(resolve => setTimeout(resolve, 1500));
            callbacks?.onConnected?.('ParcelSafe-001');
            return { name: 'ParcelSafe-001', id: deviceId };
        }

        try {
            callbacks?.onConnecting?.(deviceId);
            console.log(`[BLE] Connecting to ${deviceId}...`);

            const device = await this.manager.connectToDevice(deviceId, {
                timeout: CONNECT_TIMEOUT_MS,
            });

            await device.discoverAllServicesAndCharacteristics();
            this.connectedDevice = device;

            callbacks?.onConnected?.(device.name ?? deviceId);
            console.log(`[BLE] Connected to ${device.name}`);

            return device;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Connection failed';
            console.error('[BLE] Connection error:', errorMsg);
            callbacks?.onError?.(errorMsg);
            return null;
        }
    }

    /**
     * Transfer OTP to the connected box
     * 
     * Format: "OTP:123456:delivery_id:timestamp"
     */
    async transferOtp(
        otpCode: string,
        deliveryId: string,
        callbacks?: BleCallbacks
    ): Promise<BleTransferResult> {
        if (!isBleSupported) {
            callbacks?.onTransferring?.();
            await new Promise(resolve => setTimeout(resolve, 2000));
            callbacks?.onSuccess?.('ParcelSafe-001');
            return { success: true, message: 'SIMULATED OTP TRANSFER SUCCESS', deviceName: 'ParcelSafe-001' };
        }

        if (!this.connectedDevice) {
            return {
                success: false,
                message: 'Not connected to any device',
            };
        }

        try {
            callbacks?.onTransferring?.();

            // Build the OTP payload
            const timestamp = Date.now();
            const payload = `OTP:${otpCode}:${deliveryId}:${timestamp}`;
            const base64Payload = Buffer.from(payload).toString('base64');

            console.log(`[BLE] Sending OTP payload...`);

            // Write to the OTP characteristic
            await this.connectedDevice.writeCharacteristicWithResponseForService(
                BLE_SERVICE_UUID,
                BLE_OTP_CHAR_UUID,
                base64Payload
            );

            // Wait a bit and read status to confirm
            await new Promise(resolve => setTimeout(resolve, 500));

            const statusChar = await this.connectedDevice.readCharacteristicForService(
                BLE_SERVICE_UUID,
                BLE_STATUS_CHAR_UUID
            );

            const status = statusChar.value
                ? Buffer.from(statusChar.value, 'base64').toString('utf8')
                : '';

            const deviceName = this.connectedDevice.name ?? 'Unknown';

            if (status === 'OTP_RECEIVED') {
                callbacks?.onSuccess?.(deviceName);
                console.log(`[BLE] OTP transfer confirmed by box`);

                return {
                    success: true,
                    message: 'OTP successfully transferred to box',
                    deviceName,
                };
            } else {
                console.log(`[BLE] OTP sent but status unclear: ${status}`);
                return {
                    success: true,
                    message: 'OTP sent (status unconfirmed)',
                    deviceName,
                };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Transfer failed';
            console.error('[BLE] Transfer error:', errorMsg);
            callbacks?.onError?.(errorMsg);

            return {
                success: false,
                message: errorMsg,
                error: error instanceof Error ? error : new Error(errorMsg),
            };
        }
    }

    /**
     * Complete flow: Scan → Connect → Transfer OTP
     * 
     * This is the main method riders will use when they need to send
     * OTP to a box that was offline during delivery assignment.
     */
    async sendOtpToBox(
        boxId: string,
        otpCode: string,
        deliveryId: string,
        callbacks?: BleCallbacks
    ): Promise<BleTransferResult> {
        // 1. Check Bluetooth state
        const btState = await this.checkBluetoothState();
        if (!btState.enabled && btState.message !== 'Bluetooth in Expo Go (Simulated)') {
            // Continue if just Expo limitation, otherwise return error
            if (isBleSupported || !btState.message.includes('Expo')) {
                return {
                    success: false,
                    message: btState.message,
                };
            }
        }

        // 2. Request permissions
        const hasPermission = await this.requestPermissions();
        if (!hasPermission) {
            return {
                success: false,
                message: 'Bluetooth permissions not granted',
            };
        }

        // 3. Scan for the specific box
        console.log(`[BLE] Scanning for box: ${boxId}`);
        const devices = await this.scanForBoxes(boxId, callbacks);

        if (devices.length === 0) {
            return {
                success: false,
                message: `Box ${boxId} not found. Make sure you are near the box.`,
            };
        }

        // 4. Connect to the box
        const device = await this.connectToBox(devices[0].id, callbacks);
        if (!device) {
            return {
                success: false,
                message: 'Failed to connect to box',
            };
        }

        // 5. Transfer the OTP
        const result = await this.transferOtp(otpCode, deliveryId, callbacks);

        // 6. Disconnect
        await this.disconnect();

        return result;
    }

    /**
     * Disconnect from current device
     */
    async disconnect(): Promise<void> {
        if (!isBleSupported) return;

        if (this.connectedDevice) {
            try {
                await this.connectedDevice.cancelConnection();
                console.log('[BLE] Disconnected');
            } catch (error) {
                console.log('[BLE] Disconnect error (may already be disconnected)');
            }
            this.connectedDevice = null;
        }
    }

    /**
     * Stop any ongoing scan
     */
    stopScan(): void {
        if (!isBleSupported) return;

        if (this.isScanning) {
            this.manager.stopDeviceScan();
            this.isScanning = false;
            console.log('[BLE] Scan stopped');
        }
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        if (!isBleSupported) return;

        this.stopScan();
        this.disconnect();
        this.manager.destroy();
    }
}

// Export singleton instance
export const bleOtpService = new BleOtpService();
export default bleOtpService;
