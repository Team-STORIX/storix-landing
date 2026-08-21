import React from 'react'
import { createRoot } from 'react-dom/client'
import AppEventRouter from './pages/AppEventRouter.jsx'
import AttendanceEventPage from './pages/AttendanceEventPage.jsx'
import DownloadLandingPage from './pages/DownloadLandingPage.jsx'
import StoryCardEventPage from './pages/StoryCardEventPage.jsx'
import './styles.css'

function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const appEventMatch = pathname.match(/^\/event\/(\d+)$/)

  if (appEventMatch) {
    return <AppEventRouter appEventId={Number(appEventMatch[1])} />
  }

  if (pathname === '/events/attendance') {
    return <AttendanceEventPage />
  }

  if (pathname === '/events/story-card') {
    return <StoryCardEventPage />
  }

  return <DownloadLandingPage />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
