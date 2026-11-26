/**
 * index.ts — L0 sb3 builder: TypeScript port of sb3_builder.py.
 *
 * Programmatic Vanilla Scratch 3.0 (.sb3) Compiler/DSL. Generates 100%
 * standard Scratch 3.0 project.json + .sb3 archives (Pen extension only,
 * zero non-standard TurboWarp extensions) so every generated project runs
 * identically on official scratch.mit.edu AND TurboWarp.
 *
 * Port policy: method names use camelCase but semantics, block-construction
 * order, deterministic IDs (blocks b1.., variables v_<sprite>_<name>,
 * lists l_<sprite>_<name>) and project.json key order mirror the Python
 * original exactly, so the same scene description produces a structurally
 * identical project.json (verified by tools/compare.mjs).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pyDumpsCompact, pyDumpsDefault, pyNumStr } from './pyjson';
import { buildZip } from './zip';

export const EMPTY_SVG =
  '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" ' +
  'width="1" height="1" viewBox="0 0 1 1"></svg>';

function md5hex(data: string | Buffer): string {
  return createHash('md5').update(data).digest('hex');
}

export const EMPTY_SVG_MD5 = md5hex(EMPTY_SVG);

/** Python f-string formatting of a float that came from true division (e.g. 32.0 -> "32.0"). */
function pyFloatStr(n: number): string {
  if (Number.isInteger(n)) return `${n}.0`;
  return String(n);
}

/** Optional soft radial glow SVG costume (for comparing Pen-only vs Pen+Stamp). */
export function makeRadialGlowSvg(size = 64): [string, string] {
  const r = size / 2;
  const svg =
    `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" ` +
    `width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><radialGradient id="g" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>` +
    `<stop offset="30%" stop-color="#ffffff" stop-opacity="0.6"/>` +
    `<stop offset="65%" stop-color="#ffffff" stop-opacity="0.18"/>` +
    `<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<circle cx="${pyFloatStr(r)}" cy="${pyFloatStr(r)}" r="${pyFloatStr(r)}" fill="url(#g)"/></svg>`;
  return [svg, md5hex(svg)];
}

export type InputValue = number | string | Expr;
type BlockBuilder = (parentId: string) => string;

/** Represents a Scratch reporter/boolean expression or literal. */
export class Expr {
  constructor(
    public kind: 'num' | 'str' | 'var' | 'arg' | 'block',
    public val: unknown = null,
  ) {}
}

interface Block {
  opcode: string;
  next: string | null;
  parent: string | null;
  inputs: Record<string, unknown>;
  fields: Record<string, unknown>;
  shadow: boolean;
  topLevel: boolean;
  x?: number;
  y?: number;
  mutation?: Record<string, unknown>;
}

interface Costume {
  name: string;
  bitmapResolution: number;
  dataFormat: string;
  assetId: string;
  md5ext: string;
  rotationCenterX: number;
  rotationCenterY: number;
}

export type ProcHandle = [proccode: string, argIds: string[], warp: boolean];

export class SpriteBuilder {
  readonly variables = new Map<string, [string, unknown]>(); // name -> [id, init]
  readonly lists = new Map<string, [string, unknown[]]>(); // name -> [id, init]
  readonly blocks: Record<string, Block> = {};
  readonly costumes: Costume[] = [];
  private _idCounter = 0;
  /** md5ext -> bytes, in insertion order (mirrors Python dict). */
  readonly extraAssets = new Map<string, Buffer>();

  constructor(
    public name = 'Renderer',
    public isStage = false,
  ) {
    // Always add a 1x1 transparent empty costume (optimal for Pen sprites!)
    this.addSvgCostume('blank', EMPTY_SVG, 0, 0);
  }

  addSvgCostume(name: string, svgStr: string, rotX = 0, rotY = 0): void {
    const data = Buffer.from(svgStr, 'utf-8');
    const md5 = md5hex(data);
    const md5ext = `${md5}.svg`;
    this.extraAssets.set(md5ext, data);
    this.costumes.push({
      name,
      bitmapResolution: 1,
      dataFormat: 'svg',
      assetId: md5,
      md5ext,
      rotationCenterX: rotX,
      rotationCenterY: rotY,
    });
  }

  private _uid(prefix = 'b'): string {
    this._idCounter += 1;
    return `${prefix}${this._idCounter}`;
  }

