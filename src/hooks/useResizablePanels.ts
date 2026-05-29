import { useState, useCallback, useRef, useEffect } from 'react';

interface UseResizablePanelsOptions {
  initialTopHeight?: number; // in percentage (0-100)
  minTopHeight?: number; // in percentage
  minBottomHeight?: number; // in percentage
  storageKey?: string; // localStorage key to persist sizes
}

export const useResizablePanels = ({
  initialTopHeight = 60,
  minTopHeight = 20,
  minBottomHeight = 20,
  storageKey,
}: UseResizablePanelsOptions = {}) => {
  // Load initial height from localStorage if storageKey is provided
  const [topHeight, setTopHeight] = useState<number>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= minTopHeight && parsed <= (100 - minBottomHeight)) {
          return parsed;
        }
      }
    }
    return initialTopHeight;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save to localStorage when topHeight changes
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, topHeight.toString());
    }
  }, [topHeight, storageKey]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  }, []);

  const handleMove = useCallback(
    (clientY: number) => {
      if (!isDragging || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const offsetY = clientY - rect.top;
      const newTopHeight = (offsetY / rect.height) * 100;

      // Apply constraints
      const constrainedHeight = Math.max(
        minTopHeight,
        Math.min(100 - minBottomHeight, newTopHeight)
      );

      setTopHeight(constrainedHeight);
    },
    [isDragging, minTopHeight, minBottomHeight]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      handleMove(e.clientY);
    },
    [handleMove]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientY);
      }
    },
    [handleMove]
  );

  const handleEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Add event listeners
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
    };
  }, [handleMouseMove, handleTouchMove, handleEnd]);

  const bottomHeight = 100 - topHeight;

  return {
    topHeight,
    bottomHeight,
    handleMouseDown,
    handleTouchStart,
    containerRef,
    isDragging,
  };
};

