// The base every monolito.dev world is built on: the renderer, light, clay materials, camera, tags,
// cards and sounds of the planet on the home page (planet.js), so the worlds read as one set.
// A world calls createWorld() and fills in its hooks: what to do each frame, where the camera goes
// in each game, what a click picks. Three.js, no build step.

import * as THREE from '../planet/three.module.js?v=3feb33f3bc';

export { THREE };

export const UP = new THREE.Vector3(0, 1, 0);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
export const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// the home planet's palette
export const C = {
  planet: '#ebe8e1', planetLow: '#dcd8ce', stone: '#f6f4ef', concrete: '#dedad2', steel: '#4f5258',
  glass: '#33414a', wood: '#dcc9ad', signal: '#e66100', tree: '#f7f6f2', stem: '#cfc8bb', rock: '#e2ded5',
  dark: '#41454c', ink: '#1c1d1f', cloud: '#ffffff', sea: '#d6dfe1', seaDeep: '#c9d4d7', snow: '#fbfaf7',
};

export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomDir(rand) {
  const y = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - y * y);
  return new THREE.Vector3(Math.cos(a) * s, y, Math.sin(a) * s);
}

// a latitude and longitude in degrees as a direction: longitude 0 at +x, east towards -z, north up
export function latLon(lat, lon) {
  const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
}

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

export const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
export const glow = (color, strength = 0.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: 0.35 });

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

const SPEAKER_ON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

