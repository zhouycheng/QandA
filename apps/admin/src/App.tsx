import { lazy, Suspense } from 'react'
import { Spin } from '@arco-design/web-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './layouts/admin-layout'
import { ProtectedRoute } from './components/protected-route'

const DashboardPage = lazy(() =>
  import('./pages/dashboard/dashboard-page').then((module) => ({ default: module.DashboardPage })),
)
const CollegesPage = lazy(() =>
  import('./pages/colleges/colleges-page').then((module) => ({ default: module.CollegesPage })),
)
const LoginPage = lazy(() =>
  import('./pages/login/login-page').then((module) => ({ default: module.LoginPage })),
)
const MajorsPage = lazy(() =>
  import('./pages/majors/majors-page').then((module) => ({ default: module.MajorsPage })),
)
const QuestionBanksPage = lazy(() =>
  import('./pages/question-banks/question-banks-page').then((module) => ({
    default: module.QuestionBanksPage,
  })),
)
const QuestionsPage = lazy(() =>
  import('./pages/questions/questions-page').then((module) => ({ default: module.QuestionsPage })),
)
const SubjectsPage = lazy(() =>
  import('./pages/subjects/subjects-page').then((module) => ({ default: module.SubjectsPage })),
)
const ActivityPage = lazy(() =>
  import('./pages/activity/activity-page').then((m) => ({ default: m.ActivityPage })),
)
const RecommendationsPage = lazy(() =>
  import('./pages/recommendations/recommendations-page').then((m) => ({ default: m.RecommendationsPage })),
)
const FeedbackPage = lazy(() =>
  import('./pages/feedback/feedback-page').then((m) => ({ default: m.FeedbackPage })),
)
const BankWorkspacePage = lazy(() =>
  import('./pages/question-banks/bank-workspace-page').then((m) => ({ default: m.BankWorkspacePage })),
)
const UsersPage = lazy(() => import('./pages/users/users-page').then((m) => ({ default: m.UsersPage })))
const AnnouncementsPage = lazy(() =>
  import('./pages/announcements/announcements-page').then((m) => ({ default: m.AnnouncementsPage })),
)
const AnnouncementEditorPage = lazy(() =>
  import('./pages/announcements/announcement-editor-page').then((m) => ({
    default: m.AnnouncementEditorPage,
  })),
)
const AdminsPage = lazy(() => import('./pages/system/admins-page').then((m) => ({ default: m.AdminsPage })))
const SecurityPage = lazy(() =>
  import('./pages/system/security-page').then((m) => ({ default: m.SecurityPage })),
)
const LogsPage = lazy(() => import('./pages/system/logs-page').then((m) => ({ default: m.LogsPage })))

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="page-loading">
          <Spin size={36} />
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/permissions" element={<Navigate to="/recommendations" replace />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/announcements/new" element={<AnnouncementEditorPage />} />
          <Route path="/announcements/:id/edit" element={<AnnouncementEditorPage />} />
          <Route path="/admins" element={<AdminsPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/colleges" element={<CollegesPage />} />
          <Route path="/majors" element={<MajorsPage />} />
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/question-banks" element={<QuestionBanksPage />} />
          <Route path="/question-banks/:id" element={<BankWorkspacePage />} />
          <Route path="/questions" element={<QuestionsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
