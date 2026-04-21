// ══ MindOnline Service Worker ══
// Versão do cache — incremente ao fazer atualizações
const CACHE_VERSION = 'mindonline-v1';

// Arquivos que serão cacheados para funcionar offline
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/privacidade.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap'
];

// ── Instalação: pré-cacheia os assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW] Pré-cacheando assets...');
      // Cacheia cada asset individualmente para não falhar tudo se um der erro
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Não foi possível cachear:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Ativação: remove caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_VERSION)
          .map(name => {
            console.log('[SW] Removendo cache antigo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch: estratégia Network First para o app, Cache First para assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignora requisições ao Supabase — sempre vai para a rede
  if (url.hostname.includes('supabase.co')) return;

  // Ignora métodos não-GET
  if (event.request.method !== 'GET') return;

  // Fontes do Google — Cache First (raramente mudam)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // HTML e assets locais — Network First, fallback para cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cacheia a resposta fresca
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline: tenta servir do cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback final: página principal
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// ── Push Notifications (base para futuras notificações push)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'Você tem uma nova notificação no MindOnline',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Ver' },
      { action: 'close', title: 'Fechar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'MindOnline', options)
  );
});

// ── Clique na notificação push
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Se já tem uma janela aberta, foca nela
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      // Senão, abre uma nova
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
