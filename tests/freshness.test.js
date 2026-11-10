import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../site/freshness.js';
const {assess, validDate} = globalThis.ChopiFreshness;
test('missing dates are not inferred from modification date', () => {
 assert.match(assess({updatedAt:'2026-11-10'}).summary, /未確認/);
});
test('calendar validation rejects overflow and accepts leap day', () => {
 for (const d of ['2026-02-30','2026-13-01','abc','2025-02-29']) assert.equal(validDate(d),false);
 assert.equal(validDate('2024-02-29'),true);
});
test('future check cannot imply verified currency', () => {
 assert.match(assess({verifiedDate:'2026-11-11'},'2026-11-10').issues.join(),/未来/);
});
test('expiry starts after inclusive deadline', () => {
 const e={verifiedDate:'2026-11-01',reviewAfter:'2026-11-10'};
 assert.equal(assess(e,'2026-11-10').issues.length,0);
 assert.match(assess(e,'2026-11-11').issues.join(),/超過/);
});
test('policy applicability remains unknown unless entered', () => {
 assert.match(assess({category:'手続き・制度'}).summary,/適用年度・地域: 未確認/);
 assert.match(assess({category:'手続き・制度',policyYear:'2026年度・東京都'}).summary,/2026年度・東京都/);
});
test('metadata analysis never modifies stored verification status', () => {
 const e={status:'verified',verifiedDate:'2026-01-01',reviewAfter:'2026-02-01'}; const before=JSON.stringify(e);
 assess(e,'2026-11-10'); assert.equal(JSON.stringify(e),before);
});
test('form, normalizer, detail and script wiring stay present', () => {
 const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
 for(const name of ['policyYear','reviewAfter']) {assert.match(html,new RegExp('name="'+name+'"')); assert.match(app,new RegExp('e\\.'+name+' ='));}
 assert.ok(html.indexOf('freshness.js')<html.indexOf('app.js'));
 assert.match(app,/内容の確認日ではありません/);
 assert.match(app,/ChopiFreshness.assess\(entry\).issues.length/);
});
