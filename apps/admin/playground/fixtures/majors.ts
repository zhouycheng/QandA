import type { Major } from '../../src/types/admin'

export const majorFixtures: Major[] = [
  {
    id: 'major-computer-science',
    collegeId: 'college-computer-science',
    name: '计算机科学与技术',
    code: 'CS',
    status: 'ACTIVE',
    createdAt: '2026-09-03T08:00:00.000Z',
    updatedAt: '2026-09-03T08:00:00.000Z',
  },
  {
    id: 'major-software-engineering',
    collegeId: 'college-computer-science',
    name: '软件工程',
    code: 'SE',
    status: 'ACTIVE',
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
  },
  {
    id: 'major-english',
    collegeId: 'college-foreign-languages',
    name: '英语',
    code: 'ENG',
    status: 'ACTIVE',
    createdAt: '2026-09-05T08:00:00.000Z',
    updatedAt: '2026-09-05T08:00:00.000Z',
  },
]
