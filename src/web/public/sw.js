// Minimal service worker so the browser offers "Install app".
// It caches nothing: the app always talks to the local API, so every request just goes to the network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
