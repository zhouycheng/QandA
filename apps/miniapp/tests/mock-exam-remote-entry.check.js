const assert = require('assert')
const path = require('path')
const { SubjectListViewModel } = require(path.resolve(__dirname, '../miniprogram/viewmodels/subject-list-viewmodel.js'))

async function main() {
  const subjects = [
    { id: 'subject-preferred', name: '上次练习科目', questionCount: 4, bankCount: 2, banks: [] },
    { id: 'subject-first', name: '首个有题科目', questionCount: 5, bankCount: 1, banks: [] }
  ]
  const requests = []
  let selectedBank = null
  const repository = {
    isRemoteEnabled: () => true,
    getRemoteRecent: () => [],
    getAuth: () => ({ loggedIn: true }),
    getProgress: () => ({ lastBank: { answers: {}, total: 1, updatedAt: 1 } }),
    getScopeMeta: () => ({ subjectId: 'subject-preferred' }),
    getSubjectSummaries: () => subjects,
    loadRemoteSubjects: async () => ({ total: subjects.length, page: 1, pageSize: 20, items: subjects }),
    loadRemoteBanks: async (storage, query) => {
      requests.push(query)
      if (query.subjectId === 'subject-preferred' && query.page === 1) {
        return { total: 2, page: 1, pageSize: 1, items: [{ id: 'disabled', subjectId: query.subjectId, activeQuestionCount: 0 }] }
      }
      return { total: 2, page: 2, pageSize: 1, items: [{ id: 'preferred-bank', subjectId: query.subjectId, name: '可练习题库', activeQuestionCount: 4 }] }
    },
    loadRemoteBank: async (storage, id) => {
      selectedBank = id
      subjects[0].banks = [{ id, subjectId: subjects[0].id, name: '可练习题库', questionCount: 4 }]
    },
    getSubjectDetail: id => subjects.find(subject => subject.id === id)
  }
  const vm = new SubjectListViewModel({ repository, storage: { get: () => null, set() {}, remove() {} } })
  const result = await vm.openMock()
  assert.strictEqual(selectedBank, 'preferred-bank')
  assert.deepStrictEqual(requests.map(item => item.page), [1, 2])
  assert.strictEqual(result.command.type, 'openRouteWithLoading')
  assert(result.command.payload.url.includes('subjectId=subject-preferred'))
  assert(result.command.payload.url.includes('bankId=preferred-bank'))
  assert(!JSON.stringify(result).includes('chooseBank'))
  console.log('remote mock exam selects the last practiced subject and first active bank without a chooser')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
