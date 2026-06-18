import { BehaviorTree, SavedBehaviorTree } from '../types';
import { syncReferencedSubtrees } from '../subtreeUtils';

const STORAGE_KEY = 'robo-boy-behavior-trees';
const STORAGE_VERSION = '1.0.0';
export const BEHAVIOR_TREE_STORAGE_EVENT = 'robo-boy-behavior-trees-changed';

const emitBehaviorTreeStorageChanged = (): void => {
  window.dispatchEvent(new CustomEvent(BEHAVIOR_TREE_STORAGE_EVENT));
};

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
    emitBehaviorTreeStorageChanged();
    return true;
  } catch (error) {
    console.error('Failed to save behavior tree:', error);
    return false;
  }
};

export const syncBehaviorTreeReferences = (sourceTree: BehaviorTree): boolean => {
  try {
    const trees = listBehaviorTrees();
    let didChange = false;

    const syncedTrees = trees.map((savedTree) => {
      if (savedTree.tree.id === sourceTree.id) {
        return savedTree;
      }

      const syncedTree = syncReferencedSubtrees(savedTree.tree, sourceTree);
      if (syncedTree !== savedTree.tree) {
        didChange = true;
        return {
          ...savedTree,
          tree: syncedTree,
        };
      }

      return savedTree;
    });

    if (!didChange) return true;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(syncedTrees));
    emitBehaviorTreeStorageChanged();
    return true;
  } catch (error) {
    console.error('Failed to sync behavior tree references:', error);
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
    emitBehaviorTreeStorageChanged();
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
 * Import a behavior tree from JSON file
 */
export const importBehaviorTree = (file: File): Promise<BehaviorTree | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const savedTree: SavedBehaviorTree = JSON.parse(content);
        
        // Validate structure
        if (!savedTree.tree || !savedTree.tree.id || !savedTree.tree.nodes) {
          throw new Error('Invalid behavior tree file format');
        }

        resolve(savedTree.tree);
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
    emitBehaviorTreeStorageChanged();
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
