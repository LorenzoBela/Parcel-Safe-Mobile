/**
 * @jest-environment jsdom
 * 
 * Unit tests for useLocationRedundancy React hook
 * Tests lifecycle management and state synchronization with redundancy manager
 */

import { renderHook, act } from '@testing-library/react';
import { useLocationRedundancy } from '../hooks/useLocationRedundancy';
import { locationRedundancy } from '../services/locationRedundancy';

// Mock expo-location to prevent ESM syntax errors
jest.mock('expo-location', () => ({
  __esModule: true,
  default: {},
  PermissionStatus: {},
}));

// Mock the locationRedundancy service
jest.mock('../services/locationRedundancy', () => {
  const actualModule = jest.requireActual('../services/locationRedundancy');
  return {
    ...actualModule,
    locationRedundancy: {
      start: jest.fn(),
      stop: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
      getState: jest.fn(() => ({
        powerState: 'SLEEP',
        source: 'none',
        isBoxOnline: false,
        phoneGpsActive: false,
        lastLocation: null,
        lastBoxHeartbeat: null,
      })),
      subscribe: jest.fn(() => jest.fn()), // Return unsubscribe function
    },
  };
});

describe('useLocationRedundancy hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    test('returns initial state from redundancy manager', () => {
      const { result } = renderHook(() => useLocationRedundancy());

      expect(result.current.powerState).toBe('SLEEP');
      expect(result.current.source).toBe('none');
      expect(result.current.isBoxOnline).toBe(false);
      expect(result.current.phoneGpsActive).toBe(false);
      expect(result.current.lastLocation).toBe(null);
      expect(result.current.lastBoxHeartbeat).toBe(null);
    });

    test('subscribes to redundancy manager state changes on mount', () => {
      renderHook(() => useLocationRedundancy());

      expect(locationRedundancy.subscribe).toHaveBeenCalledTimes(1);
      expect(locationRedundancy.subscribe).toHaveBeenCalledWith(expect.any(Function));
    });

    test('unsubscribes from redundancy manager on unmount', () => {
      const mockUnsubscribe = jest.fn();
      (locationRedundancy.subscribe as jest.Mock).mockReturnValue(mockUnsubscribe);

      const { unmount } = renderHook(() => useLocationRedundancy());

      expect(mockUnsubscribe).not.toHaveBeenCalled();

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('auto-monitoring', () => {
    test('starts monitoring when boxId prop is provided', () => {
      renderHook(() => useLocationRedundancy('BOX_001'));

      expect(locationRedundancy.start).toHaveBeenCalledTimes(1);
      expect(locationRedundancy.start).toHaveBeenCalledWith('BOX_001');
    });

    test('does not start monitoring when boxId is undefined', () => {
      renderHook(() => useLocationRedundancy());

      expect(locationRedundancy.start).not.toHaveBeenCalled();
    });

    test('activates tracking when boxId and autoActivate=true', () => {
      renderHook(() => useLocationRedundancy('BOX_001', true));

      expect(locationRedundancy.start).toHaveBeenCalledWith('BOX_001');
      expect(locationRedundancy.activate).toHaveBeenCalledTimes(1);
    });

    test('restarts monitoring when boxId changes', () => {
      const { rerender } = renderHook(
        ({ boxId }) => useLocationRedundancy(boxId),
        { initialProps: { boxId: 'BOX_001' } }
      );

      expect(locationRedundancy.start).toHaveBeenCalledWith('BOX_001');

      act(() => {
        rerender({ boxId: 'BOX_002' });
      });

      // Effect calls start again with new boxId (doesn't call stop first)
      expect(locationRedundancy.start).toHaveBeenCalledWith('BOX_002');
      expect(locationRedundancy.start).toHaveBeenCalledTimes(2);
    });

    test('does not stop monitoring when component unmounts (allows background operation)', () => {
      const { unmount } = renderHook(() => useLocationRedundancy('BOX_001'));

      unmount();

      // Verify stop was NOT called - hook allows background operation
      expect(locationRedundancy.stop).not.toHaveBeenCalled();
    });
  });

  describe('manual controls', () => {
    test('startMonitoring calls redundancy manager', () => {
      const { result } = renderHook(() => useLocationRedundancy());

      act(() => {
        result.current.startMonitoring('BOX_003');
      });

      expect(locationRedundancy.start).toHaveBeenCalledWith('BOX_003');
    });

    test('activateTracking calls redundancy manager', () => {
      const { result } = renderHook(() => useLocationRedundancy());

      act(() => {
        result.current.activateTracking();
      });

      expect(locationRedundancy.activate).toHaveBeenCalledTimes(1);
    });

    test('deactivateTracking calls redundancy manager', () => {
      const { result } = renderHook(() => useLocationRedundancy());

      act(() => {
        result.current.deactivateTracking();
      });

      expect(locationRedundancy.deactivate).toHaveBeenCalledTimes(1);
    });

    test('stopMonitoring calls redundancy manager', () => {
      const { result } = renderHook(() => useLocationRedundancy());

      act(() => {
        result.current.stopMonitoring();
      });

      expect(locationRedundancy.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('state updates', () => {
    test('updates state when redundancy manager notifies subscribers', () => {
      let stateUpdateCallback: Function | null = null;
      (locationRedundancy.subscribe as jest.Mock).mockImplementation((cb) => {
        stateUpdateCallback = cb;
        return jest.fn();
      });

      const { result } = renderHook(() => useLocationRedundancy());

      expect(result.current.powerState).toBe('SLEEP');

      // Simulate state change from redundancy manager
      const mockNewState = {
        powerState: 'ACTIVE',
        source: 'box',
        isBoxOnline: true,
        phoneGpsActive: false,
        lastLocation: { latitude: 10, longitude: 20, timestamp: Date.now(), source: 'box', server_timestamp: Date.now() },
        lastBoxHeartbeat: Date.now(),
      };

      (locationRedundancy.getState as jest.Mock).mockReturnValue(mockNewState);

      act(() => {
        stateUpdateCallback?.(mockNewState);
      });

      expect(result.current.powerState).toBe('ACTIVE');
      expect(result.current.source).toBe('box');
      expect(result.current.isBoxOnline).toBe(true);
      expect(result.current.lastLocation).toBeTruthy();
    });
  });
});
