// ちょぴちゃん フロントエンド（フレームワークなし）
'use strict';

let META = null;
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const labelOf = (list, key) => (list.find((x) => x.key === key) || {}).label || key;

// ---- API ----
async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

async function loadAll() {
  [META, ENTRIES] = await Promise.all([api('/api/meta'), api('/api/entries')]);
  setupFilters();
  render();
}

// ---- 検証品質の判定（ワークフローの自動チェック） ----
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

// 「要対応」= 未検証/検証中/要再確認/異説あり、または品質に問題あり
function needsAttention(entry) {
  if (['unverified', 'reviewing', 'recheck', 'disputed'].includes(entry.status)) return true;
  if (entry.status === 'verified' && !assessVerification(entry).ok) return true;
  return false;
}

// ---- フィルタ初期化 ----
function setupFilters() {
  const cat = $('#filterCategory');
  META.categories.forEach((c) => cat.appendChild(el('option', { value: c, text: c })));
  const st = $('#filterStatus');
  META.statuses.forEach((s) => st.appendChild(el('option', { value: s.key, text: s.label })));
  const sn = $('#filterStance');
  META.stances.forEach((s) => sn.appendChild(el('option', { value: s.key, text: s.label })));

  // 編集フォームのセレクト
  const fc = $('#f_category');
  META.categories.forEach((c) => fc.appendChild(el('option', { value: c, text: c })));
  const fs = $('#f_stance');
  META.stances.forEach((s) => fs.appendChild(el('option', { value: s.key, text: `${s.label}（${s.hint}）` })));
  const fst = $('#f_status');
  META.statuses.forEach((s) => fst.appendChild(el('option', { value: s.key, text: `${s.label}（${s.hint}）` })));

  ['#search', '#filterCategory', '#filterStatus', '#filterStance', '#sortBy', '#needsAttention']
    .forEach((sel) => $(sel).addEventListener('input', render));
}

// ---- 統計 ----
function renderStats() {
  const box = $('#stats');
  box.innerHTML = '';
  const total = ENTRIES.length;
  const verified = ENTRIES.filter((e) => e.status === 'verified').length;
  const attention = ENTRIES.filter(needsAttention).length;
  const data = [
    { n: total, l: '総件数' },
    { n: verified, l: '検証済' },
    { n: attention, l: '要対応' },
  ];
  data.forEach((d) => box.appendChild(
    el('div', { class: 'stat' }, [el('div', { class: 'n', text: String(d.n) }), el('div', { class: 'l', text: d.l })])
  ));
}

// ---- バッジ生成 ----
function stanceBadge(key) {
  return el('span', { class: `badge s-${key}`, text: labelOf(META.stances, key) });
}
function statusBadge(key) {
  return el('span', { class: `badge outline st-${key}` }, [
    el('span', { class: 'dot' }), labelOf(META.statuses, key),
  ]);
}

// ---- 一覧描画 ----
function render() {
  renderStats();
  const q = $('#search').value.trim().toLowerCase();
  const fCat = $('#filterCategory').value;
  const fStatus = $('#filterStatus').value;
  const fStance = $('#filterStance').value;
  const onlyAttention = $('#needsAttention').checked;
  const sortBy = $('#sortBy').value;

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
    const top = el('div', { class: 'card-top' }, [
      el('h3', { text: e.title }),
      stanceBadge(e.stance),
      statusBadge(e.status),
    ]);
    const meta = el('div', { class: 'meta-line' }, [
      el('span', { class: 'tag', text: e.category }),
      ...(e.tags || []).slice(0, 4).map((t) => el('span', { class: 'tag', text: '#' + t })),
      el('span', { text: `出典 ${ (e.sources || []).length }件` }),
    ]);
    if (e.status !== 'rejected' && assess.issues.length) {
      meta.appendChild(el('span', { class: 'warn-flag', text: '⚠ ' + assess.issues.join(' / ') }));
    }
    const card = el('div', { class: 'card', onclick: () => openDetail(e.id) }, [
      top,
      e.conclusion ? el('div', { class: 'conclusion', text: e.conclusion }) : null,
      meta,
    ]);
    list.appendChild(card);
  });
}

