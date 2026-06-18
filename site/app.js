// ちょぴちゃん フロントエンド（静的・サーバー不要 / GitHub Pages 対応）
// データはブラウザの localStorage に保存。初回のみ data/entries.json をサンプルとして読み込む。
'use strict';

// ---- 設定値（分類・語彙） ----
const META = {
  categories: [
    '妊娠中の食事', '妊娠中の生活・注意', '衛生・食中毒予防', '授乳・離乳食',
    '睡眠・ルーティン', '安全・事故予防', '健康・病気', '発達・しつけ', '手続き・制度', 'その他',
  ],
  stances: [
    { key: 'recommend', label: '推奨', hint: '積極的にやって良い／やるべき' },
    { key: 'caution', label: '注意', hint: '条件付き・気をつければOK' },
    { key: 'avoid', label: '回避', hint: '避けた方が良い' },
    { key: 'forbid', label: '禁止', hint: '明確にNG・危険' },
    { key: 'info', label: '情報', hint: '中立的な参考情報' },
  ],
  statuses: [
    { key: 'unverified', label: '未検証', hint: '出典・裏取りこれから' },
    { key: 'reviewing', label: '検証中', hint: '調査・突き合わせ中' },
    { key: 'verified', label: '検証済', hint: '信頼できる根拠を確認済' },
    { key: 'recheck', label: '要再確認', hint: '情報が古い／変わった可能性' },
    { key: 'disputed', label: '異説あり', hint: 'ソース間で見解が割れている' },
    { key: 'rejected', label: '却下', hint: '根拠が薄い／誤りと判断' },
  ],
  sourceTypes: [
    '公的機関', '医療機関・医師', '学術・論文', '専門書・書籍',
    '専門家ブログ', '一般記事・メディア', '口コミ・SNS', '人づて', 'その他',
  ],
  credibilities: [
    { key: 'high', label: '高', hint: '公的機関・査読論文・医師監修など' },
    { key: 'medium', label: '中', hint: '専門書・専門家の記事など' },
    { key: 'low', label: '低', hint: '口コミ・出典不明・人づてなど' },
  ],
  checklist: [
    { key: 'multiSource', label: '複数のソースで確認した' },
    { key: 'highCredSource', label: '信頼度「高」のソースがある' },
    { key: 'noConflict', label: 'ソース間で矛盾がない（または整理済）' },
    { key: 'dateChecked', label: '情報の鮮度（更新日）を確認した' },
    { key: 'contextOk', label: '自分の状況に当てはまるか確認した' },
  ],
};

const STORAGE_KEY = 'chopi-chan:entries:v1';
let ENTRIES = [];
let editingId = null;

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
};
const labelOf = (list, key) => (list.find((x) => x.key === key) || {}).label || key;
const now = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

// ---- ストレージ層（localStorage） ----
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ENTRIES)); }
  catch (e) { alert('保存に失敗しました（ブラウザの保存容量やプライベートモードをご確認ください）: ' + e.message); }
}
function loadStored() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

// 入力を安全な形に正規化
function normalizeEntry(input, existing = null) {
  const e = existing ? { ...existing } : {};
  const validStances = META.stances.map((s) => s.key);
  const validStatuses = META.statuses.map((s) => s.key);
  e.title = String(input.title ?? e.title ?? '').trim();
  e.category = META.categories.includes(input.category) ? input.category : (e.category || 'その他');
  e.stance = validStances.includes(input.stance) ? input.stance : (e.stance || 'info');
  e.status = validStatuses.includes(input.status) ? input.status : (e.status || 'unverified');
  e.conclusion = String(input.conclusion ?? e.conclusion ?? '').trim();
  e.detail = String(input.detail ?? e.detail ?? '');
  e.conflictNotes = String(input.conflictNotes ?? e.conflictNotes ?? '');
  e.tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : (e.tags || []);
  e.sources = Array.isArray(input.sources) ? input.sources.map((s) => ({
    title: String(s.title ?? '').trim(),
    url: String(s.url ?? '').trim(),
    type: META.sourceTypes.includes(s.type) ? s.type : 'その他',
    credibility: ['high', 'medium', 'low'].includes(s.credibility) ? s.credibility : 'medium',
    accessedDate: String(s.accessedDate ?? '').trim(),
    note: String(s.note ?? '').trim(),
  })) : (e.sources || []);
  e.checklist = (input.checklist && typeof input.checklist === 'object') ? input.checklist : (e.checklist || {});
  e.verifiedBy = String(input.verifiedBy ?? e.verifiedBy ?? '').trim();
  e.verifiedDate = String(input.verifiedDate ?? e.verifiedDate ?? '').trim();
  return e;
}

