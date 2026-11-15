import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { preprocess } from './pipeline.mjs';
const { values } = parseArgs({ options: { raw:{type:'string',default:'data/raw'}, out:{type:'string',default:'public/data/history'}, work:{type:'string',default:'data/processed'}, config:{type:'string',default:'scripts/history/config.json'} } });
const result = await preprocess({rawRoot:values.raw,outputRoot:values.out,workRoot:values.work,config:JSON.parse(await readFile(values.config,'utf8'))});
console.log(JSON.stringify({version:result.manifest.version,distribution:result.manifest.distribution,sources:result.manifest.sources.map(({path,rows,accepted,rejected,duplicates,conflicts,fileError})=>({path,rows,accepted,rejected,duplicates,conflicts,fileError})),benchmark:result.benchmark},null,2));
