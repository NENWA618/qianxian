const CACHE_NAME = 'qianxian-pwa-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './main.css',
  './main.js',
  './utils.js',
  './qianxian.png',
  './manifest.json',
  './members.html',
  './zhinan.html',
  './chat_window.html',   // 新增：聊天小窗页面
  './chat_window.js'      // 新增：聊天小窗脚本
];

// 安装阶段：缓存静态资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 激活阶段：清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 拦截请求：优先缓存，网络失败时回退缓存
self.addEventListener('fetch', event => {
  const req = event.request;
  // 只缓存GET请求
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cachedRes => {
      if (cachedRes) return cachedRes;
      return fetch(req)
        .then(networkRes => {
          // 只缓存同源静态资源
          if (
            req.url.startsWith(self.location.origin) &&
            networkRes.status === 200 &&
            networkRes.type === 'basic'
          ) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(() => {
          // 离线时回退首页
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

// Web Push 通知（仅@和系统通告推送）
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: '新消息', body: event.data && event.data.text() };
  }
  // 只推送@和系统通告
  if (data.title === '你被@了' || data.title === '系统通知') {
    const title = data.title;
    const options = {
      body: data.body || '',
      icon: './qianxian.png',
      badge: './qianxian.png',
      data: data.url || './'
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});