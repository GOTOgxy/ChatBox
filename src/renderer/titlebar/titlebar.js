const urlInput = document.getElementById('url-input');
let currentSite = null;

window.chatbox.onTitlebarShow((data) => {
  currentSite = data.site;
  const isMac = data.platform === 'darwin';
  document.getElementById('win-left').style.display = isMac ? 'flex' : 'none';
  document.getElementById('win-right').style.display = isMac ? 'none' : 'flex';
  document.getElementById('bar').classList.toggle('docked', data.mode === 'docked');
  applyTheme(data.theme);
  urlInput.value = data.url || '';
  document.body.dataset.ready = '1';
});

window.chatbox.onThemeUpdate(({ theme }) => applyTheme(theme));

window.chatbox.onUrl(({ url }) => {
  if (document.activeElement !== urlInput) urlInput.value = url || '';
});

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    let value = urlInput.value.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    window.chatbox.navigate(value);
    urlInput.blur();
  } else if (event.key === 'Escape') {
    window.chatbox.closeTitlebar();
  }
});

document.getElementById('nav-back').addEventListener('click', () => window.chatbox.goBack());
document.getElementById('nav-forward').addEventListener('click', () => window.chatbox.goForward());
document.getElementById('nav-reload').addEventListener('click', () => window.chatbox.reload());
document.getElementById('nav-home').addEventListener('click', () => window.chatbox.goHome());

for (const suffix of ['l', 'r']) {
  document.getElementById(`win-min-${suffix}`).addEventListener('click', () => window.chatbox.minimize());
  document.getElementById(`win-max-${suffix}`).addEventListener('click', () => window.chatbox.toggleMaximize());
  document.getElementById(`win-close-${suffix}`).addEventListener('click', () => window.chatbox.closeWindow());
}

window.addEventListener('blur', () => {
  if (document.getElementById('bar').classList.contains('docked')) return;
  setTimeout(() => {
    if (!document.hasFocus()) window.chatbox.closeTitlebar();
  }, 120);
});

const barEl = document.getElementById('bar');
let dockedDragging = false;

barEl.addEventListener('mousedown', (event) => {
  if (!barEl.classList.contains('docked')) return;
  if (event.button !== 0) return;
  if (event.target.closest('button, input')) return;
  dockedDragging = true;
  window.chatbox.dockedDragStart(event.screenX, event.screenY);
  event.preventDefault();
});

window.addEventListener('mouseup', () => {
  if (!dockedDragging) return;
  dockedDragging = false;
  window.chatbox.dockedDragEnd();
});

window.addEventListener('blur', () => {
  if (!dockedDragging) return;
  dockedDragging = false;
  window.chatbox.dockedDragEnd();
});

