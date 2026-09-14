let syncing;

// 同步由后台持有，关闭浮窗后仍可完成；再次打开复用进行中的请求。
chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !['cache', 'sync', 'recordQuota', 'dashboard'].includes(request?.type)) return;
  let result;
  if (request.type === 'sync') {
    if (!syncing) {
      syncing = chrome.runtime.sendNativeMessage('com.codex.usage', {
        type: 'sync', force: request.force === true,
      }).finally(() => { syncing = undefined; });
    }
    result = syncing;
  } else if (request.type === 'recordQuota') {
    result = chrome.runtime.sendNativeMessage('com.codex.usage', {
      type: 'recordQuota',
      window: request.window,
      remainingPercent: request.remainingPercent,
    });
  } else if (request.type === 'dashboard') {
    result = chrome.runtime.sendNativeMessage('com.codex.usage', { type: 'dashboard' })
      .then(response => {
        if (response?.ok && response.url) chrome.tabs.create({ url: response.url });
        return response;
      });
  } else {
    result = chrome.runtime.sendNativeMessage('com.codex.usage', { type: 'cache' });
  }
  result.then(reply, error => reply({ ok: false, error: `无法连接本地采集程序，请按安装说明配置后重试：${error.message}` }));
  return true;
});
