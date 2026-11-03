// MINITRON, the pet bot: a cartoon of the Monolito that is alive. A little square pyramid on two tank
// tracks, with one big eye on its front face that blinks and looks about, after the app's icon
// (Minitron/data/icons/…/io.github._4ndr3lu15.Minitron.svg). Its own module, so any world can have one.
// The world moves and turns `group`; update() makes it live: tracks that roll, breathing, hops, spins.

import * as THREE from './three.module.js?v=3feb33f3bc';

export const BOT_COLORS = {
  body: [['Blue', '#3584e4'], ['Graphite', '#4a4d55'], ['Signal', '#e66100'], ['Mint', '#3fb68b'], ['Rose', '#e0749a'], ['Butter', '#f0c23a']],
  eye: [['Blue', '#1c71d8'], ['Ink', '#1c1d1f'], ['Orange', '#e66100'], ['Green', '#26a269'], ['Violet', '#9141ac'], ['Red', '#e01b24']],
};

const K = 1.5;                          // the whole bot's size
const TRACK = { x: 0.62, len: 1.9, r: 0.26, w: 0.42 };
const PYR = { side: 1.5, h: 1.45, base: 0.5 };
const GROUSERS = 14;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
}

// a stadium (a rectangle with round ends) in the y–z plane, extruded along x: one track's belt
function stadium(len, r, width, inset = 0) {
  const a = len / 2 - r, rr = r - inset;
  const s = new THREE.Shape();
  s.absarc(a, r, rr, -Math.PI / 2, Math.PI / 2, false);
  s.absarc(-a, r, rr, Math.PI / 2, Math.PI * 1.5, false);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: inset === 0, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 20 });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);              // the shape's x runs along z, the extrusion along x
  return geo;
}

// a point on the belt's outline, s along it from the back of the bottom run, going forwards underneath
function onBelt(s, out) {
  const { len, r } = TRACK, a = len / 2 - r, P = 4 * a + 2 * Math.PI * r;
  s = ((s % P) + P) % P;
  if (s < 2 * a) return out.set(-a + s, 0, 0);                                    // bottom, going forwards
  s -= 2 * a;
  if (s < Math.PI * r) { const t = -Math.PI / 2 + s / r; return out.set(a + Math.cos(t) * r, r + Math.sin(t) * r, t + Math.PI / 2); }
  s -= Math.PI * r;
  if (s < 2 * a) return out.set(a - s, 2 * r, Math.PI);                         // top, going backwards
  s -= 2 * a;
  const t = Math.PI / 2 + s / r;
  return out.set(-a + Math.cos(t) * r, r + Math.sin(t) * r, t + Math.PI / 2);
}

