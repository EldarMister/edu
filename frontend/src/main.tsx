import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { App } from './App';
import './index.css';

// Точная высота вьюпорта на мобильных. Обновляется при смене ориентации,
// показе клавиатуры и т.п., чтобы нижняя навигация не «уезжала» вниз и
// возвращалась на место. Скролл страницы заблокирован (см. index.css),
// поэтому адресная строка браузера не дёргает высоту туда-сюда.
function setAppHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 200));
window.visualViewport?.addEventListener('resize', setAppHeight);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
