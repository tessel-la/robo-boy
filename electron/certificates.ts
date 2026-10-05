import { session } from 'electron';
import { BlockList, isIP } from 'node:net';

// Literal LAN/VPN addresses only: resolving a public hostname to a private address must not
// exempt that hostname from certificate verification (including during DNS rebinding).
const robotAddresses = new BlockList();
for (const [address, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10], // Shared address space used by VPNs such as Tailscale.
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
] as const) robotAddresses.addSubnet(address, prefix, 'ipv4');
robotAddresses.addAddress('::1', 'ipv6');
robotAddresses.addSubnet('fc00::', 7, 'ipv6');
robotAddresses.addSubnet('fe80::', 10, 'ipv6');

/** Local names and private IP literals may use a robot's self-signed certificate. */
export const allowsRobotCertificate = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
  const family = isIP(host);
  if (family) return robotAddresses.check(host, family === 4 ? 'ipv4' : 'ipv6');
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
};

/** Covers renderer fetch/WebSocket/frames and main-process Chromium net requests alike. */
export const configureCertificates = (): void => {
  session.defaultSession.setCertificateVerifyProc(({ hostname }, callback) => {
    // -3 delegates to Chromium's normal verification; 0 explicitly trusts a robot certificate.
    callback(allowsRobotCertificate(hostname) ? 0 : -3);
  });
};
