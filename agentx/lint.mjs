// CI guardrail over the AgentX schema manifest (agentx/manifest.json).
// Fails the build if a collection is missing org scoping or a required workflow
// block — both are silent-failure footguns on the platform (an unscoped
// collection has NO row isolation; a redefine that omits `workflow` silently
// drops ALL transition enforcement).
//
// Usage: node agentx/lint.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// strip a UTF-8 BOM if present — exports written via PowerShell 5.1 carry one
const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'manifest.json'), 'utf8').replace(/^﻿/, '');
const manifest = JSON.parse(raw);

const REQUIRED_WORKFLOWS = { leads: 'stage', search_queries: 'status' };
const errors = [];

for (const c of manifest.collections) {
  if (!c.access?.org?.claim || !c.access?.org?.field) {
    errors.push(`${c.name}: missing access.org — collection has NO tenant isolation`);
  }
  if (c.publicWrite) {
    errors.push(`${c.name}: publicWrite is enabled — anonymous writes are forbidden in this project`);
  }
  const wanted = REQUIRED_WORKFLOWS[c.name];
  if (wanted && c.workflow?.field !== wanted) {
    errors.push(`${c.name}: workflow block missing or not on "${wanted}" — transition enforcement dropped`);
  }
}

for (const name of Object.keys(REQUIRED_WORKFLOWS)) {
  if (!manifest.collections.some((c) => c.name === name)) {
    errors.push(`collection "${name}" is missing from the manifest entirely`);
  }
}

if (errors.length) {
  console.error('AgentX manifest lint FAILED:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log(`AgentX manifest lint OK — ${manifest.collections.length} collections, all org-scoped, workflows intact.`);
