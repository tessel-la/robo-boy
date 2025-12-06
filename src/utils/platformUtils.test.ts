import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isIOS, isMobile } from './platformUtils';

describe('platformUtils', () => {
    beforeEach(() => {
        // Reset mocks before each test
        vi.stubGlobal('navigator', { userAgent: '', maxTouchPoints: 0 });
        vi.stubGlobal('window', { MSStream: undefined });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('isIOS', () => {
        it('should return true for iPhone', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)' });
            expect(isIOS()).toBe(true);
        });

        it('should return true for iPad', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)' });
            expect(isIOS()).toBe(true);
        });

        it('should return true for iPod', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 14_0 like Mac OS X)' });
            expect(isIOS()).toBe(true);
        });

        it('should return false for Android', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 11)' });
            expect(isIOS()).toBe(false);
        });

        it('should return false for desktop Chrome', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0' });
            expect(isIOS()).toBe(false);
        });

        it('should return false when MSStream is present (IE on Windows Phone)', () => {
            vi.stubGlobal('navigator', { userAgent: 'iPhone' });
            vi.stubGlobal('window', { MSStream: {} });
            expect(isIOS()).toBe(false);
        });
    });

    describe('isMobile', () => {
        it('should return true for Android', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 11)', maxTouchPoints: 5 });
            expect(isMobile()).toBe(true);
        });

        it('should return true for iPhone', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)', maxTouchPoints: 5 });
            expect(isMobile()).toBe(true);
        });

        it('should return true for iPad', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0)', maxTouchPoints: 5 });
            expect(isMobile()).toBe(true);
        });

        it('should return true when maxTouchPoints > 2', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel)', maxTouchPoints: 5 });
            expect(isMobile()).toBe(true);
        });

        it('should return false for desktop Chrome', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0', maxTouchPoints: 0 });
            expect(isMobile()).toBe(false);
        });

        it('should return false for desktop Firefox', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0', maxTouchPoints: 0 });
            expect(isMobile()).toBe(false);
        });

        it('should return true for BlackBerry', () => {
            vi.stubGlobal('navigator', { userAgent: 'BlackBerry', maxTouchPoints: 0 });
            expect(isMobile()).toBe(true);
        });

        it('should return true for Opera Mini', () => {
            vi.stubGlobal('navigator', { userAgent: 'Opera Mini', maxTouchPoints: 0 });
            expect(isMobile()).toBe(true);
        });
    });
});
