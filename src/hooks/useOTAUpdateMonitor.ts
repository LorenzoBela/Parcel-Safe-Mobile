import * as Updates from 'expo-updates';
import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/** How often (ms) to poll for updates as a safety-net alongside the reactive hook. */
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Monitors for OTA updates using the expo-updates reactive `useUpdates()` hook.
 *
 * Lifecycle:
 *  1. On mount + every 5 min + every foreground resume → `checkForUpdateAsync()`
 *  2. When `isUpdateAvailable` flips true → silently `fetchUpdateAsync()`
 *  3. When `isUpdatePending` flips true (download done) → exposes `showModal = true`
 *
 * The calling component renders the OTAUpdateModal driven by the returned state.
 * In __DEV__ the hook is a safe no-op (useUpdates() would throw).
 */
export function useOTAUpdateMonitor() {
  const [showModal, setShowModal] = useState(false);
  const hasPrompted = useRef(false);

  // ── Reactive update state ────────────────────────────────────────
  // useUpdates() only works inside a production build that has the
  // expo-updates native module linked. In __DEV__ we short-circuit
  // with static falsy values so the hook is inert.
  const {
    isUpdateAvailable,
    isUpdatePending,
    currentlyRunning,
  } = __DEV__
    ? { isUpdateAvailable: false, isUpdatePending: false, currentlyRunning: null as any }
    : Updates.useUpdates();

  // ── Auto-fetch when a new update is detected ─────────────────────
  useEffect(() => {
    if (!isUpdateAvailable) return;
    Updates.fetchUpdateAsync().catch((err) => {
      if (__DEV__) console.warn('[OTA] fetchUpdateAsync failed:', err);
    });
  }, [isUpdateAvailable]);

  // ── Show modal once the download completes ───────────────────────
  useEffect(() => {
    if (isUpdatePending && !hasPrompted.current) {
      hasPrompted.current = true;
      setShowModal(true);
    }
  }, [isUpdatePending]);

  // ── Initial check + periodic poll + foreground resume ────────────
  useEffect(() => {
    if (__DEV__) return;

    const safeCheck = () => {
      Updates.checkForUpdateAsync().catch(() => {
        /* non-fatal: network offline, EAS down, etc. */
      });
    };

    // Immediate first check
    safeCheck();

    // Periodic safety-net
    const interval = setInterval(safeCheck, POLL_INTERVAL_MS);

    // Re-check when app returns to foreground
    const handleAppState = (next: AppStateStatus) => {
      if (next === 'active') safeCheck();
    };
    const subscription = AppState.addEventListener('change', handleAppState);

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  // ── Callbacks for the modal ──────────────────────────────────────
  const handleRestart = useCallback(() => {
    Updates.reloadAsync().catch((err) => {
      if (__DEV__) console.warn('[OTA] reloadAsync failed:', err);
    });
  }, []);

  return { showModal, handleRestart, currentlyRunning };
}
