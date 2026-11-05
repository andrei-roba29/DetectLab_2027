#!/usr/bin/env node
/** Explicit operator CLI. Default DRY RUN; no database writes without --apply AND review gates.
 * Capture source evidence: node tools/sync-hoards.mjs --capture /tmp/hoard-evidence.json
 * Offline inspection: node tools/sync-hoards.mjs --from-evidence /tmp/hoard-evidence.json
 * Optional RAN read: --ran (DATABASE_URL), --apply requires DATABASE_URL too.
 * No endpoints/schema/date/quality meanings are inferred. No licence assertion.
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const config=require('../js/apm-next/hoards.config.js');
const normal=require('../js/apm-next/apm-hoards.js');
const BASE='https://services1.arcgis.com/qN3V93cYGMKQCOxL/arcgis/rest/services/DARMC_Archaeological_Studies/FeatureServer';
const LAYERS=[8,9,10,11,12,15,16];
const args=process.argv.slice(2);
const arg=k=>args.includes(k)?args[args.indexOf(k)+1]:null;
let requests=0;
async function get(url){
    requests++;
    const res=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw new Error(`HTTP ${res.status}: ${url}`);
    const json=await res.json();if(json.error)throw new Error(JSON.stringify(json.error));return json;
}
function url(layer,suffix='',query={}){return `${BASE}/${layer}${suffix}?${new URLSearchParams({f:'json',...query})}`;}
export async function capture(){
    const evidence={captured_at:new Date().toISOString(),base:BASE,layers:{}};
    for(const id of LAYERS){
        const metadata=await get(url(id));
        if(metadata.geometryType!=='esriGeometryPoint')throw new Error(`Layer ${id}: not a point layer`);
        const count=await get(url(id,'/query',{where:'1=1',returnCountOnly:'true'}));
        // ID batches work independently of pagination support; capability is reported, not assumed.
        const ids=await get(url(id,'/query',{where:'1=1',returnIdsOnly:'true'}));
        if(!Array.isArray(ids.objectIds))throw new Error(`Layer ${id}: missing object IDs`);
        if(ids.objectIds.length!==count.count)throw new Error(`Layer ${id}: ID/count mismatch`);
        const size=Math.min(1000,metadata.maxRecordCount||1000),features=[];
        for(let i=0;i<ids.objectIds.length;i+=size){
            const page=await get(url(id,'/query',{objectIds:ids.objectIds.slice(i,i+size).join(','),outFields:'*',returnGeometry:'true',outSR:'4326'}));
            if(page.exceededTransferLimit||!Array.isArray(page.features))throw new Error(`Layer ${id}: incomplete ID batch; no partial import`);
            if(page.spatialReference?.wkid!==4326 && page.spatialReference?.latestWkid!==4326)throw new Error(`Layer ${id}: output SR not confirmed 4326`);
            features.push(...page.features);
        }
        const oid=ids.objectIdFieldName;
        if(features.length!==count.count||new Set(features.map(f=>f.attributes[oid])).size!==count.count)throw new Error(`Layer ${id}: missing/duplicate rows`);
        evidence.layers[id]={metadata,count:count.count,features};
        console.error(`Captured layer ${id}: ${features.length} records; pagination=${metadata.advancedQueryCapabilities?.supportsPagination ?? 'unreported'}`);
    }
    return evidence;
}
function stableId(r){const hex=crypto.createHash('sha256').update(`${r.source}:${r.source_layer}:${r.source_id}`).digest('hex').slice(0,32);return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
function tally(rows,key){const out={};for(const r of rows){for(const k of [].concat(r[key]??'unknown'))out[k]=(out[k]||0)+1;}return out;}
export function inspect(evidence){
    const rows=[],reports={};
    for(const layer of LAYERS){
        const e=evidence.layers[layer];if(!e)throw new Error(`Missing layer ${layer}`);
        const reasons={},positions={},quality={},fields=(e.metadata.fields||[]);
        for(const f of fields.filter(f=>/^(FINDSPOT_Q|Q_LAT_LON|CENTROID|VERIFIED)$/i.test(f.name))){
            quality[f.name]={};for(const feature of e.features){const key=JSON.stringify(feature.attributes[f.name]??null);quality[f.name][key]=(quality[f.name][key]||0)+1;}
        }
        let kept=0;
        for(const feature of e.features){
            const result=normal.normaliseDarmc(feature,layer,config.layers[layer]);
            if(result.dropped){reasons[result.dropped]=(reasons[result.dropped]||0)+1;continue;}
            const r=result.row;r.id=stableId(r);rows.push(r);kept++;positions[r.position_class]=(positions[r.position_class]||0)+1;
        }
        // Raw record identity comparisons do NOT establish archaeological duplicate identity.
        reports[layer]={fetched:e.features.length,kept,dropped:e.features.length-kept,drop_reasons:reasons,position_classes:positions,quality_values:quality,
            fields:fields.map(f=>({name:f.name,type:f.type,alias:f.alias,domain:f.domain})),supportsPagination:e.metadata.advancedQueryCapabilities?.supportsPagination??null,
            attribution:e.metadata.copyrightText||null,description:e.metadata.description||null};
    }
    const signatures=id=>new Set(evidence.layers[id].features.map(f=>JSON.stringify(Object.fromEntries(Object.entries(f.attributes).filter(([k])=>!/^objectid$/i.test(k)).sort()))));
    const comparisons=[];
    for(const [a,b] of [[15,16],[8,9],[8,10],[8,11],[9,10],[9,11],[10,11],[12,15]]){
        const x=signatures(a),y=signatures(b);comparisons.push({layers:[a,b],attribute_identical_excluding_objectid:[...x].filter(v=>y.has(v)).length,
            note:'Raw attribute equality only. Different schemas can describe the same find; spatial/date/name candidate report follows reviewed mappings.'});
    }
    return {rows,reports,comparisons};
}
async function main(){
    if(args.includes('--help')){console.log('DRY RUN default. --capture PATH | --from-evidence PATH; optional --ran; --apply needs reviewed config and DATABASE_URL. Source licence remains OPEN QUESTION.');return;}
    const apply=args.includes('--apply');
    if(apply&&(!normal.ready()||LAYERS.some(id=>config.layers[id]?.reviewed!==true)))throw new Error('Review/performance gates or layer mappings incomplete; refusing data writes');
    if(arg('--capture')&&arg('--from-evidence'))throw new Error('Choose capture OR offline evidence');
    const t=Date.now();
    const evidence=arg('--from-evidence')?JSON.parse(await fs.readFile(arg('--from-evidence'),'utf8')):await capture();
    if(arg('--capture'))await fs.writeFile(arg('--capture'),JSON.stringify(evidence,null,2),{flag:'wx'});
    const result=inspect(evidence),rows=result.rows;
    let db,ran={status:'not-requested'};
    try{
        if(args.includes('--ran')||apply){
            if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required; never paste credentials in chat');
            const {Client}=createRequire(new URL('../backend/package.json',import.meta.url))('pg');db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
        }
        if(args.includes('--ran')){
            // This SELECT is the ONLY operation on archaeological_sites_a. Never UPDATE/ALTER it.
            const found=await db.query("SELECT layer_id,object_id,attributes,ST_Y(geom) lat,ST_X(geom) lon FROM public.archaeological_sites_a WHERE ST_SRID(geom)=4326 AND ST_GeometryType(geom)='ST_Point'");
            const buckets={},derived=[];for(const input of found.rows){const c=normal.classifyRomanian(input.attributes.NUMESIT);buckets[c.bucket]=(buckets[c.bucket]||0)+1;const r=normal.deriveRomanian(input);if(r.row){r.row.id=stableId(r.row);derived.push(r.row);}}
            rows.push(...derived);ran={examined:found.rows.length,total_derived:derived.length,buckets,position_classes:tally(derived,'position_class'),periods:tally(derived,'period_groups'),unknown_period:derived.filter(r=>!r.period_groups.length).length,multiple_periods:derived.filter(r=>r.multiple_periods).length};
        }
        const duplicates=normal.markDuplicates(rows);
        if(apply){
            await db.query('BEGIN');
            try{
                for(const row of rows){
                    const keys=Object.keys(row).filter(k=>k!=='synced_at'),values=keys.map(k=>['raw','periods','position_quality_raw'].includes(k)?JSON.stringify(row[k]):row[k]);
                    const update=keys.filter(k=>k!=='id').map(k=>`${k}=EXCLUDED.${k}`).join(',');
                    await db.query(`INSERT INTO public.archaeological_hoards (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${update},synced_at=now()`,values);
                }
                await db.query('COMMIT');
            }catch(e){await db.query('ROLLBACK');throw e;}
        }
        console.log(JSON.stringify({mode:apply?'APPLY':'DRY-RUN',requests,elapsed_ms:Date.now()-t,layers:result.reports,raw_comparisons:result.comparisons,
            duplicate_candidates:duplicates,position_mapping:config.layers,position_counts:tally(rows,'position_class'),romanian:ran,
            sample:rows.slice(0,3),licence:'OPEN QUESTION',unverified:['Unmapped date/quality fields','Quality code meanings','Geometry vs coordinate-field agreement pending field mapping','Archaeological overlap pending mapping review']},null,2));
    }finally{if(db)await db.end();}
}
if(import.meta.url===new URL(process.argv[1], 'file:').href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
