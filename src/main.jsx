// First import: installs the network guard before MediaPipe can load.
import './lib/offlineGuard.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AdminScreen from './components/AdminScreen.jsx'

// The admin screen is reached only by URL (index.html#admin), opened in its
// own tab/window — it never renders as part of the participant-facing game
// screen, so settings changes stay invisible to players.
const isAdminScreen = () => window.location.hash.replace('#', '').startsWith('admin');

// Switching between the two by editing the hash reloads, so the game never
// keeps a camera or model running behind the admin page.
const startedAsAdmin = isAdminScreen();
window.addEventListener('hashchange', () => {
  if (isAdminScreen() !== startedAsAdmin) window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {startedAsAdmin ? <AdminScreen /> : <App />}
  </StrictMode>,
)
