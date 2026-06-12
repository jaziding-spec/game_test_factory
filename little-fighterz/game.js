'use strict';
/* ============================================================
   LITTLE FIGHTERZ — a Little Fighter 2 inspired 2.5D brawler
   Vanilla JS + canvas, no assets, no dependencies.
   ============================================================ */

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;

const GROUND_Y = 310;          // screen y where depth z = 0 sits
const Z_MAX = 200;             // playfield depth
const GRAV = 0.55;

// ---------------------------------------------------------- input
const P1K = { left:'KeyA', right:'KeyD', up:'KeyW', down:'KeyS', attack:'KeyJ', jump:'KeyK', defend:'KeyL' };
const P2K = { left:'ArrowLeft', right:'ArrowRight', up:'ArrowUp', down:'ArrowDown', attack:'Comma', jump:'Period', defend:'Slash' };
const GAME_KEYS = new Set([...Object.values(P1K), ...Object.values(P2K), 'Enter', 'Space', 'KeyP', 'Escape']);

const keys = Object.create(null);
const pressed = new Set();
let audio = null;

window.addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys[e.code] = true;
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  else if (audio.state === 'suspended') audio.resume();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

const pr = code => pressed.has(code);

// ---------------------------------------------------------- sound
function tone(f0, f1, dur, type = 'square', vol = 0.15, delay = 0) {
  if (!audio) return;
  const t = audio.currentTime + delay;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur);
}
function noiseHit(dur, vol, cut) {
  if (!audio) return;
  const n = Math.floor(audio.sampleRate * dur);
  const b = audio.createBuffer(1, n, audio.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = audio.createBufferSource(); s.buffer = b;
  const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
  const g = audio.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(audio.destination);
  s.start();
}
function sfx(n) {
  switch (n) {
    case 'hit':    noiseHit(0.08, 0.25, 800); tone(180, 60, 0.09, 'square', 0.18); break;
    case 'block':  tone(320, 220, 0.06, 'square', 0.12); break;
    case 'swing':  noiseHit(0.05, 0.08, 3500); break;
    case 'jump':   tone(220, 440, 0.12, 'sine', 0.1); break;
    case 'fire':   tone(120, 520, 0.25, 'sawtooth', 0.13); noiseHit(0.2, 0.1, 1200); break;
    case 'ice':    tone(900, 1500, 0.18, 'triangle', 0.12); break;
    case 'bolt':   tone(900, 120, 0.16, 'sawtooth', 0.14); break;
    case 'cast':   tone(330, 660, 0.12, 'sine', 0.1); break;
    case 'ko':     tone(160, 40, 0.5, 'sawtooth', 0.22); noiseHit(0.3, 0.22, 400); break;
    case 'thud':   noiseHit(0.1, 0.18, 300); tone(100, 50, 0.12, 'sine', 0.16); break;
    case 'pickup': tone(660, 990, 0.12, 'sine', 0.1); tone(990, 1320, 0.12, 'sine', 0.09, 0.08); break;
    case 'select': tone(440, 660, 0.08, 'square', 0.08); break;
    case 'freeze': tone(1400, 350, 0.3, 'triangle', 0.12); break;
  }
}

// ---------------------------------------------------------- helpers
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------- specials
function shoot(f, o) {
  projectiles.push({
    x: f.x + f.facing * 32, z: clamp(f.z + (o.dz || 0), 0, Z_MAX), h: 42,
    vx: f.facing * o.speed, type: o.type, team: f.team, owner: f,
    dmg: o.dmg * f.power, freeze: o.freeze || false, ttl: 110,
  });
}
function castFireball(f) { shoot(f, { type: 'fire', dmg: 22, speed: 7.5 }); sfx('fire'); }
function castInferno(f) {
  sfx('fire'); sfx('ko'); shakeAdd(7);
  for (let i = 0; i < 40; i++) spawnP(f.x + rnd(-70, 70), f.z + rnd(-20, 20), rnd(0, 30), rnd(-1, 1), rnd(-0.5, 0.5), rnd(1.5, 4.5), rnd(20, 45), pick(['#ff5722', '#ffc107', '#ff9100']), rnd(3, 7), -0.05);
  for (const d of fighters) {
    if (d === f || d.dead || d.team === f.team) continue;
    if (Math.abs(d.x - f.x) < 100 && Math.abs(d.z - f.z) < 28)
      applyHit(f, d, { dmg: 34 * f.power, knock: 5, fall: true, dir: d.x >= f.x ? 1 : -1 });
  }
}
function castIceBolt(f) { shoot(f, { type: 'ice', dmg: 16, speed: 6.5, freeze: true }); sfx('ice'); }
function castIceStorm(f) {
  for (const dz of [-24, 0, 24]) shoot(f, { type: 'ice', dmg: 14, speed: 6.5, freeze: true, dz });
  sfx('ice'); sfx('freeze');
}
function castBolt(f) { shoot(f, { type: 'bolt', dmg: 20, speed: 11 }); sfx('bolt'); }
function castDash(f) {
  setState(f, 'dash'); f.atkHit = new Set(); sfx('bolt'); shakeAdd(3);
}

const CHARS = [
  { name: 'BLAZE', skin: '#e8b88a', shirt: '#d8392a', pants: '#6e1c14', hair: '#2e1a0c',
    speed: 2.3, run: 4.7,
    specials: [
      { name: 'Fireball', combo: 'D > A', mp: 25, cast: castFireball },
      { name: 'Inferno',  combo: 'D v A', mp: 45, cast: castInferno },
    ] },
  { name: 'FROST', skin: '#e9c6a8', shirt: '#2979c8', pants: '#173f6e', hair: '#cfe8ff',
    speed: 2.2, run: 4.4,
    specials: [
      { name: 'Ice Bolt',  combo: 'D > A', mp: 25, cast: castIceBolt },
      { name: 'Ice Storm', combo: 'D v A', mp: 45, cast: castIceStorm },
    ] },
  { name: 'VOLT', skin: '#d8a878', shirt: '#e8b800', pants: '#3a3a3a', hair: '#111',
    speed: 2.5, run: 5.1,
    specials: [
      { name: 'Lightning',    combo: 'D > A', mp: 25, cast: castBolt },
      { name: 'Thunder Dash', combo: 'D v A', mp: 35, cast: castDash },
    ] },
];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---------------------------------------------------------- attacks
const ATTACKS = {
  jab:     { dur: 14, from: 4, to: 8,   reach: 54, dmg: 10, stun: 18, knock: 1.6, pose: 'jab',     next: 'cross' },
  cross:   { dur: 16, from: 5, to: 9,   reach: 58, dmg: 12, stun: 20, knock: 2.2, pose: 'cross',   next: 'kick' },
  kick:    { dur: 22, from: 8, to: 13,  reach: 64, dmg: 16, knock: 4.5, fall: true, pose: 'kick',  next: null },
  runatk:  { dur: 24, from: 6, to: 14,  reach: 60, dmg: 18, knock: 5,   fall: true, pose: 'flykick', lunge: 4.2 },
  jumpatk: { dur: 999, from: 4, to: 999, reach: 58, dmg: 16, knock: 4,  fall: true, pose: 'flykick' },
  dash:    { dur: 22, from: 2, to: 20,  reach: 48, dmg: 24, knock: 5.5, fall: true, pose: 'flykick', lunge: 9 },
};

// ---------------------------------------------------------- controllers
class HumanCtl {
  constructor(map) { this.map = map; this.buf = []; this.lastTap = { d: 0, t: -99 }; this.runDir = 0; }
  poll(f) {
    const m = this.map;
    const a = { mx: 0, mz: 0, run: false, attack: false, jump: false, defend: !!keys[m.defend], special: -1, sdir: 0 };
    if (keys[m.left]) a.mx--;
    if (keys[m.right]) a.mx++;
    if (keys[m.up]) a.mz--;
    if (keys[m.down]) a.mz++;
    const toks = [['defend', 'D'], ['attack', 'A'], ['jump', 'J'], ['left', '<'], ['right', '>'], ['down', 'v'], ['up', '^']];
    for (const [k, t] of toks) if (pressed.has(m[k])) this.buf.push({ t, fr: frame });
    while (this.buf.length && frame - this.buf[0].fr > 40) this.buf.shift();
    for (const d of [-1, 1]) {
      if (pressed.has(d < 0 ? m.left : m.right)) {
        if (this.lastTap.d === d && frame - this.lastTap.t < 15) this.runDir = d;
        this.lastTap = { d, t: frame };
      }
    }
    if (this.runDir && !keys[this.runDir < 0 ? m.left : m.right]) this.runDir = 0;
    if (this.runDir && a.mx === this.runDir) a.run = true;
    a.attack = pressed.has(m.attack);
    a.jump = pressed.has(m.jump);
    if (a.attack && this.buf.length >= 3) {
      const n = this.buf.length;
      const [b1, b2, b3] = [this.buf[n - 3], this.buf[n - 2], this.buf[n - 1]];
      if (b3.t === 'A' && b1.t === 'D') {
        if (b2.t === '>' || b2.t === '<') { a.special = 0; a.sdir = b2.t === '>' ? 1 : -1; a.attack = false; }
        else if (b2.t === 'v' || b2.t === '^') { a.special = 1; a.attack = false; }
      }
    }
    return a;
  }
}

class AICtl {
  constructor(agg) { this.agg = agg; this.t = 0; this.defT = 0; this.a = this.idleAction(); }
  idleAction() { return { mx: 0, mz: 0, run: false, attack: false, jump: false, defend: false, special: -1, sdir: 0 }; }
  poll(f) {
    this.t--;
    if (this.t <= 0) { this.t = 6 + Math.floor(Math.random() * 9); this.decide(f); }
    if (this.defT > 0) { this.defT--; this.a.defend = true; } else if (this.a.defend && this.defT <= 0) this.a.defend = false;
    const a = { ...this.a };
    this.a.attack = false; this.a.jump = false; this.a.special = -1;   // one-shot presses
    return a;
  }
  decide(f) {
    const a = this.idleAction();
    const tgt = nearestEnemy(f);
    if (!tgt) { this.a = a; return; }
    const dx = tgt.x - f.x, dz = tgt.z - f.z, adx = Math.abs(dx);
    a.mx = adx > 46 ? Math.sign(dx) : 0;
    a.mz = Math.abs(dz) > 10 ? Math.sign(dz) : 0;
    if (adx > 260) a.run = true;
    const aligned = Math.abs(dz) < 16;
    const r = Math.random();
    if (aligned && adx < 72 && tgt.state !== 'lying' && tgt.state !== 'fall') {
      if (r < 0.2 + 0.55 * this.agg) { a.attack = true; if (dx) a.mx = Math.sign(dx); }
      else if (r < 0.75) { a.defend = true; this.defT = 22; }
    } else if (aligned && f.mp > 50 && adx > 120 && adx < 420 && r < 0.2 * this.agg) {
      a.special = 0; a.sdir = Math.sign(dx) || f.facing;
    } else if (aligned && f.mp > 60 && adx < 110 && r < 0.1 * this.agg) {
      a.special = 1;
    }
    if (tgt.state === 'atk' && adx < 90 && Math.random() < 0.25 * this.agg) { a.defend = true; this.defT = 18; }
    if (Math.random() < 0.02) a.jump = true;
    this.a = a;
  }
}

// ---------------------------------------------------------- game state
let state = 'title';       // title | mode | select | fight | over
let mode = 'story';        // story | coop | vscpu | vs2p
let frame = 0;

let fighters = [], projectiles = [], particles = [], dmgTexts = [], pickups = [];
let camX = 0, camDraw = 0, shake = 0, hitstop = 0, paused = false;
let arenaW = 1100;
let wave = 0, score = 0, banner = 0, bannerText = '', nextWaveT = 0, endTimer = -1;
let overText = '', overSub = '';
let modeSel = 0, selP1 = 0, selP2 = 1, selPhase = 0;
let previews = [];

function shakeAdd(n) { shake = Math.min(10, shake + n); }

function newFighter(chIdx, x, z, team, ctrl, o = {}) {
  const ch = CHARS[chIdx];
  return {
    chr: ch, name: o.name || ch.name, x, z, y: 0, vx: 0, vz: 0, vy: 0,
    facing: o.facing || 1, team, ctrl,
    hpMax: o.hp || 400, hp: o.hp || 400, mpMax: 100, mp: 40,
    power: o.power || 1, scale: o.scale || 1,
    state: 'idle', stateT: 0, animT: Math.random() * 100,
    atk: null, atkHit: new Set(), castIdx: 0, stun: 18, shock: 0, freezeDur: 0,
    flash: 0, inv: o.inv || 0, dying: false, dead: false, fade: 1,
    isPlayer: o.isPlayer || false, pid: o.pid || 0, boss: o.boss || false,
  };
}
function setState(f, s) { f.state = s; f.stateT = 0; }

function nearestEnemy(f) {
  let best = null, bd = 1e9;
  for (const d of fighters) {
    if (d === f || d.dead || d.dying || d.team === f.team) continue;
    const dist = Math.abs(d.x - f.x) + Math.abs(d.z - f.z) * 2;
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

// ---------------------------------------------------------- fight setup
const WAVES = [
  { n: 2, hp: 110, pow: 0.7, agg: 0.45 },
  { n: 3, hp: 130, pow: 0.8, agg: 0.6 },
  { n: 3, hp: 160, pow: 0.9, agg: 0.75 },
  { n: 4, hp: 170, pow: 1.0, agg: 0.85 },
  { n: 1, hp: 650, pow: 1.5, agg: 1.0, scale: 1.3, boss: true },
];

function startFight() {
  fighters = []; projectiles = []; particles = []; dmgTexts = []; pickups = [];
  camX = 0; shake = 0; hitstop = 0; paused = false;
  wave = 0; score = 0; banner = 0; nextWaveT = 0; endTimer = -1;
  if (mode === 'story' || mode === 'coop') {
    arenaW = 1900;
    fighters.push(newFighter(selP1, 220, 100, 1, new HumanCtl(P1K), { hp: 280, isPlayer: true, pid: 1, inv: 30 }));
    if (mode === 'coop')
      fighters.push(newFighter(selP2, 160, 140, 1, new HumanCtl(P2K), { hp: 280, isPlayer: true, pid: 2, inv: 30 }));
    nextWaveT = 50;
  } else {
    arenaW = 1100;
    fighters.push(newFighter(selP1, 300, 100, 1, new HumanCtl(P1K), { isPlayer: true, pid: 1, inv: 30 }));
    const ctl2 = mode === 'vs2p' ? new HumanCtl(P2K) : new AICtl(0.85);
    fighters.push(newFighter(selP2, 800, 100, 2, ctl2, { facing: -1, isPlayer: mode === 'vs2p', pid: 2, inv: 30 }));
    bannerText = 'FIGHT!'; banner = 80;
  }
  state = 'fight';
}

function spawnWave() {
  const wv = WAVES[wave]; wave++;
  bannerText = wv.boss ? 'BOSS!' : 'WAVE ' + wave; banner = 90;
  const px = fighters[0].x;
  for (let i = 0; i < wv.n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = clamp(px + side * rnd(480, 700), 40, arenaW - 40);
    const e = newFighter(Math.floor(Math.random() * CHARS.length), x, rnd(20, 180), 2, new AICtl(wv.agg), {
      hp: wv.hp, power: wv.pow, scale: wv.scale || 1, boss: wv.boss || false,
      name: wv.boss ? 'WARLORD' : undefined, facing: x > px ? -1 : 1, inv: 20,
    });
    fighters.push(e);
  }
}

// ---------------------------------------------------------- combat
function startAttack(f, kind) {
  setState(f, 'atk'); f.atk = kind; f.atkHit = new Set(); f.vz = 0;
  sfx('swing');
}
function trySpecial(f, i, sdir) {
  const sp = f.chr.specials[i];
  if (!sp || f.mp < sp.mp) return false;
  f.mp -= sp.mp;
  if (sdir) f.facing = sdir;
  setState(f, 'cast'); f.castIdx = i; f.vx = 0; f.vz = 0;
  sfx('cast');
  return true;
}

function applyHit(att, def, info) {
  if (def.inv > 0 || def.dead || def.dying || def.state === 'lying' || def.state === 'getup') return false;
  // block: defending and attacker is in front
  if (def.state === 'frozen') { info = { ...info, dmg: info.dmg * 1.3, fall: true, freeze: false }; shatterIce(def); setState(def, 'idle'); }
  else if (def.state === 'defend' && def.facing === -info.dir) {
    def.hp -= info.dmg * 0.12;
    def.vx = info.dir * 1.2;
    spawnSparks((att.x + def.x) / 2, def.z, 50, '#9ad', 5);
    sfx('block');
    return true;
  }
  def.hp -= info.dmg;
  def.flash = 4;
  def.shock += info.dmg;
  hitstop = 5; shakeAdd(3);
  spawnSparks((att.x + def.x) / 2, def.z, 50 + def.y, info.freeze ? '#aef' : '#ffd54f', 8);
  dmgTexts.push({ x: def.x, z: def.z, h: 95 + def.y, txt: Math.round(info.dmg), col: '#fff', life: 40 });
  if (def.hp <= 0) {
    def.hp = 0; def.dying = true;
    sfx('ko'); shakeAdd(5);
    if ((mode === 'story' || mode === 'coop') && def.team === 2) {
      score += def.boss ? 1000 : 100 + wave * 20;
      if (Math.random() < 0.4) pickups.push({ x: def.x, z: def.z, type: Math.random() < 0.5 ? 'hp' : 'mp', t: 0 });
    }
  }
  if (info.freeze && !def.dying) {
    setState(def, 'frozen'); def.freezeDur = 80; def.vx = 0; def.vz = 0;
    sfx('freeze');
  } else if (info.fall || def.shock > 42 || def.dying) {
    setState(def, 'fall');
    def.vy = 6.5; def.y = Math.max(def.y, 1);
    def.vx = info.dir * info.knock; def.shock = 0;
  } else {
    setState(def, 'hurt');
    def.stun = info.stun || 18;
    def.vx = info.dir * info.knock * 0.6;
  }
  sfx('hit');
  return true;
}

function shatterIce(f) {
  for (let i = 0; i < 14; i++)
    spawnP(f.x + rnd(-15, 15), f.z, rnd(10, 80), rnd(-3, 3), rnd(-1, 1), rnd(1, 4), rnd(20, 35), '#bfe8ff', rnd(2, 4), -0.15);
}

// ---------------------------------------------------------- fighter update
function stepFighter(f) {
  if (f.dead) return;
  f.animT++; f.stateT++;
  if (f.flash > 0) f.flash--;
  if (f.inv > 0) f.inv--;
  f.shock = Math.max(0, f.shock - 0.4);
  if (!f.dying) f.mp = Math.min(f.mpMax, f.mp + 0.12);

  // death fade-out once settled on the ground
  if (f.dying && f.state === 'lying' && f.stateT > 50) {
    f.fade -= 0.03;
    if (f.fade <= 0) { f.fade = 0; f.dead = true; }
    return;
  }

  const a = f.dying ? { mx: 0, mz: 0, run: false, attack: false, jump: false, defend: false, special: -1, sdir: 0 } : f.ctrl.poll(f);

  const airStates = new Set(['jump', 'jumpatk', 'fall']);
  const inAir = airStates.has(f.state) || f.y > 0;

  switch (f.state) {
    case 'idle': case 'walk': case 'run': {
      if (a.defend) { setState(f, 'defend'); f.vx = 0; f.vz = 0; break; }
      if (a.special >= 0 && trySpecial(f, a.special, a.sdir)) break;
      if (a.attack) { startAttack(f, f.state === 'run' ? 'runatk' : nextChain(f)); break; }
      if (a.jump) {
        f.vy = 10.2;
        f.vx = f.state === 'run' ? f.facing * f.chr.run : a.mx * f.chr.speed;
        f.vz = a.mz * f.chr.speed * 0.55;
        setState(f, 'jump'); sfx('jump'); break;
      }
      if (a.mx) f.facing = a.mx > 0 ? 1 : -1;
      const running = a.run && a.mx !== 0;
      const sp = running ? f.chr.run : f.chr.speed;
      f.vx = a.mx * sp;
      f.vz = a.mz * sp * 0.55;
      f.state = running ? 'run' : (a.mx || a.mz) ? 'walk' : 'idle';
      break;
    }
    case 'defend': {
      f.vx = 0; f.vz = 0;
      if (a.special >= 0 && trySpecial(f, a.special, a.sdir)) break;
      if (!a.defend) setState(f, 'idle');
      break;
    }
    case 'jump': {
      f.vx = clamp(f.vx + a.mx * 0.25, -f.chr.run, f.chr.run);
      if (a.attack) { setState(f, 'jumpatk'); f.atkHit = new Set(); sfx('swing'); }
      break;
    }
    case 'jumpatk':
      break;
    case 'atk': {
      const A = ATTACKS[f.atk];
      if (A.lunge && f.stateT <= A.to) f.vx = f.facing * A.lunge;
      else if (f.stateT >= A.from && f.stateT <= A.to) f.vx = f.facing * 0.8;
      else f.vx *= 0.7;
      if (a.attack && f.stateT > A.from && A.next) f.chainQ = true;
      if (f.stateT >= A.dur) {
        if (f.chainQ && A.next) { f.chainQ = false; startAttack(f, A.next); }
        else { f.chainQ = false; setState(f, 'idle'); }
      }
      break;
    }
    case 'cast': {
      if (f.stateT === 12) f.chr.specials[f.castIdx].cast(f);
      if (f.stateT >= 26 && f.state === 'cast') setState(f, 'idle');
      break;
    }
    case 'dash': {
      f.vx = f.facing * 9;
      if (frame % 2 === 0) spawnP(f.x, f.z, rnd(20, 80), rnd(-1, 1), 0, rnd(0, 2), 14, '#ffe838', rnd(2, 4), 0);
      if (f.stateT >= ATTACKS.dash.dur) { f.vx = 0; setState(f, 'idle'); }
      break;
    }
    case 'hurt': {
      f.vx *= 0.85;
      if (f.stateT >= f.stun) setState(f, 'idle');
      break;
    }
    case 'frozen': {
      f.vx *= 0.8;
      if (f.stateT >= f.freezeDur) { shatterIce(f); setState(f, 'idle'); }
      break;
    }
    case 'fall': {
      f.vx *= 0.99;
      break;
    }
    case 'lying': {
      f.vx *= 0.8;
      if (!f.dying && f.stateT >= 46) setState(f, 'getup');
      break;
    }
    case 'getup': {
      f.inv = Math.max(f.inv, 2);
      if (f.stateT >= 18) { setState(f, 'idle'); f.inv = 40; }
      break;
    }
  }

  // vertical physics
  if (inAir || f.vy > 0) {
    f.vy -= GRAV;
    f.y += f.vy;
    if (f.y <= 0) {
      f.y = 0; f.vy = 0;
      if (f.state === 'jump' || f.state === 'jumpatk') { setState(f, 'idle'); f.vx = 0; }
      else if (f.state === 'fall') {
        setState(f, 'lying'); sfx('thud'); shakeAdd(2);
        for (let i = 0; i < 8; i++) spawnP(f.x + rnd(-20, 20), f.z, 2, rnd(-1.5, 1.5), rnd(-0.6, 0.6), rnd(0.5, 1.5), 20, '#cbb', rnd(2, 4), -0.06);
      }
    }
  }

  // integrate
  f.x = clamp(f.x + f.vx, 26, arenaW - 26);
  f.z = clamp(f.z + f.vz, 0, Z_MAX);

  // pickups (players only)
  if (f.isPlayer && !f.dying) {
    for (const p of pickups) {
      if (p.got) continue;
      if (Math.abs(p.x - f.x) < 26 && Math.abs(p.z - f.z) < 16 && f.y < 20) {
        p.got = true; sfx('pickup');
        if (p.type === 'hp') { f.hp = Math.min(f.hpMax, f.hp + 70); dmgTexts.push({ x: f.x, z: f.z, h: 100, txt: '+70', col: '#7CFC00', life: 45 }); }
        else { f.mp = Math.min(f.mpMax, f.mp + 60); dmgTexts.push({ x: f.x, z: f.z, h: 100, txt: '+MP', col: '#41c7ff', life: 45 }); }
      }
    }
  }
}

function nextChain(f) {
  // continue the jab->cross->kick chain if attacking again shortly after
  if (f.lastAtk && frame - f.lastAtkT < 40 && ATTACKS[f.lastAtk].next) {
    const nx = ATTACKS[f.lastAtk].next;
    f.lastAtk = nx; f.lastAtkT = frame;
    return nx;
  }
  f.lastAtk = 'jab'; f.lastAtkT = frame;
  return 'jab';
}

function meleeHits() {
  for (const f of fighters) {
    if (f.dead) continue;
    let A = null;
    if (f.state === 'atk') A = ATTACKS[f.atk];
    else if (f.state === 'jumpatk' && f.y > 0) A = ATTACKS.jumpatk;
    else if (f.state === 'dash') A = ATTACKS.dash;
    if (!A || f.stateT < A.from || f.stateT > A.to) continue;
    for (const d of fighters) {
      if (d === f || d.dead || d.team === f.team || f.atkHit.has(d)) continue;
      const dx = (d.x - f.x) * f.facing;
      if (dx > -6 && dx < A.reach * f.scale + 12 && Math.abs(d.z - f.z) < 20 && Math.abs(d.y - f.y) < 60) {
        if (applyHit(f, d, { dmg: A.dmg * f.power, knock: A.knock, fall: A.fall, stun: A.stun, dir: f.facing }))
          f.atkHit.add(d);
        f.lastAtkT = frame;
      }
    }
  }
}

function stepProjectiles() {
  for (const p of projectiles) {
    p.x += p.vx; p.ttl--;
    const col = p.type === 'fire' ? '#ff7733' : p.type === 'ice' ? '#9fdcff' : '#ffee44';
    if (frame % 2 === 0) spawnP(p.x, p.z, p.h + rnd(-6, 6), -p.vx * 0.1, 0, rnd(-0.3, 0.3), 14, col, rnd(2, 4), 0);
    for (const d of fighters) {
      if (d.dead || d.team === p.team) continue;
      if (Math.abs(d.x - p.x) < 28 && Math.abs(d.z - p.z) < 18 && d.y < 75) {
        const hit = applyHit(p.owner, d, { dmg: p.dmg, knock: 4, fall: !p.freeze, freeze: p.freeze, stun: 20, dir: Math.sign(p.vx) || 1 });
        if (hit || d.state === 'defend') {
          p.ttl = 0;
          for (let i = 0; i < 12; i++) spawnP(p.x, p.z, p.h, rnd(-3, 3), rnd(-1, 1), rnd(-1, 3), rnd(15, 30), col, rnd(2, 5), -0.1);
          break;
        }
      }
    }
    if (p.x < -50 || p.x > arenaW + 50) p.ttl = 0;
  }
  projectiles = projectiles.filter(p => p.ttl > 0);
}

// ---------------------------------------------------------- particles & text
function spawnP(x, z, h, vx, vz, vh, life, col, size, grav) {
  if (particles.length > 350) return;
  particles.push({ x, z, h, vx, vz, vh, life, max: life, col, size, grav });
}
function spawnSparks(x, z, h, col, n) {
  for (let i = 0; i < n; i++) spawnP(x, z, h + rnd(-10, 10), rnd(-3.5, 3.5), rnd(-1, 1), rnd(-2, 3.5), rnd(12, 24), col, rnd(2, 4), -0.18);
}
function stepFx() {
  for (const p of particles) { p.x += p.vx; p.z += p.vz; p.h += p.vh; p.vh += p.grav; p.life--; }
  particles = particles.filter(p => p.life > 0);
  for (const t of dmgTexts) { t.h += 1.2; t.life--; }
  dmgTexts = dmgTexts.filter(t => t.life > 0);
  for (const p of pickups) p.t++;
  pickups = pickups.filter(p => !p.got && p.t < 720);
}

// ---------------------------------------------------------- fight loop
function updateFight() {
  if (pr('KeyP') || pr('Escape')) paused = !paused;
  if (paused) return;

  if (hitstop > 0) hitstop--;
  else {
    for (const f of fighters) stepFighter(f);
    meleeHits();
    stepProjectiles();
  }
  stepFx();
  if (banner > 0) banner--;
  if (shake > 0) shake *= 0.88;

  // camera follows the players (stage) or everyone (vs)
  const ps = (mode === 'story' || mode === 'coop')
    ? fighters.filter(f => f.team === 1 && !f.dead)
    : fighters.filter(f => !f.dead);
  const all = ps.length ? ps : fighters.filter(f => !f.dead);
  if (all.length) {
    const cx = all.reduce((s, f) => s + f.x, 0) / all.length - W / 2;
    camX += (clamp(cx, 0, Math.max(0, arenaW - W)) - camX) * 0.08;
  }

  // story flow
  if (mode === 'story' || mode === 'coop') {
    const foes = fighters.filter(f => f.team === 2 && !f.dying && !f.dead);
    if (foes.length === 0 && endTimer < 0) {
      if (wave < WAVES.length) {
        if (nextWaveT > 0) { nextWaveT--; if (nextWaveT === 0) spawnWave(); }
        else nextWaveT = 70;
      } else {
        endTimer = 80; overText = 'STAGE CLEAR!'; overSub = 'SCORE: ' + score;
      }
    }
    const alive1 = fighters.filter(f => f.team === 1 && !f.dying);
    if (alive1.length === 0 && endTimer < 0) { endTimer = 80; overText = 'GAME OVER'; overSub = 'SCORE: ' + score; }
  } else {
    if (endTimer < 0) {
      const t1 = fighters.filter(f => f.team === 1 && !f.dying);
      const t2 = fighters.filter(f => f.team === 2 && !f.dying);
      if (t1.length === 0) { endTimer = 80; overText = (mode === 'vs2p' ? 'PLAYER 2 WINS!' : 'CPU WINS!'); overSub = ''; }
      else if (t2.length === 0) { endTimer = 80; overText = 'PLAYER 1 WINS!'; overSub = ''; }
    }
  }
  if (endTimer > 0) endTimer--;
  if (endTimer === 0) state = 'over';
}

// ---------------------------------------------------------- drawing: world
function drawArena() {
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, '#6db5dd'); g.addColorStop(1, '#dff0fa');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND_Y);
  // sun
  ctx.fillStyle = '#fff3b0';
  ctx.beginPath(); ctx.arc(W - 150, 80, 36, 0, 7); ctx.fill();
  // clouds (slow parallax)
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 5; i++) {
    const cx = ((i * 420 + 130 - camDraw * 0.15) % (W + 300) + W + 300) % (W + 300) - 150;
    const cy = 50 + (i * 37) % 90;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 55, 16, 0, 0, 7);
    ctx.ellipse(cx + 30, cy - 10, 35, 13, 0, 0, 7);
    ctx.fill();
  }
  // far hills
  ctx.fillStyle = '#9cc49a';
  for (let i = 0; i < 8; i++) {
    const hx = ((i * 330 - camDraw * 0.3) % (W + 500) + W + 500) % (W + 500) - 250;
    ctx.beginPath(); ctx.arc(hx, GROUND_Y + 40, 150 + (i % 3) * 40, Math.PI, 0); ctx.fill();
  }
  // near hills
  ctx.fillStyle = '#7fae74';
  for (let i = 0; i < 8; i++) {
    const hx = ((i * 410 + 180 - camDraw * 0.55) % (W + 500) + W + 500) % (W + 500) - 250;
    ctx.beginPath(); ctx.arc(hx, GROUND_Y + 60, 200 + (i % 2) * 60, Math.PI, 0); ctx.fill();
  }
  // ground
  const gg = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  gg.addColorStop(0, '#9ccc60'); gg.addColorStop(1, '#46702a');
  ctx.fillStyle = gg; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, GROUND_Y, W, 3);
  // grass tufts (fixed world positions)
  ctx.strokeStyle = '#3c6322'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const wx = (i * 167) % arenaW, wz = (i * 89) % Z_MAX;
    const sx = wx - camDraw, sy = GROUND_Y + wz;
    if (sx < -10 || sx > W + 10) continue;
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(sx - 3, sy - 7);
    ctx.moveTo(sx, sy); ctx.lineTo(sx + 3, sy - 8);
    ctx.stroke();
  }
  // trees
  for (let i = 0; i < Math.floor(arenaW / 420); i++) {
    const wx = 210 + i * 430, sx = wx - camDraw, sy = GROUND_Y + 8;
    if (sx < -80 || sx > W + 80) continue;
    ctx.fillStyle = '#5d4023'; ctx.fillRect(sx - 6, sy - 64, 12, 64);
    ctx.fillStyle = '#3f7a30';
    ctx.beginPath(); ctx.arc(sx, sy - 80, 36, 0, 7); ctx.arc(sx - 24, sy - 62, 26, 0, 7); ctx.arc(sx + 24, sy - 62, 26, 0, 7); ctx.fill();
  }
}

