import { useState, type ReactNode } from 'react';

/** Closed details must not render invisible lists into copied chat text, or parse hidden
 * reasoning on every stream update. Native summary semantics retain keyboard activation. */
export function AssistantDisclosure({
  summary,
  children,
  className,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={className} open={open}>
      <summary
        onClick={event => {
          event.preventDefault();
          setOpen(value => !value);
        }}
      >
        {summary}
      </summary>
      {open ? children : null}
    </details>
  );
}
