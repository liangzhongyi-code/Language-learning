/**
 * 把某個 change-id 底下的所有 markdown 文件，打包成一份可閱讀的單檔 HTML。
 *
 * 用法：
 *   node openspec/tools/build-doc-html.mjs <change-id> [輸出目錄]
 *
 * 規則（依全域偏好）：
 *   - .md 是唯一真實來源，HTML 只是閱讀副本，永遠重新產生、不手改
 *   - 深色主題、版面置中、文字靠左
 *   - 自足單檔，不引用任何外部資源
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const changeId = process.argv[2];
const outDir = process.argv[3] || 'D:\\jimmy.lzy\\IdeaProjects\\Claude計劃(html)';

if (!changeId) {
  console.error('用法：node build-doc-html.mjs <change-id> [輸出目錄]');
  process.exit(1);
}

/**
 * 進行中的變更在 changes/、完成的在 archive/。
 * 兩邊都找，歸檔之後仍然產得出閱讀版。
 */
const candidates = [
  join(REPO_ROOT, 'openspec', 'changes', changeId),
  join(REPO_ROOT, 'openspec', 'archive', changeId),
];
const changeDir = candidates.find((p) => existsSync(p));
if (!changeDir) {
  console.error(`找不到 change 目錄，已嘗試：\n  ${candidates.join('\n  ')}`);
  process.exit(1);
}
const isArchived = changeDir.includes(`${sep}archive${sep}`);

/* ── markdown → HTML（只支援本專案文件用到的語法） ───────────────────── */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 行內語法：反引號程式碼、粗體、連結。
 * 一律先跳脫 HTML，再套用格式，避免內容被當成標籤。
 */
function inline(text) {
  let out = escapeHtml(text);
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safe = href.replace(/"/g, '');
    return /^https?:\/\//.test(safe)
      ? `<a href="${safe}" target="_blank" rel="noopener">${label}</a>`
      : `<span class="ref">${label}</span>`;
  });
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');

/**
 * 表格的儲存格切割，需保留 \| 這種跳脫寫法
 */
function splitRow(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const toc = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* 程式碼區塊 */
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    /* 表格 */
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      html.push(
        `<div class="table-wrap"><table><thead><tr>${head
          .map((c) => `<th>${inline(c)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      );
      continue;
    }

    /* 標題 */
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      if (level <= 3) toc.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    /* 分隔線 */
    if (/^-{3,}\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    /* 引言 */
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${buf.map((b) => `<p>${inline(b)}</p>`).join('')}</blockquote>`);
      continue;
    }

    /* 清單 */
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let content = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        i++;
        /* 續行（縮排且非新項目）併入同一個項目 */
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          content += ' ' + lines[i].trim();
          i++;
        }
        const box = content.match(/^\[([ xX])\]\s*(.*)$/);
        items.push(
          box
            ? `<li class="task">${box[1] === ' ' ? '☐' : '☑'} ${inline(box[2])}</li>`
            : `<li>${inline(content)}</li>`
        );
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    /* 空行 */
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    /* 段落 */
    const buf = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6}\s|```|\||>|-{3,}\s*$)/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    html.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  return { html: html.join('\n'), toc };
}

/* ── 收集文件 ─────────────────────────────────────────────────────── */

/**
 * 流程狀態與文件註解來自 meta.json；缺檔時退回內建預設值
 */
