import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { shaFile } from './pipeline.mjs';
const { values } = parseArgs({options:{benchmark:{type:'string',default:'data/processed/latest-benchmark.json'},root:{type:'string',default:'public/data/history'}}});
const benchmark=JSON.parse(await readFile(values.benchmark,'utf8'));
const root=join(values.root,benchmark.version);
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const db=new DatabaseSync(benchmark.database,{readOnly:true});
const plain=rows=>rows.map(r=>({...r}));
const started=performance.now();
try {
  const overlap=db.prepare(`SELECT MAX(start) start,MIN(end) end FROM (SELECT sensor,MIN(date) start,MAX(date) end FROM observations GROUP BY sensor)`).get();
  const sensors=db.prepare('SELECT count(DISTINCT sensor) n FROM observations').get().n;
  const scales=[];
  if(sensors===2 && overlap.start<=overlap.end)for(const resolution of manifest.config.resolutions)for(const unit of ['day','month','year']){
    const length={day:10,month:7,year:4}[unit];
    const counts=db.prepare(`WITH bins AS (
      SELECT c.cell,substr(o.date,1,${length}) period,
      MAX(o.sensor='MODIS') m,MAX(o.sensor='VIIRS') v
      FROM observations o JOIN cells c ON c.id=o.id WHERE c.resolution=? AND o.date>=? AND o.date<=?
      GROUP BY c.cell,period)
      SELECT COUNT(*) unionBins,COALESCE(SUM(m),0) MODIS,COALESCE(SUM(v),0) VIIRS,COALESCE(SUM(m*v),0) both,COALESCE(SUM(m*(1-v)),0) MODISonly,COALESCE(SUM(v*(1-m)),0) VIIRSonly FROM bins`).get(resolution,overlap.start,overlap.end);
    scales.push({resolution,unit,...counts,jaccard:counts.unionBins?counts.both/counts.unionBins:null});
  }
  // Genuine event matching requires additional evidence; proximity is only a candidate relation.
  // SQL date index and exact bounding-box prefilter keep this disk-backed, without loading either sensor in memory.
  const candidates=db.prepare(`SELECT id,lat,lon,payload FROM observations WHERE sensor='VIIRS' AND date>=? AND date<=? AND lat>=? AND lat<=? AND (?=1 OR (lon>=? AND lon<=?) OR (lon>=? AND lon<=?))`);
  const distance=(a,b)=>{
    const radians=x=>x*Math.PI/180,dl=radians(b.lat-a.lat),dn=radians(b.lon-a.lon);
    const h=Math.sin(dl/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dn/2)**2;
    return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,h)));
  };
  let pairs=0,modisWithCandidate=0;
  const matchedViirs=new Set(); // Bounded to the current regional analysis, unlike the preprocessing deduplicator.
  const toleranceKm=2,toleranceMinutes=30;
  for(const m of db.prepare("SELECT id,lat,lon,payload FROM observations WHERE sensor='MODIS' ORDER BY date,id").iterate()){
    const payload=JSON.parse(m.payload), t=payload.timestamp;
    const start=new Date(t-toleranceMinutes*60000).toISOString().slice(0,10),end=new Date(t+toleranceMinutes*60000).toISOString().slice(0,10);
    const latPad=toleranceKm/110.5;
    const lonPad=Math.min(180,toleranceKm/(111.0*Math.max(0.00001,Math.cos((Math.abs(m.lat)+latPad)*Math.PI/180))));
    let west=m.lon-lonPad,east=m.lon+lonPad, west2=1,east2=0;
    if(west < -180){west2=west+360;east2=180;west=-180;}
    if(east > 180){west2=-180;east2=east-360;east=180;}
    let matched=false;
    for(const v of candidates.iterate(start,end,m.lat-latPad,m.lat+latPad,Number(lonPad===180),west,east,west2,east2)){
      if(Math.abs(JSON.parse(v.payload).timestamp-t)<=toleranceMinutes*60000 && distance(m,v)<=toleranceKm){pairs++;matched=true;matchedViirs.add(v.id);}
    }
    if(matched)modisWithCandidate++;
  }
  const analysis={format:'firelens-sensor-analysis-1',version:manifest.version,scope:{...manifest.extent,overlap:sensors===2?overlap:null,spatial:'All retained archive points; no additional geographic restriction',types:'All source type codes retained; includes non-vegetation thermal anomalies'},
    monthly:manifest.monthly,
    daynight:plain(db.prepare('SELECT sensor,platform,daynight,COUNT(*) count FROM observations GROUP BY sensor,platform,daynight ORDER BY sensor,platform,daynight').all()),
    utcHour:plain(db.prepare('SELECT sensor,platform,hour,COUNT(*) count FROM observations GROUP BY sensor,platform,hour ORDER BY sensor,platform,hour').all()),
    types:plain(db.prepare("SELECT sensor,json_extract(payload,'$.thermal.type') type,COUNT(*) count FROM observations GROUP BY sensor,type ORDER BY sensor,type").all()),
    monthlyOccupiedCells:plain(db.prepare("SELECT substr(o.date,1,7) period,o.sensor,c.resolution,COUNT(DISTINCT c.cell) cells FROM observations o JOIN cells c ON c.id=o.id GROUP BY period,o.sensor,c.resolution ORDER BY period,o.sensor,c.resolution").all()),
    scales,
    proximity:{toleranceKm,toleranceMinutes,pairs,MODISwithCandidate:modisWithCandidate,VIIRSwithCandidate:matchedViirs.size,definition:'Many-to-many cross-sensor point pairs within 2 km spherical great-circle distance and 30 minutes acquisition UTC. Candidates, not independently verified same-fire matches; counts depend on chosen tolerances.'},
    interpretation:'Cell/time-bin co-occupancy is not acquisition-time matching, missed-fire rate, accuracy, coverage, or harmonization. Only shared record-date extent is compared. The archive footprint and observation opportunities are not established by point extents. One year cannot validate historical anomalies or cross-decade calibration.'};
  const path=join(root,'analysis.json');
  await writeFile(path,JSON.stringify(analysis,null,2)+'\n');
  const pointer={version:manifest.version,file:`${manifest.version}/analysis.json`,sha256:await shaFile(path)};
  await writeFile(join(dirname(root),'analysis-latest.json'),JSON.stringify(pointer,null,2)+'\n');
  const result={seconds:(performance.now()-started)/1000,maxRssMiB:process.resourceUsage().maxRSS/1024,scales,proximity:analysis.proximity,daynight:analysis.daynight};
  await writeFile(join(dirname(benchmark.database),'analysis-benchmark.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{db.close();}
