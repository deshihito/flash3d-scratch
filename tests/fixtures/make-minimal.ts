/**
 * make-minimal.ts — Minimal test scene for the TS sb3 builder (port).
 *
 * Builds the exact same scene as tests/fixtures/python/make_minimal.py so
 * tools/compare.mjs can verify structural identity of the two project.json
 * outputs. Keep the call sequence in lockstep with the Python version:
 * block IDs are assigned in construction order on both sides.
 */
import * as path from 'node:path';
import { ProjectBuilder, makeRadialGlowSvg } from '../../src/builder/index';

// Compiled to dist/tests/fixtures/, so the repo root is three levels up.
const OUT = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'out', 'ts', 'minimal.sb3');

function build(): string {
  const pb = new ProjectBuilder();

  const stage = pb.stage;
  stage.var('global_tick', 0);
  stage.whenFlagClicked([stage.setVar('global_tick', stage.timer())]);

  const s = pb.addSprite('Renderer');
  s.var('score', 0);
  s.var('speed', 2.5);
  s.var('label', 'Flash');
  s.var('count', 0);
  s.lst('points', [1, 2, 3]);
  s.lst('trail');

  const [glowSvg] = makeRadialGlowSvg(64);
  s.addSvgCostume('glow', glowSvg, 32, 32);

  const draw = s.defineProc('draw_dot', ['n'], true, [
    s.penClear(),
    s.setVar('count', s.arg('n')),
    s.repeat(s.arg('n'), [
      s.gotoXy(s.mul(s.var('count'), 10), s.sub(100, s.mul(s.var('count'), 5))),
      s.penSetColor(s.add(s.mul(s.var('count'), 65536), 255)),
      s.penSetParam('transparency', s.mul(s.var('count'), 10)),
      s.penDown(),
      s.penSetSize(s.add(s.var('count'), 1)),
      s.penUp(),
      s.addToList('points', s.var('count')),
      s.changeVar('count', -1),
    ]),
    s.ifElse(
      s.gt(s.lengthOfList('points'), 3),
      [s.setVar('label', s.join('len=', s.lengthOfList('points')))],
      [s.replaceItem('points', 1, s.itemOf('points', 1))],
    ),
    s.setVar('speed', s.div(s.add(s.var('speed'), s.rand(1, 9)), 2)),
    s.setVar('score', s.round(s.add(s.var('score'), s.sqrt(s.mod(s.var('count'), 7))))),
    s.wait(0.1),
    s.stopThis(),
  ]);

  s.whenFlagClicked([
    s.hide(),
    s.setVar('score', 0),
    s.callProc(draw, 4),
    s.if(s.land(s.keyPressed('space'), s.lnot(s.mouseDown())), [s.penStamp(), s.show()]),
    s.repeatUntil(s.eq(s.var('count'), 0), [
      s.changeVar('count', -1),
      s.setX(s.mouseX()),
      s.setY(s.mouseY()),
    ]),
    s.deleteAllList('trail'),
    s.setEffect('GHOST', 0),
    s.switchCostume('blank'),
    s.setSize(100),
    s.forever([s.changeX(1), s.changeY(-1)]),
  ]);

  return pb.saveSb3(OUT);
}

console.log('Built:', build());
