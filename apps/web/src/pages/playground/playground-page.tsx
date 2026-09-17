import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { scenarioLabels, usePlaygroundStore, type PlaygroundScenario } from '../../../playground/store/playground-store'
import { useAppServices } from '../../app-context'
import { PageHeading } from '../../components/page-heading'
import { usePracticeSessionStore } from '../../stores/practice-session-store'
import './playground.css'

const descriptions: Record<PlaygroundScenario, string> = {
  normal: '使用标准科目、题库和题目数据。',
  empty: '科目和题库列表为空。',
  error: '所有读取请求返回失败。',
  slow: '请求延迟 3 秒，用于检查加载状态。',
  'submit-error': '读取正常，但交卷失败并进入待同步状态。',
  restore: '创建答了一半的本地 Session，直接验证刷新恢复。',
  large: '创建最多 100 道题的练习，检查答题卡与列表。',
}

export function PlaygroundPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scenario = usePlaygroundStore((state) => state.scenario)
  const setScenario = usePlaygroundStore((state) => state.setScenario)
  const setSession = usePracticeSessionStore((state) => state.setSession)
  const { gateway, sessionRepository } = useAppServices()

  const activate = async (next: PlaygroundScenario) => {
    setScenario(next)
    await queryClient.invalidateQueries()
    if (next === 'restore') {
      const session = await gateway.createSession({
        subjectId: 'math',
        questionBankId: 'math-limit',
        config: { questionCount: 20, order: 'SEQUENTIAL', feedbackMode: 'DEFERRED', autoNext: false, timerMode: 'COUNT_UP' },
      })
      const questions = await gateway.getQuestions(session.questionIds)
      const answers = Object.fromEntries(questions.slice(0, 8).map((question) => [question.id, question.correctAnswer]))
      const restored = { ...session, answers, confirmedQuestionIds: Object.keys(answers), currentIndex: 8, elapsedSeconds: 12 * 60 }
      await sessionRepository.save(restored)
      setSession(restored)
      navigate(`/practice/${restored.id}`)
      return
    }
    navigate('/subjects')
  }

  return (
    <div className="page-container">
      <PageHeading eyebrow="仅开发环境" title="Web MVP Playground" description="切换场景后进入正式页面，验证边界状态和交互。" />
      <div className="playground-grid">
        {(Object.keys(scenarioLabels) as PlaygroundScenario[]).map((key) => (
          <button key={key} className={`playground-card ${scenario === key ? 'active' : ''}`} onClick={() => void activate(key)}>
            <span>{scenarioLabels[key]}</span><p>{descriptions[key]}</p><strong>进入场景 →</strong>
          </button>
        ))}
      </div>
    </div>
  )
}
