import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve('site');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!p.startsWith(root+path.sep))throw Error();const file=p.endsWith('/')?p+'index.html':p;res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();await mkdir('artifacts',{recursive:true});
try {
 for(const width of [390,320]) {
  const page=await browser.newPage({viewport:{width,height:844}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.addInitScript(()=>{if(!localStorage.getItem('chopi-chan:entries:v1'))localStorage.setItem('chopi-chan:entries:v1',JSON.stringify([{id:'fixture',title:'制度メモ（架空のテスト）',category:'手続き・制度',status:'verified',stance:'info',sources:[],tags:[],updatedAt:'2026-11-10'}]));});
  await page.goto(origin+'/index.html');await page.locator('.card').waitFor();
  assert.match(await page.locator('.freshness-note').innerText(),/未確認/);
  await page.locator('#needsAttention').check();assert.equal(await page.locator('.card').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`artifacts/list-${width}.png`,fullPage:true});
  await page.locator('.card').click();await page.locator('#detailOverlay.open').waitFor();
  assert.match(await page.locator('#detailModal').innerText(),/登録者の記録/);
  await page.screenshot({path:`artifacts/detail-${width}.png`});
  await page.getByRole('button',{name:'編集',exact:true}).click();
  await page.locator('[name=policyYear]').fill('2026年度・架空市');await page.locator('[name=reviewAfter]').fill('2026-01-01');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.reload();await page.locator('.card').waitFor();assert.match(await page.locator('.freshness-note').innerText(),/2026年度・架空市/);
  await page.locator('.card').click();await page.getByRole('button',{name:'編集',exact:true}).click();
  assert.equal(await page.locator('[name=reviewAfter]').inputValue(),'2026-01-01');
  await page.locator('[name=policyYear]').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/editor-${width}.png`});
  await page.locator('[name=policyYear]').fill('取消される変更');await page.locator('#cancelBtn').click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('chopi-chan:entries:v1'))[0]);assert.equal(saved.policyYear,'2026年度・架空市');assert.equal(saved.status,'verified');assert.deepEqual(errors,[]);
  await page.close();
 }
} finally {await browser.close();server.close();}
