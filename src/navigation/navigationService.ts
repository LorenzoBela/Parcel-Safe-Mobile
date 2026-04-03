import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

type PendingNav = {
    name: string;
    params?: Record<string, any>;
};

const pendingQueue: PendingNav[] = [];

export function navigateWhenReady(name: string, params?: Record<string, any>): void {
    if (navigationRef.isReady()) {
        (navigationRef.navigate as any)(name, params);
        return;
    }
    pendingQueue.push({ name, params });
}

export function flushPendingNavigation(): void {
    if (!navigationRef.isReady()) return;
    while (pendingQueue.length > 0) {
        const item = pendingQueue.shift();
        if (!item) continue;
        (navigationRef.navigate as any)(item.name, item.params);
    }
}
