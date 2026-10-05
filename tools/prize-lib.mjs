// 奖池台账 + 发布套目录实况。面板和以后的校验共用这一份，不改 prizePool.js。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'tools', 'prize-pairs.json');
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
      inGame: !!item.inGame,
      awaiting: item.awaiting ?? null,
      todo: item.todo ?? '',
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
  };
}