// ---------------------------------------------------------- drawing: fighters
function strokeSeg(x0, y0, x1, y1, w, col) {
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
function limb(x, y, a1, l1, a2, l2, w, c1, c2) {
  const mx = x + Math.sin(a1) * l1, my = y + Math.cos(a1) * l1;
  strokeSeg(x, y, mx, my, w, c1);
  const ex = mx + Math.sin(a1 + a2) * l2, ey = my + Math.cos(a1 + a2) * l2;
  strokeSeg(mx, my, ex, ey, w - 1, c2);
}

function getPose(f) {
  // angles: 0 = straight down, positive = toward facing direction
  const P = { rot: 0, hipDrop: 0, lean: 0, headFwd: 0,
    armF: [0.3, 0.45], armB: [-0.22, 0.4], legF: [0.12, 0], legB: [-0.12, 0] };
  const t = f.stateT;
  switch (f.state) {
    case 'idle': {
      const b = Math.sin(f.animT * 0.07) * 0.06;
      P.armF = [0.38 + b, 0.55]; P.armB = [-0.26 - b, 0.45];
      break;
    }
    case 'walk': {
      const s = Math.sin(f.animT * 0.22);
      P.legF = [s * 0.5, Math.min(0, s) * 0.7]; P.legB = [-s * 0.5, Math.min(0, -s) * 0.7];
      P.armF = [-s * 0.45, 0.4]; P.armB = [s * 0.45, 0.4];
      break;
    }
    case 'run': {
      const s = Math.sin(f.animT * 0.32);
      P.lean = 0.28;
      P.legF = [s * 0.85, Math.min(0, s) * 1.0]; P.legB = [-s * 0.85, Math.min(0, -s) * 1.0];
      P.armF = [-s * 0.7, 0.9]; P.armB = [s * 0.7, 0.9];
      break;
    }
    case 'jump':
      P.legF = [0.5, -0.95]; P.legB = [-0.15, -0.5];
      P.armF = [0.95, 0.3]; P.armB = [-0.85, 0.25];
      break;
    case 'defend':
      P.hipDrop = 4; P.lean = 0.08;
      P.armF = [1.05, 1.25]; P.armB = [0.9, 1.35];
      break;
    case 'atk': {
      const A = ATTACKS[f.atk], act = t >= A.from && t <= A.to;
      if (A.pose === 'jab') { P.armF = act ? [1.55, 0.05] : [0.7, 0.95]; P.armB = [-0.3, 0.6]; P.lean = act ? 0.16 : 0.05; }
      else if (A.pose === 'cross') { P.armB = act ? [1.6, 0.05] : [0.5, 1.05]; P.armF = [0.85, 0.85]; P.lean = act ? 0.24 : 0.08; }
      else if (A.pose === 'kick') { P.legF = act ? [1.5, 0.05] : [0.6, -0.85]; P.lean = act ? -0.18 : 0.04; P.armF = [0.5, 0.6]; P.armB = [-0.5, 0.5]; }
      else { P.legF = [1.35, 0.05]; P.legB = [-0.4, -0.85]; P.lean = 0.35; P.armF = [-0.4, 0.6]; P.armB = [0.7, 0.45]; }
      break;
    }
    case 'jumpatk':
      P.legF = [1.35, 0.05]; P.legB = [-0.4, -0.85]; P.lean = 0.35;
      P.armF = [-0.4, 0.6]; P.armB = [0.7, 0.45];
      break;
    case 'cast': {
      const c = t > 9 && t < 22;
      P.armF = c ? [1.5, 0.05] : [0.9, 1.0]; P.armB = c ? [1.42, 0.05] : [0.8, 1.1];
      P.lean = c ? 0.12 : -0.06;
      break;
    }
    case 'dash':
      P.legF = [1.35, 0.05]; P.legB = [-0.4, -0.85]; P.lean = 0.42;
      P.armF = [1.3, 0.05]; P.armB = [0.6, 0.4];
      break;
    case 'hurt':
      P.lean = -0.22; P.headFwd = -0.25;
      P.armF = [-0.6, 0.4]; P.armB = [0.75, 0.5];
      break;
    case 'frozen':
      P.armF = [0.6, 0.7]; P.armB = [-0.5, 0.6];
      break;
    case 'fall':
      P.rot = -1.1 - Math.min(0.45, t * 0.025); P.hipDrop = 8;
      P.armF = [-0.85, 0.3]; P.armB = [0.95, 0.3]; P.legF = [0.45, 0.35]; P.legB = [-0.3, 0.45];
      break;
    case 'lying':
      P.rot = -1.52; P.hipDrop = 27;
      P.legF = [0.15, 0.1]; P.legB = [-0.1, 0.12]; P.armF = [0.35, 0.2]; P.armB = [-0.25, 0.2];
      break;
    case 'getup': {
      const k = 1 - t / 18;
      P.rot = -1.52 * k; P.hipDrop = 27 * k;
      break;
    }
  }
  return P;
}

function drawBody(f, sx, sy) {
  const P = getPose(f);
  const flash = f.flash > 0;
  const ch = f.chr;
  const skin = flash ? '#fff' : ch.skin, shirt = flash ? '#fff' : ch.shirt,
    pants = flash ? '#fff' : ch.pants, hair = flash ? '#fff' : ch.hair;
  ctx.save();
  ctx.translate(sx, sy - f.y);
  ctx.globalAlpha = f.fade;
  ctx.scale(f.facing * f.scale, f.scale);
  ctx.translate(0, -39 + P.hipDrop);  // move origin to the hip
  ctx.rotate(-P.rot);

  const shx = Math.sin(P.lean) * 34, shy = -Math.cos(P.lean) * 34;
  // back limbs first
  limb(shx, shy, P.armB[0] + P.lean, 16, P.armB[1], 14, 7, shirt, skin);
  limb(0, 0, P.legB[0], 20, P.legB[1], 19, 8, pants, pants);
  // torso
  strokeSeg(0, 0, shx, shy, 13, shirt);
  // head
  const ha = P.lean + P.headFwd;
  const hx = shx + Math.sin(ha) * 13, hy = shy - Math.cos(ha) * 13;
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(hx, hy, 10, 0, 7); ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(hx - 1, hy - 3, 10, Math.PI * 0.95, Math.PI * 2.02); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(hx + 5, hy + 1, 1.6, 0, 7); ctx.fill();
  // front limbs
  limb(0, 0, P.legF[0], 20, P.legF[1], 19, 8, pants, pants);
  limb(shx, shy, P.armF[0] + P.lean, 16, P.armF[1], 14, 7, shirt, skin);
  ctx.restore();

  if (f.state === 'frozen') {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#a8dcff';
    ctx.strokeStyle = '#e2f5ff'; ctx.lineWidth = 2;
    const ix = sx - 24 * f.scale, iy = sy - f.y - 94 * f.scale;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ix, iy, 48 * f.scale, 98 * f.scale, 8);
    else ctx.rect(ix, iy, 48 * f.scale, 98 * f.scale);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function drawFighter(f) {
  if (f.dead) return;
  const sx = f.x - camDraw, sy = GROUND_Y + f.z;
  if (sx < -80 || sx > W + 80) return;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(sx, sy, 20 * f.scale, 6 * f.scale, 0, 0, 7); ctx.fill();
  // post-getup invulnerability blink
  if (f.inv > 0 && !f.dying && (frame >> 2) % 2 === 0 && f.state !== 'getup') {
    // skip body draw on blink frames
  } else {
    drawBody(f, sx, sy);
  }
  // tags
  if (state !== 'fight' && state !== 'over') return;
  if (f.isPlayer) {
    ctx.fillStyle = f.pid === 1 ? '#41c7ff' : '#ffae42';
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('P' + f.pid, sx, sy - f.y - 108 * f.scale);
    ctx.beginPath();
    ctx.moveTo(sx - 5, sy - f.y - 104 * f.scale);
    ctx.lineTo(sx + 5, sy - f.y - 104 * f.scale);
    ctx.lineTo(sx, sy - f.y - 98 * f.scale);
    ctx.fill();
  } else if ((mode === 'story' || mode === 'coop') && !f.dying) {
    const bw = f.boss ? 56 : 36, by = sy - f.y - (f.boss ? 132 : 104) * f.scale;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sx - bw / 2, by, bw, 5);
    ctx.fillStyle = f.boss ? '#ff4444' : '#e05050';
    ctx.fillRect(sx - bw / 2, by, bw * (f.hp / f.hpMax), 5);
  }
}

// ---------------------------------------------------------- drawing: fx, hud
function drawFx() {
  for (const p of particles) {
    const sx = p.x - camDraw, sy = GROUND_Y + p.z - p.h;
    ctx.globalAlpha = p.life / p.max;
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const t of dmgTexts) {
    ctx.globalAlpha = Math.min(1, t.life / 15);
    ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000'; ctx.fillText(t.txt, t.x - camDraw + 1, GROUND_Y + t.z - t.h + 1);
    ctx.fillStyle = t.col; ctx.fillText(t.txt, t.x - camDraw, GROUND_Y + t.z - t.h);
  }
  ctx.globalAlpha = 1;
}

function drawProjectiles() {
  for (const p of projectiles) {
    const sx = p.x - camDraw, sy = GROUND_Y + p.z - p.h;
    const col = p.type === 'fire' ? '#ff7733' : p.type === 'ice' ? '#9fdcff' : '#ffee44';
    const core = p.type === 'fire' ? '#fff1a8' : p.type === 'ice' ? '#ffffff' : '#fffbe0';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(sx, sy, 11, 0, 7); ctx.fill();
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 7); ctx.fill();
    // soft shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(sx, GROUND_Y + p.z, 9, 3, 0, 0, 7); ctx.fill();
  }
}

