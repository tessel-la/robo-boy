# BT Panel Mobile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BehaviorTree panel usable on mobile by replacing the side palette with a bottom sheet and adding tap-to-add node placement.

**Architecture:** CSS media queries transform the side palette into an absolutely-positioned bottom sheet on mobile (≤768 px). A new `onAddNode` prop lets palette items add nodes at the canvas viewport centre instead of requiring drag-and-drop. Desktop behaviour (side palette + drag) is unchanged.

**Tech Stack:** React, TypeScript, React Flow (`reactflow`), CSS media queries, Vitest + React Testing Library

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/features/behaviorTree/components/NodePalette.tsx` | Modify | Accept `onAddNode` prop; call it on item click; apply `mobile-sheet` class |
| `src/features/behaviorTree/components/NodePalette.css` | Modify | Bottom-sheet layout, floating toggle, slide animation |
| `src/features/behaviorTree/components/BehaviorTreePanel.tsx` | Modify | `handleAddNode` using `screenToFlowPosition`; wire `onAddNode` to NodePalette; mobile `isPaletteOpen` default |
| `src/features/behaviorTree/components/BehaviorTreePanel.css` | Modify | Canvas full-width on mobile; palette overlay positioning |
| `src/features/behaviorTree/components/BehaviorTreeToolbar.css` | Modify | Hide tree title below 480 px to prevent toolbar wrapping |
| `src/features/behaviorTree/components/NodePalette.test.tsx` | Create | Unit tests for `onAddNode` callback on click |

---

### Task 1: Add `onAddNode` prop to NodePalette and wire click handlers

**Files:**
- Modify: `src/features/behaviorTree/components/NodePalette.tsx`
- Create: `src/features/behaviorTree/components/NodePalette.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/behaviorTree/components/NodePalette.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import NodePalette from './NodePalette';
import { BehaviorNodeType } from '../types';

// reactflow is not needed here — NodePalette doesn't use it directly
vi.mock('reactflow', () => ({}));

