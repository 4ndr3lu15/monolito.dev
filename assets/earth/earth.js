// monolito.dev/earth: the Earth as a small toy globe, in the clay of the home page.
// The land is raised from a tiny land-and-height map (land.png: red is land, green is height, made from
// NASA's Blue Marble water mask and topography). Two games: click the sailboat to sail the seven seas and
// pick up a buoy in each; click the rocket at Alcântara to drop its stages on time and put a satellite in
// orbit (every one that makes it stays up there).
// Toys about: a few landmarks, a lighthouse, a whale (click it) and fish that jump out of the sea.

import {
  THREE, UP, C, createWorld, clamp, smooth, damp, reduceMotion, rng, randomDir, latLon, store, std, glow, canvas, plural,
} from '../world/kit.js?v=a9dc208c9d';

// ------------------------------------------------------------------ constants

const R = 20;
const SEA = -0.12;                            // the sea's surface, from the planet's radius
const CENTER = new THREE.Vector3();

const SEAS = [
  ['North Atlantic', 32, -42], ['South Atlantic', -28, -18], ['North Pacific', 32, -160], ['South Pacific', -32, -125],
  ['Indian Ocean', -22, 78], ['Arctic Ocean', 79, 2], ['Southern Ocean', -58, 40],
];
const SAIL = 6.5;                             // the boat's speed, units a second
const CRUISE = 1.8;                           // and when it drifts about on its own

const PAD_DIR = latLon(-3.5, -45.5);          // Alcântara, on the coast of Maranhão
const STAGES = [{ burn: 2.3, thrust: 10 }, { burn: 1.9, thrust: 12 }, { burn: 1.6, thrust: 14 }];
const G = 6;                                  // what gravity takes from the rocket's speed each second
const ORBIT_V = 27;                           // the speed it needs when the last stage is dropped
const KM = 2.6;                               // kilometres to a unit of the climb, for the readout
const MAX_SATS = 12;

// ------------------------------------------------------------------ the map

const map = await new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const [, g] = canvas(img.width, img.height);
    g.drawImage(img, 0, 0);
    resolve({ w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data });
  };
  img.onerror = () => resolve({ w: 1, h: 1, data: new Uint8ClampedArray(4) });
  img.src = new URL('./land.png?v=27584ec5ac', import.meta.url).href;
});

