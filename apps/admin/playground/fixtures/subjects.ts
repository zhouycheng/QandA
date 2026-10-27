import type { Subject } from '../../src/types/admin'

export const subjectFixtures: Subject[] = [
  {
    id: 'subject-math',
    majorIds: ['major-computer-science', 'major-software-engineering'],
    name: '高等数学',
    status: 'ACTIVE',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  },
  {
    id: 'subject-english',
    majorIds: ['major-software-engineering', 'major-english'],
    name: '大学英语',
    status: 'ACTIVE',
    createdAt: '2026-09-02T08:00:00.000Z',
    updatedAt: '2026-09-02T08:00:00.000Z',
  },
  {
    id: 'subject-computer',
    majorIds: ['major-computer-science', 'major-software-engineering'],
    name: '计算机基础',
    status: 'INACTIVE',
    createdAt: '2026-09-03T08:00:00.000Z',
    updatedAt: '2026-09-03T08:00:00.000Z',
  },
]
