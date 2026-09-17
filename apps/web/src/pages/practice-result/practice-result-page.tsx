import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppServices } from '../../app-context'
import { EmptyState } from '../../components/empty-state'
import { ErrorState } from '../../components/error-state'
import { LoadingState } from '../../components/loading-state'
import { PageHeading } from '../../components/page-heading'
import { formatDuration } from '../../lib/format'
import type { QuestionResultStatus } from '../../types/practice'

type ResultFilter = 'WRONG_ONLY' | 'ALL' | QuestionResultStatus

export function PracticeResultPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { gateway } = useAppServices()
  const [filter, setFilter] = useState<ResultFilter>('WRONG_ONLY')
  const [keyword, setKeyword] = useState('')
  const resultQuery = useQuery({ queryKey: ['practice-result', sessionId], queryFn: () => gateway.getResult(sessionId) })
  const bankQuery = useQuery({
    queryKey: ['question-bank', resultQuery.data?.questionBankId],
    queryFn: () => gateway.getQuestionBank(resultQuery.data!.questionBankId),
    enabled: Boolean(resultQuery.data?.questionBankId),
  })

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase()
    return (resultQuery.data?.questionResults ?? [])
      .filter((item) => filter === 'ALL' || (filter === 'WRONG_ONLY' ? item.status === 'WRONG' : item.status === filter))
      .filter((item) => `${item.stem} ${item.options.map((option) => option.content).join(' ')}`.toLocaleLowerCase().includes(normalized))
  }, [filter, keyword, resultQuery.data?.questionResults])

  if (resultQuery.isLoading) return <LoadingState fullPage label="正在生成练习结果…" />
  if (resultQuery.isError) return <div className="page-container"><ErrorState message={resultQuery.error.message} onRetry={() => void resultQuery.refetch()} /></div>
  const result = resultQuery.data
  if (!result) return null

  return (
    <div className="page-container result-page">
      <PageHeading
        eyebrow={bankQuery.data?.name ?? '练习结果'}
        title="练习完成"
        description="查看本次表现，并集中复盘错误和未回答的题目。"
        action={<button className="button button-primary" onClick={() => navigate(`/practice-config/${result.questionBankId}?subjectId=${result.subjectId}`)}>再练一组</button>}
      />

      <section className="result-overview" aria-label="成绩总览">
        <div className="score-card"><span>本次正确率</span><strong>{result.accuracy}<small>%</small></strong><p>答对 {result.correctCount} 题，共 {result.totalCount} 题 · 用时 {formatDuration(result.duration)}</p></div>
        <div className="result-stats">
          <ResultStat value={result.correctCount} label="正确" tone="success" />
          <ResultStat value={result.wrongCount} label="错误" tone="danger" />
          <ResultStat value={result.unansweredCount} label="未答" />
          <ResultStat value={formatDuration(Math.round(result.duration / Math.max(result.totalCount, 1)))} label="平均每题" />
        </div>
      </section>

      <section className="review-card" aria-labelledby="review-title">
        <div className="review-heading"><div><h2 id="review-title">题目复盘</h2><p>筛选本次题目并查看答案和解析。</p></div><input aria-label="搜索题干或选项" type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索题干或选项" /></div>
        <div className="result-tabs" role="group" aria-label="结果筛选">
          <FilterTab active={filter === 'WRONG_ONLY'} onClick={() => setFilter('WRONG_ONLY')}>错题 {result.wrongCount}</FilterTab>
          <FilterTab active={filter === 'ALL'} onClick={() => setFilter('ALL')}>全部 {result.totalCount}</FilterTab>
          <FilterTab active={filter === 'CORRECT'} onClick={() => setFilter('CORRECT')}>正确 {result.correctCount}</FilterTab>
          <FilterTab active={filter === 'UNANSWERED'} onClick={() => setFilter('UNANSWERED')}>未答 {result.unansweredCount}</FilterTab>
        </div>
        {!filtered.length ? (
          <EmptyState title="没有符合条件的题目" description="可以更换筛选条件或清除搜索关键词。" />
        ) : (
          <div className="review-list">
            {filtered.map((item, index) => (
              <Link className="review-row" key={item.questionId} to={`/question-detail/${sessionId}/${item.questionId}`}>
                <span className={`result-status result-status-${item.status.toLocaleLowerCase()}`}>{item.status === 'CORRECT' ? '✓' : item.status === 'WRONG' ? '×' : '—'}</span>
                <div><strong>{index + 1}. {item.stem}</strong><span>你的答案：{formatAnswer(item.userAnswer)} · 正确答案：{formatAnswer(item.correctAnswer)}</span></div>
                <span className="card-link">查看解析 →</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ResultStat({ value, label, tone = '' }: { value: string | number; label: string; tone?: string }) {
  return <div className="result-stat"><strong className={tone}>{value}</strong><span>{label}</span></div>
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button aria-pressed={active} className={active ? 'active' : ''} onClick={onClick}>{children}</button>
}

export function formatAnswer(answer: string[]) {
  return answer.length ? answer.join('、') : '未作答'
}
