function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function bindTheme(initialTheme, onUpdate) {
  applyTheme(initialTheme);
  if (onUpdate) onUpdate((data) => applyTheme(data.theme));
}
