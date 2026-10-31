import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useAdminGateway } from '../../gateways/gateway-context'

export function useWorkbenchData() {
  const gateway = useAdminGateway()
  return useQuery({
    queryKey: ['bank-workbench'],
    queryFn: async () => {
      const [subjects, banks, colleges, majors, grades] = await Promise.all([
        gateway.listSubjects(), gateway.listQuestionBanks(), gateway.listColleges(), gateway.listMajors(), gateway.listGrades(),
      ])
      return { subjects, banks, colleges, majors, grades }
    },
  })
}

export type WorkbenchData = NonNullable<ReturnType<typeof useWorkbenchData>['data']>

export function refreshWorkbench(client: QueryClient) {
  for (const key of ['bank-workbench', 'questions', 'question-detail', 'chapters', 'dashboard-summary', 'organization-directory', 'question-banks', 'subjects']) {
    void client.invalidateQueries({ queryKey: [key] })
  }
}
