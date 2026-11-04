import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// This database is local and ephemeral. No URL or production credential is used.
// auth.users and auth.uid() below are test doubles, not a Supabase Auth server.
const draftUrl = new URL('./books/supabase-claude-prod-review/03-chapter.md', import.meta.url);
const draft = await readFile(draftUrl, 'utf8');
const sql = draft.match(/```sql\n([\s\S]*?)\n```/u)?.[1];
assert(sql, 'The manuscript must contain the chapter 3 SQL');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const results = [];
let db;
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', message: error.message }); }
}
async function as(role, uid, statement, params = []) {
  assert(['anon', 'authenticated'].includes(role));
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? '']);
    return await db.query(statement, params);
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
const rows = async (uid, query, params) => (await as('authenticated', uid, query, params)).rows;
async function denied(role, uid, query, params = [], code = '42501') {
  let error;
  try { await as(role, uid, query, params); } catch (e) { error = e; }
  assert(error, 'Expected the operation to be rejected');
  assert.equal(error.code, code, `Expected SQLSTATE ${code}, got ${error.code}`);
}
let rowA, rowB, postgres;
try {
  db = new PGlite();
  postgres = (await db.query('select version() as version')).rows[0].version;
  await db.exec(`
    create role anon nologin nosuperuser nobypassrls;
    create role authenticated nologin nosuperuser nobypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}');
  `);
  await db.exec(sql);
  await check('SQL from manuscript executes; table RLS enabled', async () => {
    const r = await db.query("select relrowsecurity from pg_class where oid = 'public.book_tasks'::regclass");
    assert.equal(r.rows[0].relrowsecurity, true);
  });
  await check('Four operation-specific policies installed', async () => {
    const r = await db.query("select cmd from pg_policies where schemaname='public' and tablename='book_tasks' order by cmd");
    assert.deepEqual(r.rows.map(x => x.cmd), ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  });
  await check('Test client roles have no superuser or bypassrls privilege', async () => {
    const r = await db.query("select rolsuper, rolbypassrls from pg_roles where rolname in ('anon','authenticated')");
    assert.equal(r.rows.length, 2);
    assert(r.rows.every(x => !x.rolsuper && !x.rolbypassrls));
  });
  for (const [uid, label] of [[A,'A'], [B,'B']]) {
    await check(`${label}: own INSERT returns database defaults and persists`, async () => {
      const out = await rows(uid, 'insert into public.book_tasks(owner_id,summary) values($1,$2) returning *', [uid, `${label}-original`]);
      assert.equal(out.length, 1);
      assert.equal(out[0].owner_id, uid);
      assert.equal(out[0].status, 'open');
      assert.match(out[0].id, /^[0-9a-f-]{36}$/u);
      assert(out[0].created_at);
      const got = await rows(uid, 'select * from public.book_tasks where id=$1', [out[0].id]);
      assert.deepEqual(got, out);
      if (uid===A) rowA=out[0]; else rowB=out[0];
    });
  }
  assert(rowA && rowB, 'Fixture creation failed');
  const initial = (await db.query('select * from public.book_tasks order by id')).rows;
  const anonymous = [
    ['SELECT','select * from public.book_tasks',[]],
    ['INSERT','insert into public.book_tasks(owner_id,summary) values($1,$2)',[A,'anon-write']],
    ['UPDATE',"update public.book_tasks set summary='anon-write' where id=$1",[rowA.id]],
    ['DELETE','delete from public.book_tasks where id=$1',[rowA.id]],
  ];
  for(const [name,q,p] of anonymous) await check(`anon: ${name} denied and both rows intact`, async()=>{
    await denied('anon', null, q,p);
    assert.deepEqual((await db.query('select * from public.book_tasks order by id')).rows, initial);
  });
  for (const [uid, own, other, label] of [[A,rowA,rowB,'A'],[B,rowB,rowA,'B']]) {
    await check(`${label}: list returns only own row`, async () => {
      assert.deepEqual((await rows(uid,'select id from public.book_tasks order by id')).map(x=>x.id),[own.id]);
    });
    await check(`${label}: foreign row by ID returns zero rows`, async()=>{
      assert.deepEqual(await rows(uid,'select * from public.book_tasks where id=$1',[other.id]),[]);
    });
    await check(`${label}: foreign UPDATE returns zero rows and preserves the row`, async()=>{
      const before = await rows(other.owner_id,'select * from public.book_tasks where id=$1',[other.id]);
      assert.deepEqual(await rows(uid,"update public.book_tasks set summary='unauthorized' where id=$1 returning *",[other.id]),[]);
      assert.deepEqual(await rows(other.owner_id,'select * from public.book_tasks where id=$1',[other.id]),before);
    });
    await check(`${label}: foreign DELETE returns zero rows and preserves the row`, async()=>{
      const before=await rows(other.owner_id,'select * from public.book_tasks where id=$1',[other.id]);
      assert.deepEqual(await rows(uid,'delete from public.book_tasks where id=$1 returning *',[other.id]),[]);
      assert.deepEqual(await rows(other.owner_id,'select * from public.book_tasks where id=$1',[other.id]),before);
    });
    await check(`${label}: spoofed owner INSERT denied and dataset unchanged`, async()=>{
      const before=(await db.query('select * from public.book_tasks order by id')).rows;
      await denied('authenticated',uid,'insert into public.book_tasks(owner_id,summary) values($1,$2)',[other.owner_id,'spoof']);
      assert.deepEqual((await db.query('select * from public.book_tasks order by id')).rows,before);
    });
    await check(`${label}: own UPDATE returns changed value and persists`, async()=>{
      const out=await rows(uid,"update public.book_tasks set summary=$1,status='done' where id=$2 returning summary,status",[`${label}-updated`,own.id]);
      assert.deepEqual(out,[{summary:`${label}-updated`,status:'done'}]);
      assert.deepEqual(await rows(uid,'select summary,status from public.book_tasks where id=$1',[own.id]),out);
    });
  }
  for(const [name,statement,params] of [
    ['owner reassignment', 'update public.book_tasks set owner_id=$1 where id=$2',[B,rowA.id]],
    ['ID overwrite', 'update public.book_tasks set id=$1 where id=$2',['33333333-3333-4333-8333-333333333333',rowA.id]],
    ['creation time overwrite', "update public.book_tasks set created_at='2000-01-01' where id=$1",[rowA.id]],
    ['client-chosen ID on INSERT','insert into public.book_tasks(id,owner_id,summary) values($1,$2,$3)',['44444444-4444-4444-8444-444444444444',A,'forged-id']],
    ['client-chosen creation time on INSERT',"insert into public.book_tasks(owner_id,summary,created_at) values($1,$2,'2000-01-01')",[A,'forged-time']],
  ]) await check(`${name}: column privilege rejects and dataset unchanged`,async()=>{
    const before=(await db.query('select * from public.book_tasks order by id')).rows;
    await denied('authenticated',A,statement,params);
    assert.deepEqual((await db.query('select * from public.book_tasks order by id')).rows,before);
  });
  for(const [name,summary,status,code] of [
    ['empty summary','','open','23514'],['overlong summary','x'.repeat(501),'open','23514'],
    ['null summary',null,'open','23502'],['invalid status','sample','unknown','23514'],
  ]) await check(`${name}: constraint rejects`,async()=>{
    await denied('authenticated',A,'insert into public.book_tasks(owner_id,summary,status) values($1,$2,$3)',[A,summary,status],code);
  });
  await check('Missing subject: no readable rows',async()=>{
    assert.deepEqual(await rows(null,'select * from public.book_tasks'),[]);
  });
  await check('Missing subject: INSERT denied',async()=>{
    await denied('authenticated',null,'insert into public.book_tasks(owner_id,summary) values($1,$2)',[A,'no-subject']);
  });
  // Negative controls deliberately break this in-memory database, never a remote project.
  await check('Negative control: disabled RLS is detected by foreign-row assertion',async()=>{
    await db.exec('alter table public.book_tasks disable row level security');
    try {
      const observed=await rows(A,'select * from public.book_tasks where id=$1',[rowB.id]);
      assert.equal(observed.length,1);
      assert.throws(()=>assert.deepEqual(observed,[]));
    } finally { await db.exec('alter table public.book_tasks enable row level security'); }
  });
  await check('Negative control: extra permissive SELECT policy is detected',async()=>{
    await db.exec('create policy bad_read on public.book_tasks for select to authenticated using(true)');
    try {
      const observed=await rows(A,'select * from public.book_tasks where id=$1',[rowB.id]);
      assert.equal(observed.length,1);
      assert.throws(()=>assert.deepEqual(observed,[]));
    } finally { await db.exec('drop policy bad_read on public.book_tasks'); }
  });
  await check('Negative control: weakened INSERT check is detected',async()=>{
    await db.exec('alter policy book_tasks_create_own on public.book_tasks with check(true)');
    try {
      let rejected=false;
      try{await as('authenticated',A,'insert into public.book_tasks(owner_id,summary) values($1,$2)',[B,'negative-control']);}
      catch{rejected=true;}
      assert.equal(rejected,false);
      assert.throws(()=>assert.equal(rejected,true));
      const r=await rows(B,"select summary from public.book_tasks where summary='negative-control'");
      assert.equal(r.length,1);
    } finally {
      await db.exec('alter policy book_tasks_create_own on public.book_tasks with check((select auth.uid()) = owner_id)');
      await db.exec("delete from public.book_tasks where summary='negative-control'");
    }
  });
  await check('UPDATE WITH CHECK still rejects ownership change if column grant widens',async()=>{
    await db.exec('grant update(owner_id) on public.book_tasks to authenticated');
    try {
      await denied('authenticated',A,'update public.book_tasks set owner_id=$1 where id=$2',[B,rowA.id]);
      assert.equal((await rows(A,'select owner_id from public.book_tasks where id=$1',[rowA.id]))[0].owner_id,A);
    } finally { await db.exec('revoke update(owner_id) on public.book_tasks from authenticated'); }
  });
  for(const [uid,row,label] of [[A,rowA,'A'],[B,rowB,'B']]) await check(`${label}: own DELETE returns row then no row remains`,async()=>{
    assert.deepEqual(await rows(uid,'delete from public.book_tasks where id=$1 returning id',[row.id]),[{id:row.id}]);
    assert.deepEqual(await rows(uid,'select * from public.book_tasks where id=$1',[row.id]),[]);
  });
} catch(error) {
  results.push({name:'suite setup or execution',status:'FAIL',message:error.message});
} finally {
  if(db) await db.close();
}
const report={
  recordedAt:new Date().toISOString(),node:process.version,pglite:'0.5.14',postgres,
  sqlSha256:createHash('sha256').update(sql).digest('hex'),
  scope:'Local PostgreSQL engine in WebAssembly; test doubles for auth.users/auth.uid; no HTTP, JWT signature validation, GoTrue or hosted Supabase tested',
  total:results.length,passed:results.filter(x=>x.status==='PASS').length,
  failed:results.filter(x=>x.status==='FAIL').length,results
};
await mkdir(new URL('./evidence/',import.meta.url),{recursive:true});
await writeFile(new URL('./evidence/rls-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.failed) process.exitCode=1;
