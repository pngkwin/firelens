import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { latLngToCell } from 'h3-js';
import { preprocess, shaFile } from './pipeline.mjs';
const config={resolutions:[4,5,6],defaultResolution:5,excludeBasenames:['sample_viirs_snpp_071223.csv']};
const header='latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,version,daynight,frp\n';
test('empty source trees and wholly invalid files remain explicit empty datasets',async()=>{
  const root=await mkdtemp(join(tmpdir(),'firelens-empty-')),raw=join(root,'raw');
  await mkdir(raw);
  const options={rawRoot:raw,outputRoot:join(root,'out'),workRoot:join(root,'work'),config};
  const empty=await preprocess(options);
  assert.deepEqual(empty.manifest.extent,{start:null,end:null,count:0});
  assert.deepEqual(empty.manifest.partitions,[]);
  await writeFile(join(raw,'invalid.csv'),'hello,world\n1,2\n');
  const invalid=await preprocess(options);
  assert.equal(invalid.manifest.extent.count,0);
  assert.match(invalid.manifest.sources[0].fileError,/Missing required columns/);
  assert.equal(invalid.manifest.sources[0].accepted,0);
});
test('multi-year streaming, source metadata, duplicates, invalid rows, UTC, platform and deterministic spatial counts', async()=>{
  const root=await mkdtemp(join(tmpdir(),'firelens-history-')),raw=join(root,'raw'),out=join(root,'out'),work=join(root,'work');
  await mkdir(join(raw,'nested'),{recursive:true});
  const rows=['10,179,2023-12-31,2359,Terra,MODIS,80,61.03,N,1','10,-179,2024-01-01,1,SNPP,SNPP,n,2,N,2','11,179,2025-02-01,1200,J1,VIIRS,h,2,D,3'];
  await writeFile(join(raw,'a.csv'),header+rows.join('\n')+'\n91,0,2024-02-01,2400,Aqua,MODIS,80,61,D,1\n10,0,2023-02-29,1200,Aqua,MODIS,80,61,D,1\n10,0,2024-02-29,2400,Aqua,MODIS,80,61,D,1\n');
  await writeFile(join(raw,'nested','b.csv'),header+rows[0]+'\n'+rows[0].replace('61.03','61.04')+'\n');
  await writeFile(join(raw,'nested','Readme.txt'),'Official metadata fixture; tests only.');
  await writeFile(join(raw,'empty.csv'),header);
  await writeFile(join(raw,'invalid.csv'),'hello,world\n1,2\n');
  const a=await preprocess({rawRoot:raw,outputRoot:out,workRoot:work,config});
  assert.equal(a.manifest.extent.count,3);
  assert.equal(a.manifest.sources.reduce((n,s)=>n+s.duplicates,0),2);
  assert.equal(a.manifest.sources.reduce((n,s)=>n+s.conflicts,0),1);
  assert.equal(a.manifest.sources.reduce((n,s)=>n+s.rejected,0),3);
  assert.ok(a.manifest.sources.find(s=>s.path==='empty.csv').fileError);
  assert.ok(a.manifest.sources.find(s=>s.path==='invalid.csv').fileError);
  assert.equal(a.manifest.sources.find(s=>s.path==='nested/b.csv').readme.text,'Official metadata fixture; tests only.');
  assert.deepEqual(a.manifest.sources.find(s=>s.path==='nested/b.csv').sourceAttributes.map(s=>s.version),['61.03','61.04']);
  assert.deepEqual(a.manifest.yearly.map(x=>x.period),['2023','2024','2025']);
  assert.deepEqual(a.manifest.distribution.map(x=>x.platform),['Terra','NOAA-20','S-NPP']);
  for(const resolution of config.resolutions){
    let count=0;
    for(const p of a.manifest.partitions.filter(p=>p.resolution===resolution)){
      const rows=JSON.parse(gunzipSync(await readFile(join(out,a.manifest.version,p.file))));
      count+=rows.reduce((n,r)=>n+r.count,0);
      assert.ok(rows.every(r=>r.cell.length===15));
      if(p.period==='2023-12')assert.equal(rows[0].cell,latLngToCell(10,179,resolution));
    }
    assert.equal(count,3);
  }
  const db=new DatabaseSync(a.benchmark.database,{readOnly:true});
  assert.equal(db.prepare('SELECT count(*) n FROM provenance').get().n,5);
  assert.equal(db.prepare("SELECT count(*) n FROM observations WHERE date='2024-01-01'").get().n,1);
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM observations WHERE platform='S-NPP'").get().payload).time,'0001');
  assert.equal(db.prepare('SELECT count(*) n FROM observations WHERE lat>=? AND lat<=? AND (lon>=? OR lon<=?)').get(9,10,178,-178).n,2);
  db.close();
  const query=spawnSync(process.execPath,['scripts/history/query.mjs','--database',a.benchmark.database,'--start','2023-12-31','--end','2024-01-01','--bounds=178,9,-178,10'],{encoding:'utf8'});
  assert.equal(query.status,0,query.stderr);
  assert.equal(query.stdout.trim().split('\n').length,2);
  const hashes=new Map();
  for(const f of await readdir(join(out,a.manifest.version)))hashes.set(f,await shaFile(join(out,a.manifest.version,f)));
  const b=await preprocess({rawRoot:raw,outputRoot:out,workRoot:work,config});
  assert.equal(a.manifest.version,b.manifest.version);
  for(const [file,sha] of hashes)assert.equal(await shaFile(join(out,b.manifest.version,file)),sha,file);
});
// The original 2024 archive CSVs are user-supplied and gitignored; skip (not fail) when absent.
const realArchives=['data/raw/DL_FIRE_M-C61_850214/fire_archive_M-C61_850214.csv','data/raw/DL_FIRE_SV-C2_850215/fire_archive_SV-C2_850215.csv'];
const haveRealArchives=realArchives.every(f=>existsSync(f));
test('real NASA archive aggregates reconcile at all resolutions without training sample',{skip:haveRealArchives?false:'original 2024 archive CSVs not present in data/raw'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'firelens-real-'));
  const {manifest}=await preprocess({rawRoot:'data/raw',outputRoot:join(root,'out'),workRoot:join(root,'work'),config});
  assert.equal(manifest.extent.count,54191);
  assert.equal(manifest.distribution.filter(d=>d.sensor==='MODIS').reduce((n,d)=>n+d.count,0),6827);
  assert.equal(manifest.distribution.filter(d=>d.sensor==='VIIRS').reduce((n,d)=>n+d.count,0),47364);
  assert.equal(manifest.sources.reduce((n,s)=>n+s.rejected+s.duplicates,0),0);
  assert.equal(manifest.excluded.length,1);
  for(const resolution of config.resolutions){
    const total={MODIS:0,VIIRS:0};
    for(const p of manifest.partitions.filter(p=>p.resolution===resolution))for(const row of JSON.parse(gunzipSync(await readFile(join(root,'out',manifest.version,p.file)))))total[row.sensor]+=row.count;
    assert.deepEqual(total,{MODIS:6827,VIIRS:47364});
  }
});
