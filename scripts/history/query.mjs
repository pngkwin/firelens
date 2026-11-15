import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { once } from 'node:events';
const { values } = parseArgs({ options: { database:{type:'string'}, start:{type:'string'}, end:{type:'string'}, sensor:{type:'string'}, platform:{type:'string'}, bounds:{type:'string'} } });
if (!values.database) throw Error('--database is required; use the path in data/processed/latest-benchmark.json');
const clauses=[], args=[];
for (const [key,op] of [['start','>='],['end','<=']]) if (values[key]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values[key]) || new Date(`${values[key]}T00:00:00Z`).toISOString().slice(0,10)!==values[key]) throw Error('Invalid UTC date');
  clauses.push(`date ${op} ?`); args.push(values[key]);
}
if (values.start && values.end && values.start>values.end) throw Error('Reversed date range');
for (const key of ['sensor','platform']) if (values[key]) { clauses.push(`${key}=?`); args.push(values[key]); }
if (values.bounds) {
  const b=values.bounds.split(',').map(Number);
  if (b.length!==4 || b.some(n=>!Number.isFinite(n)) || Math.abs(b[0])>180 || Math.abs(b[2])>180 || Math.abs(b[1])>90 || Math.abs(b[3])>90 || b[1]>b[3]) throw Error('Invalid west,south,east,north bounds');
  clauses.push(`lat>=? AND lat<=? AND (lon>=? ${b[0]<=b[2]?'AND':'OR'} lon<=?)`); args.push(b[1],b[3],b[0],b[2]);
}
const db = new DatabaseSync(values.database,{readOnly:true});
try {
  let count=0;
  for (const row of db.prepare(`SELECT payload,source FROM observations ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY date,id`).iterate(...args)) {
    const line=JSON.stringify({...JSON.parse(row.payload),datasetId:row.source})+'\n';
    if (!process.stdout.write(line)) await once(process.stdout,'drain');
    count++;
  }
  console.error(JSON.stringify({records:count,geography:'Exact point bounds; inclusive UTC dates',format:'NDJSON'}));
} finally {db.close();}
