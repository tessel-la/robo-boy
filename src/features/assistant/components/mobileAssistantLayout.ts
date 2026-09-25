export interface CompactAssistantFrame {
  top: number;
  height: number;
  workspaceInset: number;
  takeover: boolean;
}

/** Keep useful workspace visible behind the mobile sheet when there is room. A short viewport,
 * including one reduced by the software keyboard, uses the whole area for chat instead. */
export const resolveCompactAssistantFrame = ({ viewportTop, viewportHeight, viewportWidth, toolbarBottom }: {
  viewportTop: number; viewportHeight: number; viewportWidth: number; toolbarBottom: number;
}): CompactAssistantFrame => {
  const viewportBottom = viewportTop + viewportHeight;
  const contentTop = Math.max(viewportTop, toolbarBottom);
  const availableHeight = Math.max(240, viewportBottom - contentTop);
  const takeover = availableHeight <= 620 || viewportWidth <= 340;
  const height = takeover ? availableHeight : Math.min(620, Math.max(400, availableHeight * 0.66));
  return { top: viewportBottom - height, height, workspaceInset: takeover ? 0 : height, takeover };
};
