// Small helpers around the shared <dialog> elements in partials/shared/dialogs.html.

// Open a dialog with button/keyboard handlers that are automatically removed
// when the dialog closes, so re-opening it never stacks duplicate listeners.
// `handlers` is an array of { el, event, fn }.
export function openDialog(dialog, handlers) {
  for (const h of handlers) h.el.addEventListener(h.event, h.fn);
  dialog.addEventListener(
    'close',
    () => {
      for (const h of handlers) h.el.removeEventListener(h.event, h.fn);
    },
    { once: true }
  );
  dialog.showModal();
}

// Styled replacement for the browser's alert().
export function showAlert(message, title = 'Notice') {
  const dialog = document.getElementById('messageDialog');
  document.getElementById('messageDialogTitle').textContent = title;
  document.getElementById('messageDialogText').textContent = message;
  const ok = document.getElementById('messageDialogOk');
  openDialog(dialog, [{ el: ok, event: 'click', fn: () => dialog.close() }]);
  ok.focus();
}
