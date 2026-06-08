import { BehaviorTree, SavedBehaviorTree } from '../types';
import { importTreeFromText } from '../engineIntegration';

const STORAGE_KEY = 'robo-boy-behavior-trees';
const STORAGE_VERSION = '1.0.0';

/**
 * Get all saved behavior trees from localStorage
 */
export const listBehaviorTrees = (): SavedBehaviorTree[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const data = JSON.parse(stored);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Failed to list behavior trees:', error);
    return [];
  }
};

/**
 * Save a behavior tree to localStorage
 */
export const saveBehaviorTree = (tree: BehaviorTree): boolean => {
  try {
    const trees = listBehaviorTrees();
    
    // Check if tree with this ID already exists
    const existingIndex = trees.findIndex((t) => t.tree.id === tree.id);
    
    const savedTree: SavedBehaviorTree = {
      tree: {
        ...tree,
        updatedAt: Date.now(),
      },
      version: STORAGE_VERSION,
    };
    
    if (existingIndex >= 0) {
      // Update existing tree
      trees[existingIndex] = savedTree;
    } else {
      // Add new tree
      trees.push(savedTree);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trees));
    return true;
  } catch (error) {
    console.error('Failed to save behavior tree:', error);
    return false;
  }
};

/**
 * Load a behavior tree from localStorage by ID
 */
export const loadBehaviorTree = (id: string): BehaviorTree | null => {
  try {
    const trees = listBehaviorTrees();
    const found = trees.find((t) => t.tree.id === id);
    return found ? found.tree : null;
  } catch (error) {
    console.error('Failed to load behavior tree:', error);
    return null;
  }
};

/**
 * Delete a behavior tree from localStorage
 */
export const deleteBehaviorTree = (id: string): boolean => {
  try {
    const trees = listBehaviorTrees();
    const filtered = trees.filter((t) => t.tree.id !== id);
    
    if (filtered.length === trees.length) {
      // Tree not found
      return false;
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Failed to delete behavior tree:', error);
    return false;
  }
};

/**
 * Export a behavior tree as JSON file
 */
export const exportBehaviorTree = (tree: BehaviorTree): void => {
  try {
    const savedTree: SavedBehaviorTree = {
      tree,
      version: STORAGE_VERSION,
    };
    
    const dataStr = JSON.stringify(savedTree, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tree.name.replace(/[^a-z0-9]/gi, '_')}_${tree.id}.json`;
    link.click();
    
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to export behavior tree:', error);
  }
};

/**
 * Import a behavior tree from JSON, backend-neutral YAML, or BT.CPP XML.
 */
export const importBehaviorTree = (file: File): Promise<BehaviorTree | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const tree = importTreeFromText(content, file.name);

        if (!tree || !tree.id || !tree.nodes) {
          throw new Error('Invalid behavior tree file format');
        }

        resolve(tree);
      } catch (error) {
        console.error('Failed to import behavior tree:', error);
        resolve(null);
      }
    };
    
    reader.onerror = () => {
      console.error('Failed to read file');
      resolve(null);
    };
    
    reader.readAsText(file);
  });
};

/**
 * Clear all behavior trees from localStorage
 */
export const clearAllBehaviorTrees = (): boolean => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear behavior trees:', error);
    return false;
  }
};

/**
 * Get storage usage info
 */
export const getStorageInfo = (): { count: number; size: number } => {
  try {
    const trees = listBehaviorTrees();
    const stored = localStorage.getItem(STORAGE_KEY) || '';
    
    return {
      count: trees.length,
      size: new Blob([stored]).size,
    };
  } catch (error) {
    console.error('Failed to get storage info:', error);
    return { count: 0, size: 0 };
  }
};
