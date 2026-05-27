// Grid implementation - Scene primitive for grid display
import * as THREE from 'three';

/**
 * Grid helper that extends Object3D for scene integration.
 * Displays a flat grid on the XY plane with Z up.
 */
export class Grid extends THREE.Object3D {
    constructor(options: {
        size?: number;
        divisions?: number;
        colorCenterLine?: number;
        colorGrid?: number;
    } = {}) {
        super();

        const size = options.size || 10;
        const divisions = options.divisions || 10;
        const colorCenterLine = options.colorCenterLine !== undefined ?
            options.colorCenterLine : 0x444444;
        const colorGrid = options.colorGrid !== undefined ?
            options.colorGrid : 0x888888;

        const gridHelper = new THREE.GridHelper(size, divisions, colorCenterLine, colorGrid);

        // Rotate grid to be flat on XY plane with Z up
        gridHelper.rotation.x = Math.PI / 2;

        this.add(gridHelper);
    }
}