// ---- 詳細表示 ----
function openDetail(id) {
  const e = ENTRIES.find((x) => x.id === id);
  if (!e) return;
  const assess = assessVerification(e);
  const m = $('#detailModal');
  m.innerHTML = '';

  m.appendChild(el('div', { class: 'card-top' }, [
    el('h2', { text: e.title, style: 'flex:1' }),
    stanceBadge(e.stance),
    statusBadge(e.status),
  ]));

  if (e.conclusion) {
    m.appendChild(el('div', { class: 'detail-section' }, [
      el('h4', { text: '要点' }), el('div', { text: e.conclusion }),
    ]));
  }

  m.appendChild(el('div', { class: 'meta-line', style: 'margin-bottom:14px' }, [
    el('span', { class: 'tag', text: e.category }),
    ...(e.tags || []).map((t) => el('span', { class: 'tag', text: '#' + t })),
  ]));

  if (e.status !== 'rejected' && assess.issues.length) {
    m.appendChild(el('div', { class: 'health-banner' },
      [`検証メモ：${assess.issues.join(' / ')}。追加のソース確認をおすすめします。`]));
  }

  if (e.detail) {
    m.appendChild(el('div', { class: 'detail-section' }, [
      el('h4', { text: '詳細・背景' }), el('div', { class: 'detail-detail', text: e.detail }),
    ]));
  }

  // ソース
  const srcSection = el('div', { class: 'detail-section' }, [el('h4', { text: '出典・ソース' })]);
  if ((e.sources || []).length === 0) {
    srcSection.appendChild(el('div', { class: 'verify-hint bad', text: '出典が登録されていません。' }));
  } else {
    const ul = el('ul', { class: 'src-list' });
    e.sources.forEach((s) => {
      const head = el('div', {}, [
        el('span', { class: `badge outline cred-${s.credibility}`, text: '信頼度' + labelOf(META.credibilities, s.credibility) }),
        ' ',
        el('span', { class: 'tag', text: s.type }),
      ]);
      const li = el('li', {}, [
        head,
        el('div', { style: 'margin-top:4px;font-weight:600' }, [s.title || '(無題)']),
        s.url ? el('div', {}, [el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.url })]) : null,
        s.accessedDate ? el('div', { class: 'verify-hint', text: '確認日: ' + s.accessedDate }) : null,
        s.note ? el('div', { class: 'verify-hint', text: s.note }) : null,
      ]);
      ul.appendChild(li);
    });
    srcSection.appendChild(ul);
  }
  m.appendChild(srcSection);

  // チェックリスト
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
      el('h4', { text: '矛盾・異説のメモ' }),
      el('div', { class: 'detail-detail', text: e.conflictNotes }),
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
  const wrap = el('div', { class: 'source-item' }, [
    el('div', { class: 'source-head' }, [
      el('strong', { text: 'ソース', style: 'font-size:13px;color:var(--muted)' }),
      el('button', { type: 'button', class: 'btn ghost danger', style: 'padding:2px 8px', text: '×',
        onclick: (ev) => ev.target.closest('.source-item').remove() }),
    ]),
    el('input', { type: 'text', class: 'src-title', placeholder: 'ソース名（例：厚生労働省 食中毒予防）', value: s.title || '' }),
    el('input', { type: 'text', class: 'src-url', placeholder: 'URL（任意）', value: s.url || '', style: 'margin-top:8px' }),
    el('div', { class: 'row3', style: 'margin-top:8px' }, [typeSel, credSel,
      el('input', { type: 'text', class: 'src-date', placeholder: '確認日 2026-06-18', value: s.accessedDate || '' })]),
    el('input', { type: 'text', class: 'src-note', placeholder: '補足メモ（任意）', value: s.note || '', style: 'margin-top:8px' }),
  ]);
  wrap._selects = { typeSel, credSel };
  return wrap;
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
  const tmp = { sources, conflictNotes: $('#editorForm').conflictNotes.value };
  const a = assessVerification(tmp);
  const hint = $('#sourceHint');
  if (a.ok && sources.length) { hint.className = 'verify-hint good'; hint.textContent = '✓ 検証の目安を満たしています'; }
  else { hint.className = 'verify-hint bad'; hint.textContent = sources.length ? '注意: ' + a.issues.join(' / ') : '出典を1件以上、できれば信頼度「高」を含めて2件以上登録しましょう'; }
}

function renderChecklist(values = {}) {
  const box = $('#checklist');
  box.innerHTML = '';
  META.checklist.forEach((c) => {
    box.appendChild(el('label', {}, [
      el('input', { type: 'checkbox', 'data-key': c.key, ...(values[c.key] ? { checked: 'checked' } : {}) }),
      c.label,
    ]));
  });
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

async function saveEntry(ev) {
  ev.preventDefault();
  const form = ev.target;
  const checklist = {};
  document.querySelectorAll('#checklist input[type=checkbox]').forEach((c) => { checklist[c.dataset.key] = c.checked; });
  const payload = {
    title: form.title.value, conclusion: form.conclusion.value,
    category: form.category.value, stance: form.stance.value, status: form.status.value,
    detail: form.detail.value,
    tags: form.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    sources: gatherSources(), checklist,
    conflictNotes: form.conflictNotes.value,
    verifiedBy: form.verifiedBy.value, verifiedDate: form.verifiedDate.value,
  };
  try {
    if (editingId) await api(`/api/entries/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/entries', { method: 'POST', body: JSON.stringify(payload) });
    closeOverlay('#editorOverlay');
    ENTRIES = await api('/api/entries');
    render();
  } catch (err) { alert('保存に失敗しました: ' + err.message); }
}

async function deleteEntry() {
  if (!editingId) return;
  if (!confirm('この情報を削除しますか？この操作は元に戻せません。')) return;
  await api(`/api/entries/${editingId}`, { method: 'DELETE' });
  closeOverlay('#editorOverlay');
  ENTRIES = await api('/api/entries');
  render();
}

function closeOverlay(sel) { $(sel).classList.remove('open'); }

// ---- 書き出し / 読み込み ----
function exportData() {
  const blob = new Blob([JSON.stringify(ENTRIES, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `chopi-chan-${new Date().toISOString().slice(0,10)}.json` });
  a.click();
}

async function importData(file) {
  const text = await file.text();
  let incoming;
  try { incoming = JSON.parse(text); } catch { return alert('JSONの読み込みに失敗しました'); }
  if (!Array.isArray(incoming)) return alert('配列形式のJSONを指定してください');
  const existingIds = new Set(ENTRIES.map((e) => e.id));
  let added = 0;
  for (const item of incoming) {
    if (item.id && existingIds.has(item.id)) continue; // 既存はスキップ
    const { id, createdAt, updatedAt, ...rest } = item;
    await api('/api/entries', { method: 'POST', body: JSON.stringify(rest) });
    added++;
  }
  ENTRIES = await api('/api/entries');
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

loadAll().catch((e) => alert('読み込みエラー: ' + e.message));
