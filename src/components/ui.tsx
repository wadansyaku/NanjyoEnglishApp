import type { InputHTMLAttributes, ReactNode } from 'react';

const join = (...tokens: Array<string | undefined | false>) => tokens.filter(Boolean).join(' ');

export function Button({
  children,
  className,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return (
    <button
      {...props}
      className={join(
        variant === 'secondary' && 'secondary',
        variant === 'ghost' && 'ui-ghost-button',
        className
      )}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  className,
  children
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={join('card', className)}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="candidate-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="ui-spinner-wrap" role="status" aria-live="polite">
      <span className="ui-spinner" />
      {label && <span className="counter">{label}</span>}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header-row">
          <h2 id="modal-title">{title}</h2>
          <Button className="modal-close" variant="secondary" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}

export type ToastItem = {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
};

export function ToastHost({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <div key={item.id} className={join('toast-item', `toast-${item.type}`)}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
