import type { Grade, Major, QuestionBank } from '../../src/types/admin'
import type { ManagedUser } from '../../src/types/operations'

export function createGradeFixtures(majors: Major[], users: ManagedUser[], banks: QuestionBank[]): Grade[] {
  return majors.flatMap((major) => {
    const years = new Set([2024, 2025, 2026])
    for (const user of users) {
      if (user.majorId === major.id && user.enrollmentYear) years.add(user.enrollmentYear)
    }
    for (const bank of banks) {
      for (const audience of bank.audiences ?? []) {
        if (audience.enrollmentYear && (!audience.majorId || audience.majorId === major.id) &&
          (!audience.collegeId || audience.collegeId === major.collegeId)) years.add(audience.enrollmentYear)
      }
    }
    return [...years].sort((a, b) => b - a).map((enrollmentYear) => ({
      id: `grade-${major.id}-${enrollmentYear}`,
      majorId: major.id,
      enrollmentYear,
      status: 'ACTIVE' as const,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    }))
  })
}
