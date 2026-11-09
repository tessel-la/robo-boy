import { FiX } from 'react-icons/fi';
import './ManagementDialogHeader.css';

/** Shared chrome for content and deployment management; each owner keeps its own apply lifecycle. */
export function ManagementDialogHeader({
  title,
  titleId,
  subtitle,
  closeLabel,
  onClose,
}: {
  title: string;
  titleId: string;
  subtitle: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header className="management-dialog-header">
      <div>
        <span>{subtitle}</span>
        <h2 id={titleId}>{title}</h2>
      </div>
      <button type="button" onClick={onClose} aria-label={closeLabel}>
        <FiX aria-hidden="true" />
      </button>
    </header>
  );
}
