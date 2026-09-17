import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppServices } from '../../app-context'
import { Brand } from '../../components/brand'
import { ErrorState } from '../../components/error-state'
import { LoadingState } from '../../components/loading-state'
import { getErrorMessage } from '../../lib/errors'
import { answerEquals, formatDuration } from '../../lib/format'
import { usePracticeSessionStore } from '../../stores/practice-session-store'
import type { Question } from '../../types/practice'

export function PracticePage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { gateway, sessionRepository } = useAppServices()
  const session = usePracticeSessionStore((state) => state.session)
  const { setSession, answer, confirmAnswer, goTo, tick, setSyncStatus, markSubmitted } = usePracticeSessionStore()
  const [restoring, setRestoring] = useState(session?.id !== sessionId)
  const [submitOpen, setSubmitOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const autoNextTimer = useRef<number | null>(null)

  useEffect(() => {
    if (session?.id === sessionId) {
      setRestoring(false)
      return
    }
    let active = true
    void sessionRepository.get(sessionId).then((stored) => {
      if (!active) return
      setSession(stored)
      setRestoring(false)
    })
    return () => { active = false }
  }, [session?.id, sessionId, sessionRepository, setSession])

  const questionsQuery = useQuery({
    queryKey: ['session-questions', sessionId, session?.questionIds],
    queryFn: () => gateway.getQuestions(session?.questionIds ?? []),
    enabled: Boolean(session && session.id === sessionId),
  })

  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS') return
    void sessionRepository.save(session)
  }, [session, sessionRepository])

  useEffect(() => {
    if (!session || session.config.timerMode === 'OFF' || session.status !== 'IN_PROGRESS') return
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [session?.config.timerMode, session?.status, tick])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (submitOpen && !dialog.open) dialog.showModal()
    if (!submitOpen && dialog.open) dialog.close()
  }, [submitOpen])

  useEffect(() => () => {
    if (autoNextTimer.current) window.clearTimeout(autoNextTimer.current)
  }, [])

  const submit = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('练习会话不存在。')
      setSyncStatus('SYNCING')
      return gateway.submitSession(session)
    },
    onSuccess: async (result) => {
      markSubmitted()
      const submitted = usePracticeSessionStore.getState().session
      if (submitted) await sessionRepository.save(submitted)
      setSubmitOpen(false)
      navigate(`/practice-result/${result.sessionId}`, { replace: true })
    },
    onError: async () => {
      setSyncStatus('SYNC_PENDING')
      const pending = usePracticeSessionStore.getState().session
      if (pending) await sessionRepository.save(pending)
      setSubmitOpen(false)
    },
  })

  const questions = questionsQuery.data ?? []
  const question = questions[session?.currentIndex ?? 0]
  const selectedAnswer = session && question ? session.answers[question.id] ?? [] : []
  const isConfirmed = Boolean(session && question && session.confirmedQuestionIds.includes(question.id))
  const showFeedback = Boolean(session?.config.feedbackMode === 'IMMEDIATE' && isConfirmed && question)
  const isCorrect = question ? answerEquals(selectedAnswer, question.correctAnswer) : false
  const unansweredCount = session
    ? session.questionIds.filter((id) => !(session.answers[id]?.length)).length
    : 0
  const answeredCount = session ? session.questionIds.length - unansweredCount : 0

  const scheduleAutoNext = (currentQuestion: Question) => {
    if (!session?.config.autoNext || session.currentIndex >= session.questionIds.length - 1) return
    if (autoNextTimer.current) window.clearTimeout(autoNextTimer.current)
    autoNextTimer.current = window.setTimeout(() => {
      const latest = usePracticeSessionStore.getState().session
      if (latest?.questionIds[latest.currentIndex] === currentQuestion.id) goTo(latest.currentIndex + 1)
    }, 1200)
  }

  const chooseAnswer = (optionKey: string) => {
    if (!question || !session || (showFeedback && session.config.feedbackMode === 'IMMEDIATE')) return
    if (question.type === 'MULTIPLE_CHOICE') {
      const next = selectedAnswer.includes(optionKey)
        ? selectedAnswer.filter((key) => key !== optionKey)
        : [...selectedAnswer, optionKey]
      answer(question.id, next)
      return
    }
    answer(question.id, [optionKey])
    confirmAnswer(question.id)
    scheduleAutoNext(question)
  }

  const confirmMultiple = () => {
    if (!question || !selectedAnswer.length) return
    confirmAnswer(question.id)
    scheduleAutoNext(question)
  }

  const currentProgress = session ? ((session.currentIndex + 1) / session.questionIds.length) * 100 : 0
  const syncLabel = useMemo(() => {
    if (session?.syncStatus === 'SYNC_PENDING') return '等待重新提交'
    if (session?.syncStatus === 'SYNCING') return '正在提交'
    return '已自动保存'
  }, [session?.syncStatus])

  if (restoring) return <LoadingState fullPage label="正在恢复练习…" />
  if (!session || session.id !== sessionId) {
    return <div className="practice-fallback"><ErrorState message="没有找到这场练习，可能已被清除。" onRetry={() => navigate('/subjects')} /></div>
  }
  if (questionsQuery.isLoading) return <LoadingState fullPage label="正在加载本次题目…" />
  if (questionsQuery.isError) return <div className="practice-fallback"><ErrorState message={questionsQuery.error.message} onRetry={() => void questionsQuery.refetch()} /></div>
  if (!question) return <div className="practice-fallback"><ErrorState message="本次练习没有可用题目。" onRetry={() => navigate('/subjects')} /></div>

  return (
    <div className="practice-page">
      <header className="practice-header">
        <Brand />
        <div className="practice-header-status">
          <span className={`save-label ${session.syncStatus === 'SYNC_PENDING' ? 'pending' : ''}`} role="status">{syncLabel}</span>
          <div className="practice-progress" aria-label={`练习进度 ${session.currentIndex + 1}/${session.questionIds.length}`}>
            <i style={{ width: `${currentProgress}%` }} />
          </div>
          <strong>{String(session.currentIndex + 1).padStart(2, '0')} / {String(session.questionIds.length).padStart(2, '0')}</strong>
          {session.config.timerMode === 'COUNT_UP' && <time>{formatDuration(session.elapsedSeconds)}</time>}
          <button className="button button-secondary button-compact" onClick={() => navigate(`/practice-config/${session.questionBankId}?subjectId=${session.subjectId}`)}>退出并保存</button>
        </div>
      </header>

      {session.syncStatus === 'SYNC_PENDING' && (
        <div className="submit-error-banner" role="alert">
          <div><strong>交卷未成功，答案已安全保存在此设备</strong><p>网络恢复后可以重新提交，当前练习不会被清除。</p></div>
          <button className="button button-danger" disabled={submit.isPending} onClick={() => submit.mutate()}>重新提交</button>
        </div>
      )}

      <main className="practice-layout">
        <section className="question-panel" aria-labelledby="question-title">
          <div className="question-meta"><span className="question-type">{questionTypeLabel(question.type)}</span><span>第 {session.currentIndex + 1} 题</span></div>
          <h1 id="question-title">{question.stem}</h1>
          <div className="answer-list" role={question.type === 'MULTIPLE_CHOICE' ? 'group' : 'radiogroup'} aria-label="答案选项">
            {question.options.map((option) => {
              const selected = selectedAnswer.includes(option.key)
              const correct = showFeedback && question.correctAnswer.includes(option.key)
              const wrong = showFeedback && selected && !question.correctAnswer.includes(option.key)
              return (
                <label key={option.key} className={`answer-option ${selected ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrong ? 'wrong' : ''}`}>
                  <input
                    type={question.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'}
                    name={`question-${question.id}`}
                    value={option.key}
                    checked={selected}
                    disabled={showFeedback}
                    onChange={() => chooseAnswer(option.key)}
                  />
                  <span className="answer-key">{option.key}</span>
                  <span>{option.content}</span>
                </label>
              )
            })}
          </div>

          {question.type === 'MULTIPLE_CHOICE' && !isConfirmed && (
            <button className="button button-primary confirm-answer" disabled={!selectedAnswer.length} onClick={confirmMultiple}>确认答案</button>
          )}
          {showFeedback && (
            <div className={`answer-feedback ${isCorrect ? 'correct' : 'wrong'}`} role="status">
              <strong>{isCorrect ? '回答正确。' : '回答错误。'}</strong>
              <span>{question.explanation}</span>
            </div>
          )}

          <div className="practice-actions">
            <button className="button button-secondary" disabled={session.currentIndex === 0} onClick={() => goTo(session.currentIndex - 1)}>← 上一题</button>
            <button className="button button-primary" disabled={session.currentIndex === session.questionIds.length - 1} onClick={() => goTo(session.currentIndex + 1)}>下一题 →</button>
          </div>
        </section>

        <aside className="answer-sheet" aria-label="答题卡">
          <div className="answer-sheet-heading"><strong>答题卡</strong><span>已答 {answeredCount} · 未答 {unansweredCount}</span></div>
          <div className="answer-grid">
            {session.questionIds.map((id, index) => (
              <button
                key={id}
                className={`${session.answers[id]?.length ? 'answered' : ''} ${index === session.currentIndex ? 'current' : ''}`}
                aria-current={index === session.currentIndex ? 'step' : undefined}
                aria-label={`第 ${index + 1} 题${session.answers[id]?.length ? '，已答' : '，未答'}`}
                onClick={() => goTo(index)}
              >{index + 1}</button>
            ))}
          </div>
          <div className="answer-legend"><span><i className="answered" />已答</span><span><i className="current" />当前</span><span><i />未答</span></div>
          <button className="button button-secondary submit-button" onClick={() => setSubmitOpen(true)}>检查并交卷</button>
        </aside>
      </main>

      <dialog ref={dialogRef} className="submit-dialog" onClose={() => setSubmitOpen(false)}>
        <span className="dialog-symbol" aria-hidden="true">!</span>
        <h2>确认提交本次练习？</h2>
        <p>{unansweredCount ? `你还有 ${unansweredCount} 道题未回答，可以返回检查。` : '所有题目都已回答，提交后将生成练习结果。'}</p>
        <div className="dialog-stats"><span><strong>{answeredCount}</strong>已回答</span><span><strong>{unansweredCount}</strong>未回答</span><span><strong>{formatDuration(session.elapsedSeconds)}</strong>用时</span></div>
        {submit.isError && <p className="inline-error" role="alert">{getErrorMessage(submit.error)}</p>}
        <div className="page-actions">
          <button className="button button-secondary" autoFocus onClick={() => setSubmitOpen(false)}>返回检查</button>
          <button className="button button-primary" disabled={submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? '正在提交…' : '确认交卷'}</button>
        </div>
      </dialog>
    </div>
  )
}

function questionTypeLabel(type: Question['type']) {
  return { SINGLE_CHOICE: '单选题', MULTIPLE_CHOICE: '多选题', TRUE_FALSE: '判断题' }[type]
}
