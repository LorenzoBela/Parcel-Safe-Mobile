/**
 * Token Utility Functions
 * 
 * Helper functions for generating unique tokens and identifiers.
 */

/**
 * Generate a random alphanumeric string for share tokens
 * @param length - Length of the token (default: 32)
 */
export function generateShareToken(length: number = 32): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let index = 0; index < length; index += 1) {
        token += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return token;
}

/**
 * Generate a 6-digit numeric OTP
 */
export function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
