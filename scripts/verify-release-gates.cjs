#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const commands = [
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'test']],
  ['npm', ['run', 'build']],
  ['npm', ['run', 'benchmark:kdbx']],
];

for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
