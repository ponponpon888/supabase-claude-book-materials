import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const cwd=fileURLToPath(new URL('.',import.meta.url));
const server=spawn(process.execPath,['./node_modules/zenn-cli/dist/server/zenn.js','preview','--port','8765','--host','127.0.0.1'],{cwd,stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
let output={checkedAt:new Date().toISOString(),zennCli:'0.5.13',chapterCount:0,chapters:[],articles:[],errors:[],visualReview:'not completed'};
try {
  let ready=false;
  for(let i=0;i<50;i++){
    try{const r=await fetch('http://127.0.0.1:8765/api/books');if(r.ok){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  assert(ready,logs||'Preview server did not start');
  const base='http://127.0.0.1:8765/api/books/supabase-claude-prod-review';
  const book=(await (await fetch(base)).json()).book;
  assert.equal(typeof book.published,'boolean');
  output.bookPublished=book.published;
  assert.equal(book.price,0);
  const chapters=(await (await fetch(base+'/chapters')).json()).chapters;
  assert.equal(chapters.length,9);
  for(let i=0;i<chapters.length;i++){
    const c=chapters[i];
    assert.equal(c.position,i);
    assert.equal(c.free,true);
    const res=await fetch(base+'/chapters/'+c.filename);
    assert.equal(res.status,200);
    const d=(await res.json()).chapter;
    assert(d.bodyHtml.length>500);
    assert(d.bodyHtml.includes('<details'),`Chapter ${i} must render its answer disclosure`);
    assert(d.bodyHtml.includes('<summary'),`Chapter ${i} must render its answer label`);
    assert(!d.bodyHtml.includes(':::details'),`Chapter ${i} must not show raw answer markup`);
    assert(!/出版社向け企画|持ち込み準備|著者紹介案|初稿段階では実行未検証/u.test(d.bodyHtml));
    if(i>0)assert(d.toc.length>0,`Chapter ${i} must have a table of contents`);
    const tableCount=(d.bodyHtml.match(/<table\b/gu)||[]).length;
    if(i>=1&&i<=7)assert(tableCount>0,`Chapter ${i} must render its tables`);
    output.chapters.push({slug:c.slug,status:200,free:c.free,title:d.title,htmlLength:d.bodyHtml.length,tocEntries:d.toc.length,tables:tableCount,answerDisclosure:true});
  }
  assert((await (await fetch(base+'/chapters/03-chapter.md')).json()).chapter.bodyHtml.includes('book_tasks_update_own'));
  const articleRes=await fetch('http://127.0.0.1:8765/api/articles/supabase-rls-other-user');
  assert.equal(articleRes.status,200);
  const article=(await articleRes.json()).article;
  assert.equal(article.published,false);
  assert(article.bodyHtml.includes('<details'));
  assert(article.bodyHtml.includes('<table'));
  assert(!article.bodyHtml.includes(':::details'));
  output.articles.push({slug:'supabase-rls-other-user',status:200,published:false,htmlLength:article.bodyHtml.length,answerDisclosure:true});
  output.chapterCount=chapters.length;
  output.status='PASS';
}catch(error){output.status='FAIL';output.errors.push(error.message);process.exitCode=1;}
finally {
  server.kill('SIGTERM');
  await mkdir(new URL('./evidence/',import.meta.url),{recursive:true});
  await writeFile(new URL('./evidence/preview-report.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output,null,2));
}
