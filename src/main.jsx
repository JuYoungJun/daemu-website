import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './lib/globals.js';
import App from './App.jsx';

// Pre-React: if landing directly on an admin route, swap body classes
// synchronously so the splash-pending visibility:hidden rule never gets a
// chance to flash hide admin content.
(function () {
  const p = window.location.pathname;
  if (p === '/admin' || p.startsWith('/admin/')) {
    document.body.classList.remove('splash-pending');
    document.body.classList.add('splash-ready');
  }
})();

// import.meta.env.BASE_URL is injected by Vite based on `base` config.
// Strip trailing slash for React Router basename.
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>
);