// opts: explore { at, dist, half, el }: what the camera circles and how much must fit on screen;
// occluder { center, r }: the sphere that hides tags behind it; modes: the games' names
export function createWorld(opts) {
  const $ = (id) => document.getElementById(id);
  const ui = {
    root: $('mono'), stage: $('stage'), back: $('back'), mute: $('mute'),
    score: $('score'), goal: $('goal'), toast: $('toast'), hint: $('hint'), meter: $('meter'),
    card: $('card'), kicker: $('card-kicker'), title: $('card-title'), text: $('card-text'), go: $('go'), best: $('best'),
  };

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
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 900);

  const w = {
    renderer, scene, camera, ui,
    time: 0, mode: 'explore', hot: null, ready: false, shift: 0, shake: 0,
    muted: store.get('monolito.muted') === '1',
    // what the world fills in
    hooks: {
      frame() {},                     // (dt) every frame
      enter() {},                     // (mode, from) after the mode changed
      leave() {},                     // (mode) before leaving a mode
      hover() { return null; },       // (x, y) → the tag key under the pointer, in explore
      tap() {},                       // (x, y) a click in a game
      press() { return false; },      // (x, y) a press in a game; true when it was used
      key() { return false; },        // (event, down) true when the key was used
      view() { return 2.2; },         // (want, dt) where the camera goes in a game; returns how fast
      sun() { return opts.occluder.r + 14; },   // (focus) where the shadows matter; returns their size
      playing() { return false; },
      hint() { return ''; },
      go() {},                        // the card's button
      poke() {},                      // (key) a click in explore on something that isn't a game
    },
  };

  // ---------------------------------------------------------------- building blocks

  w.box = (wd, h, d, mat, x = 0, y = 0, z = 0, parent = scene) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wd, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  w.rod = (a, b, r, mat, parent = scene) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 8), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  w.texture = (c, repeat = true) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  // a clay sphere whose ground rises and falls with lift(d); color(d, h, c) paints each vertex
  w.globe = ({ R, center = new THREE.Vector3(), lift, color, detail = [192, 128], parent = scene }) => {
    const geo = new THREE.SphereGeometry(1, detail[0], detail[1]);
    const p = geo.attributes.position, colors = new Float32Array(p.count * 3);
    const d = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(p, i).normalize();
      const h = lift(d);
      p.setXYZ(i, d.x * (R + h), d.y * (R + h), d.z * (R + h));
      color(d, h, c);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.position.copy(center);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // set an object on a sphere's surface at a direction, standing up
  w.stand = (obj, pos, d, yaw = 0) => {
    obj.position.copy(pos);
    obj.quaternion.setFromUnitVectors(UP, d);
    obj.rotateY(yaw);
    return obj;
  };

  const treeMat = std(C.tree, { roughness: 0.75, flatShading: true });
  const stemMat = std(C.stem, { roughness: 0.9 });
  const rockMat = std(C.rock, { roughness: 1, flatShading: true });
  // a round little tree: a thin stem and a soft crown
  w.tree = (pos, d, rand, scale = 1, crownMat = treeMat) => {
    const g = w.stand(new THREE.Group(), pos, d, rand() * 6);
    const h = (0.7 + rand() * 0.7) * scale, s = (0.55 + rand() * 0.4) * scale;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.09 * scale, h, 6), stemMat);
    stem.position.y = h / 2 - 0.05;
    stem.castShadow = true;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), crownMat);
    crown.position.y = h + s * 0.75;
    crown.scale.y = 1.15;
    crown.castShadow = crown.receiveShadow = true;
    g.add(stem, crown);
    scene.add(g);
    return g;
  };
  w.rock = (pos, d, rand, s, mat = rockMat) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
    w.stand(rock, pos, d, rand() * 6);
    rock.rotateX(rand());
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
    return rock;
  };

  // clouds of soft puffs on a tilted ring around a center
  w.cloudRing = ({ center, radius, count, rand, tilt = [0.32, 0, 0.18], spread = 4, height = 6 }) => {
    const ring = new THREE.Group();
    ring.position.copy(center);
    ring.rotation.set(...tilt);
    scene.add(ring);
    const mat = std(C.cloud, { roughness: 1, flatShading: true });
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group(), a = (i / count) * Math.PI * 2 + rand() * 0.4, r = radius + rand() * spread;
      g.position.set(Math.cos(a) * r, (rand() - 0.5) * height, Math.sin(a) * r);
      g.lookAt(0, g.position.y, 0);
      const puffs = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < puffs; k++) {
        const s = 0.9 + rand() * 1.0;
        const p = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat);
        p.position.set((k - puffs / 2) * 1.2, rand() * 0.6, (rand() - 0.5) * 0.8);
        p.scale.y = 0.75;
        p.castShadow = true;
        g.add(p);
      }
      ring.add(g);
    }
    return ring;
  };

  // the latticed look of the crane, drawn on solid members
  w.lattice = (() => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = 5; g.strokeRect(10, 10, 108, 108);
    g.lineWidth = 4; g.beginPath(); g.moveTo(12, 116); g.lineTo(116, 12); g.stroke();
    return w.texture(c);
  })();

  // a thin ring that marks where a click sent something
  w.marker = (() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 40), new THREE.MeshBasicMaterial({
      color: C.dark, transparent: true, opacity: 0, depthWrite: false,
    }));
    m.renderOrder = 2;
    m.life = 0;
    scene.add(m);
    return m;
  })();
  w.mark = (pos, d) => {
    w.marker.position.copy(pos);
    w.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    w.marker.life = 1;
  };

  // ---------------------------------------------------------------- light

  scene.add(new THREE.HemisphereLight('#ffffff', '#d9d3c8', 1.55));
  const sun = new THREE.DirectionalLight('#fff6ec', 2.5);
  const SUN_FROM = new THREE.Vector3(26, 44, 34).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  let shadowSize = 0;
  function aimSun(focus, size) {
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(SUN_FROM, 90);
    if (Math.abs(size - shadowSize) > 0.05) {
      shadowSize = size;
      Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 220 });
      sun.shadow.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- sound

  let actx = null;
  function audio() {
    if (w.muted) return null;
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
  function noise(a, { len, gain, freq, type = 'bandpass', at = 0 }) {
    const n = Math.floor(a.sampleRate * len), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = a.createBufferSource(), filter = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf;
    filter.type = type; filter.frequency.value = freq;
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(a.destination);
    src.start(a.currentTime + at);
  }
  const SCALE = [0, 2, 4, 7, 9];
  const note = (step) => 523.25 * 2 ** ((SCALE[step % 5] + 12 * Math.floor(step / 5)) / 12);
  w.sound = {
    thunk(volume = 1) {
      const a = audio();
      if (!a) return;
      tone(a, { from: 150, to: 52, len: 0.22, gain: 0.4 * volume });
      noise(a, { len: 0.07, gain: 0.45 * volume, freq: 900 });
    },
    whoosh(volume = 1) {
      const a = audio();
      if (a) noise(a, { len: 0.9, gain: 0.5 * volume, freq: 420, type: 'lowpass' });
    },
    chime(step) {
      const a = audio();
      if (a) tone(a, { type: 'triangle', from: note(Math.min(step, 14)), len: 0.5, gain: 0.14 });
    },
    groan() {
      const a = audio();
      if (a) tone(a, { type: 'triangle', from: 330, to: 98, len: 0.7, gain: 0.16 });
    },
    fanfare() {
      const a = audio();
      if (a) [0, 2, 4, 5, 7, 10].forEach((s, i) => tone(a, { type: 'triangle', from: note(s), at: i * 0.11, len: 0.6, gain: 0.13 }));
    },
    blip() {
      const a = audio();
      if (a) tone(a, { type: 'sine', from: 880, to: 660, len: 0.12, gain: 0.08 });
    },
  };

  // ---------------------------------------------------------------- words on the page

  let toastTimer = 0;
  w.toast = (html, ms = 1100) => {
    ui.toast.innerHTML = html;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
  };

  let cardTimer = 0;
  w.showCard = (fill, delay = 0) => {
    const mode = w.mode;
    const show = () => {
      if (w.mode !== mode) return;
      const c = fill();
      if (c.kicker && ui.kicker) ui.kicker.textContent = c.kicker;
      ui.title.textContent = c.title;
      ui.text.innerHTML = c.text;             // the worlds' own words, sometimes with a link
      ui.go.textContent = c.go;
      ui.best.textContent = c.best || '';
      ui.card.classList.remove('away');
      ui.card.inert = false;
      w.sync();
    };
    clearTimeout(cardTimer);
    if (delay) cardTimer = setTimeout(show, delay * 1000);
    else show();
  };
  w.hideCard = () => {
    clearTimeout(cardTimer);
    ui.card.classList.add('away');
    ui.card.inert = true;
  };
  w.cardShown = () => !ui.card.classList.contains('away');

  w.sync = () => {
    const c = ui.root.classList;
    c.toggle('is-explore', w.mode === 'explore');
    for (const m of opts.modes) c.toggle(`is-${m}`, w.mode === m);
    c.toggle('is-playing', w.mode !== 'explore' && w.hooks.playing());
    const hint = w.mode === 'explore' ? '' : w.hooks.hint(matchMedia('(hover: none)').matches);
    ui.hint.innerHTML = hint;
    c.toggle('show-hint', !!hint);
  };

  function syncMute() {
    ui.mute.innerHTML = w.muted ? SPEAKER_OFF : SPEAKER_ON;
    ui.mute.setAttribute('aria-pressed', String(w.muted));
    ui.mute.setAttribute('aria-label', w.muted ? 'Sound off' : 'Sound on');
  }
  ui.mute.addEventListener('click', () => {
    w.muted = !w.muted;
    store.set('monolito.muted', w.muted ? '1' : '0');
    syncMute();
  });
  ui.back.addEventListener('click', () => w.enter('explore'));
  ui.go.addEventListener('click', () => w.hooks.go());

  // ---------------------------------------------------------------- modes

  w.enter = (next) => {
    if (next === w.mode) return;
    w.hooks.leave(w.mode);
    const from = w.mode;
    w.mode = next;
    w.hot = null;
    for (const t of tags) t.el.classList.remove('hot');
    ui.root.classList.remove('is-pointing');
    if (next === 'explore') w.hideCard();
    w.hooks.enter(next, from);
    w.sync();
    if (next === 'explore') document.activeElement?.blur();
  };

  // tags float next to what can be played with; tag(el, key, mode, where) where() → a world position
  const tags = [];
  w.tag = (el, key, mode, where) => {
    tags.push({ el, key, mode, where });
    el.addEventListener('click', () => w.enter(mode));
  };
  const tagAt = new THREE.Vector3(), toward = new THREE.Vector3(), fromCenter = new THREE.Vector3();
  function hidden(world) {
    // does the line from the camera to this point go through the occluding sphere first?
    toward.copy(world).sub(camera.position);
    const dist = toward.length();
    toward.divideScalar(dist);
    fromCenter.copy(camera.position).sub(opts.occluder.center);
    const b = fromCenter.dot(toward), c = fromCenter.lengthSq() - (opts.occluder.r - 0.3) ** 2, disc = b * b - c;
    return disc > 0 && -b - Math.sqrt(disc) < dist - 0.5;
  }
  function placeTags() {
    for (const t of tags) {
      if (w.mode !== 'explore') { t.el.classList.remove('on'); continue; }
      const world = t.where();
      tagAt.copy(world).project(camera);
      const onScreen = tagAt.z < 1 && Math.abs(tagAt.x) < 1.05 && Math.abs(tagAt.y) < 1.05;
      const x = (tagAt.x * 0.5 + 0.5) * innerWidth, y = (-tagAt.y * 0.5 + 0.5) * innerHeight;
      t.el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 14)}px)`;
      t.el.classList.toggle('on', !hidden(world) && onScreen && w.ready);
    }
  }

  // ---------------------------------------------------------------- pointer and keys

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  w.pick = (x, y, targets) => {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(targets, true)[0] || null;
  };
  w.within = (object, group) => {
    for (let o = object; o; o = o.parent) if (o === group) return true;
    return false;
  };

  const orbit = { az: opts.explore.az ?? 0.78, el: opts.explore.el ?? 0.16, vaz: 0, vel: 0, idle: 99 };
  const press = { on: false, x: 0, y: 0, moved: 0, id: null };

  ui.stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    Object.assign(press, { on: true, x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId });
    ui.stage.setPointerCapture(e.pointerId);
    if (w.mode !== 'explore' && w.hooks.press(e.clientX, e.clientY)) press.on = false;
  });
  ui.stage.addEventListener('pointermove', (e) => {
    if (press.on && e.pointerId === press.id) {
      const dx = e.clientX - press.x, dy = e.clientY - press.y;
      press.moved += Math.abs(dx) + Math.abs(dy);
      press.x = e.clientX; press.y = e.clientY;
      if (press.moved > 6 && w.mode === 'explore') {
        ui.root.classList.add('is-dragging');
        orbit.vaz = -dx * 0.005; orbit.vel = dy * 0.004;
        orbit.az += orbit.vaz; orbit.el = clamp(orbit.el + orbit.vel, -0.9, 1.2);
        orbit.idle = 0;
      }
      return;
    }
    if (w.mode === 'explore' && e.pointerType === 'mouse') {
      w.hot = w.hooks.hover(e.clientX, e.clientY);
      ui.root.classList.toggle('is-pointing', !!w.hot);
      for (const t of tags) t.el.classList.toggle('hot', t.key === w.hot);
    }
  });
  ui.stage.addEventListener('pointerup', (e) => {
    if (!press.on || e.pointerId !== press.id) return;
    press.on = false;
    ui.root.classList.remove('is-dragging');
    if (press.moved > 6) return;
    if (w.mode === 'explore') {
      const key = w.hooks.hover(e.clientX, e.clientY);
      const t = tags.find((t) => t.key === key);
      if (t) w.enter(t.mode);
      else if (key) w.hooks.poke(key);
    } else w.hooks.tap(e.clientX, e.clientY);
  });
  ui.stage.addEventListener('pointercancel', () => { press.on = false; ui.root.classList.remove('is-dragging'); });

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && w.mode !== 'explore') { w.enter('explore'); return; }
    if (w.mode !== 'explore' && w.hooks.key(e, true)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { if (w.mode !== 'explore') w.hooks.key(e, false); });

  // ---------------------------------------------------------------- camera

  const cam = { pos: new THREE.Vector3(60, 20, 70), at: opts.explore.at.clone(), up: UP.clone() };
  const want = { pos: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3() };
  let offset = 0;

  w.fitDist = (dist, halfWidth) => {
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    return Math.max(dist, halfWidth / Math.tan(half));
  };

  function moveCamera(dt) {
    let rate;
    if (w.mode === 'explore') {
      orbit.idle += dt;
      if (!press.on) {
        orbit.az += orbit.vaz; orbit.el = clamp(orbit.el + orbit.vel, -0.9, 1.2);
        orbit.vaz *= Math.exp(-dt * 4); orbit.vel *= Math.exp(-dt * 4);
      }
      const rest = opts.explore.el ?? 0.16;
      if (!reduceMotion && orbit.idle > 3) orbit.az += dt * 0.035;
      if (!press.on && orbit.idle > 3) orbit.el += (rest - orbit.el) * damp(dt, 0.5);
      const dist = w.fitDist(opts.explore.dist, opts.explore.half);
      const r = Math.cos(orbit.el) * dist, at = opts.explore.at;
      want.at.copy(at);
      want.pos.set(at.x + Math.sin(orbit.az) * r, at.y + Math.sin(orbit.el) * dist, at.z + Math.cos(orbit.az) * r);
      want.up.copy(UP);
      rate = press.on ? 12 : 2.2;
    } else rate = w.hooks.view(want, dt);
    const k = damp(dt, rate);
    cam.pos.lerp(want.pos, k);
    cam.at.lerp(want.at, k);
    cam.up.lerp(want.up, k).normalize();
    camera.position.copy(cam.pos);
    camera.up.copy(cam.up);
    camera.lookAt(cam.at);

    // on a wide screen the world sits right of the words
    const wide = innerWidth > 900;
    const shift = wide ? (w.mode === 'explore' ? -innerWidth * 0.12 : -innerWidth * w.shift) : 0;
    offset += (shift - offset) * damp(dt, 2.4);
    camera.setViewOffset(innerWidth, innerHeight, offset, 0, innerWidth, innerHeight);
    if (w.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * w.shake;
      camera.position.y += (Math.random() - 0.5) * w.shake;
      w.shake = Math.max(0, w.shake - dt * 0.4);
    }
  }
  w.snapCamera = () => moveCamera(10);

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 1 ? 44 : 32;
    camera.updateProjectionMatrix();
    w.sync();
  }
  addEventListener('resize', resize);

  // ---------------------------------------------------------------- loop

  w.start = (deep = {}) => {
    resize();
    syncMute();
    w.sync();
    w.hooks.frame(0);
    moveCamera(10);                          // start where the camera wants to be, not flying in
    let last = 0;
    const focus = new THREE.Vector3();
    renderer.setAnimationLoop((now) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 0;
      last = now;
      w.time += dt;
      w.hooks.frame(dt);
      if (w.marker.life > 0) {
        w.marker.life = Math.max(0, w.marker.life - dt * 0.8);
        w.marker.material.opacity = w.marker.life * 0.55;
        w.marker.scale.setScalar(1 + (1 - w.marker.life) * 0.6);
      }
      aimSun(focus, w.hooks.sun(focus));
      moveCamera(dt);
      placeTags();
      renderer.render(scene, camera);
      if (!w.ready) { w.ready = true; ui.stage.classList.add('ready'); }
    });
    // #name links straight into a game
    if (deep[location.hash]) { w.enter(deep[location.hash]); moveCamera(10); }
  };

  return w;
}
