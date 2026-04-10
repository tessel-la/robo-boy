# BT Panel Mobile UI — Design Spec
Date: 2026-04-11

## Problem

The BehaviorTree panel is unusable on mobile (target platform) because:
- The side palette (200–250 px wide) consumes more than half the screen width on phones
- Drag-and-drop from sidebar to canvas does not work reliably on touch screens
- The toolbar can wrap/overflow on small screens

## Solution: Bottom Sheet Palette + Tap-to-Add

### Layout changes (≤768 px)

- The `NodePalette` no longer renders as a left sidebar; instead it slides up as a **bottom sheet** over the canvas
- The canvas (`bt-canvas`) takes **full width** at all times on mobile
- A **floating toggle button** (bottom-left of the canvas) opens/closes the palette sheet
- The bottom sheet occupies a fixed height (~50% of panel) and is scrollable inside

### Interaction model (mobile only)

- **Tap-to-add**: tapping a palette item calls `onAddNode(type, rosInfo)` in the panel, which places the node at the centre of the current React Flow viewport — no drag required
- Drag-and-drop from palette items is still wired (`draggable` / `onDragStart`) for desktop; on mobile it is simply unused
- The palette sheet auto-closes after a node is tapped

### Toolbar (≤768 px)

- Labels already hidden via existing CSS — keep that
- Zoom buttons moved to a single row; no layout changes needed beyond verifying no wrapping occurs
- Tree title hidden on very small screens (< 480 px) to prevent the toolbar from becoming two rows

### Desktop (> 768 px)

No changes — side palette with drag-and-drop stays exactly as-is.

## Component changes

| File | Change |
|------|--------|
| `NodePalette.tsx` | Accept `onAddNode?: (type, rosInfo?) => void`; call it on tap; emit CSS class `mobile-sheet` when on mobile |
| `NodePalette.css` | Add `.node-palette.mobile-sheet` bottom-sheet styles; floating toggle styles |
| `BehaviorTreePanel.tsx` | Implement `handleAddNode` using `reactFlowInstance.screenToFlowPosition` at viewport centre; pass to `NodePalette`; manage `isPaletteOpen` state for mobile |
| `BehaviorTreePanel.css` | Mobile layout: canvas full-width, palette as absolute overlay sheet |
| `BehaviorTreeToolbar.css` | Hide tree title below 480 px |

## Out of scope

- Multi-select on touch
- Undo/redo
- Edge editing on touch (React Flow handles pinch/pan natively)
