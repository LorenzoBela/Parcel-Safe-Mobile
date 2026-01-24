/**
 * Components Index
 * 
 * Re-exports all shared components for easier imports.
 */

// Hardware Status Components (EC-21, EC-22, EC-23, EC-25)
export { 
    HardwareAlertBanner,
    HardwareAlertList,
} from './HardwareAlertBanner';

export {
    HardwareStatusBadge,
    StatusDot,
    StatusIndicator,
} from './HardwareStatusBadge';

// Customer Hardware Components (EC-86)
export { default as CustomerHardwareBanner } from './CustomerHardwareBanner';
export { default as CustomerBleUnlockModal } from './CustomerBleUnlockModal';

// Location Components
export { default as LocationPicker } from './LocationPicker';
export type { LocationData } from './LocationPicker';