// the map at a direction, smoothly: channel 0 is land, 1 is height
function sample(d, ch) {
  const lat = Math.asin(clamp(d.y, -1, 1)), lon = Math.atan2(-d.z, d.x);
  const x = (lon / (2 * Math.PI) + 0.5) * map.w - 0.5, y = clamp((0.5 - lat / Math.PI) * map.h - 0.5, 0, map.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (xi, yi) => map.data[((Math.min(yi, map.h - 1) * map.w) + ((xi % map.w) + map.w) % map.w) * 4 + ch];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return (top * (1 - fy) + bottom * fy) / 255;
}
const land = (d) => sample(d, 0);
const isSea = (d) => land(d) < 0.42;

function lift(d) {
  const shore = smooth(0.3, 0.7, land(d));
  const ripple = Math.sin(d.x * 9.1 + 1.3) * Math.sin(d.y * 8.3 + 0.7) * Math.sin(d.z * 8.7 + 2.1) * 0.12;
  return -0.9 + shore * (1.05 + sample(d, 1) * 1.6 + ripple);
}
const ground = (d, up = 0) => d.clone().multiplyScalar(R + Math.max(lift(d), SEA) + up);
const onSea = (d, up = 0) => d.clone().multiplyScalar(R + SEA + up);

// ------------------------------------------------------------------ the world

const w = createWorld({
  explore: { at: CENTER, dist: 122, half: 38, az: 0.85, el: 0.2 },
  occluder: { center: CENTER, r: R },
  modes: ['sail', 'launch'],
});
const { scene, ui } = w;

// a toy's colors, soft: sage lowlands, sand in the dry belts, stone on the heights, snow at the top
const TOY = {
  sage: '#b7cf9b', meadow: '#c9dba6', sand: '#ecd9aa', stone: '#d6cdc0', snow: '#fbfaf6',
  sea: '#a9dcd5', shallow: '#bde6df', deep: '#93cdc6', bed: '#86bdb6', ice: '#f4f8f8',
};
const col = Object.fromEntries(Object.entries(TOY).map(([k, v]) => [k, new THREE.Color(v)]));
const planet = w.globe({
  R, lift,
  color(d, h, c) {
    if (h < SEA) { c.copy(col.bed); return; }
    const lat = Math.abs(Math.asin(d.y)), e = sample(d, 1);
    c.copy(col.sage).lerp(col.meadow, smooth(0.0, 0.5, Math.sin(d.x * 13 + d.z * 7) * 0.5 + 0.5) * 0.6);
    c.lerp(col.sand, smooth(0.17, 0.3, lat) * smooth(0.66, 0.52, lat) * 0.85);   // about 10° to 35°
    c.lerp(col.stone, smooth(0.3, 0.55, e));
    c.lerp(col.snow, Math.max(smooth(1.02, 1.18, lat), smooth(0.6, 0.78, e)));
  },
});

// the sea: a smooth shell over the low ground, frozen near the poles
const sea = (() => {
  const geo = new THREE.SphereGeometry(R + SEA, 160, 110);
  const p = geo.attributes.position, colors = new Float32Array(p.count * 3);
  const d = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    // lighter where it's shallow, by the coasts
    c.copy(col.deep).lerp(col.sea, smooth(0.0, 0.12, land(d))).lerp(col.shallow, smooth(0.15, 0.4, land(d)));
    c.lerp(col.ice, smooth(1.3, 1.38, Math.abs(Math.asin(d.y))));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

// ------------------------------------------------------------------ trees, rocks, clouds

const scatter = rng(5);
const crowns = ['#9cc78a', '#86b97c', '#b0d39a', '#a3c98c'].map((c) => std(c, { roughness: 0.75, flatShading: true }));
const rockMat = std('#d9cfc1', { roughness: 1, flatShading: true });
// the pad and the landmarks keep their ground clear of trees
const taken = [PAD_DIR, ...[[-22.95, -43.21], [29.98, 31.13], [48.86, 2.35], [35.36, 138.73], [-34.36, 18.47]].map(([a, b]) => latLon(a, b))];
for (let grove = 0; grove < 46; grove++) {
  let center = null;
  for (let tries = 0; tries < 80 && !center; tries++) {
    const d = randomDir(scatter);
    if (Math.abs(d.y) > 0.8 || land(d) < 0.9 || sample(d, 1) > 0.4) continue;
    if (taken.some((t) => t.angleTo(d) < 0.12)) continue;
    center = d;
  }
  if (!center) continue;
  taken.push(center);
  const count = 2 + Math.floor(scatter() * 3);
  const crown = crowns[grove % crowns.length];
  for (let i = 0; i < count; i++) {
    const d = center.clone().add(randomDir(scatter).multiplyScalar(0.05)).normalize();
    if (land(d) < 0.8) continue;
    w.tree(ground(d, -0.05), d, scatter, 0.8, crown);
  }
}
for (let i = 0; i < 34; i++) {
  const d = randomDir(scatter);
  if (land(d) < 0.85 || taken.some((t) => t.angleTo(d) < 0.06)) continue;
  const s = 0.2 + scatter() * 0.4;
  w.rock(ground(d, s * 0.2), d, scatter, s, rockMat);
}

const clouds = [
  w.cloudRing({ center: CENTER, radius: R + 7.5, count: 9, rand: scatter }),
  w.cloudRing({ center: CENTER, radius: R + 9, count: 5, rand: scatter, tilt: [-0.7, 0.4, 0.5] }),
];

// ------------------------------------------------------------------ the sailboat

const boat = (() => {
  const group = new THREE.Group(), body = new THREE.Group();
  group.add(body);
  const white = std(C.stone, { roughness: 0.6 });
  // the hull in profile, bow at +z
  const hull = new THREE.Shape();
  hull.moveTo(-1.05, 0.42); hull.lineTo(1.25, 0.42);
  hull.quadraticCurveTo(1.0, -0.05, 0.55, -0.18); hull.lineTo(-0.85, -0.18);
  hull.quadraticCurveTo(-1.05, 0.0, -1.05, 0.42);
  const hullGeo = new THREE.ExtrudeGeometry(hull, { depth: 0.78, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3 });
  hullGeo.translate(0, 0, -0.39);
  hullGeo.rotateY(-Math.PI / 2);
  const hullMesh = new THREE.Mesh(hullGeo, white);
  hullMesh.castShadow = true;
  body.add(hullMesh);
  w.box(0.62, 0.05, 1.8, std(C.wood, { roughness: 0.9 }), 0, 0.5, 0.05, body);
  w.box(0.5, 0.32, 0.62, white, 0, 0.66, -0.4, body);
  w.box(0.52, 0.08, 0.2, std(C.glass, { roughness: 0.2 }), 0, 0.7, -0.08, body);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 2.7, 8), std(C.steel, { roughness: 0.45, metalness: 0.3 }));
  mast.position.set(0, 1.85, 0.15);
  mast.castShadow = true;
  body.add(mast);
  const sail = (points, mat, z) => {
    const s = new THREE.Shape();
    s.moveTo(...points[0]); s.lineTo(...points[1]); s.lineTo(...points[2]); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
    geo.translate(0, 0, -0.0175);
    geo.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, 0.62, z);
    m.castShadow = true;
    body.add(m);
    return m;
  };
  const main = sail([[0, 0.05], [0, 2.3], [-1.2, 0.08]], std(C.signal, { roughness: 0.7, side: THREE.DoubleSide }), 0.1);
  const jib = sail([[0, 0.25], [0, 1.9], [0.95, 0.2]], std(C.stone, { roughness: 0.7, side: THREE.DoubleSide }), 0.2);
  main.rotation.y = 0.55;                  // trimmed to the wind, so they show from behind
  jib.rotation.y = -0.35;
  body.scale.setScalar(1.25);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hit.position.y = 1.3;
  group.add(hit);
  scene.add(group);
  return {
    group, body, hit, sails: [main, jib],
    dir: latLon(-22, -24), heading: new THREE.Vector3(), target: null, speed: CRUISE, moving: 0, rest: 2,
  };
})();
boat.heading.copy(latLon(-22, -16)).sub(boat.dir).projectOnPlane(boat.dir).normalize();

const tmpAxis = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpH = new THREE.Vector3(), next = new THREE.Vector3();
const keys = new Set();
let blockedFor = 0;

// one step along the heading, or the nearest turn of it that stays on the water
function sailStep(angle, dt) {
  for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.5, -1.5]) {
    tmpH.copy(boat.heading).applyAxisAngle(boat.dir, off);
    tmpAxis.crossVectors(boat.dir, tmpH).normalize();
    next.copy(boat.dir).applyAxisAngle(tmpAxis, angle);
    if (!isSea(next)) continue;
    boat.dir.copy(next);
    if (off) boat.heading.lerp(tmpH, damp(dt, 5)).normalize();
    return true;
  }
  return false;
}

