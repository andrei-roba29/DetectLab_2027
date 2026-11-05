'use strict';
// Real local PostgreSQL/PostGIS, never a live service.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const deps=require('node:module').createRequire(path.join(__dirname,'tools/apm-test/package.json'));
const {PGlite}=deps('@electric-sql/pglite'),{postgis}=deps('@electric-sql/pglite-postgis');
const sql=fs.readFileSync('backend/migrations/manual/017_apm_hoards.sql','utf8');
const premium='11111111-1111-4111-8111-111111111111',free='22222222-2222-4222-8222-222222222222';
(async()=>{
 const db=new PGlite({extensions:{postgis}});
 try{
  await db.exec(`CREATE EXTENSION postgis; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE SCHEMA auth; CREATE SCHEMA extensions;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE TABLE public.profiles(id uuid PRIMARY KEY,plan text,premium_expires_at timestamptz);
   CREATE TABLE public.archaeological_sites_a(layer_id integer,object_id integer,attributes jsonb,geom geometry);
   GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
   INSERT INTO public.archaeological_sites_a VALUES(0,1,'{"COORD":"DA"}',ST_SetSRID(ST_MakePoint(25,46),4326));`);
  await db.query("INSERT INTO profiles VALUES($1,'premium',now()+interval '1 day'),($2,'free',NULL)",[premium,free]);
  await db.exec(sql);
  // Check the persisted source table is unchanged, including its single row.
  assert.equal((await db.query('SELECT count(*) n FROM archaeological_sites_a')).rows[0].n,1);
  const call=async(filters={},mode='sites',radius=150,lat=46,lon=25)=>(await db.query('SELECT apm_hoards_within($1,$2,$3,$4,$5) data',[lat,lon,radius,JSON.stringify(filters),mode])).rows[0].data;
  const known=async()=>(await db.query('SELECT apm_hoard_known_sites(46,25,150) data')).rows[0].data;
  await db.exec('SET ROLE authenticated');
  await assert.rejects(call(),/premium_required/);await assert.rejects(known(),/premium_required/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[free]);await assert.rejects(call(),/premium_required/);await assert.rejects(known(),/premium_required/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[premium]);assert.equal((await call()).rows.length,0);assert.equal((await known()).rows.length,1);
  await assert.rejects(db.query('SELECT * FROM archaeological_hoards'),/permission denied/);
  await assert.rejects(db.query("INSERT INTO archaeological_hoards(id) VALUES(gen_random_uuid())"),/permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(`INSERT INTO archaeological_hoards(id,source,source_layer,source_id,name,lat,lon,position_class,position_accuracy_m,period_groups,deposit_start_year,deposit_end_year,date_basis,hoard_type)
   SELECT md5(g::text)::uuid,'darmc',12,g::text,'Example '||g,46,25,CASE WHEN g=2 THEN 'approximate' WHEN g=3 THEN 'unknown' ELSE 'exact' END,60,ARRAY['gallic'],200,300,'deposit',CASE WHEN g=4 THEN 'non-coin' ELSE 'coin' END FROM generate_series(1,6) g;
   UPDATE archaeological_hoards SET duplicate_of=md5('1')::uuid WHERE source_id='5';
   UPDATE archaeological_hoards SET bucket='uncertain' WHERE source_id='6';
   INSERT INTO archaeological_hoards(id,source,source_layer,source_id,lat,lon,position_class,period_groups,date_basis)
   VALUES(md5('far')::uuid,'darmc',12,'far',48,25,'exact','{}','deposit');`);
  await db.exec('SET ROLE authenticated');
  const exact=await call();assert.equal(exact.rows.length,2);assert.equal(exact.total_in_area,6);assert.equal(exact.excluded_approximate,1);assert.equal(exact.excluded_unknown_position,1);assert.equal(exact.excluded_duplicates,1);assert.equal(exact.excluded_uncertain,1);
  assert.equal((await call({include_approximate:true})).rows.length,3);
  assert.equal((await call({hoard_types:['coin']})).rows.length,1);assert.equal((await call({deposit_start_year:400})).rows.length,0);
  assert.equal((await call({deposit_end_year:100})).rows.length,0);assert.equal((await call({period_group:'not-a-group'})).rows.length,0);
  const counts=await call({},'counts');assert.equal(counts.rows.length,0);assert.equal(counts.period_counts.gallic,2);
  assert.deepEqual((await call({},'sites',999)).rows,exact.rows,'150km cap');
  for(const radius of [0,-1,NaN,Infinity])await assert.rejects(call({},'sites',radius),/invalid_hoard_request/);
  await assert.rejects(call({},'sites',150,91),/invalid_hoard_request/);await assert.rejects(call({deposit_start_year:400,deposit_end_year:300}),/invalid_date_range/);
  await assert.rejects(call({hoard_types:['anything']}),/invalid_hoard_types/);
  await db.exec('RESET ROLE');
  await db.exec(`INSERT INTO archaeological_hoards(id,source,source_layer,source_id,lat,lon,position_class,date_basis)
    SELECT md5(('many'||g)::text)::uuid,'darmc',12,'many'||g,46,25,'exact','deposit' FROM generate_series(1,5001)g;`);
  await db.exec('SET ROLE authenticated');const capped=await call();assert.equal(capped.rows.length,5000);assert.equal(capped.truncated,true);assert(capped.usable>5000);
  await db.exec('RESET ROLE');await db.query("UPDATE profiles SET premium_expires_at=now()-interval '1 second' WHERE id=$1",[premium]);
  await db.exec('SET ROLE authenticated');await assert.rejects(call(),/premium_required/);await assert.rejects(known(),/premium_required/);
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(call(),/permission denied/);await assert.rejects(known(),/permission denied/);
  console.log('PASS hoard SQL: real PostgreSQL/PostGIS; anonymous/free/expired denied on both RPCs; no direct reads/writes; filters/counts; 150km cap; 5000-row truncation; original table unchanged.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
