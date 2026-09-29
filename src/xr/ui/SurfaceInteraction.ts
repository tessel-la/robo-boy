import type { XrInputTarget } from '../XrInputManager';
import { getSurfaceOf, type SpatialSurface } from './SpatialSurface';

/**
 * Connects ray hits on spatial surfaces to their items.
 *
 * The input manager only knows about meshes; this is the one place that turns "the ray is on this
 * mesh at this uv" into "the ray is on this button". It is deliberately stateless apart from
 * remembering which surface each pointer last hovered, so that leaving a surface clears its
 * highlight.
 */
export class SurfaceInteraction {
  private readonly hovered = new Map<string, SpatialSurface>();

  /**
   * Identity of the control under a ray, or null when the ray is over a surface but not over any
   * control. Returning null (rather than the mesh) is what stops a press on an empty margin of a
   * menu from counting as an activation.
   */
  getActivationTarget(target: XrInputTarget): string | null {
    const surface = getSurfaceOf(target.object);
    if (!surface) return null;
    const item = surface.itemAt(target.uv);
    return item && !item.disabled ? `${surface.uid}:${item.id}` : null;
  }

  isSurface(target: XrInputTarget): boolean {
    return getSurfaceOf(target.object) !== null;
  }

  /** Run the pressed item's action. Returns whether a surface consumed the activation. */
  activate(target: XrInputTarget): boolean {
    const surface = getSurfaceOf(target.object);
    if (!surface) return false;
    const item = surface.itemAt(target.uv);
    if (item && !item.disabled) item.onPress?.();
    return true;
  }

  hover(pointerId: string, target: XrInputTarget | null): void {
    const surface = target ? getSurfaceOf(target.object) : null;
    const previous = this.hovered.get(pointerId);
    if (previous && previous !== surface) previous.clearHover(pointerId);
    if (!surface || !target) {
      this.hovered.delete(pointerId);
      return;
    }
    this.hovered.set(pointerId, surface);
    surface.setHover(pointerId, surface.itemAt(target.uv)?.id ?? null);
  }

  dispose(): void {
    for (const [pointerId, surface] of this.hovered) surface.clearHover(pointerId);
    this.hovered.clear();
  }
}
