import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useAppServices } from '../../app-context'
import { ErrorState } from '../../components/error-state'
import { LoadingState } from '../../components/loading-state'
import { PageHeading } from '../../components/page-heading'
import { formatAnswer } from '../practice-result/practice-result-page'

export function QuestionDetailPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const { gateway } = useAppServices()
  const resultQuery = useQuery({ queryKey: ['practice-result', sessionId], queryFn: () => gateway.getResult(sessionId) })

  if (resultQuery.isLoading) return <LoadingState fullPage label="正在加载题目解析…" />
  if (resultQuery.isError) return <div className="page-container"><ErrorState message={resultQuery.error.message} onRetry={() => void resultQuery.refetch()} /></div>
  const question = resultQuery.data?.questionResults.find((item) => item.questionId === questionId)
  if (!question) return <div className="page-container"><ErrorState message="没有找到这道题的结果。" /></div>

  return (
    <div className="page-container page-container-narrow detail-page">
      <PageHeading eyebrow="题目解析" title={question.stem} description={`你的答案：${formatAnswer(question.userAnswer)} · 正确答案：${formatAnswer(question.correctAnswer)}`} />
      <section className="detail-card">
        <div className="detail-options">
          {question.options.map((option) => {
            const correct = question.correctAnswer.includes(option.key)
            const selected = question.userAnswer.includes(option.key)
            return <div key={option.key} className={`detail-option ${correct ? 'correct' : ''} ${selected && !correct ? 'wrong' : ''}`}><span>{option.key}</span><p>{option.content}</p>{correct && <strong>正确答案</strong>}{selected && !correct && <strong>你的选择</strong>}</div>
          })}
        </div>
        <div className="explanation"><span>解析</span><p>{question.explanation}</p></div>
      </section>
      <div className="page-actions"><Link className="button button-secondary" to={`/practice-result/${sessionId}`}>← 返回结果</Link></div>
    </div>
  )
}
