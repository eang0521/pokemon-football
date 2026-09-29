// Tiny modal helper built on <dialog>.
let dlg;
export function openModal(html, onReady, { wide = false } = {}) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  dlg.className = wide ? 'modal wide' : 'modal';
  dlg.innerHTML = `<div class="modal-body">${html}</div>`;
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  if (!dlg.open) dlg.showModal();
  onReady?.(dlg);
  return dlg;
}
export const closeModal = () => dlg?.close();

export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  if (btn) { const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = t; }, 1200); }
}
