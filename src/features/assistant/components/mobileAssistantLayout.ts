export interface CompactAssistantFrame {
  top: number;
  height: number;
  workspaceInset: number;
  takeover: boolean;
}

/** Keep useful workspace visible behind the mobile sheet when there is room. A short viewport,
 * including one reduced by the software keyboard, uses the whole area for chat instead. */
export const resolveCompactAssistantFrame = ({ viewportTop, viewportHeight, viewportWidth, toolbarBottom, requestedHeight }: {
  viewportTop: number; viewportHeight: number; viewportWidth: number; toolbarBottom: number; requestedHeight?: number;
}): CompactAssistantFrame => {
  const viewportBottom = viewportTop + viewportHeight;
  const contentTop = Math.max(viewportTop, toolbarBottom);
  const availableHeight = Math.max(240, viewportBottom - contentTop);
  const prefersTakeover = availableHeight <= 620 || viewportWidth <= 340;
  const defaultHeight = Math.min(620, Math.max(400, availableHeight * 0.66));
  const minimumHeight = Math.min(400, Math.max(320, availableHeight * 0.45));
  const maximumDockedHeight = Math.max(minimumHeight, availableHeight - Math.max(120, availableHeight * 0.15));
  const maximumHeight = prefersTakeover ? availableHeight : maximumDockedHeight;
  const preferredHeight = requestedHeight ?? (prefersTakeover ? availableHeight : defaultHeight);
  const height = Math.min(maximumHeight, Math.max(minimumHeight, preferredHeight));
  const takeover = height >= availableHeight - 1;
  return { top: viewportBottom - height, height, workspaceInset: takeover ? 0 : height, takeover };
};
