// 奖池台账 + 发布套目录实况。面板和以后的校验共用这一份，不改 prizePool.js。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'tools', 'prize-pairs.json');
const PROMPTS = path.join(ROOT, 'tools', 'prompts-good-p2.json');
const JOB = path.join(ROOT, 'tools', 'prize-job.json');
const UPLOADS = path.join(ROOT, 'tools', 'prize-uploads');
const RELEASE_DIR = path.join(ROOT, 'prototype', 'assets', 'prizes-good-p2');

export function loadPrizeLedger() {
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

function glbStat(id) {
  const file = `${id}.glb`;
  const abs = path.join(RELEASE_DIR, file);
  if (!fs.existsSync(abs)) return { id, file, exists: false, bytes: 0 };
  return { id, file, exists: true, bytes: fs.statSync(abs).size };
}

function itemStatus(memoryId, rotId, memory, rot) {
  if (memoryId === rotId) return memory.exists ? 'material' : 'missing';
  if (memory.exists && rot.exists) return 'paired';
  if (memory.exists && !rot.exists) return 'rot-pending';
  if (!memory.exists && rot.exists) return 'memory-missing';
  return 'missing';
}

/** 只读总览：台账字段 + good-p2 目录里文件在不在。 */
export function prizeOverview() {
  const ledger = loadPrizeLedger();
  const items = (ledger.items ?? []).map((item) => {
    const memory = { ...glbStat(item.memory.id), label: item.memory.label };
    const rot = { ...glbStat(item.rot.id), label: item.rot.label };
    return {
      id: item.id,
      name: item.name,
      quest: !!item.quest,
      questLabel: item.questLabel ?? null,
      dish: item.dish ?? '',
      inGame: !!item.inGame,
      awaiting: item.awaiting ?? null,
      todo: item.todo ?? '',
      collider: item.collider ?? null,
      memory,
      rot,
      status: itemStatus(item.memory.id, item.rot.id, memory, rot),
    };
  });
  const count = (status) => items.filter(i => i.status === status).length;
  const orphans = (ledger.orphanModels?.ids ?? []).map((id) => ({
    ...glbStat(id),
    status: 'unused',
  }));
  return {
    release: ledger.sets?.release ?? 'good-p2',
    counts: {
      total: items.length,
      paired: count('paired'),
      rotPending: count('rot-pending'),
      missing: count('missing'),
      material: count('material'),
      memoryMissing: count('memory-missing'),
    },
    quests: items.filter(i => i.quest).map(i => i.questLabel || i.name),
    items,
    orphans,
    published: publishedFaces(readPublishedRows()),
  };
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

export function prizeJobStatus() {
  let job = { running: false, ids: [] };
  if (fs.existsSync(JOB)) {
    try { job = JSON.parse(fs.readFileSync(JOB, 'utf8')); }
    catch { job = { running: false, ids: [] }; }
  }
  const ids = job.ids ?? [];
  const done = ids.filter(id => glbStat(id).exists);
  const pending = ids.filter(id => !glbStat(id).exists);
  const running = !!(job.running && pidAlive(job.pid) && pending.length);
  if (job.running && !running) {
    job = { ...job, running: false, finishedAt: new Date().toISOString() };
    fs.writeFileSync(JOB, JSON.stringify(job, null, 2));
  }
  return { ...job, running, pending, done };
}

/** 名字、台账标签，或一句描述 → 可编辑的提示词。不调用模型。 */
export function completePrizePrompt(text, side = 'rot') {
  const q = String(text ?? '').trim();
  if (!q) return { error: '先写名字或一句描述' };
  const ledger = loadPrizeLedger();
  const hit = (ledger.items ?? []).find(it =>
    it.id === q || it.name === q || it.memory?.id === q || it.rot?.id === q
    || it.memory?.label === q || it.rot?.label === q);
  if (hit) {
    const face = side === 'memory' ? hit.memory : hit.rot;
    return {
      id: face.id,
      itemId: hit.id,
      name: hit.name,
      label: face.label,
      prompt: face.prompt,
      note: '从台账补全，可再改。已有文件的生成会被跳过。',
    };
  }
  const prompt = side === 'rot'
    ? `one worn spoiled version of ${q}, stained and damaged, still one single object, centered upright`
    : `one ${q}, clean and intact, single solid object, centered upright on ground`;
  return {
    id: '',
    itemId: '',
    name: q,
    label: q,
    prompt,
    note: '按这句话补了一句。新物品要自己填英文 id，再生成。',
  };
}

function loadPrompts() {
  return JSON.parse(fs.readFileSync(PROMPTS, 'utf8'));
}

export function previewPrizeGenerate({ id, prompt, image }) {
  const clean = String(id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(clean)) return { error: 'id 用英文小写，比如 carton-rot' };
  const cfg = loadPrompts();
  const exists = glbStat(clean).exists;
  const job = prizeJobStatus();
  return {
    id: clean,
    exists,
    busy: job.running && (job.ids ?? []).includes(clean),
    endpoint: image ? 'image-to-model' : 'text-to-model',
    prompt: image ? String(prompt ?? '') : `${prompt}, ${cfg._style ?? ''}`.replace(/,\s*$/, ''),
    image: image || null,
    willSkip: exists,
  };
}

export function savePrizeUpload(filename, buf) {
  const base = path.basename(String(filename || 'ref.png')).replace(/[^\w.\-]+/g, '_');
  if (!/\.(png|jpe?g|webp)$/i.test(base)) throw new Error('参考图用 png / jpg / webp');
  fs.mkdirSync(UPLOADS, { recursive: true });
  const name = `${Date.now()}-${base}`;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return `tools/prize-uploads/${name}`;
}

export function startPrizeGenerate({ id, prompt, image }) {
  const preview = previewPrizeGenerate({ id, prompt, image });
  if (preview.error) throw new Error(preview.error);
  if (preview.willSkip) throw new Error(`${preview.id}.glb 已经在，面板不会覆盖`);
  if (preview.busy) throw new Error(`${preview.id} 正在生成`);
  const job = prizeJobStatus();
  if (job.running) throw new Error(`已有生成在跑：${(job.ids ?? []).join(', ')}`);
  const text = String(prompt ?? '').trim();
  if (!text && !image) throw new Error('需要提示词或参考图');
  const cfg = loadPrompts();
  const def = { prompt: text };
  if (image) {
    const rel = String(image).replace(/\\/g, '/');
    if (!rel.startsWith('tools/prize-uploads/')) throw new Error('参考图路径不对');
    def.image = rel;
  }
  cfg.items[preview.id] = { ...(cfg.items[preview.id] ?? {}), ...def };
  fs.writeFileSync(PROMPTS, JSON.stringify(cfg, null, 2) + '\n');
  const logPath = path.join(ROOT, 'tools', 'prize-generate.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    path.join(ROOT, 'tools', 'generate.mjs'),
    '--set', 'good-p2',
    '--only', preview.id,
    '--parallel', '1',
  ], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logFd);
  const next = {
    running: true,
    pid: child.pid,
    ids: [preview.id],
    startedAt: new Date().toISOString(),
    log: 'tools/prize-generate.log',
  };
  fs.writeFileSync(JOB, JSON.stringify(next, null, 2));
  return next;
}

const GAME_DATA = path.join(ROOT, 'prototype', 'src', 'prizeTableData.js');
const COLORS = {
  bread: 0xc8a06a, can: 0xb9bec6, veg: 0x7f9c5a,
  carton: 0xd6cfc0, cheese: 0xd9b64f, bottle: 0x7c93a6,
  jar: 0x9fb4ac, apple: 0xa8574a,
  fish: 0xc4a882, ration: 0xc2b48a, cracker: 0xd8c4a0,
  oil: 0xc6b56a, fruit2: 0x7f9a4a,
};

function readPublishedRows() {
  if (!fs.existsSync(GAME_DATA)) return [];
  const text = fs.readFileSync(GAME_DATA, 'utf8');
  const m = text.match(/export const PRIZE_ROWS = (\[[\s\S]*?\]);\s*export const QUEST_MENU/);
  if (!m) return [];
  try { return JSON.parse(m[1]); }
  catch { return []; }
}

export function publishedFaces(rows = readPublishedRows()) {
  return (rows ?? []).map(r => ({
    id: r.id,
    quest: !!r.quest,
    dish: r.dish || '',
    name: r.name || '',
    rotTo: r.variants?.rot?.to || r.rotTo || '',
  }));
}

function saveLedger(ledger) {
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
}

/** 台账里 inGame 的物品发布成游戏模块。配额菜进第三幕和第四幕。 */
export function writePrizeModule(ledger = loadPrizeLedger()) {
  const rows = (ledger.items ?? []).filter(i => i.inGame).map((item) => ({
    id: item.id,
    name: item.name,
    truthName: item.rot?.label || item.name,
    category: item.category || 'food',
    quest: !!item.quest,
    questLabel: item.questLabel || item.name,
    dish: item.dish || '',
    gripFactor: item.gripFactor ?? 0.85,
    bounceMaterial: item.bounceMaterial || 'soft',
    collider: item.collider,
    visual: { type: 'primitive', color: COLORS[item.id] ?? 0xb0a090 },
    variants: { rot: { to: item.rot?.id || item.id } },
  }));
  const quests = rows.filter(r => r.quest);
  const cards = quests.map(r => r.dish || r.questLabel || r.name);
  const menu = {
    ids: quests.map(r => r.id),
    cards,
    line: cards.length ? `今日菜单\n${cards.join(' · ')}` : '',
  };
  const file = `// 由 tools/prize-pairs.json 发布。面板保存配额或新建一对时重写，不要手改。
export const PRIZE_ROWS = ${JSON.stringify(rows, null, 2)};

export const QUEST_MENU = ${JSON.stringify(menu, null, 2)};
`;
  fs.writeFileSync(GAME_DATA, file);
  return menu;
}

export function saveQuestSettings(updates) {
  const ledger = loadPrizeLedger();
  const list = Array.isArray(updates) ? updates : [];
  const chosen = list.filter(u => u && u.quest);
  if (chosen.length < 1 || chosen.length > 3) throw new Error('配额要 1 到 3 样，第四幕只有三张菜卡');
  if (chosen.some(u => !String(u.dish ?? '').trim())) throw new Error('每个配额都要写做成的菜');
  for (const u of list) {
    const it = (ledger.items ?? []).find(i => i.id === u.id && i.inGame);
    if (!it) continue;
    it.quest = !!u.quest;
    it.dish = String(u.dish ?? '').trim();
    if (it.quest) it.questLabel = String(u.questLabel || it.questLabel || it.name).trim();
  }
  saveLedger(ledger);
  const menu = writePrizeModule(ledger);
  return { ...menu, published: publishedFaces() };
}

export function completePrizePair(text) {
  const q = String(text ?? '').trim();
  if (!q) return { error: '先写名字或一句描述' };
  const ledger = loadPrizeLedger();
  const hit = (ledger.items ?? []).find(it =>
    it.id === q || it.name === q || it.memory?.id === q || it.rot?.id === q
    || it.memory?.label === q || it.rot?.label === q);
  if (hit) {
    return {
      id: hit.id,
      rotId: hit.rot.id,
      name: hit.name,
      memoryPrompt: hit.memory.prompt,
      rotPrompt: hit.rot.prompt,
      blocked: true,
      note: '已经在台账里。页面只生成新的一对，不会覆盖。',
    };
  }
  return {
    id: '',
    rotId: '',
    name: q,
    memoryPrompt: `one ${q}, clean and intact, single solid object, centered upright on ground`,
    rotPrompt: `one worn spoiled version of ${q}, stained and damaged, still one single object, centered upright`,
    blocked: false,
    note: '补了一对提示词。填英文 id 后生成，败露态文件名是 id-rot。有参考图时只用于显形态。',
  };
}

export function startPrizePair({ id, name, memoryPrompt, rotPrompt, image }) {
  const clean = String(id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(clean)) throw new Error('id 用英文小写，比如 fish');
  if (clean.endsWith('-rot')) throw new Error('id 写物品本身，败露态会自动加 -rot');
  const rotId = `${clean}-rot`;
  const ledger = loadPrizeLedger();
  const taken = (ledger.items ?? []).some(i =>
    i.id === clean || i.memory?.id === clean || i.rot?.id === clean || i.rot?.id === rotId || i.memory?.id === rotId);
  if (taken) throw new Error('这个 id 已经在台账里。页面只生成新的一对');
  if (glbStat(clean).exists || glbStat(rotId).exists) throw new Error('文件已在，不会覆盖');
  const job = prizeJobStatus();
  if (job.running) throw new Error(`已有生成在跑：${(job.pending ?? job.ids ?? []).join(', ')}`);
  const mem = String(memoryPrompt ?? '').trim();
  const rot = String(rotPrompt ?? '').trim();
  if (!mem || !rot) throw new Error('显形态和败露态的提示词都要有');
  const label = String(name ?? clean).trim() || clean;
  ledger.items.push({
    id: clean,
    name: label,
    category: 'food',
    shape: 'box',
    collider: { shape: 'box', size: [0.12, 0.1, 0.1] },
    gripFactor: 0.85,
    bounceMaterial: 'soft',
    quest: false,
    memory: { id: clean, label, prompt: mem, kind: 'text2model' },
    rot: { id: rotId, label: `${label}（败露）`, prompt: rot, kind: 'text2model' },
    paired: false,
    inGame: true,
  });
  saveLedger(ledger);
  const cfg = loadPrompts();
  cfg.items[clean] = { prompt: mem };
  cfg.items[rotId] = { prompt: rot };
  if (image) {
    const rel = String(image).replace(/\\/g, '/');
    if (!rel.startsWith('tools/prize-uploads/')) throw new Error('参考图路径不对');
    cfg.items[clean].image = rel;
  }
  fs.writeFileSync(PROMPTS, JSON.stringify(cfg, null, 2) + '\n');
  writePrizeModule(ledger);
  const logPath = path.join(ROOT, 'tools', 'prize-generate.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    path.join(ROOT, 'tools', 'generate.mjs'),
    '--set', 'good-p2',
    '--only', `${clean},${rotId}`,
    '--parallel', '2',
  ], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logFd);
  const next = {
    running: true,
    pid: child.pid,
    ids: [clean, rotId],
    startedAt: new Date().toISOString(),
    log: 'tools/prize-generate.log',
  };
  fs.writeFileSync(JOB, JSON.stringify(next, null, 2));
  return next;
}
