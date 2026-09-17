import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAppServices } from '../../app-context'
import { ErrorState } from '../../components/error-state'
import { LoadingState } from '../../components/loading-state'
import { PageHeading } from '../../components/page-heading'
import { ProgressSteps } from '../../components/progress-steps'
import { getErrorMessage } from '../../lib/errors'
import { usePracticeSessionStore } from '../../stores/practice-session-store'
import type { FeedbackMode, PracticeConfig, QuestionOrder, TimerMode } from '../../types/practice'

const defaultConfig: PracticeConfig = {
  questionCount: 20,
  order: 'SEQUENTIAL',
  feedbackMode: 'IMMEDIATE',
  autoNext: false,
  timerMode: 'COUNT_UP',
}

export function PracticeConfigPage() {
  const { questionBankId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const subjectId = searchParams.get('subjectId') ?? ''
  const navigate = useNavigate()
  const { gateway, sessionRepository } = useAppServices()
  const setSession = usePracticeSessionStore((state) => state.setSession)
  const [config, setConfig] = useState(defaultConfig)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const bankQuery = useQuery({
    queryKey: ['question-bank', questionBankId],
    queryFn: () => gateway.getQuestionBank(questionBankId),
    enabled: Boolean(questionBankId),
  })

  useEffect(() => {
    void sessionRepository.getActiveForBank(questionBankId).then((session) => {
      setActiveSessionId(session?.id ?? null)
    })
  }, [questionBankId, sessionRepository])

  const createSession = useMutation({
    mutationFn: async () => {
      if (activeSessionId) await sessionRepository.remove(activeSessionId)
      const session = await gateway.createSession({ subjectId, questionBankId, config })
      await sessionRepository.save(session)
      return session
    },
    onSuccess: (session) => {
      setSession(session)
      navigate(`/practice/${session.id}`)
    },
  })

  const continuePractice = async () => {
    if (!activeSessionId) return
    const session = await sessionRepository.get(activeSessionId)
    if (!session) return
    setSession(session)
    navigate(`/practice/${session.id}`)
  }

  if (bankQuery.isLoading) return <LoadingState fullPage label="正在准备练习配置…" />
  if (bankQuery.isError) return <div className="page-container"><ErrorState message={bankQuery.error.message} onRetry={() => void bankQuery.refetch()} /></div>
  const bank = bankQuery.data
  if (!bank) return null
  const countOptions = [10, 20, 30].filter((count) => count <= bank.questionCount)
  if (!countOptions.includes(config.questionCount)) countOptions.push(bank.questionCount)

  return (
    <div className="page-container page-container-narrow">
      <PageHeading
        eyebrow={bank.name}
        title="设置这次练习"
        description="题目会在开始时固定，刷新页面不会改变题序。"
        action={<ProgressSteps current={3} />}
      />

      {activeSessionId && (
        <section className="resume-banner" aria-labelledby="resume-title">
          <span className="resume-icon" aria-hidden="true">↻</span>
          <div><strong id="resume-title">你有一场未完成的练习</strong><p>可以继续原来的进度，或按当前设置开始新练习。</p></div>
          <button className="button button-secondary" onClick={() => void continuePractice()}>继续练习</button>
        </section>
      )}

      <div className="config-grid">
        <fieldset className="config-panel">
          <legend>题目与顺序</legend>
          <ConfigRadio
            label="题目数量"
            value={String(config.questionCount)}
            options={countOptions.map((count) => ({ value: String(count), label: `${count} 题` }))}
            onChange={(value) => setConfig((current) => ({ ...current, questionCount: Number(value) }))}
          />
          <ConfigRadio
            label="出题顺序"
            value={config.order}
            options={[{ value: 'SEQUENTIAL', label: '顺序出题' }, { value: 'RANDOM', label: '随机出题' }]}
            onChange={(value) => setConfig((current) => ({ ...current, order: value as QuestionOrder }))}
          />
          <ConfigRadio
            label="练习计时"
            value={config.timerMode}
            options={[{ value: 'COUNT_UP', label: '记录用时' }, { value: 'OFF', label: '不计时' }]}
            onChange={(value) => setConfig((current) => ({ ...current, timerMode: value as TimerMode }))}
          />
        </fieldset>

        <fieldset className="config-panel">
          <legend>答题体验</legend>
          <ConfigRadio
            label="答案反馈"
            value={config.feedbackMode}
            options={[{ value: 'IMMEDIATE', label: '立即反馈' }, { value: 'DEFERRED', label: '交卷后反馈' }]}
            onChange={(value) => setConfig((current) => ({ ...current, feedbackMode: value as FeedbackMode }))}
          />
          <label className="switch-row">
            <span><strong>答题后自动下一题</strong><small>确认答案后自动前往下一题</small></span>
            <input
              type="checkbox"
              checked={config.autoNext}
              onChange={(event) => setConfig((current) => ({ ...current, autoNext: event.target.checked }))}
            />
            <span className="switch-control" aria-hidden="true" />
          </label>
          <div className="config-note"><strong>本地自动保存</strong><p>答题、切题和计时状态会持续保存在当前浏览器。</p></div>
        </fieldset>
      </div>

      {createSession.isError && <p className="inline-error" role="alert">{getErrorMessage(createSession.error)}</p>}
      <div className="page-actions">
        <Link className="button button-secondary" to={`/subjects/${subjectId}/question-banks`}>返回题库</Link>
        <button className="button button-primary" disabled={createSession.isPending} onClick={() => createSession.mutate()}>
          {createSession.isPending ? '正在创建…' : activeSessionId ? '开始新练习' : '开始练习'}
        </button>
      </div>
    </div>
  )
}

function ConfigRadio({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="config-field">
      <span className="config-label">{label}</span>
      <div className="segmented-control">
        {options.map((option) => (
          <label key={option.value} className={value === option.value ? 'active' : ''}>
            <input type="radio" name={label} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
