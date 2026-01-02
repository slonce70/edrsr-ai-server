import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { AuthProvider } from './state/AuthContext';
import { LocaleProvider } from './state/LocaleContext';
import { WebSocketProvider } from './state/WebSocketContext';
import { WorkspaceProvider } from './state/WorkspaceContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <WebSocketProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </WebSocketProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </LocaleProvider>
  </StrictMode>
);
