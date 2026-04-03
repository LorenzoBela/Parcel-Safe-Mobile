import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

type PendingNav = {
    name: string;
    params?: Record<string, any>;
};

const pendingQueue: PendingNav[] = [];

export function navigateWhenReady(name: string, params?: Record<string, any>): void {
    if (navigationRef.isReady()) {
        navigationRef.navigate(name as never, params as never);
        return;
    }
    pendingQueue.push({ name, params });
}

export function flushPendingNavigation(): void {
    if (!navigationRef.isReady()) return;
    while (pendingQueue.length > 0) {
        const item = pendingQueue.shift();
        if (!item) continue;
        navigationRef.navigate(item.name as never, item.params as never);
    }
}
