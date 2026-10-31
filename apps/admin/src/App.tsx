import { lazy, Suspense } from 'react'
import { Spin } from '@arco-design/web-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './layouts/admin-layout'
import { ProtectedRoute } from './components/protected-route'

const DashboardPage = lazy(() =>
  import('./pages/dashboard/dashboard-page').then((module) => ({ default: module.DashboardPage })),
)
const LoginPage = lazy(() =>
  import('./pages/login/login-page').then((module) => ({ default: module.LoginPage })),
)
const CollegesPage = lazy(() =>
  import('./pages/colleges/colleges-page').then((module) => ({ default: module.CollegesPage })),
)
const QuestionBanksPage = lazy(() =>
  import('./pages/question-banks/question-banks-page').then((module) => ({ default: module.QuestionBanksPage })),
)
const BankWorkspacePage = lazy(() =>
  import('./pages/question-banks/bank-workspace-page').then((module) => ({ default: module.BankWorkspacePage })),
)

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
          <Route path="/colleges" element={<CollegesPage />} />
          <Route path="/question-banks" element={<QuestionBanksPage />} />
          <Route path="/question-banks/:id" element={<BankWorkspacePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
