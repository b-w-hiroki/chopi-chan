// chopi-chan — 子育て・妊娠ナレッジベース ローカルサーバー
// 依存パッケージなし（Node標準モジュールのみ）。`node server.js` で起動。
import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');

// ---- 設定値（フロントとAPIで共有する語彙） ----------------------------------
const META = {
  // 情報の分類
  categories: [
    '妊娠中の食事',
    '妊娠中の生活・注意',
    '衛生・食中毒予防',
    '授乳・離乳食',
    '睡眠・ルーティン',
    '安全・事故予防',
    '健康・病気',
    '発達・しつけ',
    '手続き・制度',
    'その他',
  ],
  // 推奨度（結論のタイプ）
  stances: [
    { key: 'recommend', label: '推奨', hint: '積極的にやって良い／やるべき' },
    { key: 'caution', label: '注意', hint: '条件付き・気をつければOK' },
    { key: 'avoid', label: '回避', hint: '避けた方が良い' },
    { key: 'forbid', label: '禁止', hint: '明確にNG・危険' },
    { key: 'info', label: '情報', hint: '中立的な参考情報' },
  ],
  // 検証ステータス（ワークフロー）
  statuses: [
    { key: 'unverified', label: '未検証', hint: '出典・裏取りこれから' },
    { key: 'reviewing', label: '検証中', hint: '調査・突き合わせ中' },
    { key: 'verified', label: '検証済', hint: '信頼できる根拠を確認済' },
    { key: 'recheck', label: '要再確認', hint: '情報が古い／変わった可能性' },
    { key: 'disputed', label: '異説あり', hint: 'ソース間で見解が割れている' },
    { key: 'rejected', label: '却下', hint: '根拠が薄い／誤りと判断' },
  ],
  // ソースの種類
  sourceTypes: [
    '公的機関', '医療機関・医師', '学術・論文', '専門書・書籍',
    '専門家ブログ', '一般記事・メディア', '口コミ・SNS', '人づて', 'その他',
  ],
  // ソースの信頼度
  credibilities: [
    { key: 'high', label: '高', hint: '公的機関・査読論文・医師監修など' },
    { key: 'medium', label: '中', hint: '専門書・専門家の記事など' },
    { key: 'low', label: '低', hint: '口コミ・出典不明・人づてなど' },
  ],
  // 検証チェックリスト（ワークフローの確認項目）
  checklist: [
    { key: 'multiSource', label: '複数のソースで確認した' },
    { key: 'highCredSource', label: '信頼度「高」のソースがある' },
    { key: 'noConflict', label: 'ソース間で矛盾がない（または整理済）' },
    { key: 'dateChecked', label: '情報の鮮度（更新日）を確認した' },
    { key: 'contextOk', label: '自分の状況に当てはまるか確認した' },
  ],
};

// ---- データ層 ---------------------------------------------------------------
async function ensureData() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(ENTRIES_FILE)) await writeFile(ENTRIES_FILE, '[]\n', 'utf8');
}

async function readEntries() {
  const raw = await readFile(ENTRIES_FILE, 'utf8');
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// 破損防止のため一時ファイルに書いてから差し替える（アトミック保存）
async function writeEntries(entries) {
  const tmp = ENTRIES_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  await rename(tmp, ENTRIES_FILE);
}

function now() {
  return new Date().toISOString();
}

// 入力を安全な形に正規化（不正な値で壊れないように）
function normalizeEntry(input, existing = null) {
  const e = existing ? { ...existing } : {};
  const validStances = META.stances.map((s) => s.key);
  const validStatuses = META.statuses.map((s) => s.key);

  e.title = String(input.title ?? e.title ?? '').trim();
  e.category = String(input.category ?? e.category ?? 'その他');
  e.stance = validStances.includes(input.stance) ? input.stance : (e.stance || 'info');
  e.status = validStatuses.includes(input.status) ? input.status : (e.status || 'unverified');
  e.conclusion = String(input.conclusion ?? e.conclusion ?? '').trim();
  e.detail = String(input.detail ?? e.detail ?? '');
  e.conflictNotes = String(input.conflictNotes ?? e.conflictNotes ?? '');

  e.tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).trim()).filter(Boolean)
    : (e.tags || []);

  e.sources = Array.isArray(input.sources)
    ? input.sources.map((s) => ({
        title: String(s.title ?? '').trim(),
        url: String(s.url ?? '').trim(),
        type: META.sourceTypes.includes(s.type) ? s.type : 'その他',
        credibility: ['high', 'medium', 'low'].includes(s.credibility) ? s.credibility : 'medium',
        accessedDate: String(s.accessedDate ?? '').trim(),
        note: String(s.note ?? '').trim(),
      }))
    : (e.sources || []);

  e.checklist = (input.checklist && typeof input.checklist === 'object')
    ? input.checklist
    : (e.checklist || {});

  e.verifiedBy = String(input.verifiedBy ?? e.verifiedBy ?? '').trim();
  e.verifiedDate = String(input.verifiedDate ?? e.verifiedDate ?? '').trim();

  return e;
}

// ---- HTTP ユーティリティ ----------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // ディレクトリトラバーサル防止
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const buf = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

// ---- API ルーティング -------------------------------------------------------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'entries', ':id?']

  if (parts[1] === 'meta' && req.method === 'GET') {
    return sendJson(res, 200, META);
  }

  if (parts[1] === 'entries') {
    const id = parts[2];

    if (req.method === 'GET' && !id) {
      const entries = await readEntries();
      return sendJson(res, 200, entries);
    }

    if (req.method === 'POST' && !id) {
      const input = await readBody(req);
      const entries = await readEntries();
      const entry = normalizeEntry(input);
      if (!entry.title) return sendJson(res, 400, { error: 'タイトルは必須です' });
      entry.id = crypto.randomUUID();
      entry.createdAt = now();
      entry.updatedAt = now();
      entries.push(entry);
      await writeEntries(entries);
      return sendJson(res, 201, entry);
    }

    if (req.method === 'PUT' && id) {
      const input = await readBody(req);
      const entries = await readEntries();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      const updated = normalizeEntry(input, entries[idx]);
      if (!updated.title) return sendJson(res, 400, { error: 'タイトルは必須です' });
      updated.id = id;
      updated.createdAt = entries[idx].createdAt;
      updated.updatedAt = now();
      entries[idx] = updated;
      await writeEntries(entries);
      return sendJson(res, 200, updated);
    }

    if (req.method === 'DELETE' && id) {
      const entries = await readEntries();
      const next = entries.filter((e) => e.id !== id);
      if (next.length === entries.length) return sendJson(res, 404, { error: 'not found' });
      await writeEntries(next);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: 'unknown endpoint' });
}

// ---- サーバー本体 -----------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res);
    }
  } catch (err) {
    sendJson(res, 400, { error: String(err.message || err) });
  }
});

await ensureData();
server.listen(PORT, HOST, () => {
  console.log(`\n  🍙 chopi-chan が起動しました`);
  console.log(`  → ブラウザで開いてください: http://${HOST}:${PORT}\n`);
});
