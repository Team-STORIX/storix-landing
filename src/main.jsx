import React from 'react'
import { createRoot } from 'react-dom/client'
import AttendanceEventPage from './pages/AttendanceEventPage.jsx'
import DownloadLandingPage from './pages/DownloadLandingPage.jsx'
import './styles.css'

function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const appEventMatch = pathname.match(/^\/event\/(\d+)$/)

  if (appEventMatch) {
    return <AttendanceEventPage appEventId={Number(appEventMatch[1])} />
  }

  if (pathname === '/events/attendance') {
    return <AttendanceEventPage />
  }

  return <DownloadLandingPage />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
