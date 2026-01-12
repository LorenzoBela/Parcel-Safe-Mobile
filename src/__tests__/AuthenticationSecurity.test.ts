/**
 * Authentication & Authorization Tests
 * 
 * Tests for security-related cases based on:
 * - NEGATIVE_CASES.md: NC-AUTH-01 to NC-AUTH-10
 * - BOUNDARY_CASES.md: BC-TIME-07, BC-TIME-08 (Session)
 * - EDGE_CASES.md: Session management edge cases
 * 
 * CRITICAL: Security is paramount for delivery systems
 */

// ============ CONSTANTS ============
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CONCURRENT_SESSIONS = 3;
const TOKEN_REFRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour before expiry
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

// ============ TYPES ============
interface Session {
    token: string;
    userId: string;
    createdAt: number;
    expiresAt: number;
    deviceId: string;
    lastActivity: number;
}

interface LoginAttempt {
    userId: string;
    timestamp: number;
    success: boolean;
    ipAddress: string;
}

interface User {
    id: string;
    email: string;
    role: 'customer' | 'rider' | 'admin';
    isActive: boolean;
    emailVerified: boolean;
}

// ============ SESSION UTILITIES ============
function isSessionExpired(session: Session, now: number): boolean {
    return now >= session.expiresAt;
}

function isSessionInactive(session: Session, now: number, inactivityThreshold: number = 3600000): boolean {
    return (now - session.lastActivity) > inactivityThreshold;
}

function shouldRefreshToken(session: Session, now: number): boolean {
    const timeUntilExpiry = session.expiresAt - now;
    return timeUntilExpiry > 0 && timeUntilExpiry <= TOKEN_REFRESH_THRESHOLD_MS;
}

function canCreateSession(activeSessions: number): boolean {
    return activeSessions < MAX_CONCURRENT_SESSIONS;
}