function moveBoat(dt) {
  const before = boat.dir.clone();
  const steering = w.mode === 'sail' && (keys.has('forward') || keys.has('back') || keys.has('left') || keys.has('right'));
  if (steering) {
    boat.target = null;
    const turn = (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0);
    boat.heading.applyAxisAngle(boat.dir, turn * 2.2 * dt);
    const go = (keys.has('forward') ? 1 : 0) - (keys.has('back') ? 0.5 : 0);
    if (go > 0) sailStep(go * SAIL * dt / R, dt);
  } else if (boat.target) {
    const left = boat.dir.angleTo(boat.target);
    if (left < 0.01) boat.target = null;
    else {
      tmpAxis.crossVectors(boat.dir, boat.target).normalize();
      const want = new THREE.Vector3().crossVectors(tmpAxis, boat.dir).normalize();
      boat.heading.lerp(want, damp(dt, 4)).normalize();
      if (sailStep(Math.min(left, boat.speed * dt / R), dt)) blockedFor = 0;
      else if ((blockedFor += dt) > 0.6) {
        boat.target = null;
        if (w.mode === 'sail') w.toast('land ahead');
      }
    }
  } else if (w.mode !== 'sail' && !reduceMotion) {
    boat.rest -= dt;
    if (boat.rest <= 0) {
      boat.rest = 4 + Math.random() * 4;
      const wander = boat.dir.clone().add(randomDir(Math.random).multiplyScalar(0.25)).normalize();
      if (isSea(wander)) { boat.target = wander; boat.speed = CRUISE; }
    }
  }
  boat.dir.normalize();
  boat.heading.projectOnPlane(boat.dir).normalize();
  const moved = before.angleTo(boat.dir) * R / Math.max(dt, 1e-4);
  boat.moving += (clamp(moved / SAIL, 0, 1) - boat.moving) * damp(dt, 4);

  const t = reduceMotion ? 0 : w.time;
  boat.group.position.copy(onSea(boat.dir, 0.02 + Math.sin(t * 1.8) * 0.05));
  const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), boat.heading, boat.dir);
  boat.group.quaternion.setFromRotationMatrix(look).multiply(tmpQ.setFromAxisAngle(UP, Math.PI));
  boat.body.rotation.set(-boat.moving * 0.08 + Math.sin(t * 1.4) * 0.03, 0, Math.sin(t * 1.1) * 0.06 + boat.moving * 0.12);
}

// a buoy in each of the seven seas
const buoyMat = glow(C.signal, 0.55);
const poleMat = std(C.dark, { roughness: 0.4 });
const buoys = SEAS.map(([name, lat, lon], i) => {
  let d = latLon(lat, lon);
  for (let k = 0; k < 20 && !isSea(d); k++) d = latLon(lat + (k % 2 ? -k : k), lon + k);
  const g = new THREE.Group();
  const float = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), buoyMat);
  float.scale.y = 0.8;
  float.castShadow = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), poleMat);
  pole.position.y = 0.75;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.4), buoyMat);
  flag.position.set(0, 1.15, 0.2);
  g.add(float, pole, flag);
  scene.add(g);
  return { name, dir: d, group: g, phase: i * 1.7, got: false, fade: 0 };
});
let seasGot = 0;

function moveBuoys(dt) {
  const t = reduceMotion ? 0 : w.time;
  for (const b of buoys) {
    if (b.got) {
      if (b.fade < 1) {
        b.fade = Math.min(1, b.fade + dt * 2.2);
        b.group.position.copy(onSea(b.dir, b.fade * 2.5));
        b.group.scale.setScalar(Math.max(0.001, 1 - b.fade));
      } else b.group.visible = false;
      continue;
    }
    w.stand(b.group, onSea(b.dir, Math.sin(t * 1.6 + b.phase) * 0.07), b.dir, t * 0.3 + b.phase);
    b.group.rotateX(Math.sin(t * 1.3 + b.phase) * 0.08);
    if (w.mode === 'sail' && b.group.position.distanceTo(boat.group.position) < 2.6) collect(b);
  }
}

function collect(b) {
  b.got = true;
  seasGot++;
  w.sound.chime(seasGot * 2 - 2);
  ui.score.textContent = String(seasGot);
  if (seasGot === SEAS.length) {
    w.sound.fanfare();
    store.set('earth.seas', '7');
    w.toast('All seven seas.', 5000);
    w.sync();
  } else w.toast(`${b.name} · ${seasGot} of ${SEAS.length}`);
}

function resetSeas() {
  seasGot = 0;
  for (const b of buoys) { b.got = false; b.fade = 0; b.group.visible = true; b.group.scale.setScalar(1); }
}

// ------------------------------------------------------------------ the launch pad and the rocket

const padPos = ground(PAD_DIR);
const EAST = new THREE.Vector3().crossVectors(UP, PAD_DIR).normalize();
const NORTH = new THREE.Vector3().crossVectors(PAD_DIR, EAST).normalize();

const pad = w.stand(new THREE.Group(), padPos, PAD_DIR, -0.3);
scene.add(pad);
const concrete = std(C.concrete, { roughness: 0.95 });
w.box(4.2, 1.4, 4.2, concrete, 0, -0.45, 0, pad);
w.box(1.4, 0.12, 1.4, std(C.steel, { roughness: 0.5, metalness: 0.3 }), 0, 0.3, 0, pad);
const towerMat = new THREE.MeshStandardMaterial({ map: w.lattice, color: '#ece9e2', roughness: 0.8 });
towerMat.map = w.lattice.clone();
towerMat.map.repeat.set(1, 11);
towerMat.map.needsUpdate = true;
w.box(0.6, 7.2, 0.6, towerMat, -1.45, 3.85, 0, pad);
w.box(0.95, 0.16, 0.26, std(C.signal, { roughness: 0.6 }), -0.85, 2.8, 0, pad);
w.box(0.95, 0.16, 0.26, std(C.signal, { roughness: 0.6 }), -0.85, 5.0, 0, pad);
w.box(0.3, 0.6, 0.3, std(C.signal, { roughness: 0.5 }), -1.45, 7.75, 0, pad);

