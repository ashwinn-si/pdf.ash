import { X, Plus, Check, Trash2, PenLine } from 'lucide-react';

interface SignatureDrawerProps {
  isOpen: boolean;
  signatures: string[];
  /** The signature a click on the page will place. */
  activeSignature: string | null;
  onPick: (dataUrl: string) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onClose: () => void;
}

/**
 * Desktop-only panel docked to the right of the page. It slides in from the
 * right edge while the Sign tool is active and holds every saved signature, so
 * choosing one is a click — not the signature dialog on every placement.
 * Always mounted so the slide can animate both ways; `inert` keeps its
 * contents out of the tab order and screen readers while it's closed.
 */
export default function SignatureDrawer({
  isOpen,
  signatures,
  activeSignature,
  onPick,
  onAdd,
  onDelete,
  onClose,
}: SignatureDrawerProps) {
  return (
    <aside
      className={`signature-drawer ${isOpen ? 'open' : ''}`}
      aria-label="Signatures"
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      <div className="signature-drawer-panel">
        <header className="signature-drawer-header">
          <div>
            <h3>Signatures</h3>
            <p>Choose one, then click the page to place it</p>
          </div>
          <button
            type="button"
            className="signature-drawer-close"
            onClick={onClose}
            aria-label="Close signatures"
            title="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="signature-drawer-list" role="listbox" aria-label="Saved signatures">
          {signatures.length === 0 && (
            <div className="signature-drawer-empty">
              <PenLine size={22} />
              <p>No saved signatures yet</p>
              <span>Draw or upload one and it will be kept here for next time.</span>
            </div>
          )}

          {signatures.map((dataUrl, i) => {
            const active = activeSignature === dataUrl;
            return (
              <div className={`signature-drawer-item ${active ? 'active' : ''}`} key={i}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className="signature-drawer-pick"
                  onClick={() => onPick(dataUrl)}
                  title="Use this signature"
                >
                  <img src={dataUrl} alt={`Signature ${i + 1}`} draggable={false} />
                  {active && (
                    <span className="signature-drawer-check" aria-hidden="true">
                      <Check size={12} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="signature-drawer-delete"
                  onClick={() => onDelete(i)}
                  aria-label={`Remove saved signature ${i + 1}`}
                  title="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>

        <footer className="signature-drawer-footer">
          <button type="button" className="signature-drawer-add" onClick={onAdd}>
            <Plus size={16} />
            {signatures.length === 0 ? 'Add a signature' : 'Add new signature'}
          </button>
        </footer>
      </div>
    </aside>
  );
}
