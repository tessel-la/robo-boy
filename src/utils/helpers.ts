/**
 * Generates a simple unique ID string.
 * @param prefix Optional prefix for the ID.
 * @returns A unique ID string.
 */
export function generateUniqueId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
} 