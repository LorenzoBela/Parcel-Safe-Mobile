/**
 * EC-91: Resource Conflict / Priority Interrupt Tests
 * 
 * Tests for critical section management and keypad event queuing.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock critical section types (should match hardware/ResourceLock.h)
type CriticalSectionType = 'CAMERA_CAPTURE' | 'SPIFFS_WRITE' | 'FIREBASE_UPLOAD' | 'OTP_VALIDATION' | 'NONE';

// Event queue configuration
const EVENT_QUEUE_CONFIG = {
    MAX_QUEUE_SIZE: 10,
    CAMERA_CAPTURE_DURATION_MS: 500,
    SPIFFS_WRITE_DURATION_MS: 200,
    SAFETY_TIMEOUT_MS: 3000,
};

// Helper class for testing event queue logic
class MockEventQueue {
    private queue: string[] = [];
    private maxSize: number;

    constructor(maxSize: number = EVENT_QUEUE_CONFIG.MAX_QUEUE_SIZE) {
        this.maxSize = maxSize;
    }

    enqueue(event: string): boolean {
        if (this.queue.length >= this.maxSize) {
            return false; // Queue full, drop event
        }
        this.queue.push(event);
        return true;
    }

    dequeue(): string | undefined {
        return this.queue.shift();
    }

    size(): number {
        return this.queue.length;
    }

    isFull(): boolean {
        return this.queue.length >= this.maxSize;
    }

    isEmpty(): boolean {
        return this.queue.length === 0;
    }

    clear(): void {
        this.queue = [];
    }

    getAll(): string[] {
        return [...this.queue];
    }
}

// Mock critical section manager
class MockCriticalSectionManager {
    private inCritical: boolean = false;
    private currentSection: CriticalSectionType = 'NONE';
    private interruptsEnabled: boolean = true;

    enterCriticalSection(section: CriticalSectionType): boolean {
        if (this.inCritical) return false;
        this.inCritical = true;
        this.currentSection = section;
        this.interruptsEnabled = false;
        return true;
    }

    exitCriticalSection(): void {
        this.inCritical = false;
        this.currentSection = 'NONE';
        this.interruptsEnabled = true;
    }

    isInCriticalSection(): boolean {
        return this.inCritical;
    }

    getCurrentSection(): CriticalSectionType {
        return this.currentSection;
    }

    areInterruptsEnabled(): boolean {
        return this.interruptsEnabled;
    }
}

describe('EC-91: Priority Interrupt Crash (Resource Conflict)', () => {
    describe('Event Queue', () => {
        let queue: MockEventQueue;

        beforeEach(() => {
            queue = new MockEventQueue();
        });

        it('should start empty', () => {
            expect(queue.isEmpty()).toBe(true);
            expect(queue.size()).toBe(0);
        });

        it('should enqueue events successfully', () => {
            expect(queue.enqueue('KEY_1')).toBe(true);
            expect(queue.size()).toBe(1);
        });

        it('should dequeue in FIFO order', () => {
            queue.enqueue('KEY_1');
            queue.enqueue('KEY_2');
            queue.enqueue('KEY_3');

            expect(queue.dequeue()).toBe('KEY_1');
            expect(queue.dequeue()).toBe('KEY_2');
            expect(queue.dequeue()).toBe('KEY_3');
        });

        it('should respect max queue size', () => {
            for (let i = 0; i < EVENT_QUEUE_CONFIG.MAX_QUEUE_SIZE; i++) {
                expect(queue.enqueue(`KEY_${i}`)).toBe(true);
            }

            // Queue should now be full
            expect(queue.isFull()).toBe(true);
            expect(queue.enqueue('OVERFLOW')).toBe(false);
            expect(queue.size()).toBe(EVENT_QUEUE_CONFIG.MAX_QUEUE_SIZE);
        });

        it('should return undefined when dequeuing empty queue', () => {
            expect(queue.dequeue()).toBeUndefined();
        });

        it('should allow get all queued events', () => {
            queue.enqueue('KEY_1');
            queue.enqueue('KEY_2');

            const events = queue.getAll();
            expect(events).toEqual(['KEY_1', 'KEY_2']);
        });

        it('should clear queue properly', () => {
            queue.enqueue('KEY_1');
            queue.enqueue('KEY_2');
            queue.clear();

            expect(queue.isEmpty()).toBe(true);
            expect(queue.size()).toBe(0);
        });
    });

    describe('Critical Section Manager', () => {
        let manager: MockCriticalSectionManager;

        beforeEach(() => {
            manager = new MockCriticalSectionManager();
        });

        it('should start in non-critical state', () => {
            expect(manager.isInCriticalSection()).toBe(false);
            expect(manager.getCurrentSection()).toBe('NONE');
        });

        it('should enter critical section successfully', () => {
            expect(manager.enterCriticalSection('CAMERA_CAPTURE')).toBe(true);
            expect(manager.isInCriticalSection()).toBe(true);
            expect(manager.getCurrentSection()).toBe('CAMERA_CAPTURE');
        });

        it('should disable interrupts when in critical section', () => {
            expect(manager.areInterruptsEnabled()).toBe(true);

            manager.enterCriticalSection('CAMERA_CAPTURE');
            expect(manager.areInterruptsEnabled()).toBe(false);

            manager.exitCriticalSection();
            expect(manager.areInterruptsEnabled()).toBe(true);
        });

        it('should prevent nested critical sections', () => {
            manager.enterCriticalSection('CAMERA_CAPTURE');
            expect(manager.enterCriticalSection('SPIFFS_WRITE')).toBe(false);
            expect(manager.getCurrentSection()).toBe('CAMERA_CAPTURE');
        });

        it('should exit critical section properly', () => {
            manager.enterCriticalSection('CAMERA_CAPTURE');
            manager.exitCriticalSection();

            expect(manager.isInCriticalSection()).toBe(false);
            expect(manager.getCurrentSection()).toBe('NONE');
            expect(manager.areInterruptsEnabled()).toBe(true);
        });
    });

    describe('Configuration', () => {
        it('should have correct max queue size', () => {
            expect(EVENT_QUEUE_CONFIG.MAX_QUEUE_SIZE).toBe(10);
        });

        it('should have correct camera capture duration', () => {
            expect(EVENT_QUEUE_CONFIG.CAMERA_CAPTURE_DURATION_MS).toBe(500);
        });

        it('should have correct SPIFFS write duration', () => {
            expect(EVENT_QUEUE_CONFIG.SPIFFS_WRITE_DURATION_MS).toBe(200);
        });

        it('should have safety timeout for stuck operations', () => {
            expect(EVENT_QUEUE_CONFIG.SAFETY_TIMEOUT_MS).toBe(3000);
        });
    });

    describe('Integration Scenarios', () => {
        it('should queue keypad events during camera capture', () => {
            const queue = new MockEventQueue();
            const manager = new MockCriticalSectionManager();

            manager.enterCriticalSection('CAMERA_CAPTURE');

            // Simulate keypad presses during critical section
            queue.enqueue('KEY_1');
            queue.enqueue('KEY_2');
            queue.enqueue('KEY_3');

            expect(queue.size()).toBe(3);
            expect(manager.areInterruptsEnabled()).toBe(false);

            // Exit critical section and process events
            manager.exitCriticalSection();

            expect(manager.areInterruptsEnabled()).toBe(true);
            expect(queue.dequeue()).toBe('KEY_1');
            expect(queue.dequeue()).toBe('KEY_2');
            expect(queue.dequeue()).toBe('KEY_3');
        });

        it('should handle rapid key presses without overflow', () => {
            const queue = new MockEventQueue();

            // Simulate 8 rapid key presses (within limit)
            for (let i = 0; i < 8; i++) {
                expect(queue.enqueue(`KEY_${i}`)).toBe(true);
            }

            expect(queue.size()).toBe(8);
            expect(queue.isFull()).toBe(false);
        });

        it('should gracefully handle queue overflow', () => {
            const queue = new MockEventQueue();

            // Fill queue
            for (let i = 0; i < 10; i++) {
                queue.enqueue(`KEY_${i}`);
            }

            // Try to add more
            const result = queue.enqueue('OVERFLOW');

            expect(result).toBe(false);
            expect(queue.size()).toBe(10);
        });
    });
});
