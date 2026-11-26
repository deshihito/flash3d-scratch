/**
 * render-policy.test.ts — Regression tests for the motion reflection
 * policy (render-bug re-investigation, 2026-11-26).
 *
 * User report: "when I change direction, the reflection(?) lingers".
 * Root cause (see render-bug2-report.md): a frame is drawn
 * reflection-pass-first, so while a slow frame is being drawn the
 * screen shows the mirror image long before the floor/main pass cover
 * it; at real Scratch speeds every camera move therefore looks like
 * the reflection is left behind. The engine's answer is a motion LOD
 * in the same family as AUTO_STEP's SPHERE_STEP=2: while the camera or
 * physics is moving (the tmp3 branch) and AUTO_STEP is on, the loops
 * set reflSkip=1 and render_frame skips the mirror pass (the floor
 * renders opaque via reflEff=0); the settle frame sets reflSkip=0 and
 * restores the full reflection. FLOOR_REFL remains the user toggle.
 *
 * These tests pin the wiring in both main loops (temple + demo):
 * the registers exist, and reflSkip is driven to both 1 (moving) and
 * 0 (settle / AUTO_STEP off).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTemple } from '../src/scene/temple.js';
import { buildDemo } from '../src/scene/demo.js';

type Block = {
  opcode?: string;
  fields?: Record<string, [string, string]>;
  inputs?: Record<string, unknown[]>;
};
type Proj = {
  targets: Array<{
    isStage: boolean;
    blocks: Record<string, Block>;
    variables: Record<string, [string, unknown]>;
  }>;
};

function spriteOf(pb: { buildProject(): unknown }): Proj['targets'][number] {
  const proj = pb.buildProject() as Proj;
  return proj.targets.find((t) => !t.isStage)!;
}

/** Literal values a variable is assigned anywhere in the project. */
function assignedLiterals(sprite: Proj['targets'][number], varName: string): Set<string> {
  const out = new Set<string>();
  for (const b of Object.values(sprite.blocks)) {
    if (b.opcode !== 'data_setvariableto') continue;
    if (b.fields?.VARIABLE?.[0] !== varName) continue;
    const val = b.inputs?.VALUE;
    if (!val) continue;
    // VALUE forms: [1, [4, "1"]] (inline literal), [3, blockId, [10, "x"]]
    // (block input with shadow), [2, blockId] (block input).
    const inline = val[1];
    if (Array.isArray(inline)) { out.add(String(inline[1])); continue; }
    const shadow = val[2] as [number, string] | undefined;
    if (Array.isArray(shadow)) { out.add(String(shadow[1])); continue; }
    const ref = val[1];
    if (typeof ref === 'string') {
      const src = sprite.blocks[ref];
      const num = src?.fields?.NUM?.[0];
      if (num !== undefined) out.add(String(num));
    }
  }
  return out;
}

for (const [name, build] of [['temple', buildTemple], ['demo', buildDemo]] as const) {
  test(`${name}: motion reflection policy is wired`, () => {
    const sprite = spriteOf(build());
    const varNames = Object.values(sprite.variables).map((v) => v[0]);
    assert.ok(varNames.includes('reflSkip'), 'reflSkip register missing');
    assert.ok(varNames.includes('reflEff'), 'reflEff register missing');
    assert.ok(varNames.includes('FLOOR_REFL'), 'user reflection toggle missing');
    const reflSkipVar = Object.values(sprite.variables).find((v) => v[0] === 'reflSkip')!;
    assert.equal(reflSkipVar[1], 0, 'reflSkip must start at 0 (full quality)');
    const assigned = assignedLiterals(sprite, 'reflSkip');
    assert.ok(assigned.has('1'), 'no code path sets reflSkip=1 (moving frames)');
    assert.ok(assigned.has('0'), 'no code path sets reflSkip=0 (settle frames)');
    const eff = assignedLiterals(sprite, 'reflEff');
    assert.ok(eff.has('1') && eff.has('0'), 'reflEff must be derived both ways');
  });
}