const white = std('#f8f7f3', { roughness: 0.55 });
const band = std(C.signal, { roughness: 0.6 });
const steel = std(C.steel, { roughness: 0.45, metalness: 0.4 });
function cyl(rt, rb, h, mat, y, parent) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 28), mat);
  m.position.y = y;
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
const rocket = new THREE.Group();
rocket.position.y = 0.36;
pad.add(rocket);
const stages = [
  (() => {
    const g = new THREE.Group();
    cyl(0.2, 0.32, 0.32, steel, 0.16, g);
    cyl(0.42, 0.42, 2.4, white, 1.52, g);
    cyl(0.425, 0.425, 0.22, band, 2.45, g);
    for (let i = 0; i < 4; i++) {
      const fin = w.box(0.06, 0.75, 0.5, band, 0, 0.62, 0, g);
      fin.position.set(Math.cos(i * Math.PI / 2) * 0.55, 0.62, Math.sin(i * Math.PI / 2) * 0.55);
      fin.rotation.y = -i * Math.PI / 2 + Math.PI / 2;
    }
    return g;
  })(),
  (() => {
    const g = new THREE.Group();
    cyl(0.16, 0.25, 0.22, steel, 0.11, g);
    cyl(0.36, 0.42, 0.3, white, 0.37, g);
    cyl(0.36, 0.36, 1.4, white, 1.22, g);
    cyl(0.365, 0.365, 0.16, band, 1.62, g);
    return g;
  })(),
  (() => {
    const g = new THREE.Group();
    cyl(0.12, 0.2, 0.18, steel, 0.09, g);
    cyl(0.32, 0.36, 0.25, white, 0.31, g);
    cyl(0.32, 0.32, 0.75, white, 0.8, g);
    cyl(0.325, 0.325, 0.1, std(C.dark, { roughness: 0.4 }), 0.95, g);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.05, 28), white);
    nose.position.y = 1.7;
    nose.castShadow = true;
    g.add(nose);
    return g;
  })(),
];
const STACK = [0, 2.65, 4.4];
stages.forEach((s, i) => { s.position.y = STACK[i]; rocket.add(s); });

const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3, 20), new THREE.MeshStandardMaterial({
  color: '#ff8a2a', emissive: '#ff6a00', emissiveIntensity: 2.2, roughness: 0.4,
}));
flame.rotation.x = Math.PI;
flame.visible = false;
rocket.add(flame);

// puffs of exhaust, from a pool
const puffs = Array.from({ length: 70 }, () => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 1, flatShading: true, transparent: true, opacity: 0,
  }));
  m.visible = false;
  scene.add(m);
  return { mesh: m, life: 0, vel: new THREE.Vector3(), size: 1 };
});
let puffAt = 0;
function puff(pos, vel, size = 1) {
  const p = puffs[puffAt++ % puffs.length];
  p.mesh.position.copy(pos);
  p.vel.copy(vel);
  p.life = 1;
  p.size = size;
  p.mesh.visible = true;
}
function movePuffs(dt) {
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt * 0.55;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.multiplyScalar(Math.exp(-dt * 1.5));
    p.mesh.scale.setScalar(p.size * (0.5 + (1 - p.life) * 1.8));
    p.mesh.material.opacity = Math.max(0, p.life) * 0.9;
    if (p.life <= 0) p.mesh.visible = false;
  }
}

// satellites: every launch that reached orbit
const satBody = std('#f8f7f3', { roughness: 0.5 });
const satPanel = std(C.glass, { roughness: 0.25, metalness: 0.3 });
const sats = [];
function satellite(seed) {
  const g = new THREE.Group();
  w.box(0.5, 0.5, 0.62, satBody, 0, 0, 0, g);
  w.box(0.18, 0.18, 0.12, std(C.signal, { roughness: 0.5 }), 0, 0, 0.36, g);
  const wings = new THREE.Group();
  w.box(2.6, 0.04, 0.5, satPanel, 0, 0, 0, wings);
  w.box(0.08, 0.08, 0.08, satBody, 0, 0, 0, wings);
  g.add(wings);
  scene.add(g);
  const rand = rng(seed * 97 + 3);
  const normal = randomDir(rand);
  const u = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0.3, 1, 0.2)).normalize();
  const s = { group: g, wings, normal, u, v: new THREE.Vector3().crossVectors(normal, u), r: R + 12.5 + (seed % 4) * 0.8, phase: rand() * 6, speed: 0.12 + rand() * 0.05, arrive: 1 };
  sats.push(s);
  return s;
}
function satPlace(s, dt) {
  s.phase += s.speed * dt;
  const target = s.u.clone().multiplyScalar(Math.cos(s.phase) * s.r).addScaledVector(s.v, Math.sin(s.phase) * s.r);
  if (s.arrive < 1) {
    s.arrive = Math.min(1, s.arrive + dt * 0.6);
    s.group.position.lerp(target, damp(dt, 1 + s.arrive * 6));
    s.wings.scale.x = Math.max(0.05, s.arrive);
  } else s.group.position.copy(target);
  s.group.lookAt(CENTER);
}
let satCount = clamp(Number(store.get('earth.satellites')) || 0, 0, MAX_SATS);
for (let i = 0; i < satCount; i++) satellite(i);

// ------------------------------------------------------------------ the launch game

let state = 'ready';          // ready, flying, orbit, lost
const flight = { stage: 0, fuel: 1, burn: 0, v: 0, h: 0, late: 0, ratings: [], fall: 0, spin: 0, why: '' };
const debris = [];
const rocketPos = new THREE.Vector3();

const lift3 = (h) => 13 * (1 - Math.exp(-h / 45));      // how high the rocket shows: real climbs squeezed to fit

