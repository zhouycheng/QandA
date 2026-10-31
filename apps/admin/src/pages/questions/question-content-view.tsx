import { Space, Tag, Typography } from '@arco-design/web-react'
import { questionTypeLabels } from '../../lib/labels'
import { answerSummary } from '../../lib/question-content'
import type { QuestionContent } from '../../types/admin'

export function QuestionContentView({ question }: { question: QuestionContent }) {
  return <div className="bw-content-view">
    <section><Typography.Title heading={6}>{question.type === 'READING' ? '题组标题' : '题干'}</Typography.Title><p>{question.stem}</p></section>
    {question.type === 'READING' ? <>
      <section className="bw-reading-material"><Typography.Title heading={6}>阅读材料</Typography.Title><p>{question.passage}</p></section>
      {question.subQuestions?.map((sub, index) => <section className="bw-reading-sub" key={sub.id}><div className="bw-sub-heading"><strong>小题 {index + 1}</strong><Tag>{questionTypeLabels[sub.type]}</Tag></div><QuestionContentView question={sub} /></section>)}
    </> : question.type === 'FILL_BLANK' ? <section>
      <Typography.Title heading={6}>各空可接受答案</Typography.Title>
      {question.blanks?.map((blank, index) => <div className="bw-blank-answer" key={index}><strong>第 {index + 1} 空</strong><Space wrap>{blank.answers.map((answer) => <Tag color="green" key={answer}>{answer}</Tag>)}</Space></div>)}
      <p className="muted">{question.blankMatch?.ignoreCase ? '忽略英文字母大小写' : '区分英文字母大小写'} · {question.blankMatch?.trimWhitespace ? '忽略首尾空格' : '保留首尾空格参与匹配'}</p>
    </section> : question.type === 'SHORT_ANSWER' ? <>
      <section><Typography.Title heading={6}>参考答案</Typography.Title><p>{question.referenceAnswer}</p></section>
      <section><Typography.Title heading={6}>评分要点 · 学生自评</Typography.Title><ol>{question.scoringPoints?.map((point, i) => <li key={i}>{point}</li>)}</ol></section>
    </> : <section><Typography.Title heading={6}>选项与答案</Typography.Title><Space direction="vertical" style={{ width: '100%' }}>
      {question.options.map((option) => <div className={`detail-option ${question.correctAnswer.includes(option.key) ? 'detail-option-correct' : ''}`} key={option.key}><Tag color={question.correctAnswer.includes(option.key) ? 'green' : 'gray'}>{option.key}</Tag><span>{option.content}</span></div>)}
      <p>{answerSummary(question)}</p>
    </Space></section>}
    <section><Typography.Title heading={6}>{question.type === 'READING' ? '材料说明' : '答案解析'}</Typography.Title><p>{question.explanation || (question.type === 'READING' ? '暂无材料说明' : '暂无解析，发布前请补充。')}</p></section>
  </div>
}