describe('NodePalette', () => {
  const defaultProps = {
    ros: null,
    isConnected: false,
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
  };

  it('calls onAddNode with Sequence type when Sequence item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Sequence'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Sequence, undefined);
  });

  it('calls onAddNode with Selector type when Selector item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Selector'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Selector, undefined);
  });

  it('calls onAddNode with Parallel type when Parallel item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Parallel'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Parallel, undefined);
  });

  it('does not throw when onAddNode is not provided and item is clicked', () => {
    render(<NodePalette {...defaultProps} />);
    expect(() => fireEvent.click(screen.getByText('Sequence'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run src/features/behaviorTree/components/NodePalette.test.tsx
```

Expected: FAIL — `onAddNode` prop doesn't exist yet.

- [ ] **Step 3: Update NodePalette props interface and add click handlers**

In `src/features/behaviorTree/components/NodePalette.tsx`, update the interface and component:

```tsx
interface NodePaletteProps {
  ros: Ros | null;
  isConnected: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onAddNode?: (type: BehaviorNodeType, rosInfo?: any) => void;
}

const NodePalette: React.FC<NodePaletteProps> = ({
  ros,
  isConnected,
  isCollapsed,
  onToggleCollapse,
  onAddNode,
}) => {
```

Then add `onClick` to every `.palette-node` div. For the control nodes map (around line 151):

```tsx
{controlNodes.map((node) => (
  <div
    key={node.type}
    className="palette-node"
    draggable
    onDragStart={(e) => handleDragStart(e, node.type)}
    onClick={() => onAddNode?.(node.type, undefined)}
  >
    <span className="palette-node-icon">{node.icon}</span>
    <span className="palette-node-label">{node.label}</span>
  </div>
))}
```

For the ROS Actions map (around line 188):

```tsx
<div
  key={`${action.name}-${index}`}
  className="palette-node palette-node-ros"
  draggable
  onDragStart={(e) =>
    handleDragStart(e, BehaviorNodeType.Action, action)
  }
  onClick={() => onAddNode?.(BehaviorNodeType.Action, action)}
  title={action.name}
>
```

For the ROS Services map (around line 229):

```tsx
<div
  key={`${service.name}-${index}`}
  className="palette-node palette-node-ros"
  draggable
  onDragStart={(e) =>
    handleDragStart(e, BehaviorNodeType.Service, service)
  }
  onClick={() => onAddNode?.(BehaviorNodeType.Service, service)}
  title={service.name}
>
```

For the ROS Topics map (around line 271):

```tsx
<div
  key={`${topic.name}-${index}`}
  className="palette-node palette-node-ros"
  draggable
  onDragStart={(e) =>
    handleDragStart(e, BehaviorNodeType.Topic, topic)
  }
  onClick={() => onAddNode?.(BehaviorNodeType.Topic, topic)}
  title={topic.name}
>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/features/behaviorTree/components/NodePalette.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm run test:run
```

Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/behaviorTree/components/NodePalette.tsx \
        src/features/behaviorTree/components/NodePalette.test.tsx
git commit -m "feat(bt): add onAddNode tap-to-add prop to NodePalette"
```

---

### Task 2: Implement `handleAddNode` in BehaviorTreePanel

**Files:**
- Modify: `src/features/behaviorTree/components/BehaviorTreePanel.tsx`

- [ ] **Step 1: Import `useReactFlow` in BehaviorTreePanelInner**

`useReactFlow` is already imported in `BehaviorTreeToolbar.tsx` — it's available from `reactflow`. Add it to the imports at the top of `BehaviorTreePanel.tsx`:

```tsx
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,           // add this
} from 'reactflow';
```

- [ ] **Step 2: Add `handleAddNode` callback inside `BehaviorTreePanelInner`**

Add after the existing `handleStop` callback (around line 355). Insert before the `return` statement:

```tsx
const { screenToFlowPosition } = useReactFlow();

// Add a node at the centre of the visible canvas — used for mobile tap-to-add.
const handleAddNode = useCallback(
  (nodeType: BehaviorNodeType, rosInfo?: any) => {
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!bounds) return;

    const position = screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });

    const id = `node-${nodeIdCounter.current++}`;
    let nodeData: any;
    let label = '';

    switch (nodeType) {
      case BehaviorNodeType.Sequence:
        label = 'Sequence';
        nodeData = { label, type: 'sequence' };
        break;
      case BehaviorNodeType.Selector:
        label = 'Selector';
        nodeData = { label, type: 'selector' };
        break;
      case BehaviorNodeType.Parallel:
        label = 'Parallel';
        nodeData = { label, type: 'parallel' };
        break;
      case BehaviorNodeType.Action:
        label = rosInfo?.name || 'Action';
        nodeData = {
          label,
          actionName: rosInfo?.name || '',
          actionType: rosInfo?.type || '',
        };
        break;
      case BehaviorNodeType.Service:
        label = rosInfo?.name || 'Service';
        nodeData = {
          label,
          serviceName: rosInfo?.name || '',
          serviceType: rosInfo?.type || '',
        };
        break;
      case BehaviorNodeType.Topic:
        label = rosInfo?.name || 'Topic';
        nodeData = {
          label,
          topicName: rosInfo?.name || '',
          messageType: rosInfo?.type || '',
        };
        break;
      default:
        return;
    }

    const newNode: Node = { id, type: nodeType, position, data: nodeData };
    setNodes((nds) => nds.concat(newNode));

    // Close palette on mobile after adding
    if (window.matchMedia('(max-width: 768px)').matches) {
      setIsPaletteCollapsed(true);
    }
  },
  [screenToFlowPosition, setNodes]
);
```

- [ ] **Step 3: Pass `onAddNode` to `NodePalette` in the JSX**

Find the `<NodePalette` element (around line 371) and add the prop:

```tsx
<NodePalette
  ros={ros}
  isConnected={isConnected}
  isCollapsed={isPaletteCollapsed}
  onToggleCollapse={() => setIsPaletteCollapsed(!isPaletteCollapsed)}
  onAddNode={handleAddNode}
/>
```

- [ ] **Step 4: Run the test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/behaviorTree/components/BehaviorTreePanel.tsx
git commit -m "feat(bt): implement handleAddNode for tap-to-add at viewport centre"
```

---

### Task 3: Mobile bottom sheet CSS for NodePalette

**Files:**
- Modify: `src/features/behaviorTree/components/NodePalette.css`
- Modify: `src/features/behaviorTree/components/NodePalette.tsx`

- [ ] **Step 1: Add `mobile-sheet` CSS class to NodePalette**

In `NodePalette.tsx`, add `mobile-sheet` to the root `div` className when on mobile. Add a hook at the top of the component body (before the `controlNodes` declaration):

```tsx
const [isMobile, setIsMobile] = React.useState(
  () => window.matchMedia('(max-width: 768px)').matches
);

React.useEffect(() => {
  const mq = window.matchMedia('(max-width: 768px)');
  const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}, []);
```

Update the collapsed early-return branch:

```tsx
if (isCollapsed) {
  return isMobile ? null : (
    <div className="node-palette collapsed">
      <button className="palette-toggle" onClick={onToggleCollapse} title="Expand Palette">
        ▶
      </button>
    </div>
  );
}
```

Update the main return's root element className:

```tsx
<div className={`node-palette${isMobile ? ' mobile-sheet' : ''}`}>
```

- [ ] **Step 2: Replace the `@media (max-width: 768px)` block in `NodePalette.css` with the bottom-sheet styles**

Replace the existing mobile block (lines 189–216) with:

```css
/* ── Mobile: bottom sheet ──────────────────────────────────── */
@media (max-width: 768px) {
  /* Side palette hidden on mobile — bottom sheet takes over */
  .node-palette:not(.mobile-sheet) {
    display: none;
  }

  .node-palette.mobile-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 55vh;
    border-right: none;
    border-top: 2px solid var(--border-color, #e0e0e0);
    border-radius: 16px 16px 0 0;
    z-index: 200;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.18);
    overflow-y: auto;
    /* slide up animation */
    animation: bt-sheet-slide-up 0.22s ease-out;
  }

  @keyframes bt-sheet-slide-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }

  .palette-header {
    padding: 10px 16px;
    position: sticky;
    top: 0;
    background: var(--card-bg, #ffffff);
    z-index: 1;
    border-radius: 16px 16px 0 0;
  }

  /* drag handle pill */
  .palette-header::before {
    content: '';
    display: block;
    width: 40px;
    height: 4px;
    background: var(--border-color, #cccccc);
    border-radius: 2px;
    margin: 0 auto 10px;
  }

  .palette-title {
    font-size: 14px;
  }

  .palette-discover-btn {
    margin: 8px 16px;
    padding: 8px 12px;
    font-size: 13px;
  }

  .palette-node {
    padding: 10px 16px;
    margin: 3px 10px;
    /* larger touch targets */
    min-height: 44px;
  }

  .palette-node-icon {
    font-size: 18px;
  }

  .palette-node-label {
    font-size: 14px;
  }

  .palette-section-content {
    /* allow full height scroll on mobile */
    max-height: none;
  }
}
```

- [ ] **Step 3: Run lint to check for CSS issues**

```bash
npm run lint
```

Expected: zero warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/behaviorTree/components/NodePalette.tsx \
        src/features/behaviorTree/components/NodePalette.css
git commit -m "feat(bt): bottom sheet palette layout for mobile"
```

---

### Task 4: Mobile canvas layout and floating palette toggle

**Files:**
- Modify: `src/features/behaviorTree/components/BehaviorTreePanel.css`
- Modify: `src/features/behaviorTree/components/BehaviorTreePanel.tsx`

- [ ] **Step 1: Default palette to collapsed on mobile**

In `BehaviorTreePanel.tsx`, change the `isPaletteCollapsed` initial state so the palette starts hidden on phones:

```tsx
// Replace:
const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);

// With:
const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(
  () => window.matchMedia('(max-width: 768px)').matches
);
```

- [ ] **Step 2: Add floating toggle button for mobile palette**

In `BehaviorTreePanel.tsx`, add a floating button inside `.bt-canvas` that is only rendered on mobile. Add a `isMobileState` in the inner component (or reuse the pattern — keep it simple with an inline check):

Add the floating button inside the `.bt-canvas` div, just before the closing `</div>`:

```tsx
<div className="bt-canvas" ref={reactFlowWrapper}>
  <ReactFlow
    {/* ... existing props unchanged ... */}
  >
    <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
    <Controls showInteractive={false} />
    <MiniMap
      nodeStrokeWidth={3}
      zoomable
      pannable
      style={{
        background: 'var(--card-bg, #ffffff)',
        border: '1px solid var(--border-color, #e0e0e0)',
      }}
    />
  </ReactFlow>

  {/* Mobile-only palette toggle — hidden on desktop via CSS */}
  <button
    className="bt-palette-fab"
    onClick={() => setIsPaletteCollapsed(!isPaletteCollapsed)}
    title={isPaletteCollapsed ? 'Open Node Palette' : 'Close Node Palette'}
  >
    {isPaletteCollapsed ? '＋' : '✕'}
  </button>
</div>
```

- [ ] **Step 2: Add mobile layout CSS to `BehaviorTreePanel.css`**

Append to the end of `BehaviorTreePanel.css` (before the closing dark-mode block):

```css
/* ── Mobile: full-width canvas + floating palette button ─── */
@media (max-width: 768px) {
  .bt-content {
    flex-direction: column;
  }

  /* canvas takes full width — side palette is gone on mobile */
  .bt-canvas {
    flex: 1;
    width: 100%;
  }

  /* floating action button to open/close the bottom-sheet palette */
  .bt-palette-fab {
    position: absolute;
    bottom: 16px;
    left: 16px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--primary-color, #4285f4);
    color: white;
    border: none;
    font-size: 22px;
    cursor: pointer;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    transition: background 0.2s, transform 0.15s;
  }

  .bt-palette-fab:active {
    transform: scale(0.92);
  }

  .react-flow__controls {
    bottom: 72px; /* keep above FAB */
    left: 16px;
  }
}

/* Hide FAB on desktop */
@media (min-width: 769px) {
  .bt-palette-fab {
    display: none;
  }
}
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: zero warnings.

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/behaviorTree/components/BehaviorTreePanel.tsx \
        src/features/behaviorTree/components/BehaviorTreePanel.css
git commit -m "feat(bt): full-width canvas and floating palette FAB on mobile"
```

---

### Task 5: Toolbar — hide tree title below 480 px

**Files:**
- Modify: `src/features/behaviorTree/components/BehaviorTreeToolbar.css`

- [ ] **Step 1: Add the 480 px rule**

In `BehaviorTreeToolbar.css`, append inside (or after) the existing `@media (max-width: 768px)` block:

```css
@media (max-width: 480px) {
  .bt-tree-title {
    display: none;
  }

  .bt-toolbar-center {
    display: none;
  }
}
```

- [ ] **Step 2: Verify the toolbar section gap is tight on small screens**

The existing rule already hides `.bt-toolbar-label` at 768 px and reduces padding. Confirm the three sections (file ops | title | zoom+execute) don't wrap at 360 px by counting approximate widths:
- Section 1: 5 icon-only buttons × ~34 px = ~170 px
- Section 3: 3 zoom + 1 execute = ~4 × 34 px = ~136 px
- Total: ~306 px — fits in 360 px with `gap: 4px`

No further changes needed.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: zero warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/behaviorTree/components/BehaviorTreeToolbar.css
git commit -m "feat(bt): hide tree title on very small screens to prevent toolbar wrap"
```

---

### Task 6: Start dev server and verify on mobile viewport

**Files:** none

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open browser DevTools → Responsive / Device Toolbar**

Set viewport to **360 × 780** (generic Android phone). Navigate to the BT panel.

Expected:
- Canvas is full width with no side palette eating horizontal space
- A blue circular "＋" FAB appears bottom-left
- Tapping FAB opens the bottom sheet (slides up, shows Node Palette with drag handle pill)
- Tapping "Sequence" (or any node) adds a node to the canvas centre and closes the sheet
- Tapping FAB again shows "✕" and re-opens the sheet

- [ ] **Step 3: Verify desktop is unchanged**

Switch DevTools to desktop viewport (1280 × 800). Confirm:
- Side palette is visible on the left (250 px wide)
- Drag-and-drop from palette to canvas still works
- FAB is not visible
- Collapse toggle (◀/▶) still works

- [ ] **Step 4: Run coverage to confirm thresholds still met**

```bash
npm run test:coverage
```

Expected: all four metrics (statements/branches/functions/lines) ≥ 20%.
