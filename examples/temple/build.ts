/**
 * examples/temple/build.ts — Build the temple scene to dist/temple.sb3.
 *
 * Usage: npm run build:temple
 * (compiles to dist/examples/temple/build.js; the sb3 lands in dist/.)
 */
import * as path from 'node:path';
import { buildTempleSb3 } from '../../src/scene/temple';

const out = buildTempleSb3(path.join(__dirname, '..', '..', 'temple.sb3'));
console.log(`Built: ${out}`);