  var(name: string, init: unknown = 0): Expr {
    if (!this.variables.has(name)) {
      const vid = `v_${this.name}_${name}`;
      this.variables.set(name, [vid, init]);
    }
    return new Expr('var', name);
  }

  lst(name: string, init?: unknown[]): string {
    if (!this.lists.has(name)) {
      const lid = `l_${this.name}_${name}`;
      this.lists.set(name, [lid, init !== undefined ? [...init] : []]);
    }
    return name;
  }

  private _ensureVar(name: string): string {
    if (!this.variables.has(name)) this.var(name, 0);
    return this.variables.get(name)![0];
  }

  private _ensureList(name: string): string {
    if (!this.lists.has(name)) this.lst(name, []);
    return this.lists.get(name)![0];
  }

  private _addBlock(
    opcode: string,
    inputs?: Record<string, unknown>,
    fields?: Record<string, unknown>,
    mutation?: Record<string, unknown>,
    shadow = false,
    topLevel = false,
  ): string {
    const bid = this._uid('b');
    const blk: Block = {
      opcode,
      next: null,
      parent: null,
      inputs: inputs ?? {},
      fields: fields ?? {},
      shadow,
      topLevel,
    };
    if (topLevel) {
      blk.x = 0;
      blk.y = 0;
    }
    if (mutation !== undefined && mutation !== null) blk.mutation = mutation;
    this.blocks[bid] = blk;
    return bid;
  }

  /** Convert a JS value or Expr into a Scratch block input array. */
  private _emitInput(
    val: InputValue,
    parentId: string,
    isBool = false,
    isColor = false,
  ): unknown[] {
    if (typeof val === 'number') {
      if (isColor) return [1, [4, pyNumStr(val)]];
      return [1, [4, pyNumStr(val)]];
    }
    if (typeof val === 'string') {
      return [1, [10, val]];
    }
    if (val instanceof Expr) {
      if (val.kind === 'var') {
        const vid = this._ensureVar(val.val as string);
        return [3, [12, val.val, vid], [10, '0']];
      }
      if (val.kind === 'arg') {
        const bid = this._addBlock('argument_reporter_string_number', undefined, {
          VALUE: [val.val, null],
        });
        this.blocks[bid].parent = parentId;
        return [3, bid, [10, '0']];
      }
      if (val.kind === 'block') {
        const bid = (val.val as BlockBuilder)(parentId);
        this.blocks[bid].parent = parentId;
        if (isBool) return [2, bid];
        return [3, bid, [10, '0']];
      }
    }
    throw new TypeError(`Unsupported input: ${String(val)}`);
  }

  // --- Reporter builders ---
  num(x: number): number {
    return x;
  }

  arg(name: string): Expr {
    return new Expr('arg', name);
  }

  private _binop(
    opcode: string,
    k1: string,
    a: InputValue,
    k2: string,
    b: InputValue,
    isBool = false,
  ): Expr {
    const build: BlockBuilder = () => {
      const bid = this._addBlock(opcode);
      this.blocks[bid].inputs[k1] = this._emitInput(a, bid, isBool);
      this.blocks[bid].inputs[k2] = this._emitInput(b, bid, isBool);
      return bid;
    };
    return new Expr('block', build);
  }

  add(a: InputValue, b: InputValue): Expr { return this._binop('operator_add', 'NUM1', a, 'NUM2', b); }
  sub(a: InputValue, b: InputValue): Expr { return this._binop('operator_subtract', 'NUM1', a, 'NUM2', b); }
  mul(a: InputValue, b: InputValue): Expr { return this._binop('operator_multiply', 'NUM1', a, 'NUM2', b); }
  div(a: InputValue, b: InputValue): Expr { return this._binop('operator_divide', 'NUM1', a, 'NUM2', b); }
  mod(a: InputValue, b: InputValue): Expr { return this._binop('operator_mod', 'NUM1', a, 'NUM2', b); }
  rand(a: InputValue, b: InputValue): Expr { return this._binop('operator_random', 'FROM', a, 'TO', b); }
  lt(a: InputValue, b: InputValue): Expr { return this._binop('operator_lt', 'OPERAND1', a, 'OPERAND2', b); }
  gt(a: InputValue, b: InputValue): Expr { return this._binop('operator_gt', 'OPERAND1', a, 'OPERAND2', b); }
  eq(a: InputValue, b: InputValue): Expr { return this._binop('operator_equals', 'OPERAND1', a, 'OPERAND2', b); }
  land(a: InputValue, b: InputValue): Expr { return this._binop('operator_and', 'OPERAND1', a, 'OPERAND2', b, true); }
  lor(a: InputValue, b: InputValue): Expr { return this._binop('operator_or', 'OPERAND1', a, 'OPERAND2', b, true); }
  join(a: InputValue, b: InputValue): Expr { return this._binop('operator_join', 'STRING1', a, 'STRING2', b); }

