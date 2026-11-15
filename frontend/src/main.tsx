import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { App } from './App';
import { EditorNavigationGuard } from '@/components/EditorNavigationGuard';
import { installAudioUnlock } from '@/lib/audio';
import './index.css';
import './theme.css';

installAudioUnlock();

// Точная высота вьюпорта на мобильных. Обновляется при ресайзе и
// показе клавиатуры, чтобы нижняя навигация не «уезжала» вниз.
// Ориентацией управляет система — мы просто слушаем resize.
function setAppHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.visualViewport?.addEventListener('resize', setAppHeight);

const router = createBrowserRouter([{ path: '*', element: <><App /><EditorNavigationGuard /></> }]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
