import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map(async (registration) => {
      const scopePath = new URL(registration.scope).pathname;
      const isEnglishScope =
        scopePath === '/aiyume_english' || scopePath.startsWith('/aiyume_english/');
      if (!isEnglishScope) {
        await registration.unregister();
      }
    })
  );

  registerSW({ immediate: true });
}

void setupServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
