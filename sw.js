const CACHE_NAME = 'The-COO-Agent'; // အပ်ဒိတ်လုပ်သည့်အခါ version ကိုပြောင်းရန် လိုအပ်ပါသည်။
const urlsToCache = [
    '/The-COO-Agent/',
    '/The-COO-Agent/index.html',
    '/The-COO-Agent/icons/icon-192x192.png',
    '/The-COO-Agent/icons/icon-512x512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Padauk&amp;display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://unpkg.com/html5-qrcode',
    'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js',
    'https://cdnjs.cloudflare.com/ajax/libs/marked/4.0.0/marked.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/sql/sql.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm', // WASM file
];


const fontUrls = [
  'https://fonts.gstatic.com/s/padauk/v16/z7_g_J0qP-c8hA-hA4wzOQ.woff2', 
  'https://fonts.gstatic.com/s/padauk/v16/z7_i_J0qP-c8hA-hA7wzP_A.woff',
];

self.addEventListener('install', (event) => {
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching app shell');
                return cache.addAll(urlsToCache.concat(fontUrls)).catch(err => {
                    console.error('[Service Worker] Cache.addAll failed:', err);
                    return Promise.resolve(); 
                });
            })
    );
});

self.addEventListener('fetch', (event) => {
    // Cache-First, then Network Strategy
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
               
                if (response) {
                    return response;
                }
                
               
                return fetch(event.request)
                    .then((response) => {
                        if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
                            return response;
                        }

                        const responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                if (event.request.method === 'GET') {
                                    cache.put(event.request, responseToCache).catch(err => {});
                                }
                            });

                        return response;
                    })
                    .catch((err) => {
                        
                        if (event.request.mode === 'navigate') {
                             return caches.match('/The-COO-Agent/index.html');
                        }
                    });
            })
    );
});

self.addEventListener('activate', (event) => {
    
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});