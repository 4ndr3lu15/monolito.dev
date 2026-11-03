// monolito.dev: a small white planet with the Monolito going up on its north pole.
// Click the crane to stack it, click MINITRON (the pet bot, minitron.js) to drive it and pick up the 14 bits.
// It is the visitor's planet too: they build on it, take things away and choose its colors and MINITRON's,
// all kept in their browser.
// Three.js, no build step. Each game is a mode; adding one means a new mode and a tag.

import * as THREE from './three.module.js?v=3feb33f3bc';
import { createMinitron, BOT_COLORS } from './minitron.js?v=8cbd2e3768';

// ------------------------------------------------------------------ constants

const R = 20;                                 // the planet; its north pole is the building site, at the origin
const CENTER = new THREE.Vector3(0, -R, 0);
const UP = new THREE.Vector3(0, 1, 0);

const COURSES = 30;                           // courses to top out
const DECOR = 11;                             // courses already standing when the page opens
const COURSE_H = 0.36;
const BASE = 2.6;
const TOP_RATIO = 0.62;                       // the shaft narrows to this at the top
const PLINTH_H = 0.42, PLINTH_W = 4.2;
const JIB_Y = 16.4, JIB_LEN = 10;
const MAST = { x: -5.6, z: 1.0 };
const RANGE = 2.6;                            // how far a load travels either side of its target
const HANG = 0.8;
const SLING = 0.62;
const PERFECT = 0.07;                         // closer than this snaps into place
const GROW = 0.14;                            // what a perfect streak gives back
const MIN_SIZE = 0.16;
const G = 30;
const BRICK_L = 0.44, ROW_H = COURSE_H / 2, TEX_COLS = 8, TEX_ROWS = 4;
const TEX_W = BRICK_L * TEX_COLS, TEX_H = ROW_H * TEX_ROWS;

const BITS = 14;
const WALK = 7.5;                             // MINITRON's speed, units a second
const WANDER = 2.2;                           // and when it strolls about on its own

const PAINTS = [
  ['Signal', '#e66100'], ['Graphite', '#3a3d42'], ['Chalk', '#eeece6'],
  ['Butter', '#f2c440'], ['Cobalt', '#3a6fd8'], ['Sage', '#86a58c'],
];

const C = {
  planet: '#ebe8e1', planetLow: '#dcd8ce', stone: '#f6f4ef', concrete: '#dedad2', steel: '#4f5258',
  glass: '#33414a', mortar: '#d3cfc6', bricks: ['#fdfcf9', '#f7f5f0', '#faf9f5', '#f2f0ea', '#fbfaf6', '#f4f2ec'],
  wood: '#dcc9ad', cone: '#e66100', cap: '#fbfaf7', flag: '#e66100', blueprint: '#b9b4aa',
  tree: '#f7f6f2', rock: '#e2ded5', robot: '#41454c', eye: '#ff7a1a', bit: '#e66100', cloud: '#ffffff',
};

const ideal = (i) => BASE * (1 - (1 - TOP_RATIO) * i / (COURSES - 1));
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ page

const $ = (id) => document.getElementById(id);
const ui = {
  root: $('mono'), stage: $('stage'), back: $('back'), mute: $('mute'),
  tagCrane: $('tag-crane'), tagBot: $('tag-minitron'),
  score: $('score'), goal: $('goal'), toast: $('toast'), hint: $('hint'),
  card: $('card'), title: $('card-title'), text: $('card-text'), paints: $('paints'), go: $('go'), best: $('best'),
  build: $('build'), builder: $('builder'), pieces: $('pieces'), buildPaints: $('build-paints'),
  buildCount: $('build-count'), buildClear: $('build-clear'),
  looks: $('looks'), lookReset: $('look-reset'), tabBuild: $('tab-build'), tabColors: $('tab-colors'),
  paneBuild: $('pane-build'), paneColors: $('pane-colors'),
};

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};
let best = Number(store.get('monolito.best')) || 0;
let muted = store.get('monolito.muted') === '1';
let paint = PAINTS.find(([name]) => name === store.get('monolito.paint')) || PAINTS[0];

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  ui.root.classList.add('no-gl');
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
ui.stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 600);

// ------------------------------------------------------------------ helpers

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function rod(a, b, r, mat, parent = scene) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 6), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

function texture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ the planet

// the ground's height over the sphere, flat around the building site
function lift(d) {
  const calm = smooth(0.34, 0.6, Math.acos(clamp(d.y, -1, 1)));
  const n = Math.sin(d.x * 5.1 + 1.3) * Math.sin(d.y * 4.3 + 0.7) * Math.sin(d.z * 4.7 + 2.1)
    + 0.35 * Math.sin(d.x * 11 + d.z * 9 + 0.4) * Math.sin(d.y * 7 - 0.6);
  return n * 0.55 * calm;
}
const surface = (d, up = 0) => d.clone().multiplyScalar(R + lift(d) + up).add(CENTER);
const dirAt = (x, z) => new THREE.Vector3(x, R, z).normalize();       // a spot near the site, as a direction
const dirOf = (p) => p.clone().sub(CENTER).normalize();

function stand(obj, d, up = 0, yaw = 0) {
  obj.position.copy(surface(d, up));
  obj.quaternion.setFromUnitVectors(UP, d);
  obj.rotateY(yaw);
  return obj;
}

function randomDir(rand) {
  const y = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - y * y);
  return new THREE.Vector3(Math.cos(a) * s, y, Math.sin(a) * s);
}

const planetHeights = [];
const planet = (() => {
  const geo = new THREE.SphereGeometry(1, 192, 128);
  const p = geo.attributes.position, colors = new Float32Array(p.count * 3);
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    const h = lift(d);
    p.setXYZ(i, d.x * (R + h), d.y * (R + h), d.z * (R + h));
    planetHeights.push(h);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.position.copy(CENTER);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

// the ground's colors: high ground in one, low in the other
function paintGround(high, low) {
  const colors = planet.geometry.attributes.color, hi = new THREE.Color(high), lo = new THREE.Color(low), c = new THREE.Color();
  planetHeights.forEach((h, i) => {
    c.copy(lo).lerp(hi, clamp(0.55 + h * 1.3, 0, 1));
    colors.setXYZ(i, c.r, c.g, c.b);
  });
  colors.needsUpdate = true;
}
paintGround(C.planet, C.planetLow);

// ------------------------------------------------------------------ light

scene.add(new THREE.HemisphereLight('#ffffff', '#d9d3c8', 1.55));
const sun = new THREE.DirectionalLight('#fff6ec', 2.5);
const SUN_FROM = new THREE.Vector3(26, 44, 34).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 4;
scene.add(sun, sun.target);
const shadowFocus = new THREE.Vector3(0, -6, 0);
let shadowSize = 0;

function aimSun(focus, size) {
  shadowFocus.copy(focus);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(SUN_FROM, 70);
  if (Math.abs(size - shadowSize) > 0.05) {
    shadowSize = size;
    Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 160 });
    sun.shadow.camera.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------ textures

function brickTextures() {
  const bw = 128, bh = 64, W = bw * TEX_COLS, H = bh * TEX_ROWS, m = 8;
  const [c, g] = canvas(W, H), [b, gb] = canvas(W, H);
  const rand = rng(11);
  g.fillStyle = C.mortar; g.fillRect(0, 0, W, H);
  gb.fillStyle = '#1a1a1a'; gb.fillRect(0, 0, W, H);
  if ('filter' in gb) gb.filter = 'blur(3px)';
  for (let r = 0; r < TEX_ROWS; r++) {
    const off = r % 2 ? bw / 2 : 0;
    const row = Array.from({ length: TEX_COLS }, () => C.bricks[Math.floor(rand() * C.bricks.length)]);
    for (let k = -1; k <= TEX_COLS; k++) {
      const x = k * bw + off + m / 2, y = r * bh + m / 2, w = bw - m, h = bh - m;
      g.fillStyle = row[(k + TEX_COLS) % TEX_COLS];
      g.beginPath(); g.roundRect(x, y, w, h, 5); g.fill();
      const shade = g.createLinearGradient(0, y, 0, y + h);
      shade.addColorStop(0, 'rgba(255,255,255,0.5)');
      shade.addColorStop(0.4, 'rgba(255,255,255,0)');
      shade.addColorStop(1, 'rgba(90,80,64,0.07)');
      g.fillStyle = shade;
      g.beginPath(); g.roundRect(x, y, w, h, 5); g.fill();
      gb.fillStyle = '#e6e6e6';
      gb.beginPath(); gb.roundRect(x + 1, y + 1, w - 2, h - 2, 7); gb.fill();
    }
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(80,70,60,0.035)';
    g.fillRect(rand() * W, rand() * H, 2 + rand() * 2, 2);
  }
  const bump = texture(b);
  bump.colorSpace = THREE.NoColorSpace;
  return { map: texture(c), bump };
}

// the crane's members are solid, with the lattice drawn on: it reads cleanly from far away
function latticeTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 5; g.strokeRect(10, 10, 108, 108);
  g.lineWidth = 4; g.beginPath(); g.moveTo(12, 116); g.lineTo(116, 12); g.stroke();
  return texture(c);
}

const brickTex = brickTextures();
const lattice = latticeTexture();
const brickMats = Array.from({ length: 4 }, (_, i) => new THREE.MeshStandardMaterial({
  map: brickTex.map, bumpMap: brickTex.bump, bumpScale: 1.8, roughness: 0.82,
  color: new THREE.Color(1, 1, 1).multiplyScalar(0.955 + 0.015 * i),
}));

// ------------------------------------------------------------------ the building site

const stoneMat = std(C.stone, { roughness: 0.9 });
box(PLINTH_W + 0.9, 0.9, PLINTH_W + 0.9, stoneMat, 0, -0.37, 0);
box(PLINTH_W, PLINTH_H + 0.3, PLINTH_W, stoneMat, 0, (PLINTH_H - 0.3) / 2, 0);

// the blueprint: a dashed outline of the finished monolito
{
  const shaftH = COURSES * COURSE_H, top = ideal(COURSES - 1), capH = top * 1.05;
  const shaft = new THREE.CylinderGeometry(top * Math.SQRT1_2, BASE * Math.SQRT1_2, shaftH, 4, 1, true);
  shaft.rotateY(Math.PI / 4).translate(0, PLINTH_H + shaftH / 2, 0);
  const capGeo = new THREE.ConeGeometry(top * Math.SQRT1_2, capH, 4, 1, true);
  capGeo.rotateY(Math.PI / 4).translate(0, PLINTH_H + shaftH + capH / 2, 0);
  const mat = new THREE.LineDashedMaterial({ color: C.blueprint, dashSize: 0.22, gapSize: 0.22, transparent: true, opacity: 0.7 });
  for (const geo of [shaft, capGeo]) {
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
    lines.computeLineDistances();
    scene.add(lines);
  }
}

// ------------------------------------------------------------------ the crane

const crane = new THREE.Group();       // everything a click on the crane may hit
scene.add(crane);
const paintMats = [];                  // [material, how much darker], repainted together
function painted(shade, extra = {}) {
  const m = std('#ffffff', { roughness: 0.5, ...extra });
  paintMats.push([m, shade]);
  return m;
}
function latticeMat(rx, ry) {
  const t = lattice.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return painted(0, { map: t });
}
const craneMat = painted(0), craneDeepMat = painted(0.12);
const steelMat = std(C.steel, { roughness: 0.45, metalness: 0.4 });
const glassMat = std(C.glass, { roughness: 0.12, metalness: 0.3 });
const concreteMat = std(C.concrete, { roughness: 0.95 });

function setPaint(entry) {
  paint = entry;
  const base = new THREE.Color(entry[1]), hsl = {};
  base.getHSL(hsl);
  for (const [m, shade] of paintMats) m.color.setHSL(hsl.h, hsl.s, Math.max(0, hsl.l - shade));
  for (const b of ui.paints.querySelectorAll('.paint')) b.setAttribute('aria-checked', String(b.dataset.name === entry[0]));
  store.set('monolito.paint', entry[0]);
}

const footY = surface(dirAt(MAST.x, MAST.z)).y;
box(2.2, 0.9, 2.2, concreteMat, MAST.x, footY + 0.2, MAST.z, crane);
box(0.8, JIB_Y - footY, 0.8, latticeMat(1, (JIB_Y - footY) / 0.8), MAST.x, (JIB_Y + footY) / 2, MAST.z, crane);

const slew = new THREE.Group();
slew.position.set(MAST.x, JIB_Y, MAST.z);
crane.add(slew);
{
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 24), steelMat);
  ring.position.y = 0.06;
  ring.castShadow = true;
  slew.add(ring);
  const cabMat = std(C.stone, { roughness: 0.6 });
  box(0.9, 0.85, 0.85, cabMat, 0.65, -0.3, 0.85, slew);
  box(0.02, 0.48, 0.62, glassMat, 1.105, -0.24, 0.85, slew);
  box(0.62, 0.48, 0.02, glassMat, 0.65, -0.24, 1.28, slew);
  box(JIB_LEN, 0.7, 0.7, latticeMat(JIB_LEN / 0.7, 1), 0.4 + JIB_LEN / 2, 0.5, 0, slew);
  box(0.25, 0.75, 0.75, craneDeepMat, 0.5 + JIB_LEN, 0.5, 0, slew);
  box(4.2, 0.5, 0.8, latticeMat(4.2 / 0.5, 1), -2.5, 0.4, 0, slew);
  for (let k = 0; k < 3; k++) box(0.42, 1.25, 0.95, concreteMat, -3.3 - k * 0.47, -0.05, 0, slew);
  box(0.6, 3.0, 0.6, latticeMat(1, 3.0 / 0.6), 0, 1.9, 0, slew);
  for (const z of [-0.22, 0.22]) {
    rod(new THREE.Vector3(0, 3.35, z * 0.5), new THREE.Vector3(7.5, 0.85, z), 0.03, steelMat, slew);
    rod(new THREE.Vector3(0, 3.35, z * 0.5), new THREE.Vector3(-4.5, 0.65, z), 0.03, steelMat, slew);
  }
}

const trolley = box(0.7, 0.22, 0.85, craneDeepMat, 0, 0, 0, crane);
const cable = new THREE.Group();
for (const z of [-0.1, 0.1]) {
  const geo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6).translate(0, -0.5, 0);
  const m = new THREE.Mesh(geo, steelMat);
  m.position.z = z;
  m.castShadow = true;
  cable.add(m);
}
crane.add(cable);
const hookBlock = new THREE.Group();
box(0.5, 0.42, 0.32, craneDeepMat, 0, 0, 0, hookBlock);
{
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 16, Math.PI * 1.5), steelMat);
  ring.position.y = -0.3;
  ring.castShadow = true;
  hookBlock.add(ring);
}
crane.add(hookBlock);

const slingGeo = new THREE.BufferGeometry();
slingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
const slings = new THREE.LineSegments(slingGeo, new THREE.LineBasicMaterial({ color: '#4d4a46' }));
slings.frustumCulled = false;
scene.add(slings);

const hook = new THREE.Vector3(0, 8, 0);
const hookAim = new THREE.Vector3(0, 8, 0);

function placeCrane() {
  const dx = hook.x - MAST.x, dz = hook.z - MAST.z;
  const theta = Math.atan2(-dz, dx);
  slew.rotation.y = theta;
  trolley.position.set(hook.x, JIB_Y + 0.05, hook.z);
  trolley.rotation.y = theta;
  cable.position.set(hook.x, JIB_Y - 0.06, hook.z);
  cable.rotation.y = theta;
  cable.scale.y = Math.max(JIB_Y - 0.06 - (hook.y + 0.2), 0.01);
  hookBlock.position.copy(hook);
  hookBlock.rotation.y = theta;
}

function placeSlings(points) {
  const a = slingGeo.attributes.position;
  for (let i = 0; i < 4; i++) {
    const p = points ? points[i % points.length] : hook;
    a.setXYZ(i * 2, hook.x, hook.y - 0.36, hook.z);
    a.setXYZ(i * 2 + 1, p.x, p.y, p.z);
  }
  a.needsUpdate = true;
  slings.visible = !!points;
}

// ------------------------------------------------------------------ the world around it

const obstacles = [                       // where MINITRON can't go: a direction and an angle around it
  { d: dirAt(0, 0), r: 3.6 / R },
  { d: dirAt(MAST.x, MAST.z), r: 1.9 / R },
];

function pallet(x, z, rot, seed) {
  const g = stand(new THREE.Group(), dirAt(x, z), 0, rot);
  scene.add(g);
  box(1.35, 0.14, 1.05, std(C.wood, { roughness: 0.95 }), 0, 0.07, 0, g);
  const rand = rng(seed), layers = 2 + Math.floor(rand() * 3);
  const bricks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.16, 0.19), std('#ffffff', { roughness: 0.8 }), 15 * layers);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  let n = 0;
  for (let l = 0; l < layers; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) {
    m.makeTranslation((i - 1) * 0.42, 0.22 + l * 0.165, (j - 2) * 0.205);
    bricks.setMatrixAt(n, m);
    bricks.setColorAt(n++, col.set(C.bricks[Math.floor(rand() * C.bricks.length)]));
  }
  bricks.castShadow = bricks.receiveShadow = true;
  g.add(bricks);
  obstacles.push({ d: dirAt(x, z), r: 1.1 / R });
}

function cone(d) {
  const g = stand(new THREE.Group(), d);
  scene.add(g);
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 20), std(C.cone, { roughness: 0.5 }));
  c.position.y = 0.25;
  c.castShadow = true;
  g.add(c);
}

pallet(-3.0, -2.4, 0.3, 3);
pallet(-2.0, 3.8, -0.2, 9);
pallet(3.6, -2.6, 1.2, 21);
for (let i = 0; i < 7; i++) {
  const a = 0.5 + i * 0.42;
  cone(dirAt(Math.sin(a) * 4.6, Math.cos(a) * 4.6));
}

const scatter = rng(7);
const treeMat = std(C.tree, { roughness: 0.75, flatShading: true });
const rockMat = std(C.rock, { roughness: 1, flatShading: true });
const taken = [];                          // spots already used, so nothing grows into anything else
const scenery = [];                        // trees and rocks, in the order they grow: a visitor may take them away
function freeSpot(minPolar, gap) {
  for (let tries = 0; tries < 60; tries++) {
    const d = randomDir(scatter);
    if (Math.acos(d.y) < minPolar) continue;
    if (taken.some((t) => t.angleTo(d) < gap)) continue;
    taken.push(d);
    return d;
  }
  return null;
}
// round little trees: a thin stem and a soft crown, in groves
const stemMat = std('#cfc8bb', { roughness: 0.9 });
for (let grove = 0; grove < 9; grove++) {
  const center = freeSpot(0.6, 0.35);
  if (!center) continue;
  const count = 2 + Math.floor(scatter() * 3);
  for (let i = 0; i < count; i++) {
    const d = center.clone().add(randomDir(scatter).multiplyScalar(0.07)).normalize();
    if (i && taken.some((t) => t.angleTo(d) < 0.03)) continue;
    if (i) taken.push(d);
    const g = stand(new THREE.Group(), d, -0.05, scatter() * 6);
    const h = 0.7 + scatter() * 0.7, s = 0.55 + scatter() * 0.4;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, h, 6), stemMat);
    stem.position.y = h / 2;
    stem.castShadow = true;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), treeMat);
    crown.position.y = h + s * 0.75;
    crown.scale.y = 1.15;
    crown.castShadow = crown.receiveShadow = true;
    g.add(stem, crown);
    scene.add(g);
    obstacles.push({ d, r: (s + 0.4) / R });
    scenery.push({ obj: g, block: obstacles[obstacles.length - 1] });
  }
}
for (let i = 0; i < 26; i++) {
  const d = freeSpot(0.5, 0.08);
  if (!d) continue;
  const s = 0.25 + scatter() * 0.55;
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
  stand(rock, d, s * 0.25, scatter() * 6);
  rock.rotateX(scatter());
  rock.castShadow = rock.receiveShadow = true;
  scene.add(rock);
  scenery.push({ obj: rock, block: null });
}

// clouds drift on a tilted ring below the site, so they never get in the crane's way
const cloudMat = std(C.cloud, { roughness: 1, flatShading: true });
const clouds = new THREE.Group();
clouds.position.copy(CENTER);
clouds.rotation.set(0.32, 0, 0.18);
scene.add(clouds);
{
  const mat = cloudMat;
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group(), a = (i / 7) * Math.PI * 2 + scatter() * 0.4, r = R + 8 + scatter() * 4;
    g.position.set(Math.cos(a) * r, (scatter() - 0.5) * 6, Math.sin(a) * r);
    g.lookAt(0, g.position.y, 0);
    const puffs = 3 + Math.floor(scatter() * 3);
    for (let k = 0; k < puffs; k++) {
      const s = 0.9 + scatter() * 1.0;
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat);
      p.position.set((k - puffs / 2) * 1.2, scatter() * 0.6, (scatter() - 0.5) * 0.8);
      p.scale.y = 0.75;
      p.castShadow = true;
      g.add(p);
    }
    clouds.add(g);
  }
}

// ------------------------------------------------------------------ MINITRON

// the pet bot: a little pyramid on tank tracks with one big eye (minitron.js)
const bot = (() => {
  const mini = createMinitron();
  scene.add(mini.group);
  return {
    mini, group: mini.group, hit: mini.hit,
    dir: new THREE.Vector3(0.44, 0.83, 0.35).normalize(),   // where it stands, as a direction from the center
    heading: new THREE.Vector3(),                          // which way it faces, along the ground
    target: null, speed: WANDER, moving: 0, rest: 2,
  };
})();
bot.heading.set(0.7, 0, 0.71).projectOnPlane(bot.dir).normalize();   // facing the camera at first

const marker = (() => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 40), new THREE.MeshBasicMaterial({
    color: C.robot, transparent: true, opacity: 0, depthWrite: false,
  }));
  m.renderOrder = 2;
  scene.add(m);
  return m;
})();
let markerLife = 0;

function steer(target, speed) {
  bot.target = target.clone().normalize();
  bot.speed = speed;
}

const tmpAxis = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function keepOut(d) {
  for (const o of obstacles) {
    const a = d.angleTo(o.d);
    if (a >= o.r || a < 1e-6) continue;
    tmpAxis.crossVectors(o.d, d).normalize();
    d.copy(o.d).applyQuaternion(tmpQ.setFromAxisAngle(tmpAxis, o.r));
  }
}

const keys = new Set();
function moveBot(dt) {
  const before = bot.dir.clone();
  if (mode === 'drive' && (keys.has('forward') || keys.has('back') || keys.has('left') || keys.has('right'))) {
    bot.target = null;
    const turn = (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0);
    bot.heading.applyAxisAngle(bot.dir, turn * 2.4 * dt);
    const go = (keys.has('forward') ? 1 : 0) - (keys.has('back') ? 0.6 : 0);
    if (go) {
      tmpAxis.crossVectors(bot.dir, bot.heading).normalize();
      bot.dir.applyAxisAngle(tmpAxis, go * WALK * dt / R);
    }
  } else if (bot.target) {
    const left = bot.dir.angleTo(bot.target);
    if (left < 0.004) {
      bot.target = null;
    } else {
      tmpAxis.crossVectors(bot.dir, bot.target).normalize();
      const want = new THREE.Vector3().crossVectors(tmpAxis, bot.dir).normalize();
      bot.heading.lerp(want, damp(dt, 9)).normalize();
      bot.dir.applyAxisAngle(tmpAxis, Math.min(left, bot.speed * dt / R));
    }
  } else if (mode !== 'drive' && !reduceMotion) {
    bot.rest -= dt;
    if (bot.rest <= 0) {
      bot.rest = 3 + Math.random() * 4;
      const wander = bot.dir.clone().add(randomDir(Math.random).multiplyScalar(0.35));
      if (Math.acos(clamp(wander.normalize().y, -1, 1)) > 0.45) steer(wander, WANDER);
    }
  }
  bot.dir.normalize();
  keepOut(bot.dir);
  bot.heading.projectOnPlane(bot.dir).normalize();
  const moved = before.angleTo(bot.dir) * R / Math.max(dt, 1e-4);
  bot.moving += (clamp(moved / WALK, 0, 1) - bot.moving) * damp(dt, 6);

  bot.group.position.copy(surface(bot.dir, 0.02));
  const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), bot.heading, bot.dir);
  bot.group.quaternion.setFromRotationMatrix(look).multiply(tmpQ.setFromAxisAngle(UP, Math.PI));
  // it looks at you; when you drive it, at where it's going or the nearest bit
  let sight = camera.position;
  if (mode === 'drive') {
    const near = bits.filter((b) => !b.got).sort((a, b) => a.mesh.position.distanceTo(bot.group.position) - b.mesh.position.distanceTo(bot.group.position))[0];
    sight = near && near.mesh.position.distanceTo(bot.group.position) < 9 ? near.mesh.position : bot.target ? surface(bot.target, 1) : camera.position;
  }
  bot.mini.update({ time, dt, moved: moved * dt, moving: bot.moving, look: sight, excited: hot === 'bot' ? 1 : 0, still: reduceMotion });
}

// ------------------------------------------------------------------ the bits

const bitMat = new THREE.MeshStandardMaterial({ color: C.bit, emissive: C.bit, emissiveIntensity: 0.55, roughness: 0.35 });
const bits = [];
{
  const rand = rng(14);
  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  while (bits.length < BITS) {
    const d = randomDir(rand);
    if (Math.acos(d.y) < 0.5 || taken.some((t) => t.angleTo(d) < 0.09) || bits.some((b) => b.dir.angleTo(d) < 0.3)) continue;
    const mesh = new THREE.Mesh(geo, bitMat);
    mesh.castShadow = true;
    scene.add(mesh);
    bits.push({ dir: d, mesh, phase: rand() * 6, got: false, fade: 0 });
  }
}
let gotBits = 0;

function moveBits(dt) {
  const here = bot.group.position;
  for (const b of bits) {
    if (b.got) {
      if (b.fade < 1) {
        b.fade = Math.min(1, b.fade + dt * 2.5);
        b.mesh.position.copy(surface(b.dir, 1.3 + b.fade * 2.5));
        b.mesh.scale.setScalar(Math.max(0.001, 1 - b.fade));
      } else b.mesh.visible = false;
      continue;
    }
    b.mesh.position.copy(surface(b.dir, 1.3 + Math.sin(time * 1.6 + b.phase) * 0.18));
    b.mesh.rotation.set(time * 0.7 + b.phase, time * 0.9 + b.phase, 0);
    if (mode === 'drive' && b.mesh.position.distanceTo(here) < 2.0) collect(b);
  }
}

function collect(b) {
  b.got = true;
  gotBits++;
  bot.mini.spin();
  chime(gotBits - 1);
  ui.score.textContent = String(gotBits);
  if (gotBits === BITS) {
    fanfare();
    store.set('monolito.bits', String(BITS));
    toast('All 14 bits. <a href="https://14bits.xyz">14bits.xyz</a> →', 5000);
    syncHint();
  } else toast(`bit ${gotBits} of ${BITS}`);
}

// ------------------------------------------------------------------ bricks

function brickBox(w, d, x, y, z, mat) {
  const geo = new THREE.BoxGeometry(w, COURSE_H, d);
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const wx = p.getX(i) + x, wy = p.getY(i) + y - PLINTH_H, wz = p.getZ(i) + z;
    if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, wx / TEX_W, wz / TEX_H);
    else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, wz / TEX_W, wy / TEX_H);
    else uv.setXY(i, wx / TEX_W, wy / TEX_H);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function drop(mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
}

// ------------------------------------------------------------------ sound

let actx = null;
function audio() {
  if (muted) return null;
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(a, { type = 'sine', from, to = from, at = 0, len = 0.3, gain = 0.2 }) {
  const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + len);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}

function thunk(volume = 1) {
  const a = audio();
  if (!a) return;
  tone(a, { from: 150, to: 52, len: 0.22, gain: 0.4 * volume });
  const n = Math.floor(a.sampleRate * 0.07), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = a.createBufferSource(), filter = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  filter.type = 'bandpass'; filter.frequency.value = 900;
  g.gain.value = 0.45 * volume;
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
}

const SCALE = [0, 2, 4, 7, 9];
const note = (step) => 523.25 * 2 ** ((SCALE[step % 5] + 12 * Math.floor(step / 5)) / 12);
function chime(step) {
  const a = audio();
  if (a) tone(a, { type: 'triangle', from: note(Math.min(step, 14)), len: 0.5, gain: 0.14 });
}
function groan() {
  const a = audio();
  if (a) tone(a, { type: 'triangle', from: 330, to: 98, len: 0.7, gain: 0.16 });
}
function fanfare() {
  const a = audio();
  if (a) [0, 2, 4, 5, 7, 10].forEach((s, i) => tone(a, { type: 'triangle', from: note(s), at: i * 0.11, len: 0.6, gain: 0.13 }));
}
function blip() {
  const a = audio();
  if (a) tone(a, { type: 'sine', from: 880, to: 660, len: 0.12, gain: 0.08 });
}
function chirp() {
  const a = audio();
  if (!a) return;
  tone(a, { type: 'triangle', from: 900, to: 1400, len: 0.09, gain: 0.09 });
  tone(a, { type: 'triangle', from: 1200, to: 1800, at: 0.1, len: 0.11, gain: 0.08 });
}

// ------------------------------------------------------------------ the stacking game

let mode = 'explore';      // explore, crane, drive, build
let state = 'ready';       // the crane's: ready, play, capping, over, done
let tower = [];            // courses, plinth first: { x, z, w, d, mesh }
let level = 0;
let combo = 0;
let load = null;
let debris = [];
let cap = null, flag = null;
let shake = 0, time = 0, cardTimer = 0;

const topY = () => PLINTH_H + level * COURSE_H;

function reset() {
  for (const c of tower) if (c.mesh) drop(c.mesh);
  for (const b of debris) drop(b.mesh);
  if (load) drop(load.mesh);
  if (cap) drop(cap.mesh);
  if (flag) { scene.remove(flag.group); flag = null; }
  tower = [{ x: 0, z: 0, w: PLINTH_W, d: PLINTH_W }];
  debris = [];
  load = null; cap = null;
  level = 0; combo = 0;
}

// the courses that stand when the page opens, laid true
function standing(n) {
  reset();
  for (let i = 0; i < n; i++) {
    const s = ideal(i), y = topY() + COURSE_H / 2;
    tower.push({ x: 0, z: 0, w: s, d: s, mesh: brickBox(s, s, 0, y, 0, brickMats[i % brickMats.length]) });
    level++;
  }
}

function spawnLoad() {
  const top = tower[tower.length - 1], s = ideal(level);
  const axis = level % 2 ? 'z' : 'x';
  const dir = level % 4 < 2 ? 1 : -1;
  const w = Math.min(top.w, s), d = Math.min(top.d, s);
  const y = topY() + HANG + COURSE_H / 2;
  const x = axis === 'x' ? top.x - dir * RANGE : top.x;
  const z = axis === 'z' ? top.z - dir * RANGE : top.z;
  const mat = brickMats[level % brickMats.length];
  load = {
    mesh: brickBox(w, d, x, y, z, mat), mat, axis, dir, w, d, x, y, z,
    speed: Math.min(2.5 + level * 0.085, 5.4), falling: false, vy: 0, age: 0,
  };
}

function release() {
  if (state !== 'play' || !load || load.falling) return;
  load.falling = true;
  audio();
}

function moveLoad(dt) {
  load.age += dt;
  const top = tower[tower.length - 1];
  if (!load.falling) {
    const k = load.axis;
    const c = k === 'x' ? top.x : top.z;
    let p = load[k] + load.dir * load.speed * dt;
    if (p > c + RANGE) { p = 2 * (c + RANGE) - p; load.dir = -1; }
    if (p < c - RANGE) { p = 2 * (c - RANGE) - p; load.dir = 1; }
    load[k] = p;
  } else {
    load.vy -= G * dt;
    load.y += load.vy * dt;
    if (load.y - COURSE_H / 2 <= topY()) { load.y = topY() + COURSE_H / 2; land(); return; }
  }
  const pop = Math.min(load.age / 0.18, 1);
  load.mesh.scale.setScalar(0.7 + 0.3 * ease(pop));
  load.mesh.position.set(load.x, load.y, load.z);
}

function land() {
  const top = tower[tower.length - 1];
  const alongX = load.axis === 'x';
  const size = alongX ? load.w : load.d;
  const c = alongX ? top.x : top.z;
  const p = alongX ? load.x : load.z;
  const delta = p - c, sign = Math.sign(delta) || 1;
  const y = topY() + COURSE_H / 2;
  const { mat } = load;
  drop(load.mesh);

  if (Math.abs(delta) >= size) {
    addDebris(load.w, load.d, load.x, y, load.z, mat, alongX, sign);
    load = null;
    groan();
    return gameOver('miss');
  }

  let kept, center;
  if (Math.abs(delta) < PERFECT) {
    combo++;
    center = c;
    kept = combo >= 3 ? Math.min(size + GROW, ideal(level)) : size;
    chime(combo - 1);
    toast(combo >= 3 && kept > size ? `perfect ×${combo} · the mortar spreads` : combo > 1 ? `perfect ×${combo}` : 'perfect');
  } else {
    combo = 0;
    kept = size - Math.abs(delta);
    center = (p + c) / 2;
    const piece = Math.abs(delta), pc = center + sign * (kept + piece) / 2;
    if (alongX) addDebris(piece, load.d, pc, y, load.z, mat, true, sign);
    else addDebris(load.w, piece, load.x, y, pc, mat, false, sign);
  }

  const course = alongX
    ? { x: center, z: top.z, w: kept, d: load.d }
    : { x: top.x, z: center, w: load.w, d: kept };
  course.mesh = brickBox(course.w, course.d, course.x, y, course.z, mat);
  tower.push(course);
  load = null;
  level++;
  ui.score.textContent = String(level);
  syncClasses();
  shake = 0.05;
  thunk();

  if (Math.min(course.w, course.d) < MIN_SIZE) return gameOver('thin');
  if (level >= COURSES) return startCap();
  spawnLoad();
}

function addDebris(w, d, x, y, z, mat, alongX, sign) {
  const mesh = brickBox(w, d, x, y, z, mat);
  debris.push({
    mesh, rest: false, settle: 0, q0: null, q1: null,
    v: new THREE.Vector3(alongX ? sign * 1.9 : 0, 0.8, alongX ? 0 : sign * 1.9),
    spin: new THREE.Vector3(alongX ? 0 : sign * 2.8, 0, alongX ? -sign * 2.8 : 0),
  });
  while (debris.length > 48) drop(debris.shift().mesh);
}

// debris lands on the plinth, or on the curved ground around it
const groundAt = (x, z) => Math.abs(x) < PLINTH_W / 2 && Math.abs(z) < PLINTH_W / 2 ? PLINTH_H : surface(dirAt(x, z)).y;
const bounds = new THREE.Box3();
const HALF_PI = Math.PI / 2;

function sitOnGround(mesh) {
  bounds.setFromObject(mesh);
  mesh.position.y += groundAt(mesh.position.x, mesh.position.z) - bounds.min.y;
}

function moveDebris(dt) {
  for (const b of debris) {
    if (b.rest) {
      if (b.settle < 1) {
        b.settle = Math.min(1, b.settle + dt * 3);
        b.mesh.quaternion.slerpQuaternions(b.q0, b.q1, ease(b.settle));
        sitOnGround(b.mesh);
      }
      continue;
    }
    b.v.y -= G * dt;
    b.mesh.position.addScaledVector(b.v, dt);
    b.mesh.rotation.x += b.spin.x * dt;
    b.mesh.rotation.z += b.spin.z * dt;
    bounds.setFromObject(b.mesh);
    if (bounds.min.y <= groundAt(b.mesh.position.x, b.mesh.position.z)) {
      b.rest = true;
      sitOnGround(b.mesh);
      b.q0 = b.mesh.quaternion.clone();
      const e = new THREE.Euler().setFromQuaternion(b.q0);
      e.x = Math.round(e.x / HALF_PI) * HALF_PI;
      e.z = Math.round(e.z / HALF_PI) * HALF_PI;
      b.q1 = new THREE.Quaternion().setFromEuler(e);
      thunk(0.3);
    }
  }
}

function startCap() {
  state = 'capping';
  syncClasses();
  const top = tower[tower.length - 1];
  const h = Math.max(top.w, top.d) * 1.05;
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const mesh = new THREE.Mesh(geo, std(C.cap, { roughness: 0.5, flatShading: true }));
  mesh.scale.set(top.w, h, top.d);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  cap = { mesh, top, h, t: 0, x0: top.x - 3.4, z0: top.z + 0.8, placed: false };
  hook.set(cap.x0, Math.min(topY() + 3 + h + SLING + 0.36, JIB_Y - 0.3), cap.z0);
  toast('last course · here comes the capstone');
}

function moveCap(dt) {
  cap.t += dt;
  const { top, h } = cap;
  const a = ease(Math.min(cap.t / 1.6, 1)), b = ease(clamp((cap.t - 1.7) / 1.6, 0, 1));
  const x = cap.x0 + (top.x - cap.x0) * a, z = cap.z0 + (top.z - cap.z0) * a;
  const y = topY() + 2.2 * (1 - b);
  cap.mesh.position.set(x, y, z);
  if (!cap.placed && cap.t >= 3.3) {
    cap.placed = true;
    shake = 0.08;
    thunk();
    fanfare();
    raiseFlag(x, y + h, z);
    toast('Topped out. Every building stands on a foundation: <a href="https://fundacaocachopa.org">fundacaocachopa.org</a> →', 6000);
    state = 'done';
    best = COURSES;
    store.set('monolito.best', String(best));
    showCard('done', 1.1);
  }
}

function raiseFlag(x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  rod(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.75, 0), 0.015, steelMat, group);
  const geo = new THREE.PlaneGeometry(0.46, 0.28, 10, 1).translate(0.23, 0.58, 0);
  const cloth = new THREE.Mesh(geo, std(C.flag, { side: THREE.DoubleSide, roughness: 0.7 }));
  cloth.castShadow = true;
  group.add(cloth);
  scene.add(group);
  flag = { group, cloth, base: Float32Array.from(geo.attributes.position.array) };
}

function waveFlag() {
  const p = flag.cloth.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = flag.base[i * 3];
    p.setZ(i, Math.sin(x * 14 - time * 7) * 0.05 * (x / 0.46));
  }
  p.needsUpdate = true;
}

function gameOver(reason) {
  state = 'over';
  combo = 0;
  ui.card.dataset.reason = reason;
  if (level > best) { best = level; store.set('monolito.best', String(best)); }
  showCard('over', 1.0);
}

function startStacking() {
  reset();
  hideCard();
  document.activeElement?.blur();          // so Space drops bricks instead of pressing a button
  state = 'play';
  audio();
  ui.score.textContent = '0';
  ui.goal.textContent = `of ${COURSES} courses`;
  spawnLoad();
  syncClasses();
}

// ------------------------------------------------------------------ the visitor's planet

// Build: whoever visits can put pieces on the planet, paint them, stack bricks, and take away pieces,
// trees and rocks. It is their own planet, kept in this browser only.
const PIECES = [['brick', 'Brick'], ['house', 'House'], ['tree', 'Tree'], ['rock', 'Rock'], ['lamp', 'Lamp'], ['flag', 'Flag'], ['remove', 'Take away']];
const MAX_PIECES = 400;
const BRICK = { w: 1.1, h: 0.55, d: 0.55 };
const SITE_CLEAR = 3.6 / R, MAST_CLEAR = 1.7 / R;

let tool = PIECES.some(([k]) => k === store.get('monolito.tool')) ? store.get('monolito.tool') : 'brick';
let buildPaint = clamp(Number(store.get('monolito.buildPaint')) || 0, 0, PAINTS.length - 1);
let pieces = [];                         // { kind, d, base, yaw, paint, mesh, block }
let gone = new Set();                    // scenery taken away, by its number
try { gone = new Set(JSON.parse(store.get('monolito.gone') || '[]')); } catch { /* start fresh */ }
let ghost = null, ghostKey = '';
let painting = false;                    // Build's Colors tab is open: clicks on the planet place nothing
let clearArmed = 0;

const paintCache = new Map();
function paintMat(i, ghostly = false) {
  const key = `${i}${ghostly ? 'g' : ''}`;
  if (!paintCache.has(key)) {
    paintCache.set(key, std(PAINTS[i][1], ghostly ? { transparent: true, opacity: 0.45, depthWrite: false } : { roughness: 0.6 }));
  }
  return paintCache.get(key);
}
const buildMats = {
  white: std(C.stone, { roughness: 0.75 }), dark: std(C.robot, { roughness: 0.4 }),
  door: std('#7a6a58', { roughness: 0.8 }), bulb: new THREE.MeshStandardMaterial({ color: '#ffd7a0', emissive: '#ffb062', emissiveIntensity: 1.4 }),
};
const ghostMat = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false });

// one piece, standing on its own ground at the origin
function makePiece(kind, paintIndex, ghostly = false) {
  const g = new THREE.Group();
  const m = (mat) => ghostly ? (mat === 'paint' ? paintMat(paintIndex, true) : ghostMat) : mat === 'paint' ? paintMat(paintIndex) : mat;
  const add = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m(mat));
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = !ghostly;
    g.add(mesh);
    return mesh;
  };
  if (kind === 'brick') add(new THREE.BoxGeometry(BRICK.w, BRICK.h, BRICK.d), 'paint', 0, BRICK.h / 2, 0);
  else if (kind === 'house') {
    add(new THREE.BoxGeometry(1.0, 0.75, 0.85), buildMats.white, 0, 0.375, 0);
    const roof = add(new THREE.ConeGeometry(0.82, 0.55, 4).rotateY(Math.PI / 4), 'paint', 0, 1.02, 0);
    roof.scale.set(1.05, 1, 0.92);
    add(new THREE.BoxGeometry(0.24, 0.4, 0.04), buildMats.door, 0.18, 0.2, 0.43);
    add(new THREE.BoxGeometry(0.2, 0.18, 0.04), buildMats.dark, -0.24, 0.45, 0.43);
  } else if (kind === 'tree') {
    add(new THREE.CylinderGeometry(0.06, 0.09, 1.0, 6), stemMat, 0, 0.45, 0);
    const crown = add(new THREE.IcosahedronGeometry(0.6, 1), ghostly ? ghostMat : treeMat, 0, 1.4, 0);
    crown.scale.y = 1.15;
  } else if (kind === 'rock') {
    const rock = add(new THREE.DodecahedronGeometry(0.45, 0), rockMat, 0, 0.18, 0);
    rock.rotation.set(0.4, 0.7, 0.2);
  } else if (kind === 'lamp') {
    add(new THREE.CylinderGeometry(0.04, 0.06, 1.5, 8), buildMats.dark, 0, 0.75, 0);
    add(new THREE.SphereGeometry(0.17, 16, 12), buildMats.bulb, 0, 1.6, 0);
    add(new THREE.CylinderGeometry(0.02, 0.2, 0.1, 16), 'paint', 0, 1.78, 0);
  } else if (kind === 'flag') {
    add(new THREE.CylinderGeometry(0.025, 0.03, 1.7, 8), buildMats.dark, 0, 0.85, 0);
    add(new THREE.BoxGeometry(0.55, 0.34, 0.03), 'paint', 0.3, 1.5, 0);
  }
  return g;
}

const pieceHeight = (kind) => kind === 'brick' ? BRICK.h : 0;

function putPiece({ kind, d, base = 0, yaw = 0, paint: p = 0 }) {
  const mesh = makePiece(kind, p);
  stand(mesh, d, base, yaw);
  built.add(mesh);
  const piece = { kind, d: d.clone(), base, yaw, paint: p, mesh, block: null };
  if (base === 0 && kind !== 'flag' && kind !== 'lamp') {
    piece.block = { d: d.clone(), r: (kind === 'house' ? 0.85 : 0.6) / R };
    obstacles.push(piece.block);
  }
  pieces.push(piece);
  return piece;
}

const built = new THREE.Group();
scene.add(built);

function saveBuilt() {
  const r = (v) => Math.round(v * 1e4) / 1e4;
  store.set('monolito.built', JSON.stringify(pieces.map((p) => ({ k: p.kind, d: [r(p.d.x), r(p.d.y), r(p.d.z)], b: r(p.base), y: r(p.yaw), p: p.paint }))));
  store.set('monolito.gone', JSON.stringify([...gone]));
  syncBuildCount();
}

function loadBuilt() {
  let saved = [];
  try { saved = JSON.parse(store.get('monolito.built') || '[]'); } catch { saved = []; }
  for (const s of saved.slice(0, MAX_PIECES)) {
    if (!PIECES.some(([k]) => k === s.k) || !Array.isArray(s.d)) continue;
    putPiece({ kind: s.k, d: new THREE.Vector3(...s.d).normalize(), base: Number(s.b) || 0, yaw: Number(s.y) || 0, paint: clamp(Number(s.p) || 0, 0, PAINTS.length - 1) });
  }
  for (const i of gone) takeScenery(i, false);
  syncBuildCount();
}

function takeScenery(i, save = true) {
  const s = scenery[i];
  if (!s || !s.obj.visible) return;
  s.obj.visible = false;
  if (s.block) obstacles.splice(obstacles.indexOf(s.block), 1);
  gone.add(i);
  if (save) saveBuilt();
}

