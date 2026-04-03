import * as Device from 'expo-device';
import * as Network from 'expo-network';

export type DeviceRiskSnapshot = {
  isPhysicalDevice: boolean;
  isRootedOrJailbroken: boolean;
  networkType: string;
  isConnected: boolean;
  isInternetReachable: boolean;
  isAirplaneMode: boolean;
  osName: string | null;
  osVersion: string | null;
  modelName: string | null;
};

export async function collectDeviceRiskSnapshot(): Promise<DeviceRiskSnapshot> {
  const [networkState, rootedCheck, airplaneMode] = await Promise.all([
    Network.getNetworkStateAsync(),
    Device.isRootedExperimentalAsync().catch(() => false),
    Network.isAirplaneModeEnabledAsync().catch(() => false),
  ]);

  return {
    isPhysicalDevice: Device.isDevice,
    isRootedOrJailbroken: rootedCheck,
    networkType: networkState.type || 'UNKNOWN',
    isConnected: Boolean(networkState.isConnected),
    isInternetReachable: Boolean(networkState.isInternetReachable),
    isAirplaneMode: airplaneMode,
    osName: Device.osName,
    osVersion: Device.osVersion,
    modelName: Device.modelName,
  };
}
