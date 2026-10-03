import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ setCertificateVerifyProc: vi.fn() }));
vi.mock('electron', () => ({ session: { defaultSession: native } }));
import { allowsRobotCertificate, configureCertificates } from './certificates';

describe('robot certificate exceptions', () => {
  it.each([
    '10.8.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.2',
    '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.1.2',
    '::1', '[fd12:3456::1]', 'fc00::1', 'fe80::1', '::ffff:192.168.1.2',
    'localhost', 'robot.localhost', 'robot.local', 'ROBOT.LOCAL.',
  ])('allows a local robot at %s', host => {
    expect(allowsRobotCertificate(host)).toBe(true);
  });

  it.each([
    'github.com', 'api.github.com', 'objects.githubusercontent.com',
    'raw.githubusercontent.com', 'release-assets.githubusercontent.com',
    'github.com.', 'github.com.local.evil.example', 'robot.example.com',
    'localhost.example.com', '8.8.8.8', '172.15.255.255', '172.32.0.1',
    '100.63.255.255', '100.128.0.1', '192.169.1.1', '0.0.0.0',
    '2001:4860:4860::8888', 'ff02::1', '::', '::ffff:8.8.8.8', '',
  ])('retains certificate verification for %s', host => {
    expect(allowsRobotCertificate(host)).toBe(false);
  });

  it('delegates public certificates to Chromium instead of overriding its verdict', () => {
    configureCertificates();
    const verify = native.setCertificateVerifyProc.mock.calls.at(-1)![0];
    const callback = vi.fn();
    verify({ hostname: 'github.com', verificationResult: 'CERT_AUTHORITY_INVALID' }, callback);
    expect(callback).toHaveBeenLastCalledWith(-3);
    verify({ hostname: 'github.com', verificationResult: 'OK' }, callback);
    expect(callback).toHaveBeenLastCalledWith(-3);
    verify({ hostname: '10.8.0.1', verificationResult: 'CERT_AUTHORITY_INVALID' }, callback);
    expect(callback).toHaveBeenLastCalledWith(0);
  });
});
