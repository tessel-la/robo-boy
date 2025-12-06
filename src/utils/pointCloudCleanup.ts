// Point cloud cleanup utilities
import * as THREE from 'three';
import * as ROS3D from './ros3d';

/**
 * Safely cleans up a PointCloud2 client and its associated THREE.js resources.
 * Handles unsubscribing from ROS topics, removing from scene, and disposing materials/geometries.
 */
export function cleanupPointCloudClient(
    client: ROS3D.PointCloud2 | null,
    scene?: THREE.Scene | null
): void {
    if (!client) {
        console.log("[PC Cleanup] No client to clean");
        return;
    }

    console.log("[PC Cleanup] Starting cleanup for point cloud");

    // Try to unsubscribe from the topic first to stop incoming data
    try {
        if (typeof (client as any).unsubscribe === 'function') {
            (client as any).unsubscribe();
            console.log("[PC Cleanup] Unsubscribed from topic");
        }
    } catch (e) {
        console.warn("[PC Cleanup] Error unsubscribing from topic:", e);
    }

    // Remove from scene if possible
    try {
        if (scene) {
            // Get the point wrapper parent (should be the object directly in the scene)
            let objectInScene: THREE.Object3D | null = null;

            // First approach - via points.object.parent
            const pointsObj = (client as any)?.points?.object;
            if (pointsObj && pointsObj.parent) {
                objectInScene = pointsObj.parent;
            }

            // Second approach - try to find the object directly
            if (!objectInScene && (client as any).rootObject) {
                objectInScene = (client as any).rootObject;
            }

            // Remove the object if found
            if (objectInScene && scene.children.includes(objectInScene)) {
                scene.remove(objectInScene);
                console.log("[PC Cleanup] Removed object from scene");
            }
        }
    } catch (e) {
        console.warn("[PC Cleanup] Error removing from scene:", e);
    }

    // Clean up any THREE.js objects
    try {
        const pointsObj = (client as any)?.points?.object;
        if (pointsObj) {
            // Set to invisible first
            pointsObj.visible = false;

            // Dispose material
            if (pointsObj.material) {
                disposeMaterial(pointsObj.material);
                pointsObj.material = null;
            }

            // Dispose geometry
            if (pointsObj.geometry && typeof pointsObj.geometry.dispose === 'function') {
                pointsObj.geometry.dispose();
                pointsObj.geometry = null;
            }
        }
    } catch (e) {
        console.warn("[PC Cleanup] Error cleaning up THREE.js objects:", e);
    }

    // Clear any client references
    if ((client as any).points) {
        (client as any).points = null;
    }

    console.log("[PC Cleanup] Cleanup complete");
}

/**
 * Safely disposes of a THREE.js material or array of materials.
 */
export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
    if (Array.isArray(material)) {
        material.forEach((mat: THREE.Material) => {
            if (mat && typeof mat.dispose === 'function') {
                mat.dispose();
            }
        });
    } else if (typeof material.dispose === 'function') {
        material.dispose();
    }
}

/**
 * Cleanup intervals used by point cloud client.
 */
export interface PointCloudIntervals {
    checkSceneInterval: ReturnType<typeof setInterval> | null;
    checkPointsObjectInterval: ReturnType<typeof setInterval> | null;
    updateRangesInterval: ReturnType<typeof setInterval> | null;
}

/**
 * Clears all point cloud related intervals.
 */
export function clearPointCloudIntervals(intervals: PointCloudIntervals): void {
    if (intervals.checkSceneInterval) {
        clearInterval(intervals.checkSceneInterval);
        intervals.checkSceneInterval = null;
    }
    if (intervals.checkPointsObjectInterval) {
        clearInterval(intervals.checkPointsObjectInterval);
        intervals.checkPointsObjectInterval = null;
    }
    if (intervals.updateRangesInterval) {
        clearInterval(intervals.updateRangesInterval);
        intervals.updateRangesInterval = null;
    }
}

/**
 * Creates a fresh intervals reference object.
 */
export function createIntervalsRef(): PointCloudIntervals {
    return {
        checkSceneInterval: null,
        checkPointsObjectInterval: null,
        updateRangesInterval: null
    };
}
