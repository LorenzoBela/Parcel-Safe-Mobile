import { DeviceEventEmitter, AlertButton, AlertOptions } from 'react-native';

export interface PremiumAlertOptions {
    title: string;
    message?: string;
    buttons?: AlertButton[];
    options?: AlertOptions;
}

/**
 * A drop-in replacement service for React Native's `Alert.alert`.
 * Emits an event that the `<GlobalPremiumAlert />` component listens to.
 */
class PremiumAlertServiceClass {
    public readonly SHOW_EVENT = 'SHOW_PREMIUM_ALERT';

    /**
     * Mirrors the exact API of `Alert.alert(title, message?, buttons?, options?)`
     */
    alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
        DeviceEventEmitter.emit(this.SHOW_EVENT, { title, message, buttons, options } as PremiumAlertOptions);
    }
}

export const PremiumAlert = new PremiumAlertServiceClass();