function resetRocket() {
  for (const d of debris) scene.remove(d.group);
  debris.length = 0;
  stages.forEach((s, i) => {
    rocket.add(s);
    s.position.set(0, STACK[i], 0);
    s.rotation.set(0, 0, 0);
    s.visible = true;
  });
  rocket.position.set(0, 0.36, 0);
  rocket.rotation.set(0, 0, 0);
  rocket.visible = true;
  flame.visible = false;
  Object.assign(flight, { stage: 0, fuel: 1, v: 0, h: 0, late: 0, ratings: [], fall: 0, spin: 0, why: '' });
}

function startLaunch() {
  if (state === 'flying') return;
  resetRocket();
  state = 'flying';
  flight.burn = STAGES[0].burn * (0.85 + Math.random() * 0.3);
  w.hideCard();
  flame.visible = true;
  flame.position.y = -0.55;
  w.sound.whoosh(1);
  w.shake = 0.35;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const side = EAST.clone().multiplyScalar(Math.cos(a)).addScaledVector(NORTH, Math.sin(a));
    puff(padPos.clone().addScaledVector(PAD_DIR, 0.4), side.multiplyScalar(3 + Math.random() * 3).addScaledVector(PAD_DIR, Math.random()), 1.2);
  }
  w.sync();
}

// let go of the stage that is burning or burnt out, and light the next
function dropStage() {
  if (state !== 'flying') return;
  const f = flight;
  let rating;
  if (f.fuel > 0) rating = f.fuel < 0.07 ? 'perfect' : 'early';
  else rating = f.late < 0.18 ? 'perfect' : 'late';
  f.ratings.push(rating);
  const s = stages[f.stage];
  scene.attach(s);
  debris.push({ group: s, vel: PAD_DIR.clone().multiplyScalar(f.v * 0.15).addScaledVector(EAST, 0.6), spin: (Math.random() - 0.5) * 2, life: 3 });
  w.sound.thunk(0.7);
  f.stage++;
  if (f.stage < STAGES.length) {
    f.fuel = 1;
    f.late = 0;
    f.burn = STAGES[f.stage].burn * (0.85 + Math.random() * 0.3);
    flame.visible = true;
    flame.position.y = STACK[f.stage] - 0.45;
    w.sound.whoosh(0.6);
    w.toast(rating === 'perfect' ? 'perfect staging' : rating === 'early' ? 'early: fuel left behind' : 'late: speed lost');
  } else {
    flame.visible = false;
    if (f.v >= ORBIT_V) reachOrbit();
    else lose('slow');
  }
  w.sync();
}

function reachOrbit() {
  state = 'orbit';
  rocket.visible = false;
  satCount = Math.min(satCount + 1, MAX_SATS);
  store.set('earth.satellites', String(satCount));
  const s = sats.length >= MAX_SATS ? sats[sats.length - 1] : satellite(sats.length);
  // into an orbit that passes over the pad, from where the rocket is now
  s.normal.copy(NORTH);
  s.u.copy(PAD_DIR);
  s.v.copy(EAST);                     // heading east, as rockets launch
  s.phase = 0;
  s.arrive = 0;
  s.group.position.copy(rocketPos);
  w.sound.fanfare();
  w.toast(`In orbit at ${Math.round(flight.h * KM)} km.`, 4000);
  w.showCard(() => CARDS.orbit(), 2.4);
}

function lose(why) {
  state = 'lost';
  flight.why = why;
  flame.visible = false;
  flight.fall = flight.v;
  w.sound.groan();
  w.showCard(() => CARDS.lost(), 2.6);
}

function moveRocket(dt) {
  const f = flight;
  if (state === 'flying') {
    const st = STAGES[f.stage];
    if (f.fuel > 0) {
      f.v += st.thrust * dt;
      f.fuel = Math.max(0, f.fuel - dt / f.burn);
      if (f.fuel === 0) { flame.visible = false; w.sound.blip(); }
    } else f.late += dt;
    f.v -= G * dt;
    f.h += f.v * dt;
    if (f.v <= 0) lose('stall');
    if (flame.visible && Math.random() < dt * 30) {
      const base = new THREE.Vector3(0, flame.position.y - 0.5, 0);
      rocket.localToWorld(base);
      puff(base, PAD_DIR.clone().multiplyScalar(-2 - Math.random()).addScaledVector(EAST, (Math.random() - 0.5) * 1.5), 0.55 + f.h * 0.004);
    }
    flame.scale.set(1 + Math.sin(w.time * 40) * 0.08, 1 + Math.sin(w.time * 31) * 0.18, 1);
    ui.score.textContent = String(Math.round(f.h * KM));
    ui.goal.textContent = `km · stage ${Math.min(f.stage + 1, 3)} of 3`;
    if (ui.meter) {
      ui.meter.style.setProperty('--fuel', f.fuel.toFixed(3));
      ui.meter.classList.toggle('dry', f.fuel === 0);
    }
  } else if (state === 'lost' && rocket.visible) {
    // a tumble back down to the ground
    f.fall -= G * 1.6 * dt;
    f.h = Math.max(0, f.h + f.fall * dt * 2.5);
    f.spin += dt * 1.8;
    rocket.rotation.z = Math.min(f.spin, 2.6);
    if (lift3(f.h) < 0.6) {
      rocket.visible = false;
      w.sound.thunk(1);
      w.shake = 0.5;
      for (let i = 0; i < 14; i++) puff(rocketPos, randomDir(Math.random).multiplyScalar(3).addScaledVector(PAD_DIR, 2), 1.3);
    }
  }
  if (state === 'flying' || state === 'lost') rocket.position.y = 0.36 + lift3(f.h);
  rocket.getWorldPosition(rocketPos);
  for (const d of debris) {
    d.life -= dt;
    d.vel.addScaledVector(PAD_DIR, -G * 1.4 * dt);
    d.group.position.addScaledVector(d.vel, dt);
    d.group.rotateZ(d.spin * dt);
    if (d.life < 1) d.group.scale.setScalar(Math.max(0.001, d.life));
    if (d.life <= 0) d.group.visible = false;
  }
}

