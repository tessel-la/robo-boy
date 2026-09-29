import { vi } from 'vitest';

/** jsdom has no 2D canvas; this context accepts every call so drawing code runs without a renderer. */
export const stubCanvasContext = (): void => {
  const context = new Proxy(
    {},
    {
      get: (target, key) => {
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 10 });
        if (key in target) return (target as Record<PropertyKey, unknown>)[key];
        return () => undefined;
      },
      set: (target, key, value) => {
        (target as Record<PropertyKey, unknown>)[key] = value;
        return true;
      },
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
};