function drawPickups() {
  for (const p of pickups) {
    if (p.got) continue;
    const sx = p.x - camDraw, sy = GROUND_Y + p.z - 6 - Math.abs(Math.sin(p.t * 0.08)) * 6;
    if (p.t > 600 && (frame >> 3) % 2 === 0) continue;  // blink before despawn
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(sx, GROUND_Y + p.z, 8, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = p.type === 'hp' ? '#f6f6f0' : '#41c7ff';
    ctx.fillRect(sx - 5, sy - 16, 10, 16);
    ctx.fillRect(sx - 2.5, sy - 21, 5, 6);
    ctx.fillStyle = p.type === 'hp' ? '#e05050' : '#1565c0';
    ctx.fillRect(sx - 5, sy - 10, 10, 4);
  }
}

function drawBarUI(x, y, w, h, frac, col, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#333';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
}

function drawPortrait(x, y, ch) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, 40, 40);
  ctx.fillStyle = ch.shirt; ctx.fillRect(x + 8, y + 28, 24, 12);
  ctx.fillStyle = ch.skin;
  ctx.beginPath(); ctx.arc(x + 20, y + 18, 11, 0, 7); ctx.fill();
  ctx.fillStyle = ch.hair;
  ctx.beginPath(); ctx.arc(x + 19, y + 15, 11, Math.PI * 0.95, Math.PI * 2.02); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(x + 25, y + 19, 1.7, 0, 7); ctx.fill();
  ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.strokeRect(x, y, 40, 40);
}

