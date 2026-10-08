import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (
  typeof window !== 'undefined' &&
  window.location.protocol === 'http:' &&
  !['localhost', '127.0.0.1'].includes(window.location.hostname)
) {
  window.location.href = window.location.href.replace('http:', 'https:');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
