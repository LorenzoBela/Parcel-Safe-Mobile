import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Linking } from 'react-native';
import * as Application from 'expo-application';

type BinaryUpdateGateState = {
  isUpdateRequired: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotes: string[];
  downloadUrl: string;
  isChecking: boolean;
  recheck: () => Promise<void>;
  openUpdateUrl: () => Promise<void>;
};

const GITHUB_RELEASE_API_URL =
  'https://api.github.com/repos/LorenzoBela/Parcel-Safe-Mobile/releases/latest';
const FALLBACK_APK_URL =
  'https://github.com/LorenzoBela/Parcel-Safe-Mobile/releases/latest/download/Parcel.Safe.apk';
const RECHECK_INTERVAL_MS = 30 * 60 * 1000;

function parseVersion(value: string): number[] {
  return String(value)
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number(part.replace(/\D/g, '')) || 0)
    .slice(0, 3);
}

function isRemoteVersionNewer(current: string, remote: string): boolean {
  const c = parseVersion(current);
  const r = parseVersion(remote);

  for (let i = 0; i < 3; i += 1) {
    const cv = c[i] || 0;
    const rv = r[i] || 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }

  return false;
}

function extractReleaseNotes(body: unknown): string[] {
  if (typeof body !== 'string' || body.length === 0) return [];

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.startsWith('-') || line.startsWith('*'))
    .map((line) => line.replace(/^[-*]\s*/, ''))
    .slice(0, 4);
}

export function useBinaryUpdateGate(): BinaryUpdateGateState {
  const [isUpdateRequired, setIsUpdateRequired] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState(FALLBACK_APK_URL);
  const [isChecking, setIsChecking] = useState(false);
  const isCheckingRef = useRef(false);

  const currentVersion = Application.nativeApplicationVersion || '0.0.0';

  const recheck = useCallback(async () => {
    if (isCheckingRef.current) return;

    isCheckingRef.current = true;
    setIsChecking(true);

    try {
      const response = await fetch(GITHUB_RELEASE_API_URL);
      if (!response.ok) {
        throw new Error(`Release check failed with status ${response.status}`);
      }

      const releaseData = await response.json();
      const remoteVersion: string =
        releaseData?.tag_name || releaseData?.name || '0.0.0';
      const notes = extractReleaseNotes(releaseData?.body);

      const apkAsset = releaseData?.assets?.find(
        (asset: any) =>
          asset?.name === 'Parcel.Safe.apk' ||
          asset?.name === 'Parcel Safe.apk' ||
          asset?.name === 'ParcelSafe.apk',
      );

      const apkUrl =
        apkAsset?.browser_download_url ||
        releaseData?.html_url ||
        FALLBACK_APK_URL;

      setLatestVersion(remoteVersion);
      setReleaseNotes(notes);
      setDownloadUrl(apkUrl);
      setIsUpdateRequired(isRemoteVersionNewer(currentVersion, remoteVersion));
    } catch (error) {
      if (__DEV__) {
        console.warn('[BinaryUpdateGate] recheck failed:', error);
      }
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, [currentVersion]);

  useEffect(() => {
    recheck();

    const interval = setInterval(recheck, RECHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') recheck();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [recheck]);

  const openUpdateUrl = useCallback(async () => {
    const canOpen = await Linking.canOpenURL(downloadUrl);
    if (canOpen) {
      await Linking.openURL(downloadUrl);
      return;
    }

    await Linking.openURL(FALLBACK_APK_URL);
  }, [downloadUrl]);

  return {
    isUpdateRequired,
    currentVersion,
    latestVersion,
    releaseNotes,
    downloadUrl,
    isChecking,
    recheck,
    openUpdateUrl,
  };
}
