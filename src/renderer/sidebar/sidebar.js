const sitesEl = document.getElementById('sites');
const buttons = new Map();
let sites = [];
let hotkeys = { switcher: '', showApp: '', sites: {} };
let openedIds = new Set();

function displayAccel(accelerator) {
  return (accelerator || '未设置').replace(/CommandOrControl/g, 'Ctrl');
}

function render(list, activeId) {
  sites = list;
  sitesEl.innerHTML = '';
  buttons.clear();
  list.filter((site) => site.enabled).forEach((site, index) => {
    const button = document.createElement('button');
    button.className = 'site-btn' + (site.id === activeId ? ' active' : '');
    if (!openedIds.has(site.id)) button.classList.add('closed');
    button.title = site.name;
    if (site.icon) {
      button.classList.add('has-icon');
      button.style.background = site.color;
      button.innerHTML = `<img src="${site.icon}" alt="" /><span class="badge"></span>`;
    } else {
      button.style.background = site.color;
      button.innerHTML = `<span>${site.letter}</span><span class="badge"></span>`;
    }
    button.addEventListener('click', () => window.chatbox.activate(site.id));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.chatbox.contextMenu(site.id);
    });
    button.draggable = true;
    button.dataset.id = site.id;
    button.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', site.id);
      event.dataTransfer.effectAllowed = 'move';
      button.classList.add('dragging');
    });
    button.addEventListener('dragend', () => {
      button.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    });
    button.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      button.classList.add('drop-target');
    });
    button.addEventListener('dragleave', () => button.classList.remove('drop-target'));
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      button.classList.remove('drop-target');
      const draggedId = event.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === site.id) return;
      const order = sites.map((item) => item.id);
      const fromIndex = order.indexOf(draggedId);
      const toIndex = order.indexOf(site.id);
      if (fromIndex === -1 || toIndex === -1) return;
      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, draggedId);
      window.chatbox.reorderSites(order);
    });
    sitesEl.appendChild(button);
    buttons.set(site.id, button);
  });
  refreshTitles();
  renderHiddenList();
}

function renderHiddenList() {
  const holder = document.getElementById('hidden-sites');
  const hidden = sites.filter((site) => !site.enabled);
  holder.innerHTML = '';
  const toggle = document.getElementById('hidden-toggle');
  toggle.style.display = hidden.length > 0 ? 'flex' : 'none';
  document.getElementById('hidden-count').textContent = String(hidden.length);
  if (hidden.length === 0) holder.classList.remove('expanded');
  for (const site of hidden) {
    const button = document.createElement('button');
    button.className = 'site-btn hidden-site';
    button.style.background = site.color;
    button.title = `${site.name}(已隐藏,点击恢复显示)`;
    if (site.icon) {
      button.classList.add('has-icon');
      button.style.background = site.color;
      button.innerHTML = `<img src="${site.icon}" alt="" />`;
    } else {
      button.innerHTML = `<span>${site.letter}</span>`;
    }
    button.addEventListener('click', () => window.chatbox.restoreSite(site.id));
    holder.appendChild(button);
  }
}

document.getElementById('hidden-toggle').addEventListener('click', () => {
  document.getElementById('hidden-sites').classList.toggle('expanded');
});

function refreshTitles() {
  for (const site of sites.filter((item) => item.enabled)) {
    const button = buttons.get(site.id);
    if (button) {
      button.title = `${site.name} (${displayAccel(hotkeys.sites[site.id])})`;
    }
  }
}

window.chatbox.onInit(({ sites: list, active, hotkeys: keys, opened, accentColor, theme }) => {
  if (keys) hotkeys = keys;
  if (opened) openedIds = new Set(opened);
  if (accentColor) document.documentElement.style.setProperty('--accent', accentColor);
  applyTheme(theme);
  render(list, active);
});

window.chatbox.onAccentUpdate(({ accentColor }) => {
  if (accentColor) document.documentElement.style.setProperty('--accent', accentColor);
});

window.chatbox.onThemeUpdate(({ theme }) => applyTheme(theme));

window.chatbox.onActive(({ id }) => {
  for (const [siteId, button] of buttons) {
    button.classList.toggle('active', siteId === id);
  }
});

window.chatbox.onUnread(({ id, unread }) => {
  const button = buttons.get(id);
  if (!button) return;
  const badge = button.querySelector('.badge');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('show', unread > 0);
});

window.chatbox.onHotkeysUpdate((keys) => {
  hotkeys = keys;
  refreshTitles();
});

window.chatbox.onSitesUpdate(({ sites: list, active, hotkeys: keys, opened }) => {
  if (keys) hotkeys = keys;
  if (opened) openedIds = new Set(opened);
  render(list, active);
});

window.chatbox.onOpened(({ opened }) => {
  openedIds = new Set(opened);
  for (const [siteId, button] of buttons) {
    button.classList.toggle('closed', !openedIds.has(siteId));
  }
});

const logoBtn = document.getElementById('logo-btn');
let logoPress = null;
let logoDragMoved = false;

logoBtn.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  logoPress = { x: event.screenX, y: event.screenY };
  logoDragMoved = false;
});

window.addEventListener('mousemove', (event) => {
  if (!logoPress || logoDragMoved) return;
  if (Math.hypot(event.screenX - logoPress.x, event.screenY - logoPress.y) < 5) return;
  logoDragMoved = true;
  window.chatbox.dockedDragStart(logoPress.x, logoPress.y);
});

window.addEventListener('mouseup', () => {
  if (!logoPress) return;
  if (logoDragMoved) window.chatbox.dockedDragEnd();
  else window.chatbox.toggleTitlebar();
  logoPress = null;
});

window.addEventListener('blur', () => {
  if (logoPress && logoDragMoved) window.chatbox.dockedDragEnd();
  logoPress = null;
});

document.getElementById('add-btn').addEventListener('click', () => {
  window.chatbox.openPanel('site-add');
});

document.getElementById('settings-btn').addEventListener('click', () => {
  window.chatbox.openPanel('settings');
});
document.getElementById('import-btn').addEventListener('click', () => {
  window.chatbox.openPanel('import');
});