  lnot(a: InputValue): Expr {
    const build: BlockBuilder = () => {
      const bid = this._addBlock('operator_not');
      this.blocks[bid].inputs['OPERAND'] = this._emitInput(a, bid, true);
      return bid;
    };
    return new Expr('block', build);
  }

  mathop(op: string, a: InputValue): Expr {
    // op: 'abs','floor','ceiling','sqrt','sin','cos','tan','asin','acos','atan','ln','log','e ^','10 ^'
    const build: BlockBuilder = () => {
      const bid = this._addBlock('operator_mathop', undefined, { OPERATOR: [op, null] });
      this.blocks[bid].inputs['NUM'] = this._emitInput(a, bid);
      return bid;
    };
    return new Expr('block', build);
  }

  round(a: InputValue): Expr {
    const build: BlockBuilder = () => {
      const bid = this._addBlock('operator_round');
      this.blocks[bid].inputs['NUM'] = this._emitInput(a, bid);
      return bid;
    };
    return new Expr('block', build);
  }

  abs(a: InputValue): Expr { return this.mathop('abs', a); }
  floor(a: InputValue): Expr { return this.mathop('floor', a); }
  ceil(a: InputValue): Expr { return this.mathop('ceiling', a); }
  sqrt(a: InputValue): Expr { return this.mathop('sqrt', a); }
  sin(a: InputValue): Expr { return this.mathop('sin', a); } // NOTE: degrees in Scratch!
  cos(a: InputValue): Expr { return this.mathop('cos', a); } // NOTE: degrees in Scratch!
  tan(a: InputValue): Expr { return this.mathop('tan', a); }
  atan(a: InputValue): Expr { return this.mathop('atan', a); }
  ln(a: InputValue): Expr { return this.mathop('ln', a); }
  exp(a: InputValue): Expr { return this.mathop('e ^', a); }
  pow(base: InputValue, expVal: InputValue): Expr {
    // Scratch has no pow block! base^exp = e^(exp * ln(base))
    return this.exp(this.mul(expVal, this.ln(base)));
  }

  timer(): Expr {
    const build: BlockBuilder = () => this._addBlock('sensing_timer');
    return new Expr('block', build);
  }

  daysSince2000(): Expr {
    const build: BlockBuilder = () => this._addBlock('sensing_dayssince2000');
    return new Expr('block', build);
  }

  keyPressed(keyName: string): Expr {
    const build: BlockBuilder = () => {
      const bid = this._addBlock('sensing_keypressed');
      const mid = this._addBlock(
        'sensing_keyoptions',
        undefined,
        { KEY_OPTION: [keyName, null] },
        undefined,
        true,
      );
      this.blocks[mid].parent = bid;
      this.blocks[bid].inputs['KEY_OPTION'] = [1, mid];
      return bid;
    };
    return new Expr('block', build);
  }

  mouseDown(): Expr {
    const build: BlockBuilder = () => this._addBlock('sensing_mousedown');
    return new Expr('block', build);
  }

  mouseX(): Expr {
    const build: BlockBuilder = () => this._addBlock('sensing_mousex');
    return new Expr('block', build);
  }

  mouseY(): Expr {
    const build: BlockBuilder = () => this._addBlock('sensing_mousey');
    return new Expr('block', build);
  }

  itemOf(listName: string, idx: InputValue): Expr {
    const lid = this._ensureList(listName);
    const build: BlockBuilder = () => {
      const bid = this._addBlock('data_itemoflist', undefined, { LIST: [listName, lid] });
      this.blocks[bid].inputs['INDEX'] = this._emitInput(idx, bid);
      return bid;
    };
    return new Expr('block', build);
  }

  lengthOfList(listName: string): Expr {
    const lid = this._ensureList(listName);
    const build: BlockBuilder = () =>
      this._addBlock('data_lengthoflist', undefined, { LIST: [listName, lid] });
    return new Expr('block', build);
  }

