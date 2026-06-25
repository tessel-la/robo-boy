import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceLayout from './VoiceLayout';

const publish = vi.fn();
const advertise = vi.fn();
const unadvertise = vi.fn();
const stopTrack = vi.fn();
let recorderInstance: FakeMediaRecorder | null = null;

class FakeMediaRecorder {
  state = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn(() => {
    this.state = 'recording';
  });

  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) } as BlobEvent);
    this.onstop?.();
  });

  constructor() {
    recorderInstance = this;
  }
}

vi.mock('roslib', () => ({
  default: {
    Message: vi.fn(function (this: any, data) {
      return data;
    }),
    Topic: vi.fn(function () {
      return { advertise, publish, unadvertise };
    }),
  },
}));

describe('VoiceLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorderInstance = null;
    stopTrack.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: FakeMediaRecorder,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
      configurable: true,
    });
  });

  it('records audio and publishes placeholder voice data when stopped', async () => {
    render(<VoiceLayout ros={{} as any} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    await screen.findByText('Recording... Click Stop to send.');
    expect(recorderInstance?.start).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [0.1, 0.2, 0.3],
        })
      );
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByText('Voice command sent (dummy)')).toBeInTheDocument();
  });

  it('shows an error if microphone permission fails', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error('denied'));

    render(<VoiceLayout ros={{} as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByText('Error: Could not access microphone.')).toBeInTheDocument();
    expect(publish).not.toHaveBeenCalled();
  });

  it('stops an active recorder and unadvertises on unmount', async () => {
    const { unmount } = render(<VoiceLayout ros={{} as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await screen.findByText('Recording... Click Stop to send.');

    unmount();

    expect(recorderInstance?.stop).toHaveBeenCalled();
    expect(unadvertise).toHaveBeenCalled();
  });
});
