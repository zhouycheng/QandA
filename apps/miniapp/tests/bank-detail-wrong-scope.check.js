const assert = require('assert')
const { BankDetailViewModel } = require('../miniprogram/viewmodels/bank-detail-viewmodel.js')

async function main() {
  let requestedScope
  const vm = new BankDetailViewModel({
    storage: {},
    repository: {
      isRemoteEnabled: () => true,
      previewRemotePracticeScope: async (storage, scope) => {
        requestedScope = scope
        return { availableCount: 2 }
      }
    }
  })
  vm.sheetTarget = { type: 'bank', subjectId: 'subject-1', bankId: 'bank-1', name: '题库', title: '第一章：题库', questionCount: 20 }
  vm.sheet = { mode: 'practice', order: 'order', timed: false, duration: 10, onlyWrong: true }

  const result = await vm.confirmConfig({})
  assert.deepStrictEqual(requestedScope, { questionBankId: 'bank-1', count: 1000, selectionKind: 'WRONG', collectionChip: 'all' })
  assert(result.command.payload.url.includes('selectionKind=WRONG'))
  assert(result.command.payload.url.includes('count=2'))
  assert(!result.command.payload.url.includes('count=20'))

  console.log('bank detail wrong-only practice uses server-eligible question count')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