function isValidToken(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    // JWT format: header.payload.signature (3 parts separated by dots)
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    // Each part should be non-empty base64
    return parts.every(part => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

// ============ LOGIN SECURITY ============
function isAccountLocked(attempts: LoginAttempt[], userId: string, now: number): boolean {
    const recentFailures = attempts.filter(a => 
        a.userId === userId &&
        !a.success &&
        (now - a.timestamp) < LOGIN_LOCKOUT_DURATION_MS
    );
    return recentFailures.length >= MAX_LOGIN_ATTEMPTS;
}

function getRemainingLockoutTime(attempts: LoginAttempt[], userId: string, now: number): number {
    const recentFailures = attempts
        .filter(a => a.userId === userId && !a.success && (now - a.timestamp) < LOGIN_LOCKOUT_DURATION_MS)
        .sort((a, b) => a.timestamp - b.timestamp);
    
    if (recentFailures.length < MAX_LOGIN_ATTEMPTS) return 0;
    
    const oldestRelevantAttempt = recentFailures[0];
    const lockoutEndsAt = oldestRelevantAttempt.timestamp + LOGIN_LOCKOUT_DURATION_MS;
    return Math.max(0, lockoutEndsAt - now);
}

// ============ PASSWORD VALIDATION ============
function isPasswordValid(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < PASSWORD_MIN_LENGTH) {
        errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
        errors.push(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    
    return { valid: errors.length === 0, errors };
}

// ============ AUTHORIZATION ============
function canAccessDelivery(user: User, deliveryCustomerId: string | null, deliveryRiderId: string | null): boolean {
    if (!user.isActive) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'customer' && deliveryCustomerId === user.id) return true;
    if (user.role === 'rider' && deliveryRiderId === user.id) return true;
    return false;
}

function canModifyDelivery(user: User, deliveryRiderId: string | null): boolean {
    if (!user.isActive) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'rider' && deliveryRiderId === user.id) return true;
    return false;
}

function canAccessAdminPanel(user: User): boolean {
    return user.isActive && user.role === 'admin';
}

// ============ TESTS: SESSION MANAGEMENT ============
describe('NC-AUTH: Session Management', () => {
    const NOW = Date.now();

    describe('NC-AUTH-01: Session Expiration', () => {
        test('should detect expired session', () => {
            const expiredSession: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 25 * 60 * 60 * 1000,
                expiresAt: NOW - 60 * 60 * 1000, // Expired 1 hour ago
                deviceId: 'device-1',
                lastActivity: NOW - 2 * 60 * 60 * 1000,
            };
            expect(isSessionExpired(expiredSession, NOW)).toBe(true);
        });

        test('should accept valid session', () => {
            const validSession: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 12 * 60 * 60 * 1000,
                expiresAt: NOW + 12 * 60 * 60 * 1000, // Expires in 12 hours
                deviceId: 'device-1',
                lastActivity: NOW - 5 * 60 * 1000,
            };
            expect(isSessionExpired(validSession, NOW)).toBe(false);
        });

        test('BC-TIME-07: should detect exactly expired session', () => {
            const boundarySession: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 24 * 60 * 60 * 1000,
                expiresAt: NOW, // Expiring right now
                deviceId: 'device-1',
                lastActivity: NOW - 10 * 60 * 1000,
            };
            expect(isSessionExpired(boundarySession, NOW)).toBe(true);
        });
    });

    describe('NC-AUTH-02: Inactive Session', () => {
        test('should detect inactive session (1 hour threshold)', () => {
            const inactiveSession: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 5 * 60 * 60 * 1000,
                expiresAt: NOW + 19 * 60 * 60 * 1000,
                deviceId: 'device-1',
                lastActivity: NOW - 2 * 60 * 60 * 1000, // 2 hours ago
            };
            expect(isSessionInactive(inactiveSession, NOW)).toBe(true);
        });

        test('should accept recently active session', () => {
            const activeSession: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 5 * 60 * 60 * 1000,
                expiresAt: NOW + 19 * 60 * 60 * 1000,
                deviceId: 'device-1',
                lastActivity: NOW - 30 * 60 * 1000, // 30 minutes ago
            };
            expect(isSessionInactive(activeSession, NOW)).toBe(false);
        });
    });

    describe('NC-AUTH-03: Token Refresh', () => {
        test('should recommend refresh when close to expiry', () => {
            const session: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 23 * 60 * 60 * 1000,
                expiresAt: NOW + 30 * 60 * 1000, // 30 minutes left
                deviceId: 'device-1',
                lastActivity: NOW,
            };
            expect(shouldRefreshToken(session, NOW)).toBe(true);
        });

        test('should NOT recommend refresh when plenty of time', () => {
            const session: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 12 * 60 * 60 * 1000,
                expiresAt: NOW + 12 * 60 * 60 * 1000, // 12 hours left
                deviceId: 'device-1',
                lastActivity: NOW,
            };
            expect(shouldRefreshToken(session, NOW)).toBe(false);
        });

        test('should NOT recommend refresh for expired token', () => {
            const session: Session = {
                token: 'abc.def.ghi',
                userId: 'user-1',
                createdAt: NOW - 25 * 60 * 60 * 1000,
                expiresAt: NOW - 60 * 1000, // Already expired
                deviceId: 'device-1',
                lastActivity: NOW - 2 * 60 * 60 * 1000,
            };
            expect(shouldRefreshToken(session, NOW)).toBe(false);
        });
    });

    describe('NC-AUTH-04: Concurrent Sessions', () => {
        test('should allow session when under limit', () => {
            expect(canCreateSession(0)).toBe(true);
            expect(canCreateSession(1)).toBe(true);
            expect(canCreateSession(2)).toBe(true);
        });

        test('should reject session when at limit', () => {
            expect(canCreateSession(3)).toBe(false);
            expect(canCreateSession(4)).toBe(false);
        });
    });
});

