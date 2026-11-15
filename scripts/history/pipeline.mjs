import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, basename, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import Papa from 'papaparse';
import { latLngToCell, cellToLatLng, cellArea } from 'h3-js';
import { normalizeRow, normalizeHeader, validateHeaders } from '../../src/data/normalize.ts';

export const RULES = 'firelens-history-1';
export async function shaFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const hashValue = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = rows => rows.map(row => ({ ...row }));
async function discover(root) {
  const files = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      // Never follow links outside the explicitly supplied source tree.
      if (item.isDirectory()) await walk(join(dir, item.name));
      else if (item.isFile() && /\.csv$/i.test(item.name)) files.push(join(dir, item.name));
    }
  }
  await walk(root);
  return files.sort((a, b) => relative(root, a).replaceAll('\\', '/') < relative(root, b).replaceAll('\\', '/') ? -1 : 1);
}
async function gzipRows(path, rows) {
  let count = 0;
  const hash = createHash('sha256'); let decodedBytes = 0;
  async function* chunks() {
    function track(value) { hash.update(value); decodedBytes += Buffer.byteLength(value); return value; }
    yield track('[');
    for (const row of rows) { yield track((count++ ? ',' : '') + JSON.stringify(row)); }
    yield track(']\n');
  }
  await pipeline(Readable.from(chunks()), createGzip({ level: 9 }), createWriteStream(path));
  return { rows: count, bytes: (await stat(path)).size, sha256: await shaFile(path), decodedSha256: hash.digest('hex'), decodedBytes };
}
export async function preprocess({ rawRoot, outputRoot, workRoot, config }) {
  const began = performance.now();
  rawRoot = resolve(rawRoot); outputRoot = resolve(outputRoot); workRoot = resolve(workRoot);
  for (const target of [outputRoot, workRoot]) {
    if (target === rawRoot || !relative(rawRoot, target).startsWith('..')) throw Error('Outputs and work files must be outside the raw source tree');
  }
  if (!config.resolutions?.length || config.resolutions.some(r => !Number.isInteger(r) || r < 0 || r > 10) || !config.resolutions.includes(config.defaultResolution)) throw Error('Specify H3 resolutions 0–10 and an included defaultResolution');
  config = { ...config, resolutions: [...new Set(config.resolutions)].sort((a,b) => a-b) };
  const discovered = await discover(rawRoot), excluded = [], sources = [];
  for (const path of discovered) {
    const name = relative(rawRoot, path).replaceAll('\\', '/');
    if ((config.excludeBasenames ?? []).includes(basename(path))) { excluded.push({ path: name, reason: config.excludeReason }); continue; }
    const sha256 = await shaFile(path);
    let readme = null;
    try { const text = await readFile(join(dirname(path), 'Readme.txt'), 'utf8'); readme = { text, sha256: createHash('sha256').update(text).digest('hex') }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    sources.push({ id: hashValue([name, sha256]).slice(0, 24), path: name, sha256, bytes: (await stat(path)).size, readme });
  }
  const implementation = { pipelineSha256: await shaFile(new URL('./pipeline.mjs', import.meta.url)), normalizerSha256: await shaFile(new URL('../../src/data/normalize.ts', import.meta.url)), h3Version: JSON.parse(await readFile(new URL('../../node_modules/h3-js/package.json', import.meta.url),'utf8')).version };
  const version = hashValue({ rules: RULES, implementation, config, sources }).slice(0, 24);
  const out = join(outputRoot, version);
  await mkdir(out, { recursive: true }); await mkdir(workRoot, { recursive: true });
  const database = join(workRoot, `${version}-${Date.now()}.sqlite`);
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=FILE;
    CREATE TABLE observations (id TEXT PRIMARY KEY, date TEXT, sensor TEXT, platform TEXT, version TEXT, daynight TEXT, hour TEXT, lat REAL, lon REAL, source TEXT, payload TEXT) WITHOUT ROWID;
    CREATE TABLE provenance (id TEXT, source TEXT, row INTEGER, version TEXT, raw TEXT, duplicate INTEGER, conflict INTEGER);
    CREATE TABLE cells (id TEXT, resolution INTEGER, cell TEXT, PRIMARY KEY(id,resolution)) WITHOUT ROWID;
    CREATE INDEX observations_source ON observations(source);
    CREATE INDEX source_records ON provenance(source,id);`);
  const insert = db.prepare('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const previous = db.prepare('SELECT payload FROM observations WHERE id=?');
  const associate = db.prepare('INSERT INTO provenance VALUES(?,?,?,?,?,?,?)');
  const cellInsert = db.prepare('INSERT INTO cells VALUES(?,?,?)');
  const qualityFields = ['confidence','frp','version','daynight','brightness','bright_t31','bright_ti4','bright_ti5','scan','track','type'];
  try {
    for (const source of sources) {
      Object.assign(source, { rows: 0, accepted: 0, rejected: 0, duplicates: 0, conflicts: 0, issues: [], missing: {}, invalid: {} });
      let headerChecked = false;
      db.exec('BEGIN');
      await new Promise((ok, fail) => {
        Papa.parse(createReadStream(join(rawRoot, source.path)), {
          header: true, skipEmptyLines: 'greedy', transformHeader: normalizeHeader,
          step(result, parser) {
            let validated = false;
            try {
              if (!headerChecked) { source.schema = result.meta.fields; validateHeaders(source.schema); headerChecked = true; }
              source.rows++;
              if (result.errors.length) throw Error(result.errors.map(e => e.message).join('; '));
              const row = result.data;
              const observation = normalizeRow(row, source.id);
              validated = true;
              for (const field of qualityFields) {
                if (!(field in row)) continue;
                const value = row[field]?.trim();
                if (!value) source.missing[field] = (source.missing[field] ?? 0) + 1;
                else if ((field === 'daynight' && !['D','N'].includes(value)) ||
                  (field === 'confidence' && (observation.sensor === 'MODIS' ? !Number.isFinite(+value) || +value < 0 || +value > 100 : !['l','n','h'].includes(value.toLowerCase()))) ||
                  (['frp','brightness','bright_t31','bright_ti4','bright_ti5','scan','track','type'].includes(field) && (!Number.isFinite(+value) || (field === 'type' ? ![0,1,2,3].includes(+value) : +value < 0)))) source.invalid[field] = (source.invalid[field] ?? 0) + 1;
              }
              // Dataset id is attribution, not part of the observation payload used for conflict detection.
              const { datasetId, ...identityPayload } = observation;
              const payload = JSON.stringify(identityPayload);
              const resultInsert = insert.run(observation.id, observation.date, observation.sensor, observation.satellite, observation.version, observation.daynight, observation.time.slice(0,2), observation.latitude, observation.longitude, source.id, payload);
              const duplicate = Number(!resultInsert.changes);
              const conflict = duplicate && previous.get(observation.id).payload !== payload ? 1 : 0;
              associate.run(observation.id, source.id, source.rows, observation.version, JSON.stringify(row), duplicate, conflict);
              if (duplicate) { source.duplicates++; source.conflicts += conflict; }
              else {
                source.accepted++;
                for (const resolution of config.resolutions) cellInsert.run(observation.id, resolution, latLngToCell(observation.latitude, observation.longitude, resolution));
              }
              if (source.rows % 10000 === 0) db.exec('COMMIT; BEGIN');
            } catch (error) {
              if (validated) { fail(error); parser.abort(); return; }
              if (!headerChecked) { source.fileError = error.message; parser.abort(); return; }
              source.rejected++;
              if (source.issues.length < 50) source.issues.push({ dataRow: source.rows, message: error.message });
            }
          }, complete: ok, error: fail,
        });
      });
      db.exec('COMMIT');
      if (!headerChecked && !source.fileError) source.fileError = 'Empty CSV: no data rows';
      if (await shaFile(join(rawRoot, source.path)) !== source.sha256) throw Error(`Source changed while processing: ${source.path}`);
      source.distribution = plain(db.prepare(`SELECT sensor,platform,version,MIN(date) start,MAX(date) end,COUNT(*) count FROM observations WHERE source=? GROUP BY sensor,platform,version ORDER BY sensor,platform,version`).all(source.id));
      source.sourceAttributes = plain(db.prepare(`SELECT version,json_extract(raw,'$.instrument') instrument,json_extract(raw,'$.satellite') satellite,COUNT(*) rows,SUM(duplicate) duplicates FROM provenance WHERE source=? GROUP BY version,instrument,satellite ORDER BY version,instrument,satellite`).all(source.id));
    }
    db.exec('CREATE INDEX observations_date ON observations(date,sensor,platform); CREATE INDEX observations_geo ON observations(lat,lon); CREATE INDEX cell_query ON cells(resolution,cell);');
    const partitions = [];
    const periods = db.prepare("SELECT DISTINCT substr(date,1,7) period FROM observations ORDER BY period").all();
    for (const { period } of periods) for (const resolution of config.resolutions) {
      const file = `${period}-h3-${resolution}.json.gz`;
      const rows = db.prepare(`SELECT o.date,o.sensor,o.platform,o.version,o.daynight,o.source,c.cell,COUNT(*) count
        FROM observations o JOIN cells c ON c.id=o.id WHERE c.resolution=? AND o.date>=? AND o.date<?
        GROUP BY o.date,o.sensor,o.platform,o.version,o.daynight,o.source,c.cell ORDER BY o.date,o.sensor,o.platform,o.version,o.daynight,o.source,c.cell`).iterate(resolution, `${period}-01`, `${period}-32`);
      const integrity = await gzipRows(join(out,file), rows);
      partitions.push({ period, resolution, file, ...integrity });
    }
    // Cell geometry metadata is partitioned too, preventing a global multi-decade cell registry in the browser.
    for (const part of partitions) {
      const geometryFile = part.file.replace('.json.gz', '-cells.json.gz');
      const cells = db.prepare(`SELECT DISTINCT c.cell FROM cells c JOIN observations o ON o.id=c.id WHERE c.resolution=? AND substr(o.date,1,7)=? ORDER BY c.cell`).iterate(part.resolution,part.period);
      function* geometry() { for (const { cell } of cells) { const [latitude,longitude] = cellToLatLng(cell); yield {cell,latitude,longitude,areaKm2:cellArea(cell,'km2')}; } }
      part.geometry = { file: geometryFile, ...await gzipRows(join(out,geometryFile), geometry()) };
    }
    const distribution = plain(db.prepare('SELECT sensor,platform,version,MIN(date) start,MAX(date) end,COUNT(*) count FROM observations GROUP BY sensor,platform,version ORDER BY sensor,platform,version').all());
    const monthly = plain(db.prepare("SELECT substr(date,1,7) period,sensor,platform,COUNT(*) count FROM observations GROUP BY period,sensor,platform ORDER BY period,sensor,platform").all());
    const yearly = plain(db.prepare("SELECT substr(date,1,4) period,sensor,platform,COUNT(*) count FROM observations GROUP BY period,sensor,platform ORDER BY period,sensor,platform").all());
    const extent = { ...db.prepare('SELECT MIN(date) start,MAX(date) end,COUNT(*) count FROM observations').get() };
    const manifest = {
      format: RULES, version, implementation, config, sources, excluded, extent, distribution, monthly, yearly, partitions,
      provenance: 'First file in relative-path byte order wins by sensor|platform|UTC timestamp|latitude|longitude, including across versions. All valid source rows and duplicate attributes remain in the local SQLite provenance table; accepted attribution and full source metadata accompany aggregates.',
      coverage: 'Record extents are not satellite observation coverage. Zero loaded detections is not absence of fire. All supplied type codes are retained. Confidence values remain sensor-specific.',
      spatial: 'H3 direct point-to-cell indexing at each resolution. Unequal cell areas are supplied in km². Bounds queries on cell centers are approximate; exact queries require point records in the local SQLite database.',
      points: { availableInBrowser: false, localDatabase: true, query: 'node scripts/history/query.mjs --database <benchmark.database> --start YYYY-MM-DD --end YYYY-MM-DD --bounds west,south,east,north' },
    };
    await writeFile(join(out,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
    const manifestSha256 = await shaFile(join(out,'manifest.json'));
    await writeFile(join(outputRoot,'latest.json'), JSON.stringify({version,manifest:`${version}/manifest.json`,sha256:manifestSha256},null,2)+'\n');
    const benchmark = { version, database, seconds: (performance.now()-began)/1000, maxRssMiB: process.resourceUsage().maxRSS/1024, records: extent.count, sourceBytes: sources.reduce((n,s)=>n+s.bytes,0), aggregateBytes: partitions.reduce((n,p)=>n+p.bytes+p.geometry.bytes,0) };
    await writeFile(join(workRoot,'latest-benchmark.json'),JSON.stringify(benchmark,null,2)+'\n');
    return { manifest, benchmark };
  } finally { db.close(); }
}