export function createMinitron() {
  const group = new THREE.Group();        // placed and turned by the world
  const body = new THREE.Group();         // hops, leans, spins
  group.add(body);
  const shell = new THREE.Group();        // the pyramid and its eye, which breathe
  body.add(shell);

  const bodyMat = mat(BOT_COLORS.body[0][1], { roughness: 0.5, flatShading: true });
  const rimMat = mat('#1a5fb4', { roughness: 0.5 });
  const beltMat = mat('#3d3846', { roughness: 0.85 });
  const plateMat = mat('#5e5c64', { roughness: 0.75 });
  const wheelMat = mat('#c0bfbc', { roughness: 0.45 });
  const hubMat = mat('#77767b', { roughness: 0.5 });
  const whiteMat = mat('#ffffff', { roughness: 0.25 });
  const pupilMat = mat(BOT_COLORS.eye[0][1], { roughness: 0.3 });

  const add = (parent, geo, material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // the tracks: a belt, a plate on its outer side with three wheels, and grousers that go round
  const wheels = [], grousers = [];
  const grouserGeo = new THREE.BoxGeometry(TRACK.w + 0.04, 0.06, 0.1);
  for (const side of [-1, 1]) {
    const x = side * TRACK.x;
    add(body, stadium(TRACK.len, TRACK.r, TRACK.w), beltMat, x, 0, 0);
    add(body, stadium(TRACK.len - 0.08, TRACK.r, 0.03, 0.05), plateMat, x + side * (TRACK.w / 2 + 0.05), 0, 0);
    for (const z of [-0.62, 0, 0.62]) {
      const wheel = add(body, new THREE.CylinderGeometry(0.17, 0.17, 0.05, 24), wheelMat, x + side * (TRACK.w / 2 + 0.09), TRACK.r, z);
      wheel.rotation.z = Math.PI / 2;
      const hub = add(wheel, new THREE.CylinderGeometry(0.07, 0.07, 0.07, 16), hubMat);
      add(hub, new THREE.BoxGeometry(0.03, 0.08, 0.13), hubMat);        // a notch, so the turning shows
      wheels.push(wheel);
    }
    for (let i = 0; i < GROUSERS; i++) {
      const g = add(body, grouserGeo, beltMat, x, 0, 0);
      grousers.push(g);
    }
  }

  // the body: a square pyramid on a darker rim, faceted so its faces catch the light differently
  const { side, h, base } = PYR;
  add(shell, new THREE.BoxGeometry(side + 0.08, 0.1, side + 0.08), rimMat, 0, base + 0.03, 0);
  const pyramid = add(shell, new THREE.ConeGeometry(side / Math.SQRT2, h, 4, 1).rotateY(Math.PI / 4), bodyMat, 0, base + 0.08 + h / 2, 0);

  // the eye, lying on the front face: a white pill, a pupil that moves, a glint
  const slope = Math.atan((side / 2) / h);
  const up = 0.4;                                     // how far up the face, from the base
  const eye = new THREE.Group();
  eye.position.set(0, base + 0.08 + up * h, (side / 2) * (1 - up) + 0.02);
  eye.rotation.x = -slope;
  shell.add(eye);
  const lids = new THREE.Group();                     // squashed to blink
  eye.add(lids);
  const white = add(lids, new THREE.CapsuleGeometry(0.155, 0.34, 8, 20), whiteMat);
  white.rotation.z = Math.PI / 2;
  white.scale.z = 0.38;
  const pupil = new THREE.Group();
  pupil.position.z = 0.045;
  lids.add(pupil);
  const iris = add(pupil, new THREE.SphereGeometry(0.105, 20, 14), pupilMat);
  iris.scale.z = 0.4;
  add(pupil, new THREE.SphereGeometry(0.034, 10, 8), whiteMat, 0.035, 0.035, 0.04);

  body.scale.setScalar(K);

  // a bigger, invisible shape, so it is easy to click
  const hit = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hit.position.y = 1.5;
  group.add(hit);

  const state = {
    belt: 0, blink: 0, nextBlink: 2, look: new THREE.Vector2(), glance: new THREE.Vector2(), nextGlance: 1,
    hop: 1, spin: 1, happy: 0,
  };
  const tmp = new THREE.Vector3(), pos = new THREE.Vector3();

  function placeGrousers() {
    const { len, r } = TRACK, P = 4 * (len / 2 - r) + 2 * Math.PI * r;
    grousers.forEach((g, i) => {
      onBelt(state.belt + ((i % GROUSERS) / GROUSERS) * P, pos);     // pos: (along the track, height, the belt's angle)
      const a = pos.z;
      // set a little out from the belt, along its outward side, and turned with it
      g.position.set(g.position.x, pos.y - Math.cos(a) * 0.03, pos.x + Math.sin(a) * 0.03);
      g.rotation.x = -a;
    });
  }
  placeGrousers();

  return {
    group, body, hit,

    setColors({ body: b, eye: e } = {}) {
      if (b) {
        bodyMat.color.set(b);
        rimMat.color.set(b).multiplyScalar(0.62);
      }
      if (e) pupilMat.color.set(e);
    },

    hop() { state.hop = 0; },
    spin() { state.spin = 0; state.happy = 1.2; },

    // ctx: { time, dt, moved (distance this frame), moving (0…1), look (a world point or null), excited (0…1), still }
    update({ time, dt, moved, moving, look, excited = 0, still = false }) {
      // the tracks roll with the ground covered
      state.belt -= moved / K;
      placeGrousers();
      for (const w of wheels) w.rotation.x += moved / (K * 0.17);

      // breathing when it stands, a lean forward when it goes, a wiggle when you point at it
      const calm = still ? 0 : 1;
      shell.scale.y = 1 + Math.sin(time * 2.3) * 0.025 * (1 - moving) * calm;
      body.rotation.x = moving * 0.09;
      body.rotation.z = Math.sin(time * 11) * 0.05 * excited * calm;

      // a hop, with a squash as it lands
      if (state.hop < 1) {
        state.hop = Math.min(1, state.hop + dt / 0.5);
        const t = state.hop;
        body.position.y = Math.sin(Math.PI * t) * 0.75 * calm;
        const squash = t > 0.85 ? Math.sin((t - 0.85) / 0.15 * Math.PI) * 0.12 : 0;
        body.scale.set(K * (1 + squash), K * (1 - squash), K * (1 + squash));
      } else {
        body.position.y = 0;
        body.scale.setScalar(K);
      }
      // a happy spin
      if (state.spin < 1) {
        state.spin = Math.min(1, state.spin + dt / 0.7);
        body.rotation.y = ease(state.spin) * Math.PI * 2;
      } else body.rotation.y = 0;
      state.happy = Math.max(0, state.happy - dt);

      // blinking, now and then; a happy squint after a spin
      state.nextBlink -= dt;
      if (state.nextBlink <= 0 && !still) {
        state.blink = 1;
        state.nextBlink = Math.random() < 0.2 ? 0.25 : 2 + Math.random() * 3.5;
      }
      state.blink = Math.max(0, state.blink - dt / 0.14);
      const shut = Math.sin(state.blink * Math.PI);
      lids.scale.y = Math.max(0.08, 1 - shut) * (state.happy > 0 ? 0.55 : 1);

      // where the eye looks: at what it's given, else small glances about
      if (look) {
        tmp.copy(look);
        eye.worldToLocal(tmp);
        tmp.normalize();
        state.look.set(clamp(tmp.x * 0.45, -0.16, 0.16), clamp(tmp.y * 0.25, -0.045, 0.045));
      } else {
        state.nextGlance -= dt;
        if (state.nextGlance <= 0) {
          state.nextGlance = 1.2 + Math.random() * 2.5;
          state.glance.set((Math.random() - 0.5) * 0.28, (Math.random() - 0.5) * 0.07);
        }
        state.look.copy(state.glance);
      }
      const k = 1 - Math.exp(-dt * 14);
      pupil.position.x += (state.look.x - pupil.position.x) * k;
      pupil.position.y += (state.look.y - pupil.position.y) * k;
    },
  };
}