function drawHud() {
  const p1 = fighters.find(f => f.pid === 1);
  const p2 = fighters.find(f => f.pid === 2);
  ctx.textAlign = 'left'; ctx.font = 'bold 14px monospace';
  if (p1) {
    drawPortrait(12, 10, p1.chr);
    drawBarUI(60, 14, 220, 14, p1.hp / p1.hpMax, p1.hp / p1.hpMax > 0.3 ? '#e23b3b' : '#ff7043');
    drawBarUI(60, 34, 220, 8, p1.mp / p1.mpMax, '#41a7ff');
    ctx.fillStyle = '#fff'; ctx.fillText(p1.name, 62, 56);
  }
  if (p2) {
    drawPortrait(W - 52, 10, p2.chr);
    drawBarUI(W - 280, 14, 220, 14, p2.hp / p2.hpMax, '#e23b3b');
    drawBarUI(W - 280, 34, 220, 8, p2.mp / p2.mpMax, '#41a7ff');
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff'; ctx.fillText(p2.name + (p2.isPlayer ? '' : ' (CPU)'), W - 62, 56);
  }
  if (mode === 'story' || mode === 'coop') {
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace';
    ctx.fillText('WAVE ' + Math.max(1, wave) + '/' + WAVES.length, W / 2, 24);
    ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#ffd54f';
    ctx.fillText('SCORE ' + score, W / 2, 44);
  }
  if (banner > 0) {
    ctx.globalAlpha = Math.min(1, banner / 20);
    ctx.font = 'bold 52px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000'; ctx.fillText(bannerText, W / 2 + 3, H / 2 - 37);
    ctx.fillStyle = bannerText === 'BOSS!' ? '#ff5252' : '#ffd54f';
    ctx.fillText(bannerText, W / 2, H / 2 - 40);
    ctx.globalAlpha = 1;
  }
  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = '16px monospace';
    ctx.fillText('press P to resume', W / 2, H / 2 + 34);
  }
}

