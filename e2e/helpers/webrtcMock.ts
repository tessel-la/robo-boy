import type { Page } from '@playwright/test';

export async function installWebRtcMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeMediaStream = globalThis.MediaStream;

    class MockPeerConnection extends EventTarget {
      connectionState: RTCPeerConnectionState = 'new';
      iceGatheringState: RTCIceGatheringState = 'complete';
      localDescription: RTCSessionDescription | null = null;
      private bytesReceived = 0;

      addTransceiver(): void {}

      async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'offer', sdp: 'v=0\r\ns=Robo-Boy WHEP test\r\n' };
      }

      async setLocalDescription(description: RTCLocalSessionDescriptionInit): Promise<void> {
        this.localDescription = description as RTCSessionDescription;
      }

      async setRemoteDescription(): Promise<void> {
        const event = new Event('track');
        Object.defineProperties(event, {
          streams: { value: [new NativeMediaStream()] },
          track: { value: null },
        });
        this.dispatchEvent(event);
        this.connectionState = 'connected';
        this.dispatchEvent(new Event('connectionstatechange'));
      }

      async getStats(): Promise<Map<string, object>> {
        this.bytesReceived += 25_000;
        return new Map([
          [
            'video',
            {
              id: 'video',
              type: 'inbound-rtp',
              kind: 'video',
              bytesReceived: this.bytesReceived,
              framesPerSecond: 15,
              jitter: 0.008,
              packetsReceived: 100,
              packetsLost: 2,
              framesDropped: 3,
            },
          ],
          [
            'transport',
            {
              id: 'transport',
              type: 'transport',
              selectedCandidatePairId: 'pair',
            },
          ],
          [
            'pair',
            {
              id: 'pair',
              type: 'candidate-pair',
              currentRoundTripTime: 0.042,
            },
          ],
        ]);
      }

      close(): void {
        this.connectionState = 'closed';
      }
    }

    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: MockPeerConnection,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async () => {},
    });
  });
}
