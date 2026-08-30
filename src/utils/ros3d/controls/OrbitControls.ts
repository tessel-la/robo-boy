// OrbitControls implementation - Camera control for 3D navigation
import * as THREE from 'three';

/**
 * OrbitControls for camera manipulation in the 3D scene.
 * Supports mouse and touch controls for rotation, panning, and zooming.
 */
export class OrbitControls {
    private camera: THREE.PerspectiveCamera;
    private element: HTMLElement;
    private target = new THREE.Vector3(0, 0, 0);
    private enabled = true;
    public zoomSpeed = 0.1;
    public panSpeed = 0.1;
    public rotateSpeed = 1.0;

    private mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
    private STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2 };
    private state = this.STATE.NONE;

    private spherical = new THREE.Spherical();
    private scale = 1;
    private panOffset = new THREE.Vector3();

    private rotateStart = new THREE.Vector2();
    private rotateEnd = new THREE.Vector2();
    private rotateDelta = new THREE.Vector2();

    private panStart = new THREE.Vector2();
    private panEnd = new THREE.Vector2();
    private panDelta = new THREE.Vector2();

    // Track touch points for multi-touch gestures
    private prevTouchDistance = -1;
    private prevTouchMidpoint = new THREE.Vector2();
    private readonly EPS = 0.000001;

    // Double-tap detection
    private lastTapTime = 0;
    private lastTapX = 0;
    private lastTapY = 0;
    private doubleTapDelay = 300; // ms
    private doubleTapDistance = 30; // px tolerance

    constructor(options: {
        scene: THREE.Object3D;
        camera: THREE.PerspectiveCamera;
        userZoomSpeed?: number;
        userPanSpeed?: number;
        userRotateSpeed?: number;
        element?: HTMLElement;
    }) {
        this.camera = options.camera;
        this.element = options.element || document.body;

        if (options.userZoomSpeed) {
            this.zoomSpeed = options.userZoomSpeed;
        }

        if (options.userPanSpeed) {
            this.panSpeed = options.userPanSpeed;
        }

        if (options.userRotateSpeed) {
            this.rotateSpeed = options.userRotateSpeed;
        }

        // Set up initial spherical coordinates
        this.updateSpherical();

        // Bind methods
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseWheel = this.onMouseWheel.bind(this);

        // Bind touch methods
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);

        // Add event listeners
        this.element.addEventListener('mousedown', this.onMouseDown, false);
        this.element.addEventListener('wheel', this.onMouseWheel, { passive: false });

        // Add touch event listeners
        this.element.addEventListener('touchstart', this.onTouchStart, { passive: false });
        this.element.addEventListener('touchmove', this.onTouchMove, { passive: false });
        this.element.addEventListener('touchend', this.onTouchEnd, { passive: false });
        this.element.addEventListener('touchcancel', this.onTouchEnd, { passive: false });

        // Initial update
        this.update();

        console.log('[OrbitControls] Initialized: Left=Rotate, Middle=Pan, Wheel=Zoom, Touch: 1-finger=Rotate, 2-finger=Pan/Zoom');
    }

    private updateSpherical(): void {
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.target);

        // Convert from cartesian to spherical coordinates
        this.spherical.setFromVector3(offset);
    }

    private rotate(deltaX: number, deltaY: number, speed: number = this.rotateSpeed): void {
        const element = this.element === document.body ? document.body : this.element;
        if (element.clientHeight <= 0) return;

        const worldUp = new THREE.Vector3(0, 0, 1);
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.target);
        const toYUp = new THREE.Quaternion().setFromUnitVectors(worldUp, new THREE.Vector3(0, 1, 0));

        offset.applyQuaternion(toYUp);
        this.spherical.setFromVector3(offset);
        this.spherical.theta -= 2 * Math.PI * deltaX / element.clientHeight * speed;
        this.spherical.phi -= 2 * Math.PI * deltaY / element.clientHeight * speed;
        this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi, this.EPS, Math.PI - this.EPS);
        this.spherical.makeSafe();

        offset.setFromSpherical(this.spherical).applyQuaternion(toYUp.invert());
        this.camera.position.copy(this.target).add(offset);
        this.camera.up.copy(worldUp);
        this.camera.lookAt(this.target);
    }

    private onMouseDown(event: MouseEvent): void {
        if (!this.enabled) return;

        event.preventDefault();

        switch (event.button) {
            case this.mouseButtons.LEFT:
                if (event.ctrlKey) {
                    this.state = this.STATE.PAN;
                    this.panStart.set(event.clientX, event.clientY);
                } else {
                    this.state = this.STATE.ROTATE;
                    this.rotateStart.set(event.clientX, event.clientY);
                }
                break;
            case this.mouseButtons.MIDDLE:
                // Middle click (wheel button) for pan/translate
                this.state = this.STATE.PAN;
                this.panStart.set(event.clientX, event.clientY);
                break;
            case this.mouseButtons.RIGHT:
                // Right click - no action (allow context menu)
                this.state = this.STATE.NONE;
                return; // Don't prevent default to allow context menu
            default:
                this.state = this.STATE.NONE;
        }

        if (this.state !== this.STATE.NONE) {
            document.addEventListener('mousemove', this.onMouseMove, false);
            document.addEventListener('mouseup', this.onMouseUp, false);
        }
    }

    private onMouseMove(event: MouseEvent): void {
        if (!this.enabled) return;

        event.preventDefault();

        switch (this.state) {
            case this.STATE.ROTATE:
                this.rotateEnd.set(event.clientX, event.clientY);
                this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart);
                this.rotate(this.rotateDelta.x, this.rotateDelta.y);
                this.rotateStart.copy(this.rotateEnd);
                break;

            case this.STATE.PAN:
                this.panEnd.set(event.clientX, event.clientY);
                this.panDelta.subVectors(this.panEnd, this.panStart);

                // Invert X only, keep Y natural for up/down
                this.pan(-this.panDelta.x, this.panDelta.y);

                this.panStart.copy(this.panEnd);

                // Update camera view after panning
                this.update();
                break;
        }
    }

    private onMouseUp(_event: MouseEvent): void {
        document.removeEventListener('mousemove', this.onMouseMove, false);
        document.removeEventListener('mouseup', this.onMouseUp, false);

        this.state = this.STATE.NONE;
    }

    private onMouseWheel(event: WheelEvent): void {
        if (!this.enabled) return;

        event.preventDefault();

        // Detect trackpad pinch-zoom (Ctrl + wheel) or regular mouse wheel
        if (event.ctrlKey) {
            // Trackpad pinch-to-zoom (Ctrl is automatically added by browser)
            if (event.deltaY < 0) {
                this.dollyIn();
            } else {
                this.dollyOut();
            }
        } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            // Horizontal trackpad scrolling pans; vertical wheel movement keeps
            // the conventional zoom behavior used by desktop 3D tools.
            this.pan(event.deltaX * 0.5, 0);
        } else if (event.deltaY < 0) {
            this.dollyIn();
        } else if (event.deltaY > 0) {
            this.dollyOut();
        }

        this.update();
    }

    private onTouchStart(event: TouchEvent): void {
        if (!this.enabled) return;

        event.preventDefault();

        switch (event.touches.length) {
            case 1: // Single touch - check for double-tap or rotation
                const now = Date.now();
                const tapX = event.touches[0].clientX;
                const tapY = event.touches[0].clientY;

                // Check for double-tap
                const timeDiff = now - this.lastTapTime;
                const distDiff = Math.sqrt(
                    Math.pow(tapX - this.lastTapX, 2) +
                    Math.pow(tapY - this.lastTapY, 2)
                );

                if (timeDiff < this.doubleTapDelay && distDiff < this.doubleTapDistance) {
                    // Double-tap detected - smooth zoom in
                    this.smoothZoom(0.6, 300); // Zoom to 60% distance over 300ms
                    this.lastTapTime = 0; // Reset to prevent triple-tap
                } else {
                    // Single tap - start rotation
                    this.state = this.STATE.ROTATE;
                    this.rotateStart.set(tapX, tapY);
                    this.lastTapTime = now;
                    this.lastTapX = tapX;
                    this.lastTapY = tapY;
                }
                break;

            case 2: // Two touches - pinch zoom or two-finger pan
                const dx = event.touches[0].clientX - event.touches[1].clientX;
                const dy = event.touches[0].clientY - event.touches[1].clientY;
                this.prevTouchDistance = Math.sqrt(dx * dx + dy * dy);

                // Store the midpoint for tracking pan movement
                const x = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                const y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
                this.prevTouchMidpoint.set(x, y);
                this.panStart.set(x, y);
                this.state = this.STATE.DOLLY; // Two-finger state
                break;

            default:
                this.state = this.STATE.NONE;
        }
    }

    private onTouchMove(event: TouchEvent): void {
        if (!this.enabled) return;

        event.preventDefault();

        switch (event.touches.length) {
            case 1: // Single touch - handle as rotation
                if (this.state === this.STATE.ROTATE) {
                    this.rotateEnd.set(
                        event.touches[0].clientX,
                        event.touches[0].clientY
                    );
                    this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart);

                    this.rotate(this.rotateDelta.x, this.rotateDelta.y, this.rotateSpeed * 0.4);
                    this.rotateStart.copy(this.rotateEnd);
                }
                break;

            case 2: // Two touches - handle zoom and pan separately each frame
                // Calculate current distance between touch points
                const dx2 = event.touches[0].clientX - event.touches[1].clientX;
                const dy2 = event.touches[0].clientY - event.touches[1].clientY;
                const touchDistance = Math.sqrt(dx2 * dx2 + dy2 * dy2);

                // Calculate current midpoint
                const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

                if (this.prevTouchDistance > 0 && touchDistance > 0) {
                    const midpointDeltaX = midX - this.prevTouchMidpoint.x;
                    const midpointDeltaY = midY - this.prevTouchMidpoint.y;
                    this.scale *= this.prevTouchDistance / touchDistance;
                    // Pan follows the midpoint incrementally, including slow
                    // movements that previously never crossed the per-frame
                    // threshold. It can happen alongside a pinch gesture.
                    this.pan(-midpointDeltaX * 2.5, midpointDeltaY * 2.5);
                }

                // Update tracking values
                this.prevTouchDistance = touchDistance;
                this.prevTouchMidpoint.set(midX, midY);
                this.panStart.set(midX, midY); // Keep pan start updated
                break;
        }

        this.update();
    }

    private onTouchEnd(_event: TouchEvent): void {
        this.state = this.STATE.NONE;
        this.prevTouchDistance = -1;
    }

    private pan(deltaX: number, deltaY: number): void {
        const element = this.element === document.body ?
            document.body : this.element;

        // Adjust pan speed based on camera position
        const position = this.camera.position;
        const targetDistance = position.distanceTo(this.target);

        // Scale panning based on distance
        deltaX *= targetDistance * this.panSpeed / element.clientWidth;
        deltaY *= targetDistance * this.panSpeed / element.clientHeight;

        // For Z-up system:
        // Create precise panning vectors that align with the screen
        const worldUp = new THREE.Vector3(0, 0, 1);

        // Get the vector from target to camera (camera direction reversed)
        const offset = new THREE.Vector3().subVectors(position, this.target);

        // Get right vector (screen X direction)
        // Cross product of camera direction and world up
        const panX = new THREE.Vector3().crossVectors(offset, worldUp).normalize();

        // Get the screen's Y axis vector (perpendicular to both)
        // This ensures correct panning in the screen plane
        const forward = offset.clone().normalize();
        const panY = new THREE.Vector3().crossVectors(panX, forward).normalize();

        // Move along right vector for X movement 
        const moveX = panX.clone().multiplyScalar(-deltaX);

        // Move along screen Y vector for Y movement
        const moveY = panY.clone().multiplyScalar(deltaY);

        // Apply the combined movement
        position.add(moveX).add(moveY);
        this.target.add(moveX).add(moveY);
    }

    private dollyIn(): void {
        this.scale *= 0.95;
    }

    private dollyOut(): void {
        this.scale /= 0.95;
    }

    public update(): void {
        // This method is now simplified since most rotation handling 
        // is done directly in onMouseMove and onTouchMove

        // Apply scale (zooming) if needed
        if (this.scale !== 1) {
            const position = this.camera.position;
            const offset = position.clone().sub(this.target);

            // Scale distance from target
            offset.multiplyScalar(this.scale);

            // Update position based on scaled offset
            position.copy(this.target).add(offset);

            // Reset scale
            this.scale = 1;
        }

        // Apply pan offset if needed
        if (!this.panOffset.equals(new THREE.Vector3(0, 0, 0))) {
            this.target.add(this.panOffset);
            this.camera.position.add(this.panOffset);
            this.panOffset.set(0, 0, 0);
        }

        // Ensure camera is looking at target
        this.camera.lookAt(this.target);

        // Always maintain Z-up orientation
        this.camera.up.set(0, 0, 1);
    }

    // Smooth animated zoom
    private smoothZoom(targetScale: number, duration: number): void {
        const startPosition = this.camera.position.clone();
        const startDistance = startPosition.distanceTo(this.target);
        const endDistance = startDistance * targetScale;
        const startTime = performance.now();

        const animateZoom = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic for smooth deceleration
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            // Interpolate distance
            const currentDistance = startDistance + (endDistance - startDistance) * easeProgress;

            // Calculate new position along the same direction
            const direction = this.camera.position.clone().sub(this.target).normalize();
            this.camera.position.copy(this.target).add(direction.multiplyScalar(currentDistance));

            // Keep looking at target
            this.camera.lookAt(this.target);
            this.camera.up.set(0, 0, 1);

            if (progress < 1) {
                requestAnimationFrame(animateZoom);
            }
        };

        requestAnimationFrame(animateZoom);
    }

    public dispose(): void {
        this.element.removeEventListener('mousedown', this.onMouseDown, false);
        this.element.removeEventListener('wheel', this.onMouseWheel, false);
        document.removeEventListener('mousemove', this.onMouseMove, false);
        document.removeEventListener('mouseup', this.onMouseUp, false);

        // Remove touch event listeners
        this.element.removeEventListener('touchstart', this.onTouchStart, false);
        this.element.removeEventListener('touchmove', this.onTouchMove, false);
        this.element.removeEventListener('touchend', this.onTouchEnd, false);
        this.element.removeEventListener('touchcancel', this.onTouchEnd, false);
    }
}
