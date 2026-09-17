import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/app-shell'
import { LoadingState } from './components/loading-state'

const SubjectsPage = lazy(() => import('./pages/subjects/subjects-page').then((module) => ({ default: module.SubjectsPage })))
const QuestionBanksPage = lazy(() => import('./pages/question-banks/question-banks-page').then((module) => ({ default: module.QuestionBanksPage })))
const PracticeConfigPage = lazy(() => import('./pages/practice-config/practice-config-page').then((module) => ({ default: module.PracticeConfigPage })))
const PracticePage = lazy(() => import('./pages/practice/practice-page').then((module) => ({ default: module.PracticePage })))
const PracticeResultPage = lazy(() => import('./pages/practice-result/practice-result-page').then((module) => ({ default: module.PracticeResultPage })))
const QuestionDetailPage = lazy(() => import('./pages/question-detail/question-detail-page').then((module) => ({ default: module.QuestionDetailPage })))
const PlaygroundPage = import.meta.env.DEV
  ? lazy(() => import('./pages/playground/playground-page').then((module) => ({ default: module.PlaygroundPage })))
  : null

export default function App() {
  return (
    <Suspense fallback={<LoadingState fullPage label="正在加载练习空间…" />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/subjects/:subjectId/question-banks" element={<QuestionBanksPage />} />
          <Route path="/practice-config/:questionBankId" element={<PracticeConfigPage />} />
          <Route path="/practice-result/:sessionId" element={<PracticeResultPage />} />
          <Route path="/question-detail/:sessionId/:questionId" element={<QuestionDetailPage />} />
          {PlaygroundPage && <Route path="/playground" element={<PlaygroundPage />} />}
        </Route>
        <Route path="/practice/:sessionId" element={<PracticePage />} />
        <Route path="*" element={<Navigate to="/subjects" replace />} />
      </Routes>
    </Suspense>
  )
}
