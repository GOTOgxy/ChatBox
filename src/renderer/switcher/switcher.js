const bar = document.getElementById('bar');
let sites = [];
let selected = 0;

function nearWhite(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!match) return false;
  const value = parseInt(match[1], 16);
  return ((value >> 16) & 255) > 235 && ((value >> 8) & 255) > 235 && (value & 255) > 235;
}

function render() {
  bar.innerHTML = '';
  sites.forEach((site, index) => {
    const card = document.createElement('div');
    card.className = 'card' + (index === selected ? ' selected' : '');
    card.innerHTML = `
      <span class="num">${index + 1}</span>
      <div class="icon" style="background:${site.color};${nearWhite(site.color) ? 'border:1px solid var(--border-input);' : ''}">${site.icon ? `<img src="${site.icon}" alt="" style="width:26px;height:26px;object-fit:contain" />` : site.letter}</div>
      <span class="name">${site.name}</span>`;
    card.addEventListener('click', () => window.chatbox.pick(site.id));
    card.addEventListener('mousemove', () => {
      if (selected !== index) {
        selected = index;
        updateSelection();
      }
    });
    bar.appendChild(card);
  });
}

function updateSelection() {
  Array.from(bar.children).forEach((card, index) => {
    card.classList.toggle('selected', index === selected);
  });
}

window.chatbox.onShow((data) => {
  sites = data.sites;
  selected = sites.length > 1 ? 1 : 0;
  applyTheme(data.theme);
  render();
});

window.chatbox.onThemeUpdate(({ theme }) => applyTheme(theme));

window.chatbox.onSites((data) => {
  sites = data.sites;
  if (selected >= sites.length) selected = 0;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.chatbox.hide();
  } else if (event.key === 'ArrowRight' || event.key === 'Tab') {
    event.preventDefault();
    selected = (selected + 1) % sites.length;
    updateSelection();
  } else if (event.key === 'ArrowLeft') {
    selected = (selected - 1 + sites.length) % sites.length;
    updateSelection();
  } else if (event.key === 'Enter') {
    if (sites[selected]) window.chatbox.pick(sites[selected].id);
  } else if (/^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    if (sites[index]) window.chatbox.pick(sites[index].id);
  }
});

window.addEventListener('blur', () => window.chatbox.hide());