const CARDS = {
  ready: () => ({
    kicker: 'The rocket',
    title: 'Reach orbit.',
    text: 'Three stages. Drop each one the moment it runs dry: too soon leaves fuel behind, too late and gravity takes the speed.',
    go: 'Launch',
    best: satCount ? `satellites up: ${satCount}` : '',
  }),
  orbit: () => ({
    kicker: 'The rocket',
    title: 'In orbit.',
    text: `Satellite ${satCount} is up at ${Math.round(flight.h * KM)} km, with ${flight.ratings.filter((r) => r === 'perfect').length} of 3 stagings perfect. It stays up there.`,
    go: 'Launch another',
    best: `satellites up: ${satCount}`,
  }),
  lost: () => ({
    kicker: 'The rocket',
    title: 'Lost.',
    text: flight.why === 'stall'
      ? `It ran out of speed between stages, ${plural(flight.stage, 'stage')} in.`
      : `Not fast enough for orbit: ${Math.round(clamp(flight.v / ORBIT_V, 0, 1) * 100)}% of the speed it needed.`,
    go: 'Try again',
    best: satCount ? `satellites up: ${satCount}` : '',
  }),
};

// ------------------------------------------------------------------ toys: landmarks, a lighthouse, a whale, fish

// the nearest good land to a place, since a coast at this map's scale may come out as sea
function landAt(lat, lon) {
  for (let r = 0; r < 6; r += 0.5) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const d = latLon(lat + Math.sin(a) * r, lon + Math.cos(a) * r);
      if (land(d) > 0.75) return d;
      if (r === 0) break;
    }
  }
  return latLon(lat, lon);
}

function landmark(lat, lon, build, yaw = 0) {
  const d = landAt(lat, lon);
  const g = w.stand(new THREE.Group(), ground(d, -0.08), d, yaw);
  build(g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(g);
  taken.push(d);
  return g;
}
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const toyWhite = std('#fbfaf6', { roughness: 0.7 });
const red = std('#e0533c', { roughness: 0.6 });

// Christ the Redeemer, on his hill over Rio
landmark(-22.95, -43.21, (g) => {
  g.add(mesh(new THREE.ConeGeometry(1.0, 0.9, 7), std(TOY.sage, { roughness: 0.9, flatShading: true }), 0, 0.45, 0));
  g.add(mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), toyWhite, 0, 1.0, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.95, 10), toyWhite, 0, 1.6, 0));
  g.add(mesh(new THREE.BoxGeometry(1.05, 0.11, 0.12), toyWhite, 0, 1.95, 0));
  g.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), toyWhite, 0, 2.17, 0));
}, 0.6);
// the pyramids at Giza
landmark(29.98, 31.13, (g) => {
  const stone = std('#e6cf98', { roughness: 0.9, flatShading: true });
  [[1.0, 1.25, 0, 0], [0.82, 1.0, 1.0, 0.75], [0.5, 0.62, 1.75, 1.3]].forEach(([r, h, x, z]) => {
    g.add(mesh(new THREE.ConeGeometry(r, h, 4).rotateY(Math.PI / 4), stone, x - 0.8, h / 2, z - 0.6));
  });
});
// the Eiffel Tower
landmark(48.86, 2.35, (g) => {
  const iron = std('#8c7d6c', { roughness: 0.6 });
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    w.rod(new THREE.Vector3(x * 0.55, 0, z * 0.55), new THREE.Vector3(x * 0.1, 1.7, z * 0.1), 0.06, iron, g);
  }
  g.add(mesh(new THREE.BoxGeometry(0.85, 0.08, 0.85), iron, 0, 0.55, 0));
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.07, 0.42), iron, 0, 1.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.12, 1.25, 4), iron, 0, 2.3, 0));
});
// Mount Fuji, snow on top
landmark(35.36, 138.73, (g) => {
  g.add(mesh(new THREE.ConeGeometry(1.5, 1.5, 24), std('#b9b6c9', { roughness: 0.9 }), 0, 0.75, 0));
  g.add(mesh(new THREE.ConeGeometry(0.58, 0.58, 24), toyWhite, 0, 1.21, 0));
});
// a lighthouse at the Cape of Good Hope, its beam going round
const beam = (() => {
  let b;
  landmark(-34.36, 18.47, (g) => {
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.7, 20), toyWhite, 0, 0.85, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.235, 0.26, 0.2, 20), red, 0, 0.5, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.205, 0.225, 0.2, 20), red, 0, 1.15, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 16), std(C.glass, { roughness: 0.2 }), 0, 1.83, 0));
    g.add(mesh(new THREE.SphereGeometry(0.11, 12, 10), glow('#ffd27a', 1.6), 0, 1.83, 0));
    g.add(mesh(new THREE.ConeGeometry(0.24, 0.24, 16), red, 0, 2.08, 0));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 4.5, 20, 1, true).translate(0, -2.25, 0).rotateZ(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    b = new THREE.Group();
    b.position.y = 1.83;
    b.add(cone);
    g.add(b);
  });
  return b;
})();

