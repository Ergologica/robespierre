// Uso: node scripts/fetch-fixture.mjs <txid> <nome>
// Scarica una transazione reale e la salva alleggerita in src/decoder/fixtures/.
import { writeFileSync } from 'node:fs'
const [id, name] = process.argv.slice(2)
if (!id || !name) { console.error('uso: node scripts/fetch-fixture.mjs <txid> <nome>'); process.exit(1) }
const j = await (await fetch('https://api.ergoplatform.com/api/v1/transactions/' + id)).json()
j.inputs?.forEach(i => { delete i.spendingProof; delete i.ergoTreeScript; delete i.ergoTreeConstants })
j.outputs?.forEach(o => { delete o.ergoTreeScript; delete o.ergoTreeConstants })
writeFileSync('src/decoder/fixtures/' + name + '.json', JSON.stringify(j, null, 1))
console.log('salvata src/decoder/fixtures/' + name + '.json')