  // --- Statement builders ---
  setVar(name: string, val: InputValue): string {
    const vid = this._ensureVar(name);
    const bid = this._addBlock('data_setvariableto', undefined, { VARIABLE: [name, vid] });
    this.blocks[bid].inputs['VALUE'] = this._emitInput(val, bid);
    return bid;
  }

  changeVar(name: string, val: InputValue): string {
    const vid = this._ensureVar(name);
    const bid = this._addBlock('data_changevariableby', undefined, { VARIABLE: [name, vid] });
    this.blocks[bid].inputs['VALUE'] = this._emitInput(val, bid);
    return bid;
  }

  deleteAllList(listName: string): string {
    const lid = this._ensureList(listName);
    return this._addBlock('data_deletealloflist', undefined, { LIST: [listName, lid] });
  }

  addToList(listName: string, val: InputValue): string {
    const lid = this._ensureList(listName);
    const bid = this._addBlock('data_addtolist', undefined, { LIST: [listName, lid] });
    this.blocks[bid].inputs['ITEM'] = this._emitInput(val, bid);
    return bid;
  }

  replaceItem(listName: string, idx: InputValue, val: InputValue): string {
    const lid = this._ensureList(listName);
    const bid = this._addBlock('data_replaceitemoflist', undefined, { LIST: [listName, lid] });
    this.blocks[bid].inputs['INDEX'] = this._emitInput(idx, bid);
    this.blocks[bid].inputs['ITEM'] = this._emitInput(val, bid);
    return bid;
  }

  resetTimer(): string {
    return this._addBlock('sensing_resettimer');
  }

  // Motion
  gotoXy(x: InputValue, y: InputValue): string {
    const bid = this._addBlock('motion_gotoxy');
    this.blocks[bid].inputs['X'] = this._emitInput(x, bid);
    this.blocks[bid].inputs['Y'] = this._emitInput(y, bid);
    return bid;
  }

  setX(x: InputValue): string {
    const bid = this._addBlock('motion_setx');
    this.blocks[bid].inputs['X'] = this._emitInput(x, bid);
    return bid;
  }

  setY(y: InputValue): string {
    const bid = this._addBlock('motion_sety');
    this.blocks[bid].inputs['Y'] = this._emitInput(y, bid);
    return bid;
  }

  changeX(dx: InputValue): string {
    const bid = this._addBlock('motion_changexby');
    this.blocks[bid].inputs['DX'] = this._emitInput(dx, bid);
    return bid;
  }

  changeY(dy: InputValue): string {
    const bid = this._addBlock('motion_changeyby');
    this.blocks[bid].inputs['DY'] = this._emitInput(dy, bid);
    return bid;
  }

  // Looks (for optional Stamp comparison)
  hide(): string {
    return this._addBlock('looks_hide');
  }

  show(): string {
    return this._addBlock('looks_show');
  }

  setSize(pct: InputValue): string {
    const bid = this._addBlock('looks_setsizeto');
    this.blocks[bid].inputs['SIZE'] = this._emitInput(pct, bid);
    return bid;
  }

  switchCostume(name: string): string {
    const bid = this._addBlock('looks_switchcostumeto');
    const mid = this._addBlock('looks_costume', undefined, { COSTUME: [name, null] }, undefined, true);
    this.blocks[mid].parent = bid;
    this.blocks[bid].inputs['COSTUME'] = [1, mid];
    return bid;
  }

  setEffect(effectName: string, val: InputValue): string {
    // COLOR, BRIGHTNESS, GHOST
    const bid = this._addBlock('looks_seteffectto', undefined, { EFFECT: [effectName, null] });
    this.blocks[bid].inputs['VALUE'] = this._emitInput(val, bid);
    return bid;
  }

  // Pen
  penClear(): string {
    return this._addBlock('pen_clear');
  }

  penDown(): string {
    return this._addBlock('pen_penDown');
  }

  penUp(): string {
    return this._addBlock('pen_penUp');
  }

  penStamp(): string {
    return this._addBlock('pen_stamp');
  }

  penSetSize(size: InputValue): string {
    const bid = this._addBlock('pen_setPenSizeTo');
    this.blocks[bid].inputs['SIZE'] = this._emitInput(size, bid);
    return bid;
  }

  penSetColor(colorExpr: InputValue): string {
    // Accepts 24-bit RGB or 32-bit ARGB integer!
    const bid = this._addBlock('pen_setPenColorToColor');
    this.blocks[bid].inputs['COLOR'] = this._emitInput(colorExpr, bid, false, true);
    return bid;
  }