const metaPath = join(changeDir, 'meta.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
const docStatus = meta.docStatus || {};
const docNote = meta.docNote || {};
const specNote = meta.specNote || {};

/**
 * 文件顯示順序。狀態值：approved / pending / draft / na
 */
const ORDER = [
  { file: 'proposal.md', title: '提案' },
  { file: 'design.md', title: '設計文件' },
  { file: 'tasks.md', title: '任務清單' },
  { file: 'review-report.md', title: '審查報告' },
];

const STATUS_LABEL = {
  approved: ['已核准', 'ok'],
  pending: ['待核准', 'warn'],
  draft: ['草稿', 'muted'],
  na: ['尚未產出', 'muted'],
};

const docs = [];

for (const entry of ORDER) {
  const p = join(changeDir, entry.file);
  if (existsSync(p)) {
    docs.push({
      id: entry.file.replace(/\.md$/, ''),
      ...entry,
      status: docStatus[entry.file] || 'draft',
      note: docNote[entry.file] || '',
      md: readFileSync(p, 'utf8'),
    });
  }
}

const specsDir = join(changeDir, 'specs');
if (existsSync(specsDir)) {
  for (const f of readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort()) {
    docs.push({
      id: 'spec-' + f.replace(/\.md$/, ''),
      file: `specs/${f}`,
      title: `規格：${f.replace(/\.md$/, '')}`,
      status: 'draft',
      note: specNote[f] || '',
      md: readFileSync(join(specsDir, f), 'utf8'),
      isSpec: true,
    });
  }
}

if (!docs.length) {
  console.error('這個 change 目錄底下沒有任何 .md 文件');
  process.exit(1);
}

/* ── 總覽頁：六階段流程圖 + 文件清單 + 規格統計 ───────────────────── */

const countOf = (md, re) => (md.match(re) || []).length;
const totalReq = docs.filter((d) => d.isSpec).reduce((n, d) => n + countOf(d.md, /^### Requirement:/gm), 0);
const totalScn = docs.filter((d) => d.isSpec).reduce((n, d) => n + countOf(d.md, /^#### Scenario:/gm), 0);
const totalTd = docs
  .filter((d) => d.id === 'design')
  .reduce((n, d) => n + countOf(d.md, /^### TD-\d+/gm), 0);

/**
 * 六階段流程圖。每個階段依 status 上不同的樣式類別，
 * 兩道人工 STOP 以虛線掛在 Phase 2 底下。
 */
function buildFlowSvg() {
  const phases = meta.phases || [];
  if (!phases.length) return '';
  const BW = 138, BH = 76, STEP = 160, X0 = 28, Y = 66;

  const boxes = phases
    .map((p, i) => {
      const x = X0 + i * STEP;
      const cls = `ph ${p.status}`;
      const mark = p.status === 'done' ? '✓' : p.status === 'current' ? '▶' : String(p.no);
      const arrow =
        i < phases.length - 1
          ? `<line class="flow-arrow" x1="${x + BW + 3}" y1="${Y + BH / 2}" x2="${
              x + STEP - 7
            }" y2="${Y + BH / 2}" marker-end="url(#ah)"/>`
          : '';
      return `${arrow}
      <g class="${cls}">
        <rect x="${x}" y="${Y}" width="${BW}" height="${BH}" rx="9"/>
        <circle class="ph-dot" cx="${x + 19}" cy="${Y + 21}" r="11"/>
        <text class="ph-no" x="${x + 19}" y="${Y + 25}" text-anchor="middle">${mark}</text>
        <text class="ph-name" x="${x + 37}" y="${Y + 26}">${escapeHtml(p.name)}</text>
        <text class="ph-detail" x="${x + 12}" y="${Y + 52}">${escapeHtml(p.detail)}</text>
      </g>`;
    })
    .join('\n');

  const gates = meta.gates || [];
  const gx = X0 + STEP - 71;
  const gateCx = X0 + STEP + BW / 2;
  const gatesSvg = gates.length
    ? `<line class="gate-link" x1="${gateCx}" y1="${Y + BH}" x2="${gateCx}" y2="182"/>
       <rect class="gate-box ${
         gates.every((g) => g.status === 'passed') ? 'passed' : ''
       }" x="${gx}" y="182" width="280" height="94" rx="9"/>
       ${gates
         .map(
           (g, i) => `
       <text class="gate-title" x="${gx + 16}" y="${208 + i * 46}">⛔ STOP ${g.no} · ${escapeHtml(
             g.name
           )}</text>
       <text class="gate-note ${g.status}" x="${gx + 16}" y="${226 + i * 46}">→ ${escapeHtml(
             g.note
           )}</text>`
         )
         .join('')}`
    : '';

  const lx = 720;
  const legend = `
    <g class="legend">
      <rect class="lg done" x="${lx}" y="196" width="11" height="11" rx="3"/>
      <text x="${lx + 19}" y="205">已完成</text>
      <rect class="lg current" x="${lx}" y="220" width="11" height="11" rx="3"/>
      <text x="${lx + 19}" y="229">進行中</text>
      <rect class="lg todo" x="${lx}" y="244" width="11" height="11" rx="3"/>
      <text x="${lx + 19}" y="253">未開始</text>
    </g>`;

  return `<svg class="flow" viewBox="0 0 1000 292" role="img" aria-label="spec-powers 六階段流程">
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,0 L10,5 L0,10 z"/>
      </marker>
    </defs>
    <text class="flow-cap" x="28" y="34">spec-powers 六階段 · 目前進度</text>
    ${boxes}
    ${gatesSvg}
    ${legend}
  </svg>`;
}

const docCards = docs
  .map((d) => {
    const [label, tone] = STATUS_LABEL[d.status] || STATUS_LABEL.draft;
    const reqs = d.isSpec ? countOf(d.md, /^### Requirement:/gm) : 0;
    const scns = d.isSpec ? countOf(d.md, /^#### Scenario:/gm) : 0;
    const stat = d.isSpec ? `<span class="card-stat">${reqs} Requirement · ${scns} Scenario</span>` : '';
    return `<a class="card" href="#" data-doc="${d.id}">
      <div class="card-top">
        <span class="card-title">${escapeHtml(d.title)}</span>
        <span class="badge ${tone}">${label}</span>
      </div>
      <div class="card-note">${escapeHtml(d.note || '')}</div>
      ${stat}
    </a>`;
  })
  .join('');

const overviewHtml = `
  <h1>總覽</h1>
  <p>本頁是這份規格的入口。左側可切換到各份文件，或直接點下方卡片。</p>
  <div class="flow-wrap">${buildFlowSvg()}</div>
  <h2 id="規格規模">規格規模</h2>
  <div class="kpis">
    <div class="kpi"><b>${docs.length}</b><span>份文件</span></div>
    <div class="kpi"><b>${totalReq}</b><span>條 Requirement</span></div>
    <div class="kpi"><b>${totalScn}</b><span>個 Scenario</span></div>
    <div class="kpi"><b>${totalTd}</b><span>個技術決策</span></div>
  </div>
  <p class="kpi-note">每個 Scenario 在 Phase 3 都會對應到一個測試或一項人工 QA 檢查，
  這是 <code>tasks.md</code> 的拆解依據。</p>
  <h2 id="文件清單">文件清單</h2>
  <div class="cards">${docCards}</div>`;

docs.unshift({
  id: 'overview',
  file: '（本頁由 meta.json 與各文件自動產生）',
  title: '總覽',
  status: 'approved',
  rawHtml: overviewHtml,
  toc: [],
  isOverview: true,
});

/* ── 組出 HTML ────────────────────────────────────────────────────── */

const rendered = docs.map((d) =>
  d.rawHtml ? { ...d, html: d.rawHtml, toc: d.toc || [] } : { ...d, ...renderMarkdown(d.md) }
);

const now = new Date(process.env.BUILD_DATE || Date.now());
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const readableDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const navHtml = rendered
  .map((d) => {
    const [label, tone] = d.isOverview ? ['入口', 'ok'] : STATUS_LABEL[d.status] || STATUS_LABEL.draft;
    const sub = d.toc
      .filter((t) => t.level === 2)
      .map((t) => `<a class="sub" href="#" data-doc="${d.id}" data-anchor="${t.id}">${escapeHtml(t.text)}</a>`)
      .join('');
    return `<div class="nav-group">
      <a class="nav-item" href="#" data-doc="${d.id}">
        <span class="nav-title">${escapeHtml(d.title)}</span>
        <span class="badge ${tone}">${label}</span>
      </a>
      <div class="nav-subs">${sub}</div>
    </div>`;
  })
  .join('');

const docsHtml = rendered
  .map(
    (d) => `<article class="doc" id="doc-${d.id}" hidden>
      <div class="doc-meta">${
        d.isOverview
          ? escapeHtml(d.file)
          : `原始檔：<code>openspec/${isArchived ? 'archive' : 'changes'}/${changeId}/${d.file}</code>`
      }</div>
      ${d.html}
    </article>`
  )
  .join('\n');

const title = process.env.DOC_TITLE || '語言學習網站 規格文件';

const page = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{
  --bg:#0e1116; --bg-2:#151a21; --bg-3:#1c232c;
  --fg:#e6edf3; --fg-dim:#9fb0c0; --fg-mute:#6e7f90;
  --line:#252d38; --line-2:#323c49;
  --accent:#5eb3f6; --accent-dim:#2b5f88;
  --ok:#57c98a; --warn:#e0b341; --danger:#f0736a;
  --mono:ui-monospace,"Cascadia Code","Consolas","Noto Sans Mono CJK TC",monospace;
  --sans:"Segoe UI","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--fg);
  font-family:var(--sans); font-size:16px; line-height:1.75;
  -webkit-font-smoothing:antialiased;
}
a{color:var(--accent); text-decoration:none}
a:hover{text-decoration:underline}

/* 版面：整體置中，內容靠左 */
.shell{max-width:1280px; margin:0 auto; display:flex; gap:32px; padding:0 24px; align-items:flex-start}

/* 側欄 */
.sidebar{
  position:sticky; top:0; width:270px; flex:0 0 270px;
  max-height:100vh; overflow-y:auto; padding:28px 0 40px;
}
.brand{font-size:15px; font-weight:600; letter-spacing:.02em; margin-bottom:4px}
.brand small{display:block; font-weight:400; color:var(--fg-mute); font-size:12px; margin-top:6px; line-height:1.6}
.meta-box{
  background:var(--bg-2); border:1px solid var(--line); border-radius:8px;
  padding:10px 12px; margin:16px 0 20px; font-size:12px; color:var(--fg-dim); line-height:1.9;
}
.meta-box b{color:var(--fg); font-weight:600}
.meta-box code{font-size:11.5px}
.nav-group{margin-bottom:2px}
.nav-item{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:8px 10px; border-radius:6px; color:var(--fg-dim); font-size:14px;
}
.nav-item:hover{background:var(--bg-2); color:var(--fg); text-decoration:none}
.nav-item.active{background:var(--accent-dim); color:#fff}
.nav-item.active .badge{background:rgba(255,255,255,.16); color:#fff}
.nav-title{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.badge{
  flex:0 0 auto; font-size:10.5px; padding:1px 6px; border-radius:10px;
  background:var(--bg-3); color:var(--fg-mute); border:1px solid var(--line-2);
}
.badge.ok{color:var(--ok); border-color:#2c5f45}
.badge.warn{color:var(--warn); border-color:#6b5620}
.nav-subs{display:none; padding:2px 0 6px 10px; border-left:1px solid var(--line); margin-left:12px}
.nav-group.open .nav-subs{display:block}
.nav-subs .sub{
  display:block; padding:4px 8px; font-size:12.5px; color:var(--fg-mute);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.nav-subs .sub:hover{color:var(--accent); text-decoration:none}
.hint{margin-top:22px; padding:10px 12px; border-radius:8px; background:var(--bg-2);
  border:1px solid var(--line); font-size:11.5px; color:var(--fg-mute); line-height:1.8}

/* 內容 */
main{flex:1 1 auto; min-width:0; padding:28px 0 96px; max-width:820px}
.doc-meta{
  font-size:12px; color:var(--fg-mute); padding:8px 12px; margin-bottom:24px;
  background:var(--bg-2); border:1px solid var(--line); border-radius:6px;
}
h1,h2,h3,h4,h5,h6{line-height:1.4; font-weight:650; scroll-margin-top:20px}
h1{font-size:28px; margin:8px 0 24px; padding-bottom:14px; border-bottom:1px solid var(--line-2)}
h2{font-size:21px; margin:44px 0 16px; padding-bottom:8px; border-bottom:1px solid var(--line)}
h3{font-size:17.5px; margin:32px 0 12px; color:#cfe3f5}
h4{font-size:15.5px; margin:24px 0 8px; color:var(--fg-dim)}
p{margin:0 0 14px}
ul,ol{margin:0 0 14px; padding-left:24px}
li{margin:5px 0}
li.task{list-style:none; margin-left:-20px}
strong{color:#fff; font-weight:650}
hr{border:0; border-top:1px solid var(--line); margin:36px 0}
blockquote{
  margin:16px 0; padding:10px 16px; border-left:3px solid var(--accent-dim);
  background:var(--bg-2); border-radius:0 6px 6px 0; color:var(--fg-dim);
}
blockquote p:last-child{margin-bottom:0}
code{
  font-family:var(--mono); font-size:13px; background:var(--bg-3);
  padding:1.5px 5px; border-radius:4px; color:#a5d6ff; word-break:break-word;
}
pre{
  background:var(--bg-2); border:1px solid var(--line); border-radius:8px;
  padding:14px 16px; overflow-x:auto; margin:0 0 18px;
}
pre code{background:none; padding:0; color:var(--fg-dim); font-size:12.5px; line-height:1.6; white-space:pre}
.table-wrap{overflow-x:auto; margin:0 0 18px; border:1px solid var(--line); border-radius:8px}
table{border-collapse:collapse; width:100%; font-size:14px}
th,td{padding:8px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top}
th{background:var(--bg-3); font-weight:600; white-space:nowrap}
tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--bg-2)}
.ref{color:var(--accent); border-bottom:1px dotted var(--accent-dim)}

/* ── 總覽頁：流程圖 ── */
.flow-wrap{
  background:var(--bg-2); border:1px solid var(--line); border-radius:10px;
  padding:8px 4px; margin:24px 0 8px; overflow-x:auto;
}
svg.flow{display:block; width:100%; min-width:760px; height:auto}
svg.flow text{font-family:var(--sans); fill:var(--fg-dim)}
.flow-cap{font-size:13px; fill:var(--fg-mute); letter-spacing:.04em}
.flow-arrow{stroke:var(--line-2); stroke-width:1.5}
#ah path{fill:var(--line-2)}
.ph rect{fill:var(--bg-3); stroke:var(--line-2); stroke-width:1}
.ph-dot{fill:var(--line-2)}
.ph-no{font-size:11.5px; font-weight:700; fill:var(--bg)}
.ph-name{font-size:14px; font-weight:650; fill:var(--fg)}
.ph-detail{font-size:11.5px; fill:var(--fg-mute)}
.ph.done rect{fill:#132a1e; stroke:#2c5f45}
.ph.done .ph-dot{fill:var(--ok)}
.ph.done .ph-name{fill:#b9e8cd}
.ph.current rect{fill:#12283a; stroke:var(--accent); stroke-width:1.8}
.ph.current .ph-dot{fill:var(--accent)}
.ph.current .ph-name{fill:#cfe8ff}
.ph.todo rect{fill:var(--bg-2); stroke:var(--line)}
.ph.todo .ph-name{fill:var(--fg-mute)}
.ph.todo .ph-detail{fill:#55636f}
.gate-link{stroke:var(--warn); stroke-width:1.2; stroke-dasharray:3 3}
.gate-box{fill:#241d0e; stroke:#6b5620; stroke-width:1; stroke-dasharray:4 3}
.gate-title{font-size:12px; font-weight:600; fill:#f2d692}
.gate-note{font-size:11.5px; fill:var(--fg-mute)}
.gate-note.pending{fill:var(--warn)}
.gate-note.passed{fill:var(--ok)}
.gate-box.passed{fill:#132a1e; stroke:#2c5f45}
.legend text{font-size:11.5px; fill:var(--fg-mute)}
.lg.done{fill:var(--ok)} .lg.current{fill:var(--accent)} .lg.todo{fill:var(--line-2)}

/* ── 總覽頁：統計與卡片 ── */
.kpis{display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:18px 0 10px}
.kpi{background:var(--bg-2); border:1px solid var(--line); border-radius:9px; padding:14px 12px}
.kpi b{display:block; font-size:26px; line-height:1.2; color:var(--accent); font-weight:700}
.kpi span{font-size:12px; color:var(--fg-mute)}
.kpi-note{font-size:13px; color:var(--fg-mute)}
.cards{display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin:18px 0}
.card{
  display:block; background:var(--bg-2); border:1px solid var(--line);
  border-radius:9px; padding:13px 15px; color:var(--fg);
}
.card:hover{border-color:var(--accent-dim); background:var(--bg-3); text-decoration:none}
.card-top{display:flex; align-items:center; justify-content:space-between; gap:8px}
.card-title{font-weight:650; font-size:14.5px}
.card-note{font-size:12.5px; color:var(--fg-mute); margin-top:5px; line-height:1.65}
.card-stat{display:inline-block; margin-top:8px; font-size:11px; color:var(--accent);
  background:rgba(94,179,246,.09); border:1px solid var(--accent-dim); padding:1px 7px; border-radius:10px}

@media (max-width:900px){
  .kpis{grid-template-columns:repeat(2,1fr)}
  .cards{grid-template-columns:1fr}
  .shell{flex-direction:column; gap:0; padding:0 16px}
  .sidebar{position:static; width:100%; flex:none; max-height:none; padding:20px 0 8px}
  .nav-group{display:inline-block; margin-right:6px}
  .nav-subs{display:none!important}
  main{padding-top:12px; max-width:100%}
  h1{font-size:24px} h2{font-size:19px}
}
</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      ${escapeHtml(title)}
      <small>spec-powers 完整模式 · 閱讀版</small>
    </div>
    <div class="meta-box">
      <div>change-id：<b>${escapeHtml(changeId)}</b></div>
      <div>分支：<code>feature/${escapeHtml(changeId)}</code></div>
      <div>產生日期：<b>${readableDate}</b></div>
    </div>
    <nav id="nav">${navHtml}</nav>
    <div class="hint">
      本頁為閱讀副本，<b>不是</b>修改對象。<br>
      原始 md 位於 <code>openspec/${isArchived ? 'archive' : 'changes'}/${escapeHtml(changeId)}/</code>，
      修改請改 md 原檔，再重新執行<br>
      <code>node openspec/tools/build-doc-html.mjs ${escapeHtml(changeId)}</code>
    </div>
  </aside>
  <main id="main">${docsHtml}</main>
</div>
<script>
(function(){
  var nav = document.getElementById('nav');
  var items = Array.prototype.slice.call(nav.querySelectorAll('.nav-item'));

  function show(id, anchor){
    Array.prototype.forEach.call(document.querySelectorAll('.doc'), function(d){
      d.hidden = (d.id !== 'doc-' + id);
    });
    items.forEach(function(a){
      var on = a.dataset.doc === id;
      a.classList.toggle('active', on);
      a.parentNode.classList.toggle('open', on);
    });
    if (anchor) {
      var el = document.getElementById(anchor);
      if (el) { el.scrollIntoView({behavior:'smooth', block:'start'}); return; }
    }
    window.scrollTo({top:0, behavior:'smooth'});
    if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  }

  /* 側欄與總覽卡片共用同一套切換 */
  document.addEventListener('click', function(e){
    var a = e.target.closest('a[data-doc]');
    if (!a) return;
    e.preventDefault();
    show(a.dataset.doc, a.dataset.anchor);
  });

  var first = items[0] && items[0].dataset.doc;
  var want = location.hash.slice(1);
  show(document.getElementById('doc-' + want) ? want : first);
})();
</script>
</body>
</html>`;

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outName = `${process.env.DOC_SLUG || '語言學習網站規格'}_${stamp}.html`;
const outPath = join(outDir, outName);
writeFileSync(outPath, page, 'utf8');
console.log(`已產出：${outPath}`);
console.log(`收錄文件 ${rendered.length} 份：${rendered.map((d) => d.file).join(', ')}`);
