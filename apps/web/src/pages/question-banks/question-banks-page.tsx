import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useAppServices } from '../../app-context'
import { EmptyState } from '../../components/empty-state'
import { ErrorState } from '../../components/error-state'
import { LoadingState } from '../../components/loading-state'
import { PageHeading } from '../../components/page-heading'
import { ProgressSteps } from '../../components/progress-steps'

export function QuestionBanksPage() {
  const { subjectId = '' } = useParams()
  const { gateway } = useAppServices()
  const subjectsQuery = useQuery({ queryKey: ['subjects'], queryFn: () => gateway.listSubjects() })
  const banksQuery = useQuery({
    queryKey: ['question-banks', subjectId],
    queryFn: () => gateway.listQuestionBanks(subjectId),
    enabled: Boolean(subjectId),
  })
  const subject = subjectsQuery.data?.find((item) => item.id === subjectId)

  return (
    <div className="page-container">
      <PageHeading
        eyebrow={subject?.name ?? '选择题库'}
        title="选择练习题库"
        description="每次练习会固定本次题目和顺序，刷新后仍可继续。"
        action={<ProgressSteps current={2} />}
      />
      {banksQuery.isLoading ? <LoadingState label="正在获取题库…" /> : banksQuery.isError ? (
        <ErrorState message={banksQuery.error.message} onRetry={() => void banksQuery.refetch()} />
      ) : !banksQuery.data?.length ? (
        <EmptyState
          title="这个科目还没有可练习的题库"
          description="请选择其他科目，或稍后等待内容更新。"
          action={<Link className="button button-secondary" to="/subjects">返回科目</Link>}
        />
      ) : (
        <div className="bank-list">
          {banksQuery.data.map((bank, index) => (
            <article className="bank-card" key={bank.id}>
              <span className="bank-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className="bank-copy">
                <div className="bank-title-row"><h2>{bank.name}</h2><span className="difficulty">{bank.difficulty}</span></div>
                <p>{bank.description}</p>
                <span className="card-meta">{bank.questionCount} 道题</span>
              </div>
              <Link className="button button-primary" to={`/practice-config/${bank.id}?subjectId=${subjectId}`}>设置练习</Link>
            </article>
          ))}
        </div>
      )}
      <Link className="back-link" to="/subjects">← 返回科目</Link>
    </div>
  )
}
