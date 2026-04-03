export type ActionCriticality = 'critical-hardware' | 'critical-delivery-state' | 'non-critical-metadata';

export function getActionCriticality(actionType: string): ActionCriticality {
    const normalized = actionType.toLowerCase();

    if (
        normalized.includes('unlock') ||
        normalized.includes('lock') ||
        normalized.includes('box_command')
    ) {
        return 'critical-hardware';
    }

    if (
        normalized.includes('delivery') ||
        normalized.includes('status') ||
        normalized.includes('complete') ||
        normalized.includes('cancel') ||
        normalized.includes('return')
    ) {
        return 'critical-delivery-state';
    }

    return 'non-critical-metadata';
}

export function shouldUseOptimisticUi(actionType: string): boolean {
    return getActionCriticality(actionType) === 'non-critical-metadata';
}
