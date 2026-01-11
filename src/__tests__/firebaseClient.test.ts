/**
 * Unit tests for Firebase Realtime Database client
 * Tests location subscriptions, writes, and box state management
 */

import {
  subscribeToLocation,
  subscribeToBoxState,
  writePhoneLocation,
  updateBoxState,
  LocationData,
  BoxState,
} from '../services/firebaseClient';
import { ref } from 'firebase/database';

// Mock Firebase RTDB
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockSet = jest.fn(() => Promise.resolve());

jest.mock('firebase/database', () => ({
  getDatabase: jest.fn(() => ({})),
  ref: jest.fn(() => ({
    on: mockOn,
    off: mockOff,
    set: mockSet,
  })),
  onValue: jest.fn((dbRef, callback) => {
    // Store callback for manual invocation in tests
    mockOn.mockImplementation((eventType, cb) => {
      if (eventType === 'value') callback({ val: () => null });
    });
    return () => mockOff();
  }),
  set: mockSet,
}));

// Mock firebase config (prevents import errors)
jest.mock('../config/firebase', () => ({}), { virtual: true });

describe('firebaseClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('subscribeToLocation', () => {
    test('subscribes to box location updates', () => {
      const mockCallback = jest.fn();
      const unsubscribe = subscribeToLocation('BOX_001', mockCallback);

      expect(ref).toHaveBeenCalledWith(expect.anything(), 'locations/BOX_001');
      expect(typeof unsubscribe).toBe('function');
    });

    test('invokes callback when location data received', () => {
      const { onValue } = require('firebase/database');
      const mockCallback = jest.fn();
      
      const mockLocationData: LocationData = {
        latitude: 14.5995,
        longitude: 120.9842,
        timestamp: Date.now(),
        source: 'box',
        server_timestamp: Date.now(),
      };

      onValue.mockImplementation((dbRef, callback) => {
        callback({ val: () => mockLocationData });
        return () => {};
      });

      subscribeToLocation('BOX_001', mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(mockLocationData);
    });

    test('handles null location data gracefully', () => {
      const { onValue } = require('firebase/database');
      const mockCallback = jest.fn();

      onValue.mockImplementation((dbRef, callback) => {
        callback({ val: () => null });
        return () => {};
      });

      subscribeToLocation('BOX_001', mockCallback);

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test('unsubscribe function stops receiving updates', () => {
      const { onValue } = require('firebase/database');
      const mockUnsubscribeFn = jest.fn();
      onValue.mockReturnValue(mockUnsubscribeFn);

      const unsubscribe = subscribeToLocation('BOX_001', jest.fn());
      
      expect(mockUnsubscribeFn).not.toHaveBeenCalled();
      
      unsubscribe();
      
      expect(mockUnsubscribeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribeToBoxState', () => {
    test('subscribes to box state updates', () => {
      const mockCallback = jest.fn();
      const unsubscribe = subscribeToBoxState('BOX_001', mockCallback);

      expect(ref).toHaveBeenCalledWith(expect.anything(), 'boxes/BOX_001/state');
      expect(typeof unsubscribe).toBe('function');
    });

    test('invokes callback with box state data', () => {
      const { onValue } = require('firebase/database');
      const mockCallback = jest.fn();

      const mockBoxState: BoxState = {
        status: 'ACTIVE',
        delivery_id: 'DEL_001',
        last_heartbeat: Date.now(),
      };

      onValue.mockImplementation((dbRef, callback) => {
        callback({ val: () => mockBoxState });
        return () => {};
      });

      subscribeToBoxState('BOX_001', mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(mockBoxState);
    });

    test('handles null box state gracefully', () => {
      const { onValue } = require('firebase/database');
      const mockCallback = jest.fn();

      onValue.mockImplementation((dbRef, callback) => {
        callback({ val: () => null });
        return () => {};
      });

      subscribeToBoxState('BOX_001', mockCallback);

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('writePhoneLocation', () => {
    test('writes phone GPS location to Firebase', async () => {
      const { set } = require('firebase/database');

      await writePhoneLocation('BOX_001', 14.6042, 121.0246, 5.5, 180);

      expect(ref).toHaveBeenCalledWith(expect.anything(), 'locations/BOX_001');
      expect(set).toHaveBeenCalled();
      const callArgs = set.mock.calls[0][1];
      expect(callArgs.latitude).toBe(14.6042);
      expect(callArgs.longitude).toBe(121.0246);
      expect(callArgs.source).toBe('phone');
    });

    test('throws error when write fails', async () => {
      const { set } = require('firebase/database');
      set.mockRejectedValueOnce(new Error('Network error'));

      await expect(writePhoneLocation('BOX_001', 14.6042, 121.0246)).rejects.toThrow('Network error');
    });
  });

  describe('updateBoxState', () => {
    test('updates box state in Firebase', async () => {
      const { set } = require('firebase/database');
      const boxState: BoxState = {
        status: 'ARRIVED',
        delivery_id: 'DEL_001',
        otp_code: '123456',
      };

      await updateBoxState('BOX_001', boxState);

      expect(ref).toHaveBeenCalledWith(expect.anything(), 'boxes/BOX_001/state');
      expect(set).toHaveBeenCalledWith(expect.anything(), boxState);
    });

    test('handles partial state updates', async () => {
      const { set } = require('firebase/database');
      const partialState: Partial<BoxState> = {
        status: 'STANDBY',
        last_heartbeat: Date.now(),
      };

      await updateBoxState('BOX_001', partialState);

      expect(set).toHaveBeenCalledWith(expect.anything(), partialState);
    });
  });

  describe('data validation', () => {
    test('location data has required fields', () => {
      const { onValue } = require('firebase/database');
      const mockCallback = jest.fn();

      const invalidLocation = {
        latitude: 14.5995,
        // Missing longitude, source, timestamp
      };

      onValue.mockImplementation((dbRef, callback) => {
        callback({ val: () => invalidLocation });
        return () => {};
      });

      subscribeToLocation('BOX_001', mockCallback);

      // Should still invoke callback (validation happens in business logic layer)
      expect(mockCallback).toHaveBeenCalledWith(invalidLocation);
    });
  });
});
