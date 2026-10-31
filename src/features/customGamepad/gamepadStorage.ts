import { getLibraryPad, getLibraryPads } from '../library/runtime';
import { readContentFile, importError } from '../library/json';
import { readPads, copyPads, serializePads } from './portablePad';
import { CustomGamepadLayout, GamepadLibraryItem } from './types';
import { defaultGamepadLibrary } from './defaultLayouts';

const STORAGE_KEY = 'robo-boy-custom-gamepads';
const STORAGE_VERSION = '1.0.0';
export const GAMEPAD_STORAGE_EVENT = 'robo-boy-gamepads-changed';

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

// Reading can fall back for display. Mutating must never replace unrecognized data.
function assertWritableStorage(): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const data = JSON.parse(raw);
  if (!data || data.version !== STORAGE_VERSION || !Array.isArray(data.customLayouts) || data.customLayouts.some((item: GamepadLibraryItem) => !item || typeof item.id !== 'string' || !item.layout || !Array.isArray(item.layout.components))) throw new Error('Unrecognized Pad storage. Export/recover it before saving; the original data was preserved.');
}

/**
 * Load all gamepad layouts (default + custom) from storage
 */
export function loadGamepadLibrary(): GamepadLibraryItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [...defaultGamepadLibrary, ...getLibraryPads()];
    }

    const data: StorageData = JSON.parse(stored);
    
    // Version check - if version mismatch, reset to defaults
    if (data.version !== STORAGE_VERSION) {
      console.warn('Gamepad storage version mismatch, resetting to defaults');
      return [...defaultGamepadLibrary, ...getLibraryPads()];
    }

    // Combine defaults with custom layouts
    return [...defaultGamepadLibrary, ...getLibraryPads(), ...data.customLayouts];
  } catch (error) {
    console.error('Failed to load gamepad library:', error);
    return [...defaultGamepadLibrary, ...getLibraryPads()];
  }
}

/**
 * Save a custom gamepad layout
 */
export function saveCustomGamepad(layout: CustomGamepadLayout): boolean {
  try {
    assertWritableStorage();
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
    window.dispatchEvent(new CustomEvent(GAMEPAD_STORAGE_EVENT));
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
    assertWritableStorage();
    const library = loadGamepadLibrary();
    const customLayouts = library.filter(item => !item.isDefault && item.id !== layoutId);
    
    const storageData: StorageData = {
      version: STORAGE_VERSION,
      customLayouts,
      lastModified: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
    window.dispatchEvent(new CustomEvent(GAMEPAD_STORAGE_EVENT));
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
  return library.find(item => item.id === layoutId || item.layout.id === layoutId) || getLibraryPad(layoutId);
}

/**
 * Create an editable custom layout from a built-in template.
 */
export function cloneGamepadTemplate(templateId: string): CustomGamepadLayout | null {
  const template = getGamepadLayout(templateId);
  if (!template?.isDefault) return null;

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

  return serializePads(layoutsToExport.map(item => item.layout));
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

/** Prepare one storage write after validating and allocating every copy. No side effects. */
export function prepareImportedPadStorage(pads: CustomGamepadLayout[]): {
  key: string;
  before: string | null;
  after: string;
} {
  assertWritableStorage();
  const before = localStorage.getItem(STORAGE_KEY);
  const customLayouts: GamepadLibraryItem[] = before ? [...(JSON.parse(before) as StorageData).customLayouts] : [];
  const ids = new Set([...defaultGamepadLibrary, ...customLayouts].flatMap(item => [item.id, item.layout.id]));
  for (const layout of pads) {
    if (ids.has(layout.id)) throw new Error('An imported Pad id already exists. Please import again.');
    ids.add(layout.id);
    customLayouts.push({
      id: layout.id,
      name: layout.name,
      description: layout.description || '',
      layout,
      isDefault: false,
    });
  }
  return {
    key: STORAGE_KEY,
    before,
    after: JSON.stringify({ version: STORAGE_VERSION, customLayouts, lastModified: new Date().toISOString() }),
  };
}
function storeImportedPads(pads: CustomGamepadLayout[]): void {
  const write = prepareImportedPadStorage(pads);
  localStorage.setItem(write.key, write.after);
  window.dispatchEvent(new CustomEvent(GAMEPAD_STORAGE_EVENT));
}
/** Programmatic legacy reader. Validates the whole file before making one storage write. */
export function importGamepadLayouts(jsonData: string): GamepadImportResult {
  try {
    const plan = copyPads(readPads(jsonData));
    storeImportedPads(plan.pads);
    return { success: true, imported: plan.pads.length, errors: [], idMap: plan.idMap };
  } catch (error) {
    return { success: false, imported: 0, errors: [importError(error)], idMap: {} };
  }
}
export async function importGamepadFile(file: File, signal?: AbortSignal): Promise<GamepadImportResult> {
  const cancelled: GamepadImportResult = { success: false, imported: 0, errors: [], idMap: {} };
  try {
    const pads = readPads(await readContentFile(file, signal));
    const { reviewImport } = await import('../library/ImportReview');
    const accepted = await reviewImport(
      {
        title: 'Import Pads',
        items: pads.map(pad => `${pad.name} · Pad`),
        details: [],
        action: 'Import',
      },
      signal
    );
    if (!accepted || signal?.aborted) return cancelled;
    const plan = copyPads(pads);
    storeImportedPads(plan.pads);
    return { success: true, imported: plan.pads.length, errors: [], idMap: plan.idMap };
  } catch (error) {
    if (signal?.aborted) return cancelled;
    return { ...cancelled, errors: [importError(error)] };
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
