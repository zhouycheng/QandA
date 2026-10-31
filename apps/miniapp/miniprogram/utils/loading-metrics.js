const samples = []
function record(name, detail) {
  samples.push(Object.assign({ name, at: Date.now() }, detail || {}))
  if (samples.length > 300) samples.shift()
}
module.exports = { record, snapshot: () => samples.map(item => Object.assign({}, item)), clear: () => { samples.length = 0 } }