async function loadAll() {
  const stored = loadStored();
  if (stored === null) {
    // 初回：リポジトリ同梱のサンプルを読み込む
    try {
      const seed = await fetch('data/entries.json', { cache: 'no-store' }).then((r) => r.json());
      ENTRIES = Array.isArray(seed) ? seed : [];
    } catch { ENTRIES = []; }
    persist();
  } else {
    ENTRIES = Array.isArray(stored) ? stored : [];
  }
  setupFilters();
  render();
}

// ---- 検証品質の自動チェック ----
function assessVerification(entry) {
  const sources = entry.sources || [];
  const issues = [];
  if (sources.length === 0) issues.push('出典なし');
  else if (sources.length === 1) issues.push('単一ソースのみ');
  const hasHigh = sources.some((s) => s.credibility === 'high');
  if (sources.length > 0 && !hasHigh) issues.push('信頼度「高」のソースなし');
  if ((entry.conflictNotes || '').trim()) issues.push('未整理の異説あり');
  return { issues, ok: issues.length === 0 };
}
function needsAttention(entry) {
  if (['unverified', 'reviewing', 'recheck', 'disputed'].includes(entry.status)) return true;
  if (entry.status === 'verified' && !assessVerification(entry).ok) return true;
  return false;
}

// ---- フィルタ初期化 ----
function setupFilters() {
  const cat = $('#filterCategory');
  META.categories.forEach((c) => cat.appendChild(el('option', { value: c, text: c })));
  META.statuses.forEach((s) => $('#filterStatus').appendChild(el('option', { value: s.key, text: s.label })));
  META.stances.forEach((s) => $('#filterStance').appendChild(el('option', { value: s.key, text: s.label })));
  META.categories.forEach((c) => $('#f_category').appendChild(el('option', { value: c, text: c })));
  META.stances.forEach((s) => $('#f_stance').appendChild(el('option', { value: s.key, text: `${s.label}（${s.hint}）` })));
  META.statuses.forEach((s) => $('#f_status').appendChild(el('option', { value: s.key, text: `${s.label}（${s.hint}）` })));
  ['#search', '#filterCategory', '#filterStatus', '#filterStance', '#sortBy', '#needsAttention']
    .forEach((sel) => $(sel).addEventListener('input', render));
}

// ---- 統計 ----
function renderStats() {
  const box = $('#stats');
  box.innerHTML = '';
  const data = [
    { n: ENTRIES.length, l: '総件数' },
    { n: ENTRIES.filter((e) => e.status === 'verified').length, l: '検証済' },
    { n: ENTRIES.filter(needsAttention).length, l: '要対応' },
  ];
  data.forEach((d) => box.appendChild(
    el('div', { class: 'stat' }, [el('div', { class: 'n', text: String(d.n) }), el('div', { class: 'l', text: d.l })])
  ));
}

function stanceBadge(key) { return el('span', { class: `badge s-${key}`, text: labelOf(META.stances, key) }); }
function statusBadge(key) {
  return el('span', { class: `badge outline st-${key}` }, [el('span', { class: 'dot' }), labelOf(META.statuses, key)]);
}

