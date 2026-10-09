// 零缓存直通 Service Worker：仅为满足浏览器「可安装」判定，不缓存任何资源。
// 空的 fetch 监听让请求走默认网络路径，因此不会造成站点内容陈旧。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