function drawFight() {
  camDraw = camX + (shake > 0.5 ? rnd(-shake, shake) : 0);
  drawArena();
  drawPickups();
  const drawable = fighters.filter(f => !f.dead).sort((a, b) => a.z - b.z);
  for (const f of drawable) drawFighter(f);
  drawProjectiles();
  drawFx();
  drawHud();
}

// ---------------------------------------------------------- menus
const MODES = [
  { id: 'story', name: 'STAGE MODE',        desc: 'Fight 5 waves of enemies (1 player)' },
  { id: 'coop',  name: 'STAGE MODE CO-OP',  desc: 'Fight the waves together (2 players)' },
  { id: 'vscpu', name: 'VS CPU',            desc: 'Duel against the computer' },
  { id: 'vs2p',  name: 'VS 2P',             desc: 'Local duel, player vs player' },
];

function makePreview(i) {
  return { chr: CHARS[i], state: 'idle', stateT: 0, animT: rnd(0, 100), facing: 1, y: 0, vy: 0, flash: 0, fade: 1, scale: 1.5, atk: null };
}

function updateMenus() {
  if (state === 'title') {
    if (pr('Enter') || pr(P1K.attack) || pr('Space')) { state = 'mode'; sfx('select'); }
    return;
  }
  if (state === 'mode') {
    if (pr(P1K.up) || pr(P2K.up)) { modeSel = (modeSel + MODES.length - 1) % MODES.length; sfx('select'); }
    if (pr(P1K.down) || pr(P2K.down)) { modeSel = (modeSel + 1) % MODES.length; sfx('select'); }
    if (pr('Enter') || pr(P1K.attack)) {
      mode = MODES[modeSel].id;
      state = 'select'; selPhase = 0; selP1 = 0; selP2 = 1;
      previews = CHARS.map((_, i) => makePreview(i));
      sfx('select');
    }
    return;
  }
  if (state === 'select') {
    for (const p of previews) p.animT++;
    const needsP2 = mode === 'coop' || mode === 'vs2p';
    if (selPhase === 0) {
      if (pr(P1K.left)) { selP1 = (selP1 + CHARS.length - 1) % CHARS.length; sfx('select'); }
      if (pr(P1K.right)) { selP1 = (selP1 + 1) % CHARS.length; sfx('select'); }
      if (pr(P1K.attack) || pr('Enter')) {
        sfx('select');
        if (needsP2) selPhase = 1;
        else {
          if (mode === 'vscpu') selP2 = Math.floor(Math.random() * CHARS.length);
          startFight();
        }
      }
    } else {
      if (pr(P2K.left)) { selP2 = (selP2 + CHARS.length - 1) % CHARS.length; sfx('select'); }
      if (pr(P2K.right)) { selP2 = (selP2 + 1) % CHARS.length; sfx('select'); }
      if (pr(P2K.attack) || pr('Enter')) { sfx('select'); startFight(); }
    }
    if (pr('Escape')) { state = 'mode'; }
    return;
  }
  if (state === 'over') {
    stepFx();
    for (const f of fighters) if (f.dying && !f.dead) stepFighter(f);
    if (pr('Enter') || pr(P1K.attack) || pr(P2K.attack)) { state = 'title'; sfx('select'); }
  }
}

