#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main().catch(err => {
  console.error('✗ ' + (err?.stack || err?.message || err));
  process.exit(1);
});