// ---- 一覧 ----
function render() {
  renderStats();
  const q = $('#search').value.trim().toLowerCase();
  const fCat = $('#filterCategory').value, fStatus = $('#filterStatus').value, fStance = $('#filterStance').value;
  const onlyAttention = $('#needsAttention').checked, sortBy = $('#sortBy').value;

  let items = ENTRIES.filter((e) => {
    if (fCat && e.category !== fCat) return false;
    if (fStatus && e.status !== fStatus) return false;
    if (fStance && e.stance !== fStance) return false;
    if (onlyAttention && !needsAttention(e)) return false;
    if (q) {
      const hay = [e.title, e.conclusion, e.detail, (e.tags || []).join(' '),
        (e.sources || []).map((s) => s.title + ' ' + s.note).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const statusOrder = { unverified: 0, recheck: 1, disputed: 2, reviewing: 3, verified: 5, rejected: 6 };
  items.sort((a, b) => {
    if (sortBy === 'title') return a.title.localeCompare(b.title, 'ja');
    if (sortBy === 'created') return (b.createdAt || '').localeCompare(a.createdAt || '');
    if (sortBy === 'status') return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  const list = $('#list');
  list.innerHTML = '';
  if (items.length === 0) {
    list.appendChild(el('div', { class: 'empty', html: ENTRIES.length === 0
      ? 'まだ情報がありません。<br>「＋ 新規追加」から最初のメモを作りましょう。'
      : '条件に合う情報がありません。' }));
    return;
  }

  items.forEach((e) => {
    const assess = assessVerification(e);
    const top = el('div', { class: 'card-top' }, [el('h3', { text: e.title }), stanceBadge(e.stance), statusBadge(e.status)]);
    const meta = el('div', { class: 'meta-line' }, [
      el('span', { class: 'tag', text: e.category }),
      ...(e.tags || []).slice(0, 4).map((t) => el('span', { class: 'tag', text: '#' + t })),
      el('span', { text: `出典 ${(e.sources || []).length}件` }),
    ]);
    if (e.status !== 'rejected' && assess.issues.length) {
      meta.appendChild(el('span', { class: 'warn-flag', text: '⚠ ' + assess.issues.join(' / ') }));
    }
    list.appendChild(el('div', { class: 'card', onclick: () => openDetail(e.id) }, [
      top, e.conclusion ? el('div', { class: 'conclusion', text: e.conclusion }) : null, meta,
    ]));
  });
}

// ---- 詳細 ----
function openDetail(id) {
  const e = ENTRIES.find((x) => x.id === id);
  if (!e) return;
  const assess = assessVerification(e);
  const m = $('#detailModal');
  m.innerHTML = '';
  m.appendChild(el('div', { class: 'card-top' }, [
    el('h2', { text: e.title, style: 'flex:1' }), stanceBadge(e.stance), statusBadge(e.status),
  ]));
  if (e.conclusion) m.appendChild(el('div', { class: 'detail-section' }, [el('h4', { text: '要点' }), el('div', { text: e.conclusion })]));
  m.appendChild(el('div', { class: 'meta-line', style: 'margin-bottom:14px' }, [
    el('span', { class: 'tag', text: e.category }),
    ...(e.tags || []).map((t) => el('span', { class: 'tag', text: '#' + t })),
  ]));
  if (e.status !== 'rejected' && assess.issues.length) {
    m.appendChild(el('div', { class: 'health-banner' }, [`検証メモ：${assess.issues.join(' / ')}。追加のソース確認をおすすめします。`]));
  }
  if (e.detail) m.appendChild(el('div', { class: 'detail-section' }, [el('h4', { text: '詳細・背景' }), el('div', { class: 'detail-detail', text: e.detail })]));

  const srcSection = el('div', { class: 'detail-section' }, [el('h4', { text: '出典・ソース' })]);
  if ((e.sources || []).length === 0) {
    srcSection.appendChild(el('div', { class: 'verify-hint bad', text: '出典が登録されていません。' }));
  } else {
    const ul = el('ul', { class: 'src-list' });
    e.sources.forEach((s) => {
      ul.appendChild(el('li', {}, [
        el('div', {}, [
          el('span', { class: `badge outline cred-${s.credibility}`, text: '信頼度' + labelOf(META.credibilities, s.credibility) }),
          ' ', el('span', { class: 'tag', text: s.type }),
        ]),
        el('div', { style: 'margin-top:4px;font-weight:600' }, [s.title || '(無題)']),
        s.url ? el('div', {}, [el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.url })]) : null,
        s.accessedDate ? el('div', { class: 'verify-hint', text: '確認日: ' + s.accessedDate }) : null,
        s.note ? el('div', { class: 'verify-hint', text: s.note }) : null,
      ]));
    });
    srcSection.appendChild(ul);
  }
  m.appendChild(srcSection);

  const checked = META.checklist.filter((c) => e.checklist && e.checklist[c.key]);
  m.appendChild(el('div', { class: 'detail-section' }, [
    el('h4', { text: `検証チェック（${checked.length}/${META.checklist.length}）` }),
    el('div', {}, META.checklist.map((c) => el('div', {
      class: 'verify-hint' + (e.checklist && e.checklist[c.key] ? ' good' : ''),
      text: (e.checklist && e.checklist[c.key] ? '☑ ' : '☐ ') + c.label,
    }))),
  ]));

  if ((e.conflictNotes || '').trim()) {
    m.appendChild(el('div', { class: 'detail-section' }, [
      el('h4', { text: '矛盾・異説のメモ' }), el('div', { class: 'detail-detail', text: e.conflictNotes }),
    ]));
  }
  const footMeta = [];
  if (e.verifiedBy || e.verifiedDate) footMeta.push(`検証: ${e.verifiedBy || '—'} / ${e.verifiedDate || '—'}`);
  footMeta.push(`更新: ${(e.updatedAt || '').slice(0, 10)}`);
  m.appendChild(el('div', { class: 'verify-hint', style: 'margin-top:8px', text: footMeta.join('　') }));

  m.appendChild(el('div', { class: 'modal-foot' }, [
    el('button', { class: 'btn ghost', onclick: () => closeOverlay('#detailOverlay'), text: '閉じる' }),
    el('button', { class: 'btn primary', onclick: () => { closeOverlay('#detailOverlay'); openEditor(e.id); }, text: '編集' }),
  ]));
  $('#detailOverlay').classList.add('open');
}

// ---- 編集フォーム ----
function sourceRow(s = {}) {
  const typeSel = el('select', {}, META.sourceTypes.map((t) =>
    el('option', { value: t, text: t, ...(s.type === t ? { selected: 'selected' } : {}) })));
  const credSel = el('select', {}, META.credibilities.map((c) =>
    el('option', { value: c.key, text: `信頼度${c.label}`, ...(s.credibility === c.key ? { selected: 'selected' } : {}) })));
  return el('div', { class: 'source-item' }, [
    el('div', { class: 'source-head' }, [
      el('strong', { text: 'ソース', style: 'font-size:13px;color:var(--muted)' }),
      el('button', { type: 'button', class: 'btn ghost danger', style: 'padding:2px 8px', text: '×',
        onclick: (ev) => { ev.target.closest('.source-item').remove(); updateSourceHint(); } }),
    ]),
    el('input', { type: 'text', class: 'src-title', placeholder: 'ソース名（例：厚生労働省 食中毒予防）', value: s.title || '' }),
    el('input', { type: 'text', class: 'src-url', placeholder: 'URL（任意）', value: s.url || '', style: 'margin-top:8px' }),
    el('div', { class: 'row3', style: 'margin-top:8px' }, [typeSel, credSel,
      el('input', { type: 'text', class: 'src-date', placeholder: '確認日 2026-06-18', value: s.accessedDate || '' })]),
    el('input', { type: 'text', class: 'src-note', placeholder: '補足メモ（任意）', value: s.note || '', style: 'margin-top:8px' }),
  ]);
}
function gatherSources() {
  return [...document.querySelectorAll('#sourcesList .source-item')].map((row) => ({
    title: row.querySelector('.src-title').value.trim(),
    url: row.querySelector('.src-url').value.trim(),
    type: row.querySelectorAll('select')[0].value,
    credibility: row.querySelectorAll('select')[1].value,
    accessedDate: row.querySelector('.src-date').value.trim(),
    note: row.querySelector('.src-note').value.trim(),
  })).filter((s) => s.title || s.url);
}
function updateSourceHint() {
  const sources = gatherSources();
  const a = assessVerification({ sources, conflictNotes: $('#editorForm').conflictNotes.value });
  const hint = $('#sourceHint');
  if (a.ok && sources.length) { hint.className = 'verify-hint good'; hint.textContent = '✓ 検証の目安を満たしています'; }
  else { hint.className = 'verify-hint bad'; hint.textContent = sources.length ? '注意: ' + a.issues.join(' / ') : '出典を1件以上、できれば信頼度「高」を含めて2件以上登録しましょう'; }
}
function renderChecklist(values = {}) {
  const box = $('#checklist');
  box.innerHTML = '';
  META.checklist.forEach((c) => box.appendChild(el('label', {}, [
    el('input', { type: 'checkbox', 'data-key': c.key, ...(values[c.key] ? { checked: 'checked' } : {}) }), c.label,
  ])));
}
function openEditor(id = null) {
  editingId = id;
  const form = $('#editorForm');
  form.reset();
  $('#sourcesList').innerHTML = '';
  const e = id ? ENTRIES.find((x) => x.id === id) : null;
  $('#editorTitle').textContent = e ? '情報を編集' : '情報を追加';
  $('#deleteBtn').hidden = !e;
  form.title.value = e?.title || '';
  form.conclusion.value = e?.conclusion || '';
  form.category.value = e?.category || META.categories[0];
  form.stance.value = e?.stance || 'info';
  form.status.value = e?.status || 'unverified';
  form.detail.value = e?.detail || '';
  form.tags.value = (e?.tags || []).join(', ');
  form.conflictNotes.value = e?.conflictNotes || '';
  form.verifiedBy.value = e?.verifiedBy || '';
  form.verifiedDate.value = e?.verifiedDate || '';
  (e?.sources || []).forEach((s) => $('#sourcesList').appendChild(sourceRow(s)));
  renderChecklist(e?.checklist || {});
  updateSourceHint();
  $('#editorOverlay').classList.add('open');
}
function saveEntry(ev) {
  ev.preventDefault();
  const form = ev.target;
  const checklist = {};
  document.querySelectorAll('#checklist input[type=checkbox]').forEach((c) => { checklist[c.dataset.key] = c.checked; });
  const payload = {
    title: form.title.value, conclusion: form.conclusion.value,
    category: form.category.value, stance: form.stance.value, status: form.status.value,
    detail: form.detail.value,
    tags: form.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    sources: gatherSources(), checklist, conflictNotes: form.conflictNotes.value,
    verifiedBy: form.verifiedBy.value, verifiedDate: form.verifiedDate.value,
  };
  if (!payload.title.trim()) { alert('タイトルは必須です'); return; }
  if (editingId) {
    const idx = ENTRIES.findIndex((x) => x.id === editingId);
    const updated = normalizeEntry(payload, ENTRIES[idx]);
    updated.id = editingId; updated.createdAt = ENTRIES[idx].createdAt; updated.updatedAt = now();
    ENTRIES[idx] = updated;
  } else {
    const entry = normalizeEntry(payload);
    entry.id = uuid(); entry.createdAt = now(); entry.updatedAt = now();
    ENTRIES.push(entry);
  }
  persist();
  closeOverlay('#editorOverlay');
  render();
}
function deleteEntry() {
  if (!editingId) return;
  if (!confirm('この情報を削除しますか？この操作は元に戻せません。')) return;
  ENTRIES = ENTRIES.filter((e) => e.id !== editingId);
  persist();
  closeOverlay('#editorOverlay');
  render();
}
function closeOverlay(sel) { $(sel).classList.remove('open'); }

// ---- 書き出し / 読み込み ----
function exportData() {
  const blob = new Blob([JSON.stringify(ENTRIES, null, 2)], { type: 'application/json' });
  el('a', { href: URL.createObjectURL(blob), download: `chopi-chan-${new Date().toISOString().slice(0, 10)}.json` }).click();
}
async function importData(file) {
  const text = await file.text();
  let incoming;
  try { incoming = JSON.parse(text); } catch { return alert('JSONの読み込みに失敗しました'); }
  if (!Array.isArray(incoming)) return alert('配列形式のJSONを指定してください');
  const existingIds = new Set(ENTRIES.map((e) => e.id));
  let added = 0;
  for (const item of incoming) {
    if (item.id && existingIds.has(item.id)) continue;
    const entry = normalizeEntry(item);
    entry.id = item.id || uuid();
    entry.createdAt = item.createdAt || now();
    entry.updatedAt = now();
    ENTRIES.push(entry); added++;
  }
  persist();
  render();
  alert(`${added}件を読み込みました（重複IDはスキップ）`);
}

// ---- イベント ----
$('#addBtn').addEventListener('click', () => openEditor(null));
$('#cancelBtn').addEventListener('click', () => closeOverlay('#editorOverlay'));
$('#deleteBtn').addEventListener('click', deleteEntry);
$('#editorForm').addEventListener('submit', saveEntry);
$('#addSource').addEventListener('click', () => { $('#sourcesList').appendChild(sourceRow()); updateSourceHint(); });
$('#sourcesList').addEventListener('input', updateSourceHint);
$('#exportBtn').addEventListener('click', exportData);
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
[...document.querySelectorAll('.overlay')].forEach((ov) =>
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') [...document.querySelectorAll('.overlay.open')].forEach((o) => o.classList.remove('open')); });

loadAll();
