import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

const SELECTIVE_RECONNECT_QUERY_KEYS = new Set([
    'assigned-deliveries',
    'delivery-log',
    'admin-delivery-records',
]);

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 2,
            retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 10000),
            staleTime: 60 * 1000,
            gcTime: 10 * 60 * 1000,
            refetchOnReconnect: false,
            refetchOnMount: true,
        },
    },
});

export async function runSelectiveReconnectInvalidation(reason: string = 'resume_reconnect'): Promise<void> {
    await queryClient.invalidateQueries({
        predicate: (query) => {
            const keyRoot = Array.isArray(query.queryKey) && query.queryKey.length > 0
                ? String(query.queryKey[0])
                : '';
            return SELECTIVE_RECONNECT_QUERY_KEYS.has(keyRoot);
        },
        refetchType: 'active',
    });

    if (__DEV__) {
        console.log(`[QueryClient] Selective reconnect invalidation completed (${reason})`);
    }
}

export const queryPersister = createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'rq-cache-v1',
});