function removePiece(piece) {
  // whatever stood on a brick comes down with it
  const above = pieces.filter((p) => p !== piece && p.base > piece.base && p.d.angleTo(piece.d) < 0.002);
  for (const p of [piece, ...above]) {
    built.remove(p.mesh);
    if (p.block) obstacles.splice(obstacles.indexOf(p.block), 1);
  }
  pieces = pieces.filter((p) => p !== piece && !above.includes(p));
}

function pieceOf(object) {
  for (let o = object; o; o = o.parent) {
    const p = pieces.find((q) => q.mesh === o);
    if (p) return p;
    if (o === built) return null;
  }
  return null;
}
function sceneryOf(object) {
  for (let o = object; o; o = o.parent) {
    const i = scenery.findIndex((s) => s.obj === o);
    if (i >= 0) return i;
  }
  return -1;
}

// where a click would put the piece: on a brick, or on open ground clear of the building site and the crane
function placement(x, y) {
  const hit = pick(x, y, [built, planet]);
  if (!hit) return null;
  const on = pieceOf(hit.object);
  if (on) {
    if (on.kind !== 'brick') return null;
    return { d: on.d, base: on.base + BRICK.h, yaw: on.yaw, on };
  }
  const d = dirOf(hit.point);
  if (d.angleTo(dirAt(0, 0)) < SITE_CLEAR || d.angleTo(dirAt(MAST.x, MAST.z)) < MAST_CLEAR) return { d, blocked: true };
  return { d, base: 0, yaw: orbit.az + (tool === 'brick' ? 0 : Math.random() * 6) };
}

function aimGhost(x, y) {
  if (tool === 'remove' || painting) { if (ghost) ghost.visible = false; return; }
  const key = `${tool}${buildPaint}`;
  if (key !== ghostKey) {
    if (ghost) scene.remove(ghost);
    ghost = makePiece(tool, buildPaint, true);
    ghost.renderOrder = 3;
    scene.add(ghost);
    ghostKey = key;
  }
  const at = placement(x, y);
  ghost.visible = !!at && !at.blocked;
  if (ghost.visible) stand(ghost, at.d, at.base, at.yaw);
}

function buildAt(x, y) {
  if (painting) return;
  if (tool === 'remove') {
    const hit = pick(x, y, [built, planet, ...scenery.map((s) => s.obj).filter((o) => o.visible)]);
    if (!hit) return;
    const piece = pieceOf(hit.object);
    if (piece) { removePiece(piece); saveBuilt(); groan(); return; }
    const i = sceneryOf(hit.object);
    if (i >= 0) { takeScenery(i); groan(); }
    return;
  }
  if (pieces.length >= MAX_PIECES) { toast(`that's ${MAX_PIECES} pieces: take some away first`, 2200); return; }
  const at = placement(x, y);
  if (!at) return;
  if (at.blocked) { toast('that ground is the building site'); return; }
  if (at.base > 14) { toast('high enough'); return; }
  putPiece({ kind: tool, d: at.d, base: at.base, yaw: at.yaw, paint: buildPaint });
  saveBuilt();
  thunk(0.45);
  aimGhost(x, y);
}

function syncBuildCount() {
  if (!ui.buildCount) return;
  const n = pieces.length;
  ui.buildCount.textContent = n || gone.size ? `${n} ${n === 1 ? 'piece' : 'pieces'}${gone.size ? `, ${gone.size} taken away` : ''} · kept in this browser` : 'kept in this browser';
}

function enterBuild() {
  hideCard();
  ui.builder.classList.remove('away');
  ui.builder.inert = false;
  orbit.idle = 0;
}
function leaveBuild() {
  ui.builder.classList.add('away');
  ui.builder.inert = true;
  if (ghost) ghost.visible = false;
}

if (ui.pieces) {
  for (const [kind, label] of PIECES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `piece${kind === 'remove' ? ' piece-remove' : ''}`;
    b.textContent = label;
    b.setAttribute('role', 'radio');
    b.dataset.kind = kind;
    b.addEventListener('click', () => { tool = kind; store.set('monolito.tool', kind); syncTools(); blip(); });
    ui.pieces.append(b);
  }
  PAINTS.forEach(([name, color], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paint';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.title = name;
    b.style.setProperty('--c', color);
    b.addEventListener('click', () => {
      buildPaint = i;
      store.set('monolito.buildPaint', String(i));
      if (tool === 'remove' || tool === 'tree' || tool === 'rock') tool = 'brick';
      syncTools();
      blip();
    });
    ui.buildPaints.append(b);
  });
  ui.build.addEventListener('click', () => enter('build'));
  ui.buildClear.addEventListener('click', () => {
    if (Date.now() - clearArmed > 3000) {
      clearArmed = Date.now();
      ui.buildClear.textContent = 'Sure? Click again';
      setTimeout(() => { ui.buildClear.textContent = 'Start over'; }, 3000);
      return;
    }
    clearArmed = 0;
    ui.buildClear.textContent = 'Start over';
    for (const p of [...pieces]) removePiece(p);
    for (const i of gone) {
      const s = scenery[i];
      s.obj.visible = true;
      if (s.block) obstacles.push(s.block);
    }
    gone.clear();
    saveBuilt();
    groan();
  });
}
function syncTools() {
  for (const b of ui.pieces?.children || []) b.setAttribute('aria-checked', String(b.dataset.kind === tool));
  [...(ui.buildPaints?.querySelectorAll('.paint') || [])].forEach((b, i) => b.setAttribute('aria-checked', String(i === buildPaint)));
  syncClasses();
  syncHint();
}
syncTools();

// ------------------------------------------------------------------ the visitor's colors

// the planet's look, chosen in Build's Colors: [name, color, second color]
const LOOKS = {
  ground: { label: 'Ground', options: [['Chalk', '#ebe8e1', '#dcd8ce'], ['Sand', '#f0dfba', '#dcc497'], ['Sage', '#d3e0c2', '#b4c7a0'], ['Rose', '#f2dcd8', '#dfc0bb'], ['Slate', '#d0d5dc', '#aeb6c1'], ['Moss', '#b4c99a', '#93ab78']] },
  plants: { label: 'Plants', options: [['White', '#f7f6f2', '#cfc8bb'], ['Green', '#8fc27b', '#9b8670'], ['Autumn', '#ec9a5c', '#8f7660'], ['Blossom', '#f4b8c8', '#8f7660'], ['Lilac', '#c6b4e6', '#958a86'], ['Gold', '#f1cf55', '#8f7660']] },
  clouds: { label: 'Clouds', options: [['White', '#ffffff'], ['Peach', '#ffdcc6'], ['Pink', '#fad3e3'], ['Lilac', '#e1d8f7'], ['Mint', '#d4f2e7'], ['Storm', '#b8bdc6']] },
  sky: { label: 'Sky', options: [['Paper', '#f1f0ec', '#fbfaf8', '#e7e5df'], ['Dawn', '#fbe0d0', '#fff4eb', '#f2c9b8'], ['Mint', '#dff3ea', '#f3fbf8', '#c9e7da'], ['Lilac', '#e9e1f6', '#f8f4fd', '#d6cbec'], ['Day', '#d8e9fb', '#eff7ff', '#bcd6f2'], ['Night', '#0c0e15', '#171a26', '#06070a']] },
  bot: { label: 'MINITRON', options: BOT_COLORS.body },
  eye: { label: 'Its eye', options: BOT_COLORS.eye },
};
const NIGHT = 5;
let looks = {};
try { looks = JSON.parse(store.get('monolito.look') || '{}'); } catch { looks = {}; }
const pickOf = (key) => clamp(Number(looks[key]) || 0, 0, LOOKS[key].options.length - 1);

