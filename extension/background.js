const HOST_NAME = 'com.chatai.cookie_import';
let storageStatus = {};

async function collectAndSend() {
  // 采集全部 cookie(含自定义站点),应用侧按各站点域名过滤注入。
  let everyCookie = [];
  try {
    everyCookie = await chrome.cookies.getAll({});
  } catch {
  }
  const perDomain = {};
  for (const cookie of everyCookie) {
    const host = cookie.domain.replace(/^\./, '');
    perDomain[host] = (perDomain[host] || 0) + 1;
  }
  const totalInStore = everyCookie.length;
  const storeHosts = Array.from(new Set(everyCookie.map((cookie) => cookie.domain.replace(/^\./, '')))).sort();
  const seen = new Set();
  const unique = everyCookie.filter((cookie) => {
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const googleAuthNames = new Set([
    'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
    '__Secure-1PSID', '__Secure-1PAPISID', '__Secure-1PSIDTS',
    '__Secure-3PSID', '__Secure-3PAPISID', '__Secure-3PSIDTS'
  ]);
  const googleCookies = unique.filter((cookie) => {
    const host = cookie.domain.replace(/^\./, '');
    return host === 'google.com' || host.endsWith('.google.com');
  });
  const googleAuthCount = googleCookies.filter((cookie) => googleAuthNames.has(cookie.name)).length;
  const googleAuth = googleCookies.some((cookie) =>
    cookie.name === 'SID' || cookie.name === '__Secure-1PSID' || cookie.name === '__Secure-3PSID');
  const payload = {
    type: 'cookie-import',
    cookies: unique.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.session ? undefined : cookie.expirationDate
    })),
    userAgent: navigator.userAgent,
    sentAt: Date.now(),
    diag: { perDomain, totalInStore, storeHosts, googleAuth, googleAuthCount }
  };
  payload.storage = await collectStorage();
  payload.storageStatus = storageStatus;
  return sendPayload(payload);
}

function sendPayload(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ ...(response || { ok: false, error: 'empty response' }), diag: payload.diag });
      }
    });
  });
}

const STORAGE_ORIGINS = [
  'https://chatgpt.com',
  'https://gemini.google.com',
  'https://www.qianwen.com',
  'https://www.kimi.com',
  'https://chat.deepseek.com'
];

async function dumpStorageInTab(tabId) {
  const injection = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const dump = {};
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        dump[key] = localStorage.getItem(key);
      }
      return dump;
    }
  });
  return (injection && injection[0] && injection[0].result) || {};
}

async function collectStorage() {
  const result = {};
  storageStatus = {};
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    tabs = [];
  }
  for (const tab of tabs) {
    if (!tab.url || !/^https?:/.test(tab.url)) continue;
    let origin;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      continue;
    }
    // 采集所有已打开 http(s) 标签页的 localStorage(含自定义站点),应用侧按域名过滤。
    if (result[origin]) continue;
    try {
      const data = await dumpStorageInTab(tab.id);
      if (Object.keys(data).length > 0) {
        result[origin] = data;
        storageStatus[origin] = 'tab';
      }
    } catch (error) {
      storageStatus[origin] = `tab-error: ${String(error).slice(0, 80)}`;
    }
  }
  return result;
}

async function deepCollectAndSend() {
  let totalInStore = -1;
  let storeHosts = [];
  try {
    const everyCookie = await chrome.cookies.getAll({});
    totalInStore = everyCookie.length;
    storeHosts = Array.from(new Set(everyCookie.map((cookie) => cookie.domain.replace(/^\./, '')))).sort();
  } catch {
  }
  const payload = {
    type: 'cookie-import',
    cookies: [],
    userAgent: navigator.userAgent,
    sentAt: Date.now(),
    storage: {},
    storageStatus: {},
    deep: true,
    diag: { totalInStore, storeHosts }
  };
  await Promise.all(STORAGE_ORIGINS.map((origin) => collectOneOrigin(origin, payload)));
  return sendPayload(payload);
}

async function collectOneOrigin(origin, payload) {
    let tab;
    try {
      tab = await chrome.tabs.create({ url: `${origin}/`, active: false });
      await waitForTabComplete(tab.id, 10000);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const data = await dumpStorageInTab(tab.id);
      if (Object.keys(data).length > 0) {
        payload.storage[origin] = data;
        payload.storageStatus[origin] = 'opened';
      } else {
        payload.storageStatus[origin] = 'empty';
      }
    } catch (error) {
      payload.storageStatus[origin] = `open-error: ${String(error).slice(0, 80)}`;
    } finally {
      if (tab) {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
    function listener(updatedId, changeInfo) {
      if (updatedId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'send-cookies') {
    collectAndSend().then(sendResponse);
    return true;
  }
  if (message && message.type === 'deep-collect') {
    deepCollectAndSend().then(sendResponse);
    return true;
  }
  return false;
});
