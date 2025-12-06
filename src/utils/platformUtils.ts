// Platform detection utilities for point cloud rendering optimizations
/**
 * Detects if the current device is running iOS.
 */
export const isIOS = (): boolean => {
    return (
        typeof navigator !== 'undefined' &&
        /iPad|iPhone|iPod/.test(navigator.userAgent) &&
        !(window as any).MSStream
    );
};

/**
 * Detects if the current device is a mobile device.
 */
export const isMobile = (): boolean => {
    return (
        typeof navigator !== 'undefined' &&
        (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 2))
    );
};