// a whale, going round in the South Pacific; click it and it spouts
const whale = (() => {
  const group = new THREE.Group(), body = new THREE.Group();
  group.add(body);
  const skin = std('#7393ad', { roughness: 0.6 }), belly = std('#d9e3ea', { roughness: 0.7 });
  const b = mesh(new THREE.SphereGeometry(1, 28, 18), skin);
  b.scale.set(0.62, 0.5, 1.5);
  const under = mesh(new THREE.SphereGeometry(1, 28, 18), belly, 0, -0.12, 0.1);
  under.scale.set(0.5, 0.36, 1.25);
  const tail = new THREE.Group();
  tail.position.z = -1.35;
  const fluke = (x) => { const f = mesh(new THREE.BoxGeometry(0.55, 0.06, 0.32), skin, x, 0.05, -0.32); f.rotation.y = x * 0.9; return f; };
  tail.add(mesh(new THREE.CylinderGeometry(0.12, 0.28, 0.6, 12).rotateX(Math.PI / 2), skin, 0, 0, -0.1), fluke(0.3), fluke(-0.3));
  const eyeL = mesh(new THREE.SphereGeometry(0.05, 8, 6), std(C.ink), 0.5, 0.05, 0.9);
  const eyeR = mesh(new THREE.SphereGeometry(0.05, 8, 6), std(C.ink), -0.5, 0.05, 0.9);
  body.add(b, under, tail, eyeL, eyeR);
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const hit = mesh(new THREE.SphereGeometry(2.0, 10, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), 0, 0.5, 0);
  group.add(hit);
  scene.add(group);
  return { group, body, tail, hit, center: latLon(-18, -128), around: 0, spout: 0 };
})();
const spray = Array.from({ length: 10 }, () => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0 }));
  scene.add(m);
  return { mesh: m, life: 0, vel: new THREE.Vector3() };
});
function spout() {
  whale.spout = 1;
  const top = new THREE.Vector3(0, 0.55, 0.5);
  whale.group.localToWorld(top);
  const up = whale.group.position.clone().normalize();
  spray.forEach((s, i) => {
    s.mesh.position.copy(top);
    s.vel.copy(up).multiplyScalar(2.6 + Math.random() * 1.6).add(randomDir(Math.random).multiplyScalar(0.6));
    s.life = 1 + i * 0.03;
  });
  w.sound.whoosh(0.35);
}
let spoutTimer = 4;
function moveWhale(dt) {
  const t = reduceMotion ? 0 : w.time;
  whale.around += dt * 0.05;
  whale.spout = Math.max(0, whale.spout - dt * 0.5);
  // a small circle round its center, on the sea
  const east = new THREE.Vector3().crossVectors(UP, whale.center).normalize();
  const north = new THREE.Vector3().crossVectors(whale.center, east);
  const off = east.clone().multiplyScalar(Math.cos(whale.around)).addScaledVector(north, Math.sin(whale.around));
  const d = whale.center.clone().addScaledVector(off, 0.13).normalize();
  const heading = east.clone().multiplyScalar(-Math.sin(whale.around)).addScaledVector(north, Math.cos(whale.around)).projectOnPlane(d).normalize();
  whale.group.position.copy(onSea(d, -0.22 + Math.sin(t * 0.7) * 0.12));
  const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), heading, d);
  whale.group.quaternion.setFromRotationMatrix(look).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
  whale.body.rotation.x = Math.sin(t * 0.7 + 0.8) * 0.08;
  whale.tail.rotation.x = Math.sin(t * 2.2) * 0.35;
  if (!reduceMotion && (spoutTimer -= dt) <= 0) { spoutTimer = 7 + Math.random() * 6; spout(); }
  for (const s of spray) {
    if (s.life <= 0) continue;
    s.life -= dt * 0.9;
    s.vel.addScaledVector(s.mesh.position.clone().normalize(), -5 * dt);
    s.mesh.position.addScaledVector(s.vel, dt);
    s.mesh.scale.setScalar(0.6 + (1 - s.life) * 1.4);
    s.mesh.material.opacity = Math.max(0, s.life) * 0.9;
  }
}

// fish that leap out of the sea where you're looking, now and then
const fishMat = std('#f2924a', { roughness: 0.5 });
const fishes = Array.from({ length: 3 }, () => {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.3, 14, 10), fishMat);
  body.scale.set(0.45, 0.6, 1);
  const tail = mesh(new THREE.ConeGeometry(0.2, 0.3, 4).rotateX(-Math.PI / 2), fishMat, 0, 0, -0.38);
  tail.scale.x = 0.3;
  g.add(body, tail);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.visible = false;
  scene.add(g);
  return { group: g, t: 1, from: new THREE.Vector3(), to: new THREE.Vector3() };
});
const rings = Array.from({ length: 6 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.36, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
  m.life = 0;
  scene.add(m);
  return m;
});
let ringAt = 0, leapTimer = 2;
function splash(d) {
  const r = rings[ringAt++ % rings.length];
  r.position.copy(onSea(d, 0.03));
  r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
  r.life = 1;
}
function moveFish(dt) {
  if (!reduceMotion && (leapTimer -= dt) <= 0) {
    leapTimer = 1.5 + Math.random() * 3;
    const f = fishes.find((x) => x.t >= 1);
    const near = (w.mode === 'sail' ? boat.dir : w.camera.position).clone().normalize();
    const d = near.add(randomDir(Math.random).multiplyScalar(w.mode === 'sail' ? 0.12 : 0.35)).normalize();
    if (f && isSea(d)) {
      const side = randomDir(Math.random).projectOnPlane(d).normalize();
      f.from.copy(d);
      f.to.copy(d).applyAxisAngle(new THREE.Vector3().crossVectors(d, side).normalize(), 1.7 / R);
      if (isSea(f.to)) { f.t = 0; f.group.visible = true; splash(d); }
    }
  }
  for (const f of fishes) {
    if (f.t >= 1) continue;
    const before = f.t;
    f.t = Math.min(1, f.t + dt / 0.9);
    const d = f.from.clone().lerp(f.to, f.t).normalize();
    f.group.position.copy(onSea(d, Math.sin(Math.PI * f.t) * 1.3));
    const dir = f.to.clone().sub(f.from).projectOnPlane(d).normalize();
    const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, d);
    f.group.quaternion.setFromRotationMatrix(look).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
    f.group.rotateX(-Math.cos(Math.PI * f.t) * 0.9);
    if (f.t >= 1) { f.group.visible = false; splash(f.to); if (before < 1) w.sound.blip(); }
  }
  for (const r of rings) {
    if (r.life <= 0) continue;
    r.life = Math.max(0, r.life - dt * 1.2);
    r.material.opacity = r.life * 0.8;
    r.scale.setScalar(1 + (1 - r.life) * 2.5);
  }
}

