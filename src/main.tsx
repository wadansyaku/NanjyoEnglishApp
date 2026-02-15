import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const SW_DISABLE_KEY = 'aiyume_sw_disabled_v1';

async function disableServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  let removed = false;
  await Promise.all(
    registrations.map(async (registration) => {
      const scopePath = new URL(registration.scope).pathname;
      const isEnglishScope =
        scopePath === '/aiyume_english' || scopePath.startsWith('/aiyume_english/');
      if (!isEnglishScope) return;
      const result = await registration.unregister();
      if (result) removed = true;
    })
  );

  if ('caches' in window) {
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
    } catch {
      // ignore cache cleanup failure
    }
  }

  if (removed && navigator.serviceWorker.controller && !sessionStorage.getItem(SW_DISABLE_KEY)) {
    sessionStorage.setItem(SW_DISABLE_KEY, '1');
    window.location.reload();
  }
}

void disableServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
