import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAppServices } from '../../app-context'
import { EmptyState } from '../../components/empty-state'
import { ErrorState } from '../../components/error-state'
import { LoadingState } from '../../components/loading-state'
import { PageHeading } from '../../components/page-heading'
import { ProgressSteps } from '../../components/progress-steps'

const subjectMarks: Record<string, string> = { math: '数', english: '英', computer: '计' }

export function SubjectsPage() {
  const { gateway } = useAppServices()
  const query = useQuery({ queryKey: ['subjects'], queryFn: () => gateway.listSubjects() })

  return (
    <div className="page-container">
      <PageHeading
        eyebrow="开始一场专注练习"
        title="今天想练什么？"
        description="先选择科目，再挑选题库并设置练习方式。"
        action={<ProgressSteps current={1} />}
      />
      {query.isLoading ? <LoadingState label="正在获取科目…" /> : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState title="暂时没有可练习的科目" description="内容准备好后会显示在这里，请稍后再来。" />
      ) : (
        <div className="subject-grid">
          {query.data.map((subject) => (
            <Link key={subject.id} className="subject-card" to={`/subjects/${subject.id}/question-banks`}>
              <span className={`subject-mark subject-mark-${subject.id}`} aria-hidden="true">
                {subjectMarks[subject.id] ?? subject.name.slice(0, 1)}
              </span>
              <h2>{subject.name}</h2>
              <p>{subject.description}</p>
              <span className="card-meta">{subject.questionBankCount} 个题库 · {subject.questionCount} 道题</span>
              <span className="card-link">查看题库 <span aria-hidden="true">→</span></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
