import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FONT_CSS } from './fonts';
import './styles.css';

const fonts = document.createElement('style');
fonts.textContent = FONT_CSS;
document.head.append(fonts);
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('sw.js', location.href), { scope: './' }).catch(() => {});
  });
}