  penSetParam(param: string, val: InputValue): string {
    // param: 'color', 'saturation', 'brightness', 'transparency'
    const bid = this._addBlock('pen_setPenColorParamTo');
    const mid = this._addBlock(
      'pen_menu_colorParam',
      undefined,
      { colorParam: [param, null] },
      undefined,
      true,
    );
    this.blocks[mid].parent = bid;
    this.blocks[bid].inputs['COLOR_PARAM'] = [1, mid];
    this.blocks[bid].inputs['VALUE'] = this._emitInput(val, bid);
    return bid;
  }

  // Control
  private _linkChain(stmts: (string | null | undefined)[], parentId: string | null = null): string | null {
    const list = stmts.filter((s): s is string => s !== null && s !== undefined);
    if (list.length === 0) return null;
    for (let i = 0; i < list.length; i++) {
      const bid = list[i];
      if (i === 0) {
        this.blocks[bid].parent = parentId;
      } else {
        this.blocks[bid].parent = list[i - 1];
        this.blocks[list[i - 1]].next = bid;
      }
    }
    return list[0];
  }

  repeat(times: InputValue, body: string[]): string {
    const bid = this._addBlock('control_repeat');
    this.blocks[bid].inputs['TIMES'] = this._emitInput(times, bid);
    const first = this._linkChain(body, bid);
    if (first) this.blocks[bid].inputs['SUBSTACK'] = [2, first];
    return bid;
  }

  repeatUntil(cond: InputValue, body: string[]): string {
    const bid = this._addBlock('control_repeat_until');
    this.blocks[bid].inputs['CONDITION'] = this._emitInput(cond, bid, true);
    const first = this._linkChain(body, bid);
    if (first) this.blocks[bid].inputs['SUBSTACK'] = [2, first];
    return bid;
  }

  forever(body: string[]): string {
    const bid = this._addBlock('control_forever');
    const first = this._linkChain(body, bid);
    if (first) this.blocks[bid].inputs['SUBSTACK'] = [2, first];
    return bid;
  }

  if(cond: InputValue, body: string[]): string {
    const bid = this._addBlock('control_if');
    this.blocks[bid].inputs['CONDITION'] = this._emitInput(cond, bid, true);
    const first = this._linkChain(body, bid);
    if (first) this.blocks[bid].inputs['SUBSTACK'] = [2, first];
    return bid;
  }

  ifElse(cond: InputValue, thenBody: string[], elseBody: string[]): string {
    const bid = this._addBlock('control_if_else');
    this.blocks[bid].inputs['CONDITION'] = this._emitInput(cond, bid, true);
    const f1 = this._linkChain(thenBody, bid);
    const f2 = this._linkChain(elseBody, bid);
    if (f1) this.blocks[bid].inputs['SUBSTACK'] = [2, f1];
    if (f2) this.blocks[bid].inputs['SUBSTACK2'] = [2, f2];
    return bid;
  }

  stopThis(): string {
    return this._addBlock('control_stop', undefined, { STOP_OPTION: ['this script', null] }, {
      tagName: 'mutation',
      children: [],
      hasnext: 'false',
    });
  }

  stopAll(): string {
    return this._addBlock('control_stop', undefined, { STOP_OPTION: ['all', null] }, {
      tagName: 'mutation',
      children: [],
      hasnext: 'false',
    });
  }

  wait(secs: InputValue): string {
    const bid = this._addBlock('control_wait');
    this.blocks[bid].inputs['DURATION'] = this._emitInput(secs, bid);
    return bid;
  }

  // Custom Procedures (Run Without Screen Refresh = warp=true!)
  defineProc(
    name: string,
    argNames: string[] = [],
    warp = true,
    body?: string[],
  ): ProcHandle {
    const argIds = argNames.map((a) => `arg_${name}_${a}`);
    const proccode = name + (argNames.length ? ' ' + argNames.map(() => '%s').join(' ') : '');
    const defId = this._addBlock('procedures_definition', undefined, undefined, undefined, false, true);
    const protoId = this._addBlock(
      'procedures_prototype',
      undefined,
      undefined,
      {
        tagName: 'mutation',
        children: [],
        proccode,
        argumentids: pyDumpsDefault(argIds),
        argumentnames: pyDumpsDefault(argNames),
        argumentdefaults: pyDumpsDefault(argNames.map(() => '')),
        warp: warp ? 'true' : 'false',
      },
      true,
    );
    this.blocks[protoId].parent = defId;
    argNames.forEach((aname, i) => {
      const aid = argIds[i];
      const repId = this._addBlock(
        'argument_reporter_string_number',
        undefined,
        { VALUE: [aname, null] },
        undefined,
        true,
      );
      this.blocks[repId].parent = protoId;
      this.blocks[protoId].inputs[aid] = [1, repId];
    });
    this.blocks[defId].inputs['custom_block'] = [1, protoId];

    if (body) {
      const first = this._linkChain(body, defId);
      if (first) this.blocks[defId].next = first;
    }

    return [proccode, argIds, warp];
  }

