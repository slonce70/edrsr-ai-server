import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { AuthProvider } from './state/AuthContext';
import { WebSocketProvider } from './state/WebSocketContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <WebSocketProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </WebSocketProvider>
    </AuthProvider>
  </StrictMode>
);