function drawTitle() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a1a2e'); g.addColorStop(1, '#30304e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // floating embers
  for (let i = 0; i < 30; i++) {
    const ex = (i * 167 + frame * (0.3 + (i % 5) * 0.12)) % W;
    const ey = H - ((i * 97 + frame * (0.5 + (i % 3) * 0.3)) % H);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = i % 2 ? '#ff8c42' : '#ffd54f';
    ctx.beginPath(); ctx.arc(ex, ey, 2 + (i % 3), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.font = 'bold 74px monospace';
  ctx.fillStyle = '#000'; ctx.fillText('LITTLE FIGHTERZ', W / 2 + 5, 215);
  const tg = ctx.createLinearGradient(0, 150, 0, 230);
  tg.addColorStop(0, '#ffd54f'); tg.addColorStop(1, '#ff5722');
  ctx.fillStyle = tg; ctx.fillText('LITTLE FIGHTERZ', W / 2, 210);
  ctx.font = '18px monospace'; ctx.fillStyle = '#9aa0b4';
  ctx.fillText('a tiny tribute to Little Fighter 2', W / 2, 255);
  if ((frame >> 5) % 2 === 0) {
    ctx.font = 'bold 24px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('PRESS ENTER', W / 2, 380);
  }
  ctx.font = '14px monospace'; ctx.fillStyle = '#666e85';
  ctx.fillText('move WASD · attack J · jump K · defend L · specials D>A / DvA', W / 2, 480);
}

function drawModeMenu() {
  drawTitle();
  ctx.fillStyle = 'rgba(10,10,20,0.82)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 36px monospace'; ctx.fillStyle = '#ffd54f';
  ctx.fillText('SELECT MODE', W / 2, 120);
  for (let i = 0; i < MODES.length; i++) {
    const y = 190 + i * 70, sel = i === modeSel;
    if (sel) {
      ctx.fillStyle = 'rgba(255,213,79,0.12)';
      ctx.fillRect(W / 2 - 280, y - 32, 560, 58);
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - 280, y - 32, 560, 58);
    }
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = sel ? '#fff' : '#8b91a6';
    ctx.fillText(MODES[i].name, W / 2, y);
    ctx.font = '13px monospace';
    ctx.fillStyle = sel ? '#cfd2dc' : '#5a5f72';
    ctx.fillText(MODES[i].desc, W / 2, y + 19);
  }
  ctx.font = '14px monospace'; ctx.fillStyle = '#666e85';
  ctx.fillText('W/S — choose    ENTER or J — confirm', W / 2, 505);
}

