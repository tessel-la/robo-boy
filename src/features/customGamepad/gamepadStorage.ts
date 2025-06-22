import { CustomGamepadLayout, GamepadLibraryItem } from './types';
import { defaultGamepadLibrary } from './defaultLayouts';

const STORAGE_KEY = 'robo-boy-custom-gamepads';
const STORAGE_VERSION = '1.0.0';

interface StorageData {
  version: string;
  customLayouts: GamepadLibraryItem[];
  lastModified: string;
}

/**
 * Load all gamepad layouts (default + custom) from storage
 */
export function loadGamepadLibrary(): GamepadLibraryItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [...defaultGamepadLibrary];
    }

    const data: StorageData = JSON.parse(stored);
    
    // Version check - if version mismatch, reset to defaults
    if (data.version !== STORAGE_VERSION) {
      console.warn('Gamepad storage version mismatch, resetting to defaults');
      return [...defaultGamepadLibrary];
    }

    // Combine defaults with custom layouts
    return [...defaultGamepadLibrary, ...data.customLayouts];
  } catch (error) {
    console.error('Failed to load gamepad library:', error);
    return [...defaultGamepadLibrary];
  }
}

/**
 * Save a custom gamepad layout
 */
export function saveCustomGamepad(layout: CustomGamepadLayout): boolean {
  try {
    const library = loadGamepadLibrary();
    const customLayouts = library.filter(item => !item.isDefault);
    
    // Check if layout already exists (update) or is new
    const existingIndex = customLayouts.findIndex(item => item.id === layout.id);
    
    const libraryItem: GamepadLibraryItem = {
      id: layout.id,
      name: layout.name,
      description: layout.description || '',
      layout: {
        ...layout,
        metadata: {
          ...layout.metadata,
          modified: new Date().toISOString()
        }
      },
      isDefault: false
    };

    if (existingIndex >= 0) {
      customLayouts[existingIndex] = libraryItem;
    } else {
      customLayouts.push(libraryItem);
    }

    const storageData: StorageData = {
      version: STORAGE_VERSION,
      customLayouts,
      lastModified: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
    return true;
  } catch (error) {
    console.error('Failed to save custom gamepad:', error);
    return false;
  }
}

/**
 * Delete a custom gamepad layout
 */
export function deleteCustomGamepad(layoutId: string): boolean {
  try {
    const library = loadGamepadLibrary();
    const customLayouts = library.filter(item => !item.isDefault && item.id !== layoutId);
    
    const storageData: StorageData = {
      version: STORAGE_VERSION,
      customLayouts,
      lastModified: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
    return true;
  } catch (error) {
    console.error('Failed to delete custom gamepad:', error);
    return false;
  }
}

/**
 * Get a specific gamepad layout by ID
 */
export function getGamepadLayout(layoutId: string): GamepadLibraryItem | null {
  const library = loadGamepadLibrary();
  return library.find(item => item.id === layoutId) || null;
}

/**
 * Generate a unique ID for a new gamepad layout
 */
export function generateGamepadId(baseName: string): string {
  const library = loadGamepadLibrary();
  const existingIds = library.map(item => item.id);
  
  const baseId = baseName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  let counter = 1;
  let newId = `custom-${baseId}`;
  
  while (existingIds.includes(newId)) {
    newId = `custom-${baseId}-${counter}`;
    counter++;
  }
  
  return newId;
}

/**
 * Export gamepad layouts to JSON file
 */
export function exportGamepadLayouts(layoutIds?: string[]): string {
  const library = loadGamepadLibrary();
  const layoutsToExport = layoutIds 
    ? library.filter(item => layoutIds.includes(item.id))
    : library.filter(item => !item.isDefault);

  const exportData = {
    version: STORAGE_VERSION,
    exportDate: new Date().toISOString(),
    layouts: layoutsToExport.map(item => item.layout)
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Import gamepad layouts from JSON
 */
export function importGamepadLayouts(jsonData: string): { success: boolean; imported: number; errors: string[] } {
  const result = { success: false, imported: 0, errors: [] as string[] };
  
  try {
    const importData = JSON.parse(jsonData);
    
    if (!importData.layouts || !Array.isArray(importData.layouts)) {
      result.errors.push('Invalid import format: missing layouts array');
      return result;
    }

    for (const layout of importData.layouts) {
      try {
        // Validate layout structure
        if (!layout.id || !layout.name || !layout.components) {
          result.errors.push(`Invalid layout structure: ${layout.name || 'unnamed'}`);
          continue;
        }

        // Generate new ID if it conflicts with existing
        const existingLayout = getGamepadLayout(layout.id);
        if (existingLayout) {
          layout.id = generateGamepadId(layout.name);
        }

        // Update metadata
        layout.metadata = {
          ...layout.metadata,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          version: STORAGE_VERSION
        };

        if (saveCustomGamepad(layout)) {
          result.imported++;
        } else {
          result.errors.push(`Failed to save layout: ${layout.name}`);
        }
      } catch (error) {
        result.errors.push(`Error processing layout: ${error}`);
      }
    }

    result.success = result.imported > 0;
    return result;
  } catch (error) {
    result.errors.push(`Failed to parse JSON: ${error}`);
    return result;
  }
}

/**
 * Clear all custom gamepad layouts (reset to defaults)
 */
export function clearCustomGamepads(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear custom gamepads:', error);
    return false;
  }
} 