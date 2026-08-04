import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from './router'
import {
  DashboardPage,
  EmbedDashboardPage,
  ExhibitionPage,
  JoinPage,
  LandingPage,
  NotFoundPage,
  OrganizerControlPage,
  OrganizerOperationsPage,
  ParticipantLivePage,
  SubmissionPage,
  SynthesisPage,
} from '../features/pages'

function ScrollManager() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

export function App() {
  return (
    <>
      <ScrollManager />
      <Routes>
        <Route element={<LandingPage />} path="/" />
        <Route element={<Navigate replace to="/join/VIBE26" />} path="/join" />
        <Route element={<JoinPage />} path="/join/:roomCode" />
        <Route element={<ParticipantLivePage />} path="/events/:eventId/lobby" />
        <Route element={<ParticipantLivePage />} path="/events/:eventId/live" />
        <Route element={<SubmissionPage />} path="/events/:eventId/submission" />
        <Route element={<OrganizerControlPage />} path="/admin/events/:eventId/control" />
        <Route element={<OrganizerOperationsPage section="participants" />} path="/admin/events/:eventId/participants" />
        <Route element={<SynthesisPage />} path="/admin/events/:eventId/synthesis" />
        <Route element={<OrganizerOperationsPage section="submissions" />} path="/admin/events/:eventId/submissions" />
        <Route element={<OrganizerOperationsPage section="admins" />} path="/admin/events/:eventId/admins" />
        <Route element={<OrganizerOperationsPage section="portability" />} path="/admin/events/:eventId/portability" />
        <Route element={<DashboardPage />} path="/dashboards/:slug" />
        <Route element={<EmbedDashboardPage />} path="/embed/:roomCode" />
        <Route element={<EmbedDashboardPage />} path="/embed/dashboards/:slug" />
        <Route element={<ExhibitionPage />} path="/exhibitions/:slug" />
        <Route element={<ExhibitionPage />} path="/exhibitions/:slug/:submissionSlug" />
        <Route element={<NotFoundPage />} path="*" />
      </Routes>
    </>
  )
}
