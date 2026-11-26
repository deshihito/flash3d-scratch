/**
 * examples/rooms/build.ts — Build the phase-5 rooms + AI demo to dist/rooms.sb3.
 *
 * Usage: npm run build:rooms
 * (compiles to dist/examples/rooms/build.js; the sb3 lands in dist/.)
 */
import * as path from 'node:path';
import { buildRoomsSb3 } from '../../src/scene/rooms-demo';

const out = buildRoomsSb3(path.join(__dirname, '..', '..', 'rooms.sb3'));
console.log(`Built: ${out}`);