function drawSelect() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a1a2e'); g.addColorStop(1, '#30304e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 32px monospace'; ctx.fillStyle = '#ffd54f';
  const who = selPhase === 0 ? 'PLAYER 1' : 'PLAYER 2';
  ctx.fillText(who + ' — CHOOSE YOUR FIGHTER', W / 2, 70);
  const cw = 250, gap = 40, total = CHARS.length * cw + (CHARS.length - 1) * gap;
  const x0 = (W - total) / 2;
  for (let i = 0; i < CHARS.length; i++) {
    const x = x0 + i * (cw + gap), y = 110, hgt = 330;
    const ch = CHARS[i];
    const selBy1 = selPhase === 0 && i === selP1;
    const selBy2 = selPhase === 1 && i === selP2;
    const locked1 = selPhase === 1 && i === selP1;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y, cw, hgt);
    if (selBy1 || selBy2) {
      ctx.strokeStyle = selBy1 ? '#41c7ff' : '#ffae42'; ctx.lineWidth = 4;
      ctx.strokeRect(x, y, cw, hgt);
    } else if (locked1) {
      ctx.strokeStyle = 'rgba(65,199,255,0.4)'; ctx.lineWidth = 3;
      ctx.strokeRect(x, y, cw, hgt);
    } else {
      ctx.strokeStyle = '#444'; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cw, hgt);
    }
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = (selBy1 || selBy2) ? '#fff' : '#9aa0b4';
    ctx.fillText(ch.name, x + cw / 2, y + 36);
    drawBody(previews[i], x + cw / 2, y + 220);
    ctx.font = '13px monospace';
    for (let s = 0; s < ch.specials.length; s++) {
      const sp = ch.specials[s];
      ctx.fillStyle = '#cfd2dc';
      ctx.fillText(sp.name + '  [' + sp.combo + ']  ' + sp.mp + 'mp', x + cw / 2, y + 262 + s * 22);
    }
    if (locked1) {
      ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#41c7ff';
      ctx.fillText('P1', x + cw / 2, y + hgt - 12);
    }
  }
  ctx.font = '14px monospace'; ctx.fillStyle = '#666e85';
  const keysHint = selPhase === 0 ? 'A/D — choose    J — confirm' : '←/→ — choose    ,(comma) — confirm';
  ctx.fillText(keysHint + '    ESC — back', W / 2, 510);
}

function drawOver() {
  drawFight();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 56px monospace';
  ctx.fillStyle = '#000'; ctx.fillText(overText, W / 2 + 4, H / 2 - 16);
  ctx.fillStyle = overText === 'GAME OVER' ? '#ff5252' : '#ffd54f';
  ctx.fillText(overText, W / 2, H / 2 - 20);
  if (overSub) {
    ctx.font = 'bold 24px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText(overSub, W / 2, H / 2 + 30);
  }
  if ((frame >> 5) % 2 === 0) {
    ctx.font = '18px monospace'; ctx.fillStyle = '#cfd2dc';
    ctx.fillText('ENTER — back to menu', W / 2, H / 2 + 90);
  }
}

// ---------------------------------------------------------- main loop
function loop() {
  frame++;
  if (state === 'fight') updateFight();
  else updateMenus();

  if (state === 'title') drawTitle();
  else if (state === 'mode') drawModeMenu();
  else if (state === 'select') drawSelect();
  else if (state === 'fight') drawFight();
  else if (state === 'over') drawOver();

  pressed.clear();
  requestAnimationFrame(loop);
}
loop();
