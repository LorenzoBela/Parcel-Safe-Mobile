let initialized = false;

type SentryLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

type SentryModule = {
  init: (options: Record<string, unknown>) => void;
  withScope: (callback: (scope: { setTag: (key: string, value: string) => void; setLevel: (level: SentryLevel) => void }) => void) => void;
  captureException: (error: unknown) => void;
  captureMessage: (message: string) => void;
};

let sentryModule: SentryModule | null | undefined;

function getSentry(): SentryModule | null {
  if (sentryModule !== undefined) {
    return sentryModule;
  }

  try {
    // Lazy-load avoids Jest parsing ESM in environments where it is not transformed.
    sentryModule = require('@sentry/react-native') as SentryModule;
  } catch {
    sentryModule = null;
  }

  return sentryModule;
}

export function initializeSentry(): void {
  if (initialized) return;

  const Sentry = getSentry();
  if (!Sentry) return;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    if (__DEV__) {
      console.log('[Sentry] EXPO_PUBLIC_SENTRY_DSN missing. Skipping initialization.');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 0 : 0.1,
    enableAutoPerformanceTracing: false,
  });

  initialized = true;
}

export function captureHandledError(error: unknown, context?: Record<string, string>): void {
  if (!initialized) return;
  const Sentry = getSentry();
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => scope.setTag(key, value));
    }
    Sentry.captureException(error);
  });
}

export function captureHandledMessage(
  message: string,
  context?: Record<string, string>,
  level: SentryLevel = 'info'
): void {
  if (!initialized) return;
  const Sentry = getSentry();
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => scope.setTag(key, value));
    }
    scope.setLevel(level);
    Sentry.captureMessage(message);
  });
}
