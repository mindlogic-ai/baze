import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { installSkill, readSkillSource, skillState, type SkillTarget, uninstallSkill } from './skill.js';

function targets(withClaude: boolean, withCodex: boolean): SkillTarget[] {
  const root = mkdtempSync(join(tmpdir(), 'baze-skill-'));
  const claude = join(root, '.claude');
  const codex = join(root, '.codex');
  if (withClaude) mkdirSync(claude);
  if (withCodex) mkdirSync(codex);
  return [
    { label: 'Claude Code', home: claude, file: join(claude, 'skills', 'baze', 'SKILL.md') },
    { label: 'Codex', home: codex, file: join(codex, 'skills', 'baze', 'SKILL.md') },
  ];
}

test('the shipped skill is readable and names itself', () => {
  // The package lists skills/ in `files`; a missing file would crash `baze doctor`.
  assert.match(readSkillSource(), /^---\nname: baze\n/);
});

test('install writes the skill into every tool set up here, and only those', () => {
  const t = targets(true, false);
  const written = installSkill('SKILL', t);
  assert.deepEqual(written, [t[0]!.file]);
  assert.equal(readFileSync(t[0]!.file, 'utf8'), 'SKILL');
  assert.equal(existsSync(t[1]!.file), false);
  assert.equal(skillState(t[1]!, 'SKILL'), 'no-tool');
});

test('a second install is a no-op, and a changed skill is reported and replaced', () => {
  const t = targets(true, true);
  installSkill('v1', t);
  assert.deepEqual(installSkill('v1', t), []);
  assert.equal(skillState(t[0]!, 'v2'), 'outdated');
  assert.equal(installSkill('v2', t).length, 2);
  assert.equal(skillState(t[1]!, 'v2'), 'current');
});

test('with neither tool set up, install says so instead of creating their folders', () => {
  const t = targets(false, false);
  assert.throws(() => installSkill('x', t), /Neither Claude Code nor Codex/);
  assert.equal(existsSync(t[0]!.home), false);
});

test('uninstall removes only our file and keeps a folder that holds anything else', () => {
  const t = targets(true, true);
  installSkill('x', t);
  writeFileSync(join(t[1]!.file, '..', 'notes.md'), 'mine');
  assert.equal(uninstallSkill(t).length, 2);
  assert.equal(existsSync(join(t[0]!.file, '..')), false);
  assert.equal(readFileSync(join(t[1]!.file, '..', 'notes.md'), 'utf8'), 'mine');
});
