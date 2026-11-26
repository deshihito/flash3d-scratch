import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_SVG_MD5,
  ProjectBuilder,
  SpriteBuilder,
  makeRadialGlowSvg,
} from '../src/builder/index';

// Values produced by the Python original (sb3_builder.py) — the port must match.
test('EMPTY_SVG_MD5 matches Python', () => {
  assert.equal(EMPTY_SVG_MD5, '3402b0cd6684364ad4a66e6a2ce796a0');
});

test('makeRadialGlowSvg(64) md5 matches Python (float formatting 32.0)', () => {
  const [, md5] = makeRadialGlowSvg(64);
  assert.equal(md5, 'ed755f5b875fd8bbe211b5cd8e907ac0');
});

test('deterministic variable/list IDs follow v_<sprite>_<name> / l_<sprite>_<name>', () => {
  const s = new SpriteBuilder('Renderer');
  s.var('score', 0);
  s.lst('points', [1]);
  const target = s.toTargetDict();
  assert.deepEqual(Object.keys(target.variables as object), ['v_Renderer_score']);
  assert.deepEqual(Object.keys(target.lists as object), ['l_Renderer_points']);
});

test('procedure mutation uses Python json.dumps formatting (", " separator)', () => {
  const s = new SpriteBuilder('Renderer');
  s.defineProc('draw_dot', ['n', 'm'], true, [s.penClear()]);
  const target = s.toTargetDict();
  const proto = Object.values(target.blocks as Record<string, { opcode: string; mutation?: Record<string, unknown> }>)
    .find((b) => b.opcode === 'procedures_prototype');
  assert.ok(proto);
  assert.equal(proto.mutation?.argumentids, '["arg_draw_dot_n", "arg_draw_dot_m"]');
  assert.equal(proto.mutation?.argumentnames, '["n", "m"]');
  assert.equal(proto.mutation?.argumentdefaults, '["", ""]');
  assert.equal(proto.mutation?.proccode, 'draw_dot %s %s');
});

test('projectJson is deterministic across identical builds', () => {
  const build = () => {
    const pb = new ProjectBuilder();
    const s = pb.addSprite('Renderer');
    s.var('x', 1);
    s.whenFlagClicked([s.setVar('x', s.add(s.var('x'), 2))]);
    return pb.projectJson();
  };
  assert.equal(build(), build());
});