// stars, for a night sky
const stars = (() => {
  const n = 1400, pos = new Float32Array(n * 3), rand = rng(31);
  for (let i = 0; i < n; i++) {
    const d = randomDir(rand).multiplyScalar(420);
    pos.set([d.x, d.y, d.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#f4efe6', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false }));
  points.visible = false;
  scene.add(points);
  return points;
})();

function applyLooks() {
  const g = LOOKS.ground.options[pickOf('ground')];
  paintGround(g[1], g[2]);
  const pl = LOOKS.plants.options[pickOf('plants')];
  treeMat.color.set(pl[1]);
  stemMat.color.set(pl[2]);
  cloudMat.color.set(LOOKS.clouds.options[pickOf('clouds')][1]);
  const sky = LOOKS.sky.options[pickOf('sky')], night = pickOf('sky') === NIGHT;
  ui.root.classList.toggle('space', night);
  ui.root.style.background = night ? '' : `radial-gradient(120% 90% at 62% 40%, ${sky[2]} 0%, ${sky[1]} 55%, ${sky[3]} 100%)`;
  stars.visible = night;
  bot.mini.setColors({ body: LOOKS.bot.options[pickOf('bot')][1], eye: LOOKS.eye.options[pickOf('eye')][1] });
  for (const row of ui.looks?.children || []) {
    row.querySelectorAll('.paint').forEach((b, i) => b.setAttribute('aria-checked', String(i === pickOf(row.dataset.key))));
  }
}

if (ui.looks) {
  for (const [key, { label, options }] of Object.entries(LOOKS)) {
    const row = document.createElement('fieldset');
    row.className = 'paints look';
    row.dataset.key = key;
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', label);
    row.innerHTML = `<legend>${label}</legend>`;
    options.forEach(([name, color, second], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'paint';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', name);
      b.title = name;
      b.style.setProperty('--c', key === 'sky' ? `radial-gradient(circle at 35% 35%, ${second}, ${color})` : color);
      b.addEventListener('click', () => {
        looks[key] = i;
        store.set('monolito.look', JSON.stringify(looks));
        applyLooks();
        if (key === 'bot' || key === 'eye') { bot.mini.hop(); chirp(); } else blip();
      });
      row.append(b);
    });
    ui.looks.append(row);
  }
  ui.lookReset.addEventListener('click', () => {
    looks = {};
    store.set('monolito.look', '{}');
    applyLooks();
    blip();
  });
  for (const tab of [ui.tabBuild, ui.tabColors]) {
    tab.addEventListener('click', () => {
      const colors = tab === ui.tabColors;
      ui.tabBuild.setAttribute('aria-selected', String(!colors));
      ui.tabColors.setAttribute('aria-selected', String(colors));
      ui.paneBuild.hidden = colors;
      ui.paneColors.hidden = !colors;
      painting = colors;
      if (ghost) ghost.visible = false;
      syncHint();
    });
  }
}
applyLooks();

// ------------------------------------------------------------------ modes

function enter(next) {
  if (next === mode) return;
  if (mode === 'crane') leaveCrane();
  if (mode === 'build') leaveBuild();
  mode = next;
  hot = null;
  if (mode === 'crane' && state !== 'capping') { state = 'ready'; showCard('ready'); }
  else hideCard();
  if (mode === 'drive') {
    bot.target = null;
    ui.score.textContent = String(gotBits);
    ui.goal.textContent = `of ${BITS} bits`;
    bot.mini.hop();
    chirp();
  }
  if (mode === 'build') enterBuild();
  syncClasses();
  syncHint();
  if (mode === 'explore') document.activeElement?.blur();
}

function leaveCrane() {
  if (load) { drop(load.mesh); load = null; }
  if (state !== 'play') return;
  if (level > best) { best = level; store.set('monolito.best', String(best)); }
  state = 'ready';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CARDS = {
  ready: () => ({
    title: 'Stack the Monolito.',
    text: `Drop each course of white brick right on the one below; whatever hangs over is knocked off. Lay ${COURSES} to top it out.`,
    go: 'Start stacking',
  }),
  over: () => ({
    title: 'Crane down.',
    text: `${plural(level, 'course')} before ${ui.card.dataset.reason === 'thin' ? 'the shaft got too thin to carry on' : 'a load missed the tower'}.`,
    go: 'Build again',
  }),
  done: () => ({
    title: 'Topped out.',
    text: `All ${COURSES} courses, capstone on, flag up. Every building stands on a foundation: <a href="https://fundacaocachopa.org">fundacaocachopa.org</a>.`,
    go: 'Build another',
  }),
};

function showCard(kind, delay = 0) {
  const fill = () => {
    if (mode !== 'crane') return;
    const c = CARDS[kind]();
    ui.title.textContent = c.title;
    ui.text.innerHTML = c.text;
    ui.go.textContent = c.go;
    ui.best.textContent = best >= COURSES ? 'your best: topped out' : best ? `your best: ${plural(best, 'course')}` : '';
    ui.card.classList.remove('away');
    ui.card.inert = false;
    syncClasses();
  };
  clearTimeout(cardTimer);
  if (delay) cardTimer = setTimeout(fill, delay * 1000);
  else fill();
}

function hideCard() {
  clearTimeout(cardTimer);
  ui.card.classList.add('away');
  ui.card.inert = true;
}

let toastTimer = 0;
function toast(html, ms = 1100) {
  ui.toast.innerHTML = html;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
}

function syncHint() {
  const touch = matchMedia('(hover: none)').matches;
  if (mode === 'drive') {
    ui.hint.innerHTML = gotBits >= BITS
      ? 'every bit found · <a href="https://14bits.xyz">14bits.xyz</a>'
      : touch ? 'tap the ground to send MINITRON there · find the 14 bits'
        : 'click the ground, or use WASD · find the 14 bits';
  } else if (mode === 'crane') {
    ui.hint.textContent = touch ? 'tap to drop the bricks' : 'click or press space to drop the bricks';
  } else if (mode === 'build' && painting) {
    ui.hint.textContent = touch ? 'pick its colors and MINITRON\'s · drag to turn' : 'pick its colors and MINITRON\'s · drag to turn, scroll to come closer';
  } else if (mode === 'build') {
    ui.hint.textContent = tool === 'remove'
      ? (touch ? 'tap a piece, a tree or a rock to take it away' : 'click a piece, a tree or a rock to take it away')
      : touch ? 'tap the ground to place it · tap a brick to stack on it · drag to turn'
        : 'click the ground to place it · click a brick to stack on it · drag to turn, scroll to come closer';
  }
}

function syncClasses() {
  const c = ui.root.classList;
  c.toggle('is-explore', mode === 'explore');
  c.toggle('is-crane', mode === 'crane');
  c.toggle('is-drive', mode === 'drive');
  c.toggle('is-build', mode === 'build');
  c.toggle('is-erasing', mode === 'build' && tool === 'remove');
  c.toggle('is-playing', mode === 'crane' && (state === 'play' || state === 'capping'));
  c.toggle('show-hint', (mode === 'crane' && state === 'play' && level < 3) || mode === 'drive' || mode === 'build');
}

const SPEAKER_ON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
function syncMute() {
  ui.mute.innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON;
  ui.mute.setAttribute('aria-pressed', String(muted));
  ui.mute.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
}

for (const entry of PAINTS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'paint';
  b.dataset.name = entry[0];
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', entry[0]);
  b.title = entry[0];
  b.style.setProperty('--c', entry[1]);
  b.addEventListener('click', () => { setPaint(entry); blip(); });
  ui.paints.append(b);
}

ui.go.addEventListener('click', startStacking);
ui.back.addEventListener('click', () => enter('explore'));
ui.tagCrane.addEventListener('click', () => enter('crane'));
ui.tagBot.addEventListener('click', () => enter('drive'));
ui.mute.addEventListener('click', () => {
  muted = !muted;
  store.set('monolito.muted', muted ? '1' : '0');
  syncMute();
});

// ------------------------------------------------------------------ pointer and keys

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hot = null;                     // what the pointer is over in explore: 'crane', 'bot' or null
const press = { on: false, x: 0, y: 0, moved: 0, id: null };

function pick(x, y, targets) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(targets, true)[0] || null;
}

function whatIsAt(x, y) {
  const hit = pick(x, y, [crane, bot.hit, planet]);
  if (!hit) return null;
  if (hit.object === bot.hit) return 'bot';
  let o = hit.object;
  while (o) { if (o === crane) return 'crane'; o = o.parent; }
  return null;
}

ui.stage.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  Object.assign(press, { on: true, x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId });
  ui.stage.setPointerCapture(e.pointerId);
  if (mode === 'crane' && state === 'play') { release(); press.on = false; }
});

ui.stage.addEventListener('pointermove', (e) => {
  if (press.on && e.pointerId === press.id) {
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    press.moved += Math.abs(dx) + Math.abs(dy);
    press.x = e.clientX; press.y = e.clientY;
    if (press.moved > 6 && mode !== 'crane') {
      ui.root.classList.add('is-dragging');
      orbit.vaz = -dx * 0.005; orbit.vel = dy * 0.004;
      orbit.az += orbit.vaz; orbit.el = clamp(orbit.el + orbit.vel, -0.9, 1.2);
      orbit.idle = 0;
    }
    return;
  }
  if (mode === 'build' && e.pointerType === 'mouse') { aimGhost(e.clientX, e.clientY); return; }
  if (mode === 'explore' && e.pointerType === 'mouse') {
    hot = whatIsAt(e.clientX, e.clientY);
    ui.root.classList.toggle('is-pointing', !!hot);
    ui.tagCrane.classList.toggle('hot', hot === 'crane');
    ui.tagBot.classList.toggle('hot', hot === 'bot');
  }
});

ui.stage.addEventListener('pointerup', (e) => {
  if (!press.on || e.pointerId !== press.id) return;
  press.on = false;
  ui.root.classList.remove('is-dragging');
  if (press.moved > 6) return;
  if (mode === 'explore') {
    const what = whatIsAt(e.clientX, e.clientY);
    if (what === 'crane') enter('crane');
    else if (what === 'bot') enter('drive');
  } else if (mode === 'build') {
    buildAt(e.clientX, e.clientY);
  } else if (mode === 'drive') {
    const hit = pick(e.clientX, e.clientY, [planet]);
    if (!hit) return;
    const d = dirOf(hit.point);
    steer(d, WALK);
    marker.position.copy(surface(d, 0.05));
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    markerLife = 1;
  }
});
ui.stage.addEventListener('pointercancel', () => { press.on = false; ui.root.classList.remove('is-dragging'); });
ui.stage.addEventListener('pointerleave', () => { if (ghost) ghost.visible = false; });
ui.stage.addEventListener('wheel', (e) => {
  if (mode !== 'build') return;
  e.preventDefault();
  orbit.zoom = clamp(orbit.zoom * Math.exp(e.deltaY * 0.0012), 0.3, 1.15);
}, { passive: false });

const KEYMAP = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode !== 'explore') { enter('explore'); return; }
  if (mode === 'drive' && KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); return; }
  if (mode !== 'crane' || (e.code !== 'Space' && e.code !== 'Enter')) return;
  if (e.target.closest?.('a, button')) return;
  e.preventDefault();
  if (state === 'play') release();
  else if (state !== 'capping' && !ui.card.classList.contains('away')) startStacking();
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
addEventListener('blur', () => keys.clear());

