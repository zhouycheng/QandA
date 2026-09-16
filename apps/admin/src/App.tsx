import { lazy, Suspense } from 'react'
import { Spin } from '@arco-design/web-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './layouts/admin-layout'
import { ProtectedRoute } from './components/protected-route'

const DashboardPage = lazy(() => import('./pages/dashboard/dashboard-page').then((module) => ({ default: module.DashboardPage })))
const LoginPage = lazy(() => import('./pages/login/login-page').then((module) => ({ default: module.LoginPage })))
const QuestionBanksPage = lazy(() => import('./pages/question-banks/question-banks-page').then((module) => ({ default: module.QuestionBanksPage })))
const QuestionsPage = lazy(() => import('./pages/questions/questions-page').then((module) => ({ default: module.QuestionsPage })))
const SubjectsPage = lazy(() => import('./pages/subjects/subjects-page').then((module) => ({ default: module.SubjectsPage })))

export default function App() {
  return (
    <Suspense fallback={<div className="page-loading"><Spin size={36} /></div>}>
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
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/question-banks" element={<QuestionBanksPage />} />
          <Route path="/questions" element={<QuestionsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
