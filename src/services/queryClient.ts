import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 2,
            retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 10000),
            staleTime: 60 * 1000,
            gcTime: 10 * 60 * 1000,
            refetchOnReconnect: true,
            refetchOnMount: true,
        },
    },
});

export const queryPersister = createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'rq-cache-v1',
});
