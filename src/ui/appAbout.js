// App-title about popover: click to toggle, Escape / outside click to close.

let open = false;
let outsideClickHandler = null;
let documentKeyHandler = null;

function getEls() {
  return {
    button: document.getElementById('appAboutButton'),
    popover: document.getElementById('appAboutPopover'),
  };
}

function teardownListeners() {
  if (outsideClickHandler) {
    document.removeEventListener('mousedown', outsideClickHandler);
    outsideClickHandler = null;
  }
  if (documentKeyHandler) {
    document.removeEventListener('keydown', documentKeyHandler);
    documentKeyHandler = null;
  }
}

function closeAppAbout({ restoreFocus = false } = {}) {
  const { button, popover } = getEls();
  if (!button || !popover) {
    open = false;
    return;
  }
  if (!open && !restoreFocus) return;
  open = false;
  popover.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  teardownListeners();
  if (restoreFocus) button.focus();
}

function openAppAbout() {
  const { button, popover } = getEls();
  if (!button || !popover || open) return;
  open = true;
  popover.hidden = false;
  button.setAttribute('aria-expanded', 'true');

  outsideClickHandler = (e) => {
    const { button: btn, popover: pop } = getEls();
    if (!btn || !pop) return;
    const t = e.target;
    if (btn.contains(t) || pop.contains(t)) return;
    closeAppAbout({ restoreFocus: false });
  };
  documentKeyHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAppAbout({ restoreFocus: true });
    }
  };
  document.addEventListener('mousedown', outsideClickHandler);
  document.addEventListener('keydown', documentKeyHandler);
}

function toggleAppAbout() {
  if (open) closeAppAbout({ restoreFocus: false });
  else openAppAbout();
}

export function initAppAbout() {
  const { button } = getEls();
  if (!button || button.dataset.appAboutWired === '1') return;
  button.dataset.appAboutWired = '1';
  button.addEventListener('click', (e) => {
    e.preventDefault();
    toggleAppAbout();
  });
}
