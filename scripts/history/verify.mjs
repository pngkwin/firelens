import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const root=resolve(process.argv.includes('--dist')?'dist/data/history':'public/data/history');
const digest=b=>createHash('sha256').update(b).digest('hex');
const pointer=JSON.parse(await readFile(join(root,'latest.json'),'utf8'));
const bytes=await readFile(join(root,pointer.manifest));
if(digest(bytes)!==pointer.sha256)throw Error('History manifest integrity mismatch');
const m=JSON.parse(bytes);
if(m.version!==pointer.version)throw Error('History version mismatch');
for(const resolution of m.config.resolutions){
  const totals={MODIS:0,VIIRS:0};
  for(const part of m.partitions.filter(p=>p.resolution===resolution)){
    for(const descriptor of [part,part.geometry]){
      const zipped=await readFile(join(root,m.version,descriptor.file)),decoded=gunzipSync(zipped);
      if(digest(zipped)!==descriptor.sha256||digest(decoded)!==descriptor.decodedSha256||zipped.length!==descriptor.bytes||decoded.length!==descriptor.decodedBytes)throw Error(`Integrity mismatch: ${descriptor.file}`);
      const rows=JSON.parse(decoded);
      if(rows.length!==descriptor.rows)throw Error('Partition row count mismatch');
      if(descriptor===part)for(const row of rows)totals[row.sensor]+=row.count;
    }
  }
  for(const sensor of ['MODIS','VIIRS'])if(totals[sensor]!==m.distribution.filter(d=>d.sensor===sensor).reduce((n,d)=>n+d.count,0))throw Error(`Reconciliation failed: ${sensor}, H3 ${resolution}`);
}
for(const summary of [m.monthly,m.yearly])if(summary.reduce((n,d)=>n+d.count,0)!==m.extent.count)throw Error('Temporal reconciliation failed');
const analysisPointer=JSON.parse(await readFile(join(root,'analysis-latest.json'),'utf8'));
const analysis=await readFile(join(root,analysisPointer.file));
if(digest(analysis)!==analysisPointer.sha256||analysisPointer.version!==m.version||JSON.parse(analysis).version!==m.version)throw Error('Analysis mismatch: run history:analyze');
console.log(`Historical integrity and daily/monthly/yearly reconciliation passed: ${m.extent.count} observations, H3 ${m.config.resolutions.join(', ')}.`);