// ============ TESTS: TOKEN VALIDATION ============
describe('NC-AUTH-05: Token Validation', () => {
    test('should accept valid JWT format', () => {
        expect(isValidToken('eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiMTIzIn0.dGVzdA')).toBe(true);
    });

    test('should reject empty token', () => {
        expect(isValidToken('')).toBe(false);
    });

    test('should reject null/undefined token', () => {
        expect(isValidToken(null as unknown as string)).toBe(false);
        expect(isValidToken(undefined as unknown as string)).toBe(false);
    });

    test('should reject malformed token (missing parts)', () => {
        expect(isValidToken('onlyonepart')).toBe(false);
        expect(isValidToken('two.parts')).toBe(false);
        expect(isValidToken('four.parts.are.invalid')).toBe(false);
    });

    test('should reject token with empty parts', () => {
        expect(isValidToken('..signature')).toBe(false);
        expect(isValidToken('header..')).toBe(false);
        expect(isValidToken('.payload.')).toBe(false);
    });

    test('should reject token with invalid characters', () => {
        expect(isValidToken('abc$.def.ghi')).toBe(false);
        expect(isValidToken('abc.def!.ghi')).toBe(false);
    });
});

// ============ TESTS: LOGIN SECURITY ============
describe('NC-AUTH-06: Login Security', () => {
    const NOW = Date.now();

    test('should NOT lock account with few failures', () => {
        const attempts: LoginAttempt[] = [
            { userId: 'user-1', timestamp: NOW - 60000, success: false, ipAddress: '192.168.1.1' },
            { userId: 'user-1', timestamp: NOW - 30000, success: false, ipAddress: '192.168.1.1' },
        ];
        expect(isAccountLocked(attempts, 'user-1', NOW)).toBe(false);
    });

    test('should lock account after 5 failures', () => {
        const attempts: LoginAttempt[] = Array.from({ length: 5 }, (_, i) => ({
            userId: 'user-1',
            timestamp: NOW - (i + 1) * 60000,
            success: false,
            ipAddress: '192.168.1.1',
        }));
        expect(isAccountLocked(attempts, 'user-1', NOW)).toBe(true);
    });

    test('should unlock account after lockout period', () => {
        const attempts: LoginAttempt[] = Array.from({ length: 5 }, (_, i) => ({
            userId: 'user-1',
            timestamp: NOW - LOGIN_LOCKOUT_DURATION_MS - (i + 1) * 60000, // All outside window
            success: false,
            ipAddress: '192.168.1.1',
        }));
        expect(isAccountLocked(attempts, 'user-1', NOW)).toBe(false);
    });

    test('should ignore successful logins in lockout calculation', () => {
        const attempts: LoginAttempt[] = [
            { userId: 'user-1', timestamp: NOW - 300000, success: true, ipAddress: '192.168.1.1' },
            { userId: 'user-1', timestamp: NOW - 240000, success: false, ipAddress: '192.168.1.1' },
            { userId: 'user-1', timestamp: NOW - 180000, success: false, ipAddress: '192.168.1.1' },
            { userId: 'user-1', timestamp: NOW - 120000, success: false, ipAddress: '192.168.1.1' },
            { userId: 'user-1', timestamp: NOW - 60000, success: false, ipAddress: '192.168.1.1' },
        ];
        expect(isAccountLocked(attempts, 'user-1', NOW)).toBe(false); // Only 4 failures
    });

    test('should calculate remaining lockout time', () => {
        const fiveMinutesAgo = NOW - 5 * 60 * 1000;
        const attempts: LoginAttempt[] = Array.from({ length: 5 }, (_, i) => ({
            userId: 'user-1',
            timestamp: fiveMinutesAgo + i * 1000, // All within window
            success: false,
            ipAddress: '192.168.1.1',
        }));
        
        const remaining = getRemainingLockoutTime(attempts, 'user-1', NOW);
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(LOGIN_LOCKOUT_DURATION_MS);
    });
});