// ------------------------------------------------------------------ camera

const orbit = { az: 0.78, el: 0.16, vaz: 0, vel: 0, idle: 99, zoom: 0.62 };   // zoom: how close Build comes in
const EXPLORE_AT = new THREE.Vector3(0, -11.5, 0);
const cam = { pos: new THREE.Vector3(60, 20, 70), at: EXPLORE_AT.clone(), up: UP.clone() };
const want = { pos: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3() };
const followDir = new THREE.Vector3();
let offset = 0;

function fitDist(dist, halfWidth) {
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  return Math.max(dist, halfWidth / Math.tan(half));
}

function moveCamera(dt) {
  let rate = 2.2;
  if (mode === 'explore' || mode === 'build') {
    orbit.idle += dt;
    if (!press.on) {
      orbit.az += orbit.vaz; orbit.el = clamp(orbit.el + orbit.vel, -0.9, 1.2);
      orbit.vaz *= Math.exp(-dt * 4); orbit.vel *= Math.exp(-dt * 4);
    }
    const building = mode === 'build';
    if (!reduceMotion && !building && orbit.idle > 3) orbit.az += dt * 0.035;
    if (!press.on && !building && orbit.idle > 3) orbit.el += (0.16 - orbit.el) * damp(dt, 0.5);
    const dist = fitDist(122, 38) * (building ? orbit.zoom : 1);
    const r = Math.cos(orbit.el) * dist;
    want.at.copy(EXPLORE_AT);
    want.pos.set(Math.sin(orbit.az) * r, EXPLORE_AT.y + Math.sin(orbit.el) * dist, Math.cos(orbit.az) * r);
    want.up.copy(UP);
    rate = press.on ? 12 : 2.2;
  } else if (mode === 'crane') {
    const sway = reduceMotion ? 0 : Math.sin(time * 0.07) * 0.4;
    let az = 0.78, el, dist, y;
    if (state === 'play') { el = 0.36; dist = fitDist(12.5, 4.3); y = topY() + 0.9; }
    else if (state === 'capping') { el = 0.3; dist = fitDist(14, 4.3); y = topY() + 1.4; }
    else {
      // the whole crane, so a new paint shows
      az += sway; el = 0.2; dist = fitDist(44, 12); y = JIB_Y * 0.46;
    }
    const r = Math.cos(el) * dist;
    want.at.set(state === 'play' || state === 'capping' ? 0 : -2.4, y, 0);
    want.pos.set(Math.sin(az) * r, y + Math.sin(el) * dist, Math.cos(az) * r);
    want.up.copy(UP);
    rate = state === 'play' ? 4 : 2.2;
  } else {
    // behind and above MINITRON, turning with it
    followDir.lerp(bot.heading, damp(dt, 1.6)).projectOnPlane(bot.dir).normalize();
    if (followDir.lengthSq() < 0.5) followDir.copy(bot.heading);
    const p = bot.group.position;
    want.at.copy(p).addScaledVector(followDir, 5);
    want.pos.copy(p).addScaledVector(bot.dir, 19).addScaledVector(followDir, -16);
    want.up.copy(bot.dir);
    rate = 3;
  }
  const k = damp(dt, rate);
  cam.pos.lerp(want.pos, k);
  cam.at.lerp(want.at, k);
  cam.up.lerp(want.up, k).normalize();
  camera.position.copy(cam.pos);
  camera.up.copy(cam.up);
  camera.lookAt(cam.at);

  // on a wide screen the planet sits right of the words
  const wide = innerWidth > 900;
  const shift = (mode === 'explore' || mode === 'build') && wide ? -innerWidth * 0.12 : mode === 'crane' && wide && state !== 'play' && state !== 'capping' ? -innerWidth * 0.1 : 0;
  offset += (shift - offset) * damp(dt, 2.4);
  camera.setViewOffset(innerWidth, innerHeight, offset, 0, innerWidth, innerHeight);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 0.4);
  }
}

const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function moveCrane(dt) {
  let points = null;
  if (load) {
    const topOfLoad = load.y + COURSE_H / 2;
    if (!load.falling) hookAim.set(load.x, topOfLoad + SLING + 0.36, load.z);
    const s = load.mesh.scale.x, hw = load.w / 2 * s * 0.85, hd = load.d / 2 * s * 0.85;
    corners[0].set(load.x - hw, topOfLoad, load.z - hd);
    corners[1].set(load.x + hw, topOfLoad, load.z - hd);
    corners[2].set(load.x + hw, topOfLoad, load.z + hd);
    corners[3].set(load.x - hw, topOfLoad, load.z + hd);
    if (!load.falling) points = corners;
  } else if (cap && !cap.placed) {
    const m = cap.mesh.position;
    hookAim.set(m.x, m.y + cap.h + SLING + 0.36, m.z);
    corners[0].set(m.x, m.y + cap.h, m.z);
    points = [corners[0]];
  } else if (state !== 'play') {
    const t = reduceMotion ? 0 : time;
    hookAim.set(Math.sin(t * 0.3) * 1.6, Math.max(topY() + (cap ? cap.h : 0) + 3, 8) + Math.sin(t * 0.5) * 0.6, Math.cos(t * 0.3) * 1.2 + 0.6);
  }
  hookAim.y = Math.min(hookAim.y, JIB_Y - 0.6);
  const k = cap && !cap.placed ? 1 : damp(dt, state === 'play' ? 14 : 2);
  hook.lerp(hookAim, k);
  placeCrane();
  placeSlings(points);
}

// tags follow the crane's cab and MINITRON, and hide when the planet is in the way
const tagAt = new THREE.Vector3(), toward = new THREE.Vector3(), fromCenter = new THREE.Vector3();
function hiddenByPlanet(world) {
  // does the line from the camera to this point go through the planet first?
  toward.copy(world).sub(camera.position);
  const dist = toward.length();
  toward.divideScalar(dist);
  fromCenter.copy(camera.position).sub(CENTER);
  const b = fromCenter.dot(toward), c = fromCenter.lengthSq() - (R - 0.3) ** 2, disc = b * b - c;
  return disc > 0 && -b - Math.sqrt(disc) < dist - 0.5;
}
function placeTag(el, world) {
  tagAt.copy(world).project(camera);
  const facing = !hiddenByPlanet(world);
  const onScreen = tagAt.z < 1 && Math.abs(tagAt.x) < 1.05 && Math.abs(tagAt.y) < 1.05;
  const x = (tagAt.x * 0.5 + 0.5) * innerWidth, y = (-tagAt.y * 0.5 + 0.5) * innerHeight;
  el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 14)}px)`;
  el.classList.toggle('on', facing && onScreen && ready);
}

function placeTags() {
  if (mode !== 'explore') return;
  placeTag(ui.tagCrane, new THREE.Vector3(MAST.x, JIB_Y + 1.2, MAST.z));
  placeTag(ui.tagBot, surface(bot.dir, 3.8));
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 44 : 32;
  camera.updateProjectionMatrix();
  syncHint();
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ loop

let last = 0, ready = false;
const focus = new THREE.Vector3();
renderer.setAnimationLoop((now) => {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 0;
  last = now;
  time += dt;
  if (mode === 'crane' && state === 'play' && load) moveLoad(dt);
  if (cap && !cap.placed) moveCap(dt);
  moveDebris(dt);
  moveCrane(dt);
  moveBot(dt);
  moveBits(dt);
  if (flag) waveFlag();
  if (!reduceMotion) clouds.rotation.y += dt * 0.015;
  if (markerLife > 0) {
    markerLife = Math.max(0, markerLife - dt * 0.8);
    marker.material.opacity = markerLife * 0.55;
    marker.scale.setScalar(1 + (1 - markerLife) * 0.6);
  }
  if (mode === 'explore' || mode === 'build') aimSun(focus.set(0, -R * 0.45, 0), R + 14);
  else if (mode === 'crane') aimSun(focus.set(-1.5, Math.max(topY(), 6) * 0.5, 0), 13);
  else aimSun(bot.group.position, 14);
  moveCamera(dt);
  placeTags();
  renderer.render(scene, camera);
  if (!ready) { ready = true; ui.stage.classList.add('ready'); }
});

standing(DECOR);
setPaint(paint);
loadBuilt();
resize();
moveBot(0);
moveCamera(10);                            // start where the camera wants to be, not flying in
syncMute();
syncClasses();

// #crane and #minitron link straight into a game
const DEEP = { '#crane': 'crane', '#minitron': 'drive', '#build': 'build' };
if (DEEP[location.hash]) { enter(DEEP[location.hash]); followDir.copy(bot.heading); moveCamera(10); }
