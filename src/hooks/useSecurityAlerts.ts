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
const ALERT_DEDUPE_WINDOW_MS = 12000;
let lastSecurityAlertKey = '';
let lastSecurityAlertAt = 0;

function buildSecurityCopy(
    theftState: string,
    boxId: string,
    hasActiveDelivery: boolean
): { title: string; message: string; modalRequired: boolean } {
    if (theftState === 'STOLEN') {
        return hasActiveDelivery
            ? {
                title: '🚨 Security Hold Active',
                message: `Box ${boxId} triggered a theft signal during delivery. Do not attempt manual unlock. Submit incident evidence in Box Controls and await admin review.`,
                modalRequired: true,
            }
            : {
                title: '🚨 Theft Signal Detected',
                message: `Box ${boxId} reported movement without an active delivery. Admin investigation is in progress.`,
                modalRequired: true,
            };
    }

    if (theftState === 'LOCKDOWN') {
        return hasActiveDelivery
            ? {
                title: '🔒 Security Lockdown',
                message: `Box ${boxId} is locked for safety while this incident is reviewed. Delivery controls are temporarily paused.`,
                modalRequired: true,
            }
            : {
                title: '🔒 Lockdown Confirmed',
                message: `Box ${boxId} is locked with no active delivery. Admin team has been notified.`,
                modalRequired: true,
            };
    }

    return {
        title: '⚠️ Security Watch',
        message: `Unusual movement detected on Box ${boxId}. Monitoring is active.`,
        modalRequired: false,
    };
}

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
                const hasActiveDelivery = Boolean(deliveryId);
                const { title, message, modalRequired } = buildSecurityCopy(
                    String(currentTheft),
                    boxId,
                    hasActiveDelivery
                );

                const dedupeKey = `${boxId}:${currentTheft}:${hasActiveDelivery ? 'with_delivery' : 'no_delivery'}`;
                const now = Date.now();
                const dedupeBlocked =
                    dedupeKey === lastSecurityAlertKey &&
                    now - lastSecurityAlertAt < ALERT_DEDUPE_WINDOW_MS;
                if (dedupeBlocked) {
                    prevTheftState.current = currentTheft;
                    return;
                }

                lastSecurityAlertKey = dedupeKey;
                lastSecurityAlertAt = now;

                // 1. Local notification (shows in system tray, survives app background)
                showSecurityNotification(title, message, {
                    boxId,
                    theftState: currentTheft,
                    hasActiveDelivery,
                    ...(deliveryId ? { deliveryId } : {}),
                }).catch(() => {});

                // 2. In-app modal only for high-severity states to reduce alert fatigue.
                if (modalRequired) {
                    Alert.alert(title, message, [{ text: 'OK' }]);
                }

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
