import type { BankAudience, Grade, Major } from '../types/admin'

export function referencesGrade(audience: BankAudience, grade: Grade, major: Major) {
  return audience.enrollmentYear === grade.enrollmentYear &&
    (!audience.majorId || audience.majorId === major.id) &&
    (!audience.collegeId || audience.collegeId === major.collegeId)
}
