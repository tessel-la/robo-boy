import { CustomGamepadLayout, GamepadLibraryItem } from './types';
import { defaultGamepadLibrary } from './defaultLayouts';

const STORAGE_KEY = 'robo-boy-custom-gamepads';
const STORAGE_VERSION = '1.0.0';

interface StorageData {
  version: string;
  customLayouts: GamepadLibraryItem[];
  lastModified: string;
}

export interface GamepadImportResult {
  success: boolean;
  imported: number;
  errors: string[];
  idMap: Record<string, string>;
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
  return library.find(item => item.id === layoutId || item.layout.id === layoutId) || null;
}

/**
 * Create an editable custom layout from a built-in template.
 */
export function cloneGamepadTemplate(templateId: string): CustomGamepadLayout | null {
  const template = loadGamepadLibrary().find(item => item.isDefault && (
    item.id === templateId || item.layout.id === templateId
  ));
  if (!template) return null;

  const now = new Date().toISOString();
  const layout = JSON.parse(JSON.stringify(template.layout)) as CustomGamepadLayout;
  return {
    ...layout,
    id: generateGamepadId(template.name),
    name: template.name,
    metadata: {
      ...layout.metadata,
      created: now,
      modified: now,
      version: STORAGE_VERSION
    }
  };
}

/**
 * Generate a unique ID for a new gamepad layout
 */
export function generateGamepadId(baseName: string): string {
  const library = loadGamepadLibrary();
  const existingIds = library.map(item => item.id);
  
  const baseId = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'gamepad';
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

export function getGamepadExportFilename(name: string): string {
  const sanitized = name.trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return `${sanitized || 'gamepad'}.json`;
}

export function downloadGamepadLayout(layoutId: string): boolean {
  try {
    const item = loadGamepadLibrary().find(layout => !layout.isDefault && layout.id === layoutId);
    if (!item) return false;

    const blob = new Blob([exportGamepadLayouts([layoutId])], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getGamepadExportFilename(item.name);
    link.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('Failed to download gamepad layout:', error);
    return false;
  }
}

/**
 * Import gamepad layouts from JSON
 */
export function importGamepadLayouts(jsonData: string): GamepadImportResult {
  const result: GamepadImportResult = {
    success: false,
    imported: 0,
    errors: [],
    idMap: {},
  };
  
  try {
    const importData = JSON.parse(jsonData);
    
    if (!importData.layouts || !Array.isArray(importData.layouts)) {
      result.errors.push('Invalid import format: missing layouts array');
      return result;
    }

    for (const importedLayout of importData.layouts) {
      try {
        const layout = JSON.parse(JSON.stringify(importedLayout)) as CustomGamepadLayout;
        // Validate layout structure
        if (!layout.id || !layout.name || !layout.components) {
          result.errors.push(`Invalid layout structure: ${layout.name || 'unnamed'}`);
          continue;
        }

        // Generate new ID if it conflicts with existing
        const sourceId = layout.id;
        const existingLayout = getGamepadLayout(sourceId);
        if (existingLayout) {
          layout.id = generateGamepadId(layout.name);
        }
        result.idMap[sourceId] = layout.id;

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

export function importGamepadFile(file: File): Promise<GamepadImportResult> {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = event => {
      resolve(importGamepadLayouts(String(event.target?.result || '')));
    };
    reader.onerror = () => {
      resolve({ success: false, imported: 0, errors: ['Failed to read gamepad file'], idMap: {} });
    };

    reader.readAsText(file);
  });
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