  callProc(handle: ProcHandle, ...args: InputValue[]): string {
    const [proccode, argIds, warp] = handle;
    if (args.length !== argIds.length) {
      throw new Error(`Expected ${argIds.length} args for ${proccode}, got ${args.length}`);
    }
    const bid = this._addBlock('procedures_call', undefined, undefined, {
      tagName: 'mutation',
      children: [],
      proccode,
      argumentids: pyDumpsDefault(argIds),
      warp: warp ? 'true' : 'false',
    });
    argIds.forEach((aid, i) => {
      this.blocks[bid].inputs[aid] = this._emitInput(args[i], bid);
    });
    return bid;
  }

  whenFlagClicked(body: string[]): string {
    const hat = this._addBlock('event_whenflagclicked', undefined, undefined, undefined, false, true);
    const first = this._linkChain(body, hat);
    if (first) this.blocks[hat].next = first;
    return hat;
  }

  toTargetDict(): Record<string, unknown> {
    const variables: Record<string, unknown> = {};
    for (const [vname, [vid, init]] of this.variables) variables[vid] = [vname, init];
    const lists: Record<string, unknown> = {};
    for (const [lname, [lid, init]] of this.lists) lists[lid] = [lname, init];
    const base: Record<string, unknown> = {
      isStage: this.isStage,
      name: this.name,
      variables,
      lists,
      broadcasts: {},
      blocks: this.blocks,
      comments: {},
      currentCostume: 0,
      costumes: this.costumes,
      sounds: [],
      volume: 100,
      layerOrder: this.isStage ? 0 : 1,
    };
    if (this.isStage) {
      base['tempo'] = 60;
      base['videoTransparency'] = 50;
      base['videoState'] = 'on';
      base['textToSpeechLanguage'] = null;
    } else {
      base['visible'] = false;
      base['x'] = 0;
      base['y'] = 0;
      base['size'] = 100;
      base['direction'] = 90;
      base['draggable'] = false;
      base['rotationStyle'] = 'all around';
    }
    return base;
  }
}

export class ProjectBuilder {
  readonly stage: SpriteBuilder;
  readonly sprites: SpriteBuilder[] = [];

  constructor() {
    this.stage = new SpriteBuilder('Stage', true);
  }

  addSprite(name = 'Renderer'): SpriteBuilder {
    const s = new SpriteBuilder(name, false);
    this.sprites.push(s);
    return s;
  }

  /** Assemble the project object (same shape/key order as Python save_sb3). */
  buildProject(): Record<string, unknown> {
    const targets = [this.stage.toTargetDict(), ...this.sprites.map((s) => s.toTargetDict())];
    return {
      targets,
      monitors: [],
      extensions: ['pen'],
      meta: { semver: '3.0.0', vm: '0.2.0', agent: 'scratch-ue5-pen-compiler' },
    };
  }

  /** Serialize project.json exactly as Python's json.dumps(..., separators=(",", ":")). */
  projectJson(): string {
    return pyDumpsCompact(this.buildProject() as never);
  }

  saveSb3(outPath: string): string {
    const dir = path.dirname(outPath);
    fs.mkdirSync(dir, { recursive: true });
    const projJson = this.projectJson();
    const assets = new Map<string, Buffer>();
    for (const t of [this.stage, ...this.sprites]) {
      for (const [k, v] of t.extraAssets) assets.set(k, v);
    }
    const entries = [
      { name: 'project.json', data: Buffer.from(projJson, 'utf-8') },
      ...[...assets.entries()].map(([name, data]) => ({ name, data })),
    ];
    fs.writeFileSync(outPath, buildZip(entries));
    return outPath;
  }
}
