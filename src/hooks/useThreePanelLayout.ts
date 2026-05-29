import { useState, useCallback, useRef, useEffect } from 'react';

interface UseThreePanelLayoutOptions {
  initialBtHeight?: number; // Behavior tree panel height in percentage
  initialViewHeight?: number; // View panel height in percentage
  minPanelHeight?: number; // Minimum height for any panel in percentage
  storageKey?: string; // localStorage key to persist sizes
}

export const useThreePanelLayout = ({
  initialBtHeight = 30,
  initialViewHeight = 40,
  minPanelHeight = 15,
  storageKey,
}: UseThreePanelLayoutOptions = {}) => {
  // Load heights from localStorage if available
  const [heights, setHeights] = useState<{ bt: number; view: number; control: number }>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const total = parsed.bt + parsed.view + parsed.control;
          // Validate stored values
          if (
            parsed.bt >= minPanelHeight &&
            parsed.view >= minPanelHeight &&
            parsed.control >= minPanelHeight &&
            Math.abs(total - 100) < 1 // Allow for small rounding errors
          ) {
            return parsed;
          }
        } catch (e) {
          console.error('Failed to parse stored panel heights');
        }
      }
    }
    
    // Calculate control height
    const controlHeight = 100 - initialBtHeight - initialViewHeight;
    return {
      bt: initialBtHeight,
      view: initialViewHeight,
      control: Math.max(minPanelHeight, controlHeight),
    };
  });

  const [activeHandle, setActiveHandle] = useState<'bt-view' | 'view-control' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save to localStorage when heights change
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(heights));
    }
  }, [heights, storageKey]);

  // Handle resize start for BT-View divider
  const handleBtViewMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setActiveHandle('bt-view');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleBtViewTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setActiveHandle('bt-view');
    document.body.style.userSelect = 'none';
  }, []);

  // Handle resize start for View-Control divider
  const handleViewControlMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setActiveHandle('view-control');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleViewControlTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setActiveHandle('view-control');
    document.body.style.userSelect = 'none';
  }, []);

  // Handle resize move
  const handleMove = useCallback(
    (clientY: number) => {
      if (!activeHandle || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const offsetY = clientY - rect.top;
      const percentFromTop = (offsetY / rect.height) * 100;

      setHeights((prev) => {
        if (activeHandle === 'bt-view') {
          // Resizing between BT and View panels
          const newBtHeight = Math.max(minPanelHeight, Math.min(100 - minPanelHeight * 2, percentFromTop));
          const remainingHeight = 100 - newBtHeight;
          const newViewHeight = Math.max(minPanelHeight, Math.min(remainingHeight - minPanelHeight, prev.view));
          const newControlHeight = 100 - newBtHeight - newViewHeight;

          if (newControlHeight >= minPanelHeight) {
            return {
              bt: newBtHeight,
              view: newViewHeight,
              control: newControlHeight,
            };
          }
        } else if (activeHandle === 'view-control') {
          // Resizing between View and Control panels
          const newViewHeight = Math.max(minPanelHeight, Math.min(100 - prev.bt - minPanelHeight, percentFromTop - prev.bt));
          const newControlHeight = 100 - prev.bt - newViewHeight;

          if (newControlHeight >= minPanelHeight && newViewHeight >= minPanelHeight) {
            return {
              bt: prev.bt,
              view: newViewHeight,
              control: newControlHeight,
            };
          }
        }

        return prev;
      });
    },
    [activeHandle, minPanelHeight]
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
    setActiveHandle(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Add event listeners
  useEffect(() => {
    if (!activeHandle) return;

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
  }, [activeHandle, handleMouseMove, handleTouchMove, handleEnd]);

  return {
    btHeight: heights.bt,
    viewHeight: heights.view,
    controlHeight: heights.control,
    handleBtViewMouseDown,
    handleBtViewTouchStart,
    handleViewControlMouseDown,
    handleViewControlTouchStart,
    containerRef,
    isDragging: activeHandle !== null,
    activeHandle,
  };
};

