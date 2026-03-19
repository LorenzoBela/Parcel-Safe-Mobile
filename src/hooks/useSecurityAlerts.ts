/**
 * useSecurityAlerts Hook
 *
 * Monitors theft_state on the hardware node and dispatches:
 *   1. Local on-device notification (shows in notification tray even if app is backgrounded)
 *   2. FCM push notification to rider, customer, and all admins
 *   3. In-app Alert dialog for immediate attention
 *
 * Fires when the state escalates to SUSPICIOUS, STOLEN, or LOCKDOWN.
 *
 * Mount this hook on any screen that is active while a delivery is ongoing
 * (e.g. RiderDashboard, ArrivalScreen, BoxControlsScreen).
 */

import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { subscribeToBoxState, BoxState } from '../services/firebaseClient';
import { showSecurityNotification } from '../services/pushNotificationService';

const THREAT_STATES = ['SUSPICIOUS', 'STOLEN', 'LOCKDOWN'] as const;

export function useSecurityAlerts(
    boxId: string | null | undefined,
    deliveryId?: string,
    riderId?: string
) {
    const prevTheftState = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (!boxId) return;

        const unsubscribe = subscribeToBoxState(boxId, (state: BoxState | null) => {
            if (!state) return;

            const currentTheft = state.theft_state;
            const prev = prevTheftState.current;

            // Only fire when escalating INTO a threat state (not on every poll)
            if (
                currentTheft &&
                THREAT_STATES.includes(currentTheft as any) &&
                prev !== currentTheft
            ) {
                const title =
                    currentTheft === 'STOLEN' ? '🚨 THEFT DETECTED'
                    : currentTheft === 'LOCKDOWN' ? '🔒 BOX LOCKED DOWN'
                    : '⚠️ Suspicious Activity';

                const message =
                    currentTheft === 'STOLEN'
                        ? `Box ${boxId} may have been stolen! Motion detected without an active delivery. Do not attempt retrieval — contact support immediately.`
                    : currentTheft === 'LOCKDOWN'
                        ? `Box ${boxId} has been locked down by an admin. All OTP and unlock functions are disabled.`
                        : `Unusual movement detected on Box ${boxId}. The system is monitoring the situation.`;

                // 1. Local notification (shows in system tray, survives app background)
                showSecurityNotification(title, message, {
                    boxId,
                    theftState: currentTheft,
                    ...(deliveryId ? { deliveryId } : {}),
                }).catch(() => {});

                // 2. In-app modal alert for immediate attention
                Alert.alert(title, message, [{ text: 'OK' }]);

                // Cloud-first security orchestration:
                // backend listeners dispatch tamper/theft fanout notifications.
                // Mobile remains a consumer for local tray + in-app alert only.
            }

            prevTheftState.current = currentTheft;
        });

        return () => {
            unsubscribe();
            prevTheftState.current = undefined;
        };
    }, [boxId, deliveryId, riderId]);
}
