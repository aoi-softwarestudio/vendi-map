const CACHE_NAME = 'vendimap-cache-v80';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/leaflet.css',
  '/leaflet.js',
  '/data.js',
  '/vendix_logo.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&family=Outfit:wght@500;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Force reload on fetch requests during installation to bypass HTTP disk cache
      const requests = ASSETS_TO_CACHE.map(url => new Request(url, { cache: 'reload' }));
      return cache.addAll(requests).then(() => {
        self.skipWaiting();
      }).catch(err => {
        console.warn('Pre-caching warning (some assets might fail if offline during install):', err);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Page navigation (index.html): Network-First, fallback to Cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match('/index.html', { ignoreSearch: true }) || caches.match(event.request, { ignoreSearch: true });
        })
    );
  }
  // API requests: Network-First, fallback to Cache
  else if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
  } else if (url.origin !== self.location.origin) {
    // Cross-origin requests (e.g. Geocoding API) should always go directly to network
    event.respondWith(fetch(event.request));
  } else {
    // Static assets: Cache-First, fallback to Network (matching assets ignoring search queries for version-busting links)
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
        return cachedResponse || fetch(event.request).catch(() => {
          // If both fail and request is for page, return cached index
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html', { ignoreSearch: true });
          }
        });
      })
    );
  }
});
