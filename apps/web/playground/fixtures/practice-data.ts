import type { Question, QuestionBank, Subject } from '../../src/types/practice'

export const subjects: Subject[] = [
  { id: 'math', name: '高等数学', description: '极限、导数、积分与微分方程', questionBankCount: 2, questionCount: 60 },
  { id: 'english', name: '大学英语', description: '词汇、语法与阅读理解', questionBankCount: 1, questionCount: 30 },
  { id: 'computer', name: '计算机基础', description: '数据结构、网络与操作系统基础', questionBankCount: 1, questionCount: 30 },
]

export const questionBanks: QuestionBank[] = [
  { id: 'math-limit', subjectId: 'math', name: '极限与连续', description: '覆盖数列极限、函数极限和连续性判断。', questionCount: 30, difficulty: '基础' },
  { id: 'math-calculus', subjectId: 'math', name: '导数与微分', description: '导数定义、求导法则与微分应用。', questionCount: 30, difficulty: '进阶' },
  { id: 'english-core', subjectId: 'english', name: '核心词汇与语法', description: '大学英语常用词汇和基础语法。', questionCount: 30, difficulty: '基础' },
  { id: 'computer-core', subjectId: 'computer', name: '计算机通识', description: '计算机组成、网络和数据结构基础。', questionCount: 30, difficulty: '综合' },
]

const templates = {
  'math-limit': [
    ['设函数在某点的极限存在，下列关于连续性的说法中，正确的是哪一项？', ['函数一定有定义', '若函数值等于该极限，则函数连续', '左右极限可以不相等', '函数一定可导'], ['B'], '连续要求函数在该点有定义，且函数值等于该点的极限。'],
    ['下列哪一项是数列收敛的必要条件？', ['数列有界', '数列单调', '所有项均为正数', '相邻两项相等'], ['A'], '收敛数列一定有界，但有界数列不一定收敛。'],
    ['判断：若函数在某点可导，则函数在该点连续。', ['正确', '错误'], ['T'], '可导必连续，但连续不一定可导。'],
    ['函数极限存在需要满足哪些条件？', ['左极限存在', '右极限存在', '左右极限相等', '函数值必须为零'], ['A', 'B', 'C'], '两侧极限都存在且相等时，函数极限存在。'],
  ],
  'math-calculus': [
    ['导数的几何意义是什么？', ['曲线切线的斜率', '曲线长度', '函数最大值', '面积'], ['A'], '函数在一点的导数表示曲线在该点切线的斜率。'],
    ['判断：常数函数的导数恒为零。', ['正确', '错误'], ['T'], '常数函数在定义域内任一点的导数均为零。'],
    ['复合函数求导涉及哪些要素？', ['外层函数导数', '内层函数导数', '链式法则', '只需求外层'], ['A', 'B', 'C'], '链式法则要求外层导数乘以内层导数。'],
  ],
  'english-core': [
    ['Choose the word closest in meaning to “essential”.', ['optional', 'necessary', 'temporary', 'ordinary'], ['B'], 'Essential means absolutely necessary or extremely important.'],
    ['Choose all grammatically correct sentences.', ['She has finished the task.', 'He go to school yesterday.', 'They were waiting outside.', 'I am agree.'], ['A', 'C'], 'A and C use correct tense and verb forms.'],
    ['True or false: “Although” can introduce a concessive clause.', ['True', 'False'], ['T'], 'Although commonly introduces a concessive subordinate clause.'],
  ],
  'computer-core': [
    ['下列哪一种数据结构遵循先进先出原则？', ['栈', '队列', '树', '图'], ['B'], '队列遵循先进先出（FIFO）原则。'],
    ['TCP 具有哪些特征？', ['面向连接', '可靠传输', '无序交付', '拥塞控制'], ['A', 'B', 'D'], 'TCP 提供面向连接、可靠、有序的字节流，并包含拥塞控制。'],
    ['判断：RAM 断电后通常会丢失其中的数据。', ['正确', '错误'], ['T'], 'RAM 通常属于易失性存储器。'],
  ],
} as const

function makeOptions(values: readonly string[], trueFalse: boolean) {
  return values.map((content, index) => ({
    key: trueFalse ? (index === 0 ? 'T' : 'F') : String.fromCharCode(65 + index),
    content,
  }))
}

function createBankQuestions(questionBankId: keyof typeof templates, count = 30): Question[] {
  const bankTemplates = templates[questionBankId]
  return Array.from({ length: count }, (_, index) => {
    const [stem, optionContents, correctAnswer, explanation] = bankTemplates[index % bankTemplates.length]
    const trueFalse = optionContents.length === 2 && correctAnswer[0] === 'T'
    return {
      id: `${questionBankId}-${index + 1}`,
      questionBankId,
      type: trueFalse ? 'TRUE_FALSE' : correctAnswer.length > 1 ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE',
      stem: index < bankTemplates.length ? stem : `${stem}（变式 ${index + 1}）`,
      options: makeOptions(optionContents, trueFalse),
      correctAnswer: [...correctAnswer],
      explanation,
    }
  })
}

export const questions: Question[] = [
  ...createBankQuestions('math-limit'),
  ...createBankQuestions('math-calculus'),
  ...createBankQuestions('english-core'),
  ...createBankQuestions('computer-core'),
]

export function createLargeQuestionSet(questionBankId: string) {
  const base = questions.filter((question) => question.questionBankId === questionBankId)
  return Array.from({ length: 100 }, (_, index) => ({
    ...base[index % base.length],
    id: `${questionBankId}-large-${index + 1}`,
    stem: `${base[index % base.length].stem}（压力测试 ${index + 1}）`,
  }))
}