// ============ TESTS: PASSWORD VALIDATION ============
describe('NC-AUTH-07: Password Validation', () => {
    test('should accept strong password', () => {
        const result = isPasswordValid('MyP@ssw0rd!');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('should reject short password', () => {
        const result = isPasswordValid('Ab1!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    });

    test('should reject password without uppercase', () => {
        const result = isPasswordValid('myp@ssw0rd!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    test('should reject password without lowercase', () => {
        const result = isPasswordValid('MYP@SSW0RD!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    test('should reject password without number', () => {
        const result = isPasswordValid('MyP@ssword!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one number');
    });

    test('should reject password without special character', () => {
        const result = isPasswordValid('MyPassw0rd');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one special character');
    });

    test('should reject excessively long password', () => {
        const longPassword = 'A'.repeat(129) + 'a1!';
        const result = isPasswordValid(longPassword);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
    });
});

// ============ TESTS: AUTHORIZATION ============
describe('NC-AUTH-08: Authorization Checks', () => {
    const customerUser: User = { id: 'cust-1', email: 'cust@test.com', role: 'customer', isActive: true, emailVerified: true };
    const riderUser: User = { id: 'rider-1', email: 'rider@test.com', role: 'rider', isActive: true, emailVerified: true };
    const adminUser: User = { id: 'admin-1', email: 'admin@test.com', role: 'admin', isActive: true, emailVerified: true };
    const inactiveUser: User = { id: 'inactive-1', email: 'inactive@test.com', role: 'customer', isActive: false, emailVerified: true };

    describe('Delivery Access', () => {
        test('customer can access their own delivery', () => {
            expect(canAccessDelivery(customerUser, 'cust-1', 'rider-2')).toBe(true);
        });

        test('customer cannot access another customer delivery', () => {
            expect(canAccessDelivery(customerUser, 'cust-2', 'rider-2')).toBe(false);
        });

        test('rider can access their assigned delivery', () => {
            expect(canAccessDelivery(riderUser, 'cust-1', 'rider-1')).toBe(true);
        });

        test('rider cannot access unassigned delivery', () => {
            expect(canAccessDelivery(riderUser, 'cust-1', 'rider-2')).toBe(false);
        });

        test('admin can access any delivery', () => {
            expect(canAccessDelivery(adminUser, 'cust-1', 'rider-2')).toBe(true);
            expect(canAccessDelivery(adminUser, 'cust-2', 'rider-3')).toBe(true);
        });

        test('inactive user cannot access any delivery', () => {
            expect(canAccessDelivery(inactiveUser, 'inactive-1', null)).toBe(false);
        });
    });

    describe('Delivery Modification', () => {
        test('rider can modify their assigned delivery', () => {
            expect(canModifyDelivery(riderUser, 'rider-1')).toBe(true);
        });

        test('rider cannot modify unassigned delivery', () => {
            expect(canModifyDelivery(riderUser, 'rider-2')).toBe(false);
        });

        test('customer cannot modify delivery', () => {
            expect(canModifyDelivery(customerUser, null)).toBe(false);
        });

        test('admin can modify any delivery', () => {
            expect(canModifyDelivery(adminUser, 'rider-1')).toBe(true);
            expect(canModifyDelivery(adminUser, null)).toBe(true);
        });
    });

    describe('Admin Panel Access', () => {
        test('admin can access admin panel', () => {
            expect(canAccessAdminPanel(adminUser)).toBe(true);
        });

        test('customer cannot access admin panel', () => {
            expect(canAccessAdminPanel(customerUser)).toBe(false);
        });

        test('rider cannot access admin panel', () => {
            expect(canAccessAdminPanel(riderUser)).toBe(false);
        });

        test('inactive admin cannot access admin panel', () => {
            const inactiveAdmin: User = { ...adminUser, isActive: false };
            expect(canAccessAdminPanel(inactiveAdmin)).toBe(false);
        });
    });
});
