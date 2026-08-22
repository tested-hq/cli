#!/usr/bin/env node
/**
 * prepare:
 *   - Always build dist/tested.js so git installs get a working bin.
 *   - Install husky only in this repo checkout (not when consumed as a dep).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import isCi from 'is-ci';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('pnpm', ['run', 'build']);

const initCwd = process.env.INIT_CWD;
const isConsumerInstall =
  Boolean(initCwd) && resolve(initCwd) !== resolve(process.cwd());

if (!isConsumerInstall && !isCi) {
  run('husky', []);
}
