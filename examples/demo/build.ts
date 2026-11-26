/**
 * examples/demo/build.ts — Build the phase-2 dynamic-objects demo to dist/demo.sb3.
 *
 * Usage: npm run build:demo
 * (compiles to dist/examples/demo/build.js; the sb3 lands in dist/.)
 */
import * as path from 'node:path';
import { buildDemoSb3 } from '../../src/scene/demo';

// Debug stage monitors (impact readouts) are off in the shipped
// build; FLASH_MONITORS=1 turns them on.
const out = buildDemoSb3(path.join(__dirname, '..', '..', 'demo.sb3'), process.env.FLASH_MONITORS === '1');
console.log(`Built: ${out}`);
