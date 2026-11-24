const button = document.getElementById('send');
const deepButton = document.getElementById('deep');
const status = document.getElementById('status');

function run(type, activeButton) {
  activeButton.disabled = true;
  status.className = '';
  status.textContent = type === 'deep-collect' ? '深度采集中,后台会短暂打开各站点…' : '读取并发送中…';
  const timeout = setTimeout(() => {
    activeButton.disabled = false;
    status.className = 'error';
    status.textContent = '采集超时,请重试(标签页较多时首次采集可能较慢)。';
  }, type === 'deep-collect' ? 90000 : 60000);
  chrome.runtime.sendMessage({ type }, (response) => {
    clearTimeout(timeout);
    activeButton.disabled = false;
    if (response && response.ok) {
      status.textContent = response.count !== undefined
        ? `已发送 ${response.count} 条 Cookie。回到 ChatBox 点「导入」。`
        : '深度采集完成。回到 ChatBox 点「导入」。';
      if (response.count === 0 && response.diag) {
        status.className = 'error';
        const hosts = (response.diag.storeHosts || []).join(', ');
        status.textContent = `发送 0 条。本浏览器 Cookie 总数: ${response.diag.totalInStore}。实际存在的域名: ${hosts || '(无)'}。请对照:你要导入的站点域名若不在此列表,说明登录态在别的浏览器/配置里。`;
      } else if (response.diag && typeof response.diag.googleAuth === 'boolean') {
        if (response.diag.googleAuth) {
          status.textContent += ' Google 登录态:已检测到 ✓';
        } else {
          status.className = 'error';
          status.textContent += ' ⚠ 未检测到 Google 登录态。请先在本浏览器打开 gemini.google.com 登录,再重新发送。';
        }
      }
    } else {
      status.className = 'error';
      status.textContent = `失败: ${(response && response.error) || '未知错误'}。请确认 ChatBox 正在运行。`;
    }
  });
}

button.addEventListener('click', () => run('send-cookies', button));
deepButton.addEventListener('click', () => run('deep-collect', deepButton));
