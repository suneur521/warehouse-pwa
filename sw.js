// Service Worker for 补货系统
const CACHE_NAME = 'replenish-v9';
const STATIC_ASSETS = [
  '/',
  'index.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm'
];

// 安装事件：预缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] 缓存静态资源');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] 部分资源缓存失败（可能跨域）:', err.message);
      });
    })
  );
  self.skipWaiting();
});

// 激活事件：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => {
      console.log('[SW] 旧缓存已清理');
      return self.clients.claim();
    })
  );
});

// 请求拦截
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Supabase API 请求：仅网络（动态数据不缓存）
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: '网络不可用，请检查连接' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // CDN 脚本：缓存优先
  if (url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // index.html / 首页：stale-while-revalidate（缓存优先 + 后台静默更新）
  // 重复访问秒开（用缓存），后台拉取最新版写入缓存供下次使用；离线仍可用缓存
  if (url.pathname.endsWith('index.html') || url.pathname === '/') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          // 后台拉取最新版本并更新缓存（不阻塞当前响应）
          const networkFetch = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => null);
          // 有缓存：立即返回缓存（SWR）；无缓存：等网络（首次访问）
          return cached || networkFetch.then((res) => res || new Response('离线', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
        })
      )
    );
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || new Response(
            '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;color:#333;text-align:center}</style></head><body><div><h2>当前处于离线状态</h2><p>请检查网络连接后重试</p></div></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
  );
});