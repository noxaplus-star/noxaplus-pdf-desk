import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ActivePanel {
  panel: HTMLDivElement;
  layer: HTMLDivElement;
  previousFocus: HTMLElement | null;
}

interface IsolationState {
  inert: string | null;
  ariaHidden: string | null;
}

const activePanels: ActivePanel[] = [];
const isolatedElements = new Map<Element, IsolationState>();
let bodyObserver: MutationObserver | null = null;
let originalOverflow = '';
let originalFocus: HTMLElement | null = null;

const topPanel = () => activePanels[activePanels.length - 1];

function syncIsolation() {
  const active = topPanel();
  if (!active) {
    bodyObserver?.disconnect();
    bodyObserver = null;
  } else if (!bodyObserver) {
    bodyObserver = new MutationObserver(syncIsolation);
    bodyObserver.observe(document.body, { childList: true });
  }

  // Restore the newly active layer (and detached elements) before moving focus.
  for (const [element, state] of isolatedElements) {
    if (!active || element === active.layer || element.parentElement !== document.body) {
      if (state.inert === null) element.removeAttribute('inert');
      else element.setAttribute('inert', state.inert);
      if (state.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', state.ariaHidden);
      isolatedElements.delete(element);
    }
  }

  for (const entry of activePanels) {
    entry.panel.setAttribute('aria-modal', entry === active ? 'true' : 'false');
  }

  if (!active) return;
  for (const element of Array.from(document.body.children)) {
    if (element === active.layer) continue;
    if (!isolatedElements.has(element)) {
      isolatedElements.set(element, {
        inert: element.getAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
      });
    }
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  }
}

function focusPanel(panel: HTMLDivElement) {
  const target =
    panel.querySelector<HTMLElement>('[data-autofocus]') ??
    panel.querySelector<HTMLElement>(FOCUSABLE);
  (target ?? panel).focus();
}

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg';
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  feedback?: string;
}

export function Modal({ open, title, subtitle, size = 'md', onClose, children, footer, feedback }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    const layer = layerRef.current;
    if (!open || !panel || !layer) return;
    const entry: ActivePanel = {
      panel,
      layer,
      previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    if (activePanels.length === 0) {
      originalOverflow = document.body.style.overflow;
      originalFocus = entry.previousFocus;
      document.body.style.overflow = 'hidden';
    }
    activePanels.push(entry);
    focusPanel(panel);
    syncIsolation();

    const timer = window.setTimeout(() => {
      if (topPanel() === entry) focusPanel(panel);
    }, 40);

    const onKeyDown = (event: KeyboardEvent) => {
      if (topPanel() !== entry || (event.key !== 'Escape' && event.key !== 'Tab')) return;
      // One key event must never reach a second dialog, even if this one closes synchronously.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true',
      );
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || active === panel || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.clearTimeout(timer);
      const index = activePanels.indexOf(entry);
      if (index < 0) return;
      const wasTop = topPanel() === entry;
      activePanels.splice(index, 1);
      panel.removeAttribute('aria-modal');
      syncIsolation();
      const underlying = topPanel();
      if (!underlying) {
        document.body.style.overflow = originalOverflow;
        const target = originalFocus;
        originalFocus = null;
        if (target?.isConnected) target.focus();
      } else if (wasTop) {
        const target = entry.previousFocus;
        if (target?.isConnected && underlying.panel.contains(target)) target.focus();
        if (!underlying.panel.contains(document.activeElement)) focusPanel(underlying.panel);
      }
    };
  }, [open]);

  if (!open) return null;

  const closeActivePanel = () => {
    if (topPanel()?.panel === panelRef.current) closeRef.current();
  };

  return createPortal(
    <div
      ref={layerRef}
      className="modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeActivePanel();
      }}
    >
      <div
        ref={panelRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal__head">
          <div className="modal__heading">
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={closeActivePanel} aria-label="بستن پنجره">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{feedback ? <p className="dialog-note" role="status">{feedback}</p> : null}{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