// ------------------------------------------------------------------ hooks

const followDir = new THREE.Vector3();
const padTop = padPos.clone().addScaledVector(PAD_DIR, 7.6);
const tmp = new THREE.Vector3();

Object.assign(w.hooks, {
  frame(dt) {
    moveBoat(dt);
    moveBuoys(dt);
    moveWhale(dt);
    moveFish(dt);
    if (beam && !reduceMotion) beam.rotation.y += dt * 1.2;
    moveRocket(dt);
    movePuffs(dt);
    for (const s of sats) satPlace(s, dt);
    if (!reduceMotion) {
      clouds[0].rotation.y += dt * 0.015;
      clouds[1].rotation.y -= dt * 0.01;
    }
  },
  enter(mode, from) {
    if (from === 'launch') { state = 'ready'; resetRocket(); }
    if (mode === 'sail') {
      boat.target = null;
      if (seasGot === SEAS.length) resetSeas();
      ui.score.textContent = String(seasGot);
      ui.goal.textContent = `of ${SEAS.length} seas`;
      followDir.copy(boat.heading);
      w.sound.blip();
    }
    if (mode === 'launch') {
      if (state !== 'flying') { state = 'ready'; resetRocket(); }
      w.showCard(() => CARDS.ready());
    }
  },
  hover(x, y) {
    const hit = w.pick(x, y, [pad, boat.hit, whale.hit, planet, sea]);
    if (!hit) return null;
    if (hit.object === boat.hit) return 'boat';
    if (hit.object === whale.hit) return 'whale';
    if (w.within(hit.object, pad)) return 'rocket';
    return null;
  },
  tap(x, y) {
    if (w.mode !== 'sail') return;
    const hit = w.pick(x, y, [planet, sea]);
    if (!hit) return;
    const d = hit.point.clone().normalize();
    boat.target = d;
    boat.speed = SAIL;
    blockedFor = 0;
    w.mark(isSea(d) ? onSea(d, 0.06) : ground(d, 0.06), d);
    if (!isSea(d)) w.toast('land: sailing as near as it can');
  },
  press() {
    if (w.mode === 'launch' && state === 'flying') { dropStage(); return true; }
    return false;
  },
  key(e, down) {
    const map = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
    if (w.mode === 'sail' && map[e.code]) {
      if (down) keys.add(map[e.code]); else keys.delete(map[e.code]);
      return true;
    }
    if (w.mode === 'launch' && down && (e.code === 'Space' || e.code === 'Enter') && !e.target.closest?.('a, button')) {
      if (state === 'flying') dropStage();
      else if (w.cardShown()) startLaunch();
      return true;
    }
    return false;
  },
  view(want, dt) {
    w.shift = 0;
    if (w.mode === 'sail') {
      followDir.lerp(boat.heading, damp(dt, 1.4)).projectOnPlane(boat.dir).normalize();
      if (followDir.lengthSq() < 0.5) followDir.copy(boat.heading);
      const p = boat.group.position;
      want.at.copy(p).addScaledVector(followDir, 5);
      want.pos.copy(p).addScaledVector(boat.dir, 19).addScaledVector(followDir, -16);
      want.up.copy(boat.dir);
      return 3;
    }
    // the rocket, from out over the Atlantic
    if (state === 'orbit') {
      const s = sats[sats.length - 1];
      want.at.copy(s.group.position).multiplyScalar(0.55);
      want.pos.copy(s.group.position).normalize().multiplyScalar(R + 46).addScaledVector(EAST, 26);
      want.up.copy(PAD_DIR);
      return 1.4;
    }
    w.shift = state === 'flying' ? 0 : 0.1;
    const climb = state === 'flying' || state === 'lost' ? lift3(flight.h) : 0;
    const at = tmp.copy(padPos).addScaledVector(PAD_DIR, 3.2 + climb);
    want.at.copy(at);
    want.pos.copy(at).addScaledVector(EAST, 21 + climb * 1.4).addScaledVector(NORTH, -7).addScaledVector(PAD_DIR, 3 - climb * 0.25);
    want.up.copy(PAD_DIR);
    return state === 'flying' ? 4 : 2.2;
  },
  sun(focus) {
    if (w.mode === 'sail') { focus.copy(boat.group.position); return 14; }
    if (w.mode === 'launch' && state !== 'orbit') { focus.copy(rocketPos); return 16; }
    focus.copy(CENTER);
    return R + 16;
  },
  playing() {
    return w.mode === 'sail' || (w.mode === 'launch' && state === 'flying');
  },
  hint(touch) {
    if (w.mode === 'sail') {
      return seasGot === SEAS.length ? 'all seven seas sailed'
        : touch ? 'tap the sea to sail there · a buoy waits in each of the seven seas'
          : 'click the sea, or use WASD · a buoy waits in each of the seven seas';
    }
    if (w.mode === 'launch' && state === 'flying' && flight.stage === 0) {
      return touch ? 'tap to drop each stage as it runs dry' : 'click or press space to drop each stage as it runs dry';
    }
    return '';
  },
  go: startLaunch,
  poke(key) {
    if (key === 'whale' && whale.spout <= 0.2) spout();
  },
});

w.tag($('tag-rocket'), 'rocket', 'launch', () => padTop);
const boatTop = new THREE.Vector3();
w.tag($('tag-boat'), 'boat', 'sail', () => boatTop.copy(boat.group.position).addScaledVector(boat.dir, 3.4));
function $(id) { return document.getElementById(id); }

w.start({ '#sail': 'sail', '#rocket': 'launch' });
