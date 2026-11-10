import * as THREE from 'three';
import { TrackNetwork } from './tracks.js';
import { StationManager } from './stations.js';
import { Terrain } from './terrain.js';
import { Roads } from './roads.js';
import { createWorld, SKY_HORIZON } from './world.js';
import { Train } from './train.js';
import { Sound } from './audio.js';
import { Weather } from './weather.js';
import { DepotManager } from './depot.js';
import { DayNight } from './daynight.js';
import { setClimateSeed } from './heights.js';
import { spanAt } from './structures.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_HORIZON);
scene.fog = new THREE.Fog(SKY_HORIZON, 250, 820);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 4000);

const hemi = new THREE.HemisphereLight(0xdff1ff, 0x5a7a3a, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 500 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// ---------- build the world ----------
const seed = Number(new URLSearchParams(location.search).get("seed")) || Math.floor(Math.random() * 1e9); // new world every visit (or ?seed=123)
setClimateSeed(seed);
const net = new TrackNetwork(scene, seed);
const stations = new StationManager(scene, seed);
const roads = new Roads(scene, net, stations, seed + 1);
const terrain = new Terrain(scene, net, stations, roads);
const depots = new DepotManager(scene, net);
roads.terrain = terrain; roads.depots = depots; terrain.depots = depots;
net.onEdgeAdded = (e) => {
  if (e.wantsStation) {
    const st = stations.create(e);
    terrain.markDirtyArea(st.trackPos.x, st.trackPos.z, st.townR + 70);
  }
  const gone = depots.checkEdge(e);
  if (gone) terrain.markDirtyArea(gone.p.x, gone.p.z, 220);
  if (e.wantsDepot) {
    const dp = depots.create(e);
    if (dp) terrain.markDirtyArea(dp.p.x, dp.p.z, 220);
  }
  roads.checkEdge(e);
  if (!e.wantsStation && !e.wantsDepot) roads.maybeCreate(e);
  terrain.markDirtyEdge(e);
};
net.onEdgeRemoved = (e) => {
  if (e.station) stations.remove(e.station);
  if (e.depot) depots.remove(e.depot);
  roads.removeForEdge(e);
};

const firstEdge = net.start();
// start stopped with the coaches beside the first platform
const train = new Train(scene, net, firstEdge, firstEdge.length / 2 + 38.5);
net.expand(train.edge, train.d);
const world = createWorld(scene);
terrain.update(train.loco.group.position, Infinity);
const sound = new Sound();
const weather = new Weather(scene, world, { sun, hemi, sound });
const hourParam = new URLSearchParams(location.search).get('hour'); // e.g. ?hour=19 to start at dusk
const dayNight = new DayNight(scene, hourParam !== null ? Number(hourParam) % 24 : 9);
window.game = { train, net, stations, terrain, roads, weather, dayNight, depots }; // handy for debugging in the console

// ---------- input ----------
const held = new Set();
let started = false;
const startEl = document.getElementById('start');
startEl.innerHTML = '🚂 Choo Choo!<small>Click or press any key to play</small>';
function start() {
  if (started) return;
  started = true;
  sound.init();
  startEl.classList.add('hidden');
  // the first station has nobody waiting: straight to "All aboard!" and off we go
  sound.say('All aboard!');
  setTimeout(() => sound.horn(), 1100);
}
startEl.addEventListener('click', start);

let camMode = 0;
const CAM_MODES = 4;
addEventListener('keydown', (e) => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  held.add(e.key);
  if (e.repeat) return;
  start();
  switch (e.key) {
    case ' ': // the one action button: toot, and turn on the lights at any crossing coming up
      sound.horn();
      for (const c of crossingsAhead()) if (c.dist > -70 && c.dist < 330) roads.activate(c.road);
      break;
    case 'ArrowLeft': train.choose('left'); sound.click(); break;
    case 'ArrowRight': train.choose('right'); sound.click(); break;
    case 'ArrowUp': case 'ArrowDown': break;
    case 'c': case 'C': camMode = (camMode + 1) % CAM_MODES; break;
    case 'f': case 'F':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      break;
    default: if (e.key.length === 1) sound.ding(); // toddler key-mashing = bell
  }
});
addEventListener('keyup', (e) => held.delete(e.key));
addEventListener('blur', () => held.clear());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- HUD ----------
const arrowsEl = document.getElementById('arrows');
const aL = document.getElementById('aL'), aR = document.getElementById('aR');
const hintEl = document.getElementById('hint');
const paxEl = document.getElementById('pax');
function renderPax() {
  paxEl.textContent = train.passengers.length ? '🚃 ' + train.passengers.join('') : '🚃 (empty)';
}
renderPax();
let hintText = '';
function setHint(text) {
  if (text !== hintText) { hintText = text; if (text) hintEl.textContent = text; }
  hintEl.style.opacity = text ? 1 : 0;
}

// ---------- stations ----------
let activeStop = null, announced = null;
const stopHooks = {
  changed: renderPax,
  pop: () => sound.pop(),
  done: () => {
    activeStop = null;
    sound.say('All aboard!');
    setTimeout(() => sound.horn(), 1300);
  },
};

// Next unvisited station on our route, with the distance from the train's head to the platform middle.
function stationAhead() {
  for (const { edge, start } of train.routeAhead(350)) {
    const st = edge.station;
    if (!st || st.served) continue;
    const dist = start + edge.length / 2;
    if (dist > -60 && dist < 350) return { st, dist };
  }
  return null;
}

// Once the driver slows down near a station, glide in and line the coaches up with the platform.
// Any tap of ⬇ while a station is ahead (or simply driving slowly near one) latches the assist.
const STOP_OFFSET = 38.5; // head of train sits this far past the platform middle
let assisting = null;
function stopAssist(next, throttle) {
  if (!next || throttle > 0) { assisting = null; return throttle; }
  const remaining = next.dist + STOP_OFFSET;
  if (remaining < -15) { assisting = null; return throttle; } // went past it
  if (assisting !== next.st) {
    const slowNear = train.speed < 5 && !(train.speed < 0.05 && remaining > 50);
    if (throttle < 0 || slowNear) assisting = next.st; else return throttle;
  }
  train.speed = remaining > 0.3 ? Math.min(Math.max(train.speed, 2.5), Math.sqrt(2 * 3 * remaining)) : 0;
  return 0;
}

function updateStations(next, crossing) {
  const ahead = next?.st;
  if (ahead && ahead !== announced && train.speed > 0.5) { announced = ahead; sound.chime(); }

  // stopped next to a platform? let people on and off
  if (started && !activeStop && train.speed < 0.05) {
    for (const st of stations.list) {
      if (st.startStop(train, stopHooks)) { activeStop = st; sound.chime(); sound.say(`Welcome to ${st.name}!`); break; }
    }
  }

  if (!started) setHint('');
  else if (crossing && crossing.dist > 0 && crossing.dist < 260 && (!ahead || crossing.dist < next.dist) && train.speed > 0.05) {
    setHint(crossing.road.active ? '🚦 Ding ding! The cars are waiting' : '🚗 Cars crossing! Press SPACE');
  } else if (activeStop) setHint(`🚉 ${activeStop.name}! Everyone is getting on and off`);
  else if (ahead && train.speed > 0.05) setHint(`🚉 ${ahead.name}! Press ⬇️ to stop`);
  else if (train.speed < 0.5) setHint('Press ⬆️ to go!');
  else if (time < skyHintUntil) setHint(skyHint);
  else if (depotNear()) setHint('🏭 A train depot! Look at all the trains!');
  else {
    const sp = spanAt(train.edge, train.d - 5);
    setHint(sp?.type === 'tunnel' ? '🌑 Into the tunnel! Toot toot!' : sp?.type === 'bridge' ? '🌉 Over the bridge!' : '');
  }
}

// Is the train running past (or about to pass) a depot?
function depotNear() {
  for (const { edge, start } of train.routeAhead(200)) {
    if (!edge.depot) continue;
    const mid = start + edge.length / 2;
    if (mid > -130 && mid < 200) return true;
  }
  return false;
}

// a little announcement when the lights come on in the evening and go off in the morning
let skyHint = '', skyHintUntil = 0, lightsWereOn = dayNight.lights > 0.5;
function updateSkyHint() {
  const on = dayNight.lightsTarget();
  if (on === lightsWereOn) return;
  lightsWereOn = on;
  skyHint = on ? '🌙 Getting dark! Lights on!' : '🌅 Good morning! Lights off!';
  skyHintUntil = time + 5;
}

// ---------- level crossings ----------
// Crossings on our route ahead, with the distance from the train's head to each.
function crossingsAhead() {
  const out = [];
  for (const { edge, start } of train.routeAhead(400)) {
    for (const road of edge.roads ?? []) {
      const dist = start + road.d;
      if (dist > -70 && dist < 400) out.push({ road, dist });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

let bellTimer = 0;
function updateCrossings(dt, ahead) {
  const aheadSet = new Set(ahead.filter((c) => c.dist > -2).map((c) => c.road));
  const sfx = (name) => sound[name]();
  const bellDist = roads.update(dt, train, aheadSet, sfx);
  if (bellDist < 300 && (bellTimer -= dt) <= 0) { bellTimer = 0.42; sound.bell(1 - bellDist / 300); }
}

// ---------- camera ----------
// Is the track at offset o metres from the train's head (negative = behind) inside a tunnel?
function tunnelAt(o) {
  let d = train.d + o, e = train.edge;
  while (d > e.length) { d -= e.length; e = train.nextEdge(e); }
  for (let i = train.history.length - 1; d < 0 && i >= 0; i--) { e = train.history[i]; d += e.length; }
  return spanAt(e, Math.max(0, d))?.type === 'tunnel';
}
// Ride up front from just before the portal until the engine is well clear of the exit,
// so the chase camera never ends up buried in the mountain.
const inTunnelZone = () => [30, 15, 0, -15, -30, -45].some(tunnelAt);
let tunnelBlend = 0;
const frontPos = new THREE.Vector3(), frontLook = new THREE.Vector3();

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const desired = new THREE.Vector3(), look = new THREE.Vector3();
let orbit = 0;

function updateCamera(dt, snap) {
  const loco = train.loco.group;
  const p = loco.position;
  fwd.set(0, 0, 1).applyQuaternion(loco.quaternion); fwd.y = 0; fwd.normalize();
  right.crossVectors(fwd, up);
  let k = 1 - Math.exp(-dt * 3);
  switch (camMode) {
    case 0: // chase, from above and to the side
      desired.copy(p).addScaledVector(fwd, -14).addScaledVector(right, 10).add({ x: 0, y: 11, z: 0 });
      look.copy(p).addScaledVector(fwd, 9).add({ x: 0, y: 1.5, z: 0 });
      break;
    case 1: // slow orbit
      orbit += dt * 0.25;
      desired.copy(p).addScaledVector(fwd, Math.cos(orbit) * 22).addScaledVector(right, Math.sin(orbit) * 22).add({ x: 0, y: 6, z: 0 });
      look.copy(p).add({ x: 0, y: 2, z: 0 });
      break;
    case 2: // cab
      loco.localToWorld(desired.set(0.7, 4.0, -2.2));
      loco.localToWorld(look.set(0.7, 3.4, 30));
      k = 1;
      break;
    case 3: // high
      desired.copy(p).addScaledVector(fwd, -45).add({ x: 0, y: 40, z: 0 });
      look.copy(p);
      break;
  }
  // Tunnels: fade to a camera fixed just above the front of the engine, looking down the tunnel.
  // It's attached rigidly (no lag) so it can't drift into the tunnel walls or behind the chimney.
  const tunnelCam = camMode !== 2 && inTunnelZone();
  tunnelBlend = THREE.MathUtils.clamp(tunnelBlend + (tunnelCam ? dt * 2 : -dt * 1.5), 0, 1);
  if (tunnelBlend > 0) {
    const b = THREE.MathUtils.smoothstep(tunnelBlend, 0, 1);
    desired.lerp(loco.localToWorld(frontPos.set(0, 4.9, 6.4)), b);
    look.lerp(loco.localToWorld(frontLook.set(0, 3.2, 40)), b);
    k = THREE.MathUtils.lerp(k, 1, b);
  }
  if (activeStop && camMode !== 2) { // watch the people getting on and off
    const st = activeStop;
    desired.copy(st.platform).addScaledVector(st.s, 13).addScaledVector(st.t, -26).add({ x: 0, y: 6, z: 0 });
    look.copy(st.trackPos).add({ x: 0, y: 1.5, z: 0 });
    k = 1 - Math.exp(-dt * 1.5);
  }
  if (snap) k = 1;
  camPos.lerp(desired, k);
  camLook.lerp(look, k);
  if (camMode !== 2 && !tunnelCam) camPos.y = Math.max(camPos.y, terrain.heightAt(camPos.x, camPos.z) + 2);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------- loop ----------
const clock = new THREE.Clock();
let time = 0, chuffAcc = 0, pruneTimer = 0;
updateCamera(0, true);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  const next = stationAhead();
  let throttle = !started ? 0 : held.has('ArrowUp') ? 1 : held.has('ArrowDown') ? -1 : 0;
  throttle = stopAssist(next, throttle);
  train.update(dt, throttle);
  net.expand(train.edge, train.d);
  if ((pruneTimer += dt) > 1) { pruneTimer = 0; net.prune(train, train.loco.group.position); }
  terrain.update(train.loco.group.position, 1);
  stations.update(dt, train, dayNight.lights);
  depots.update(dt, train.loco.group.position);
  const crossings = crossingsAhead();
  updateCrossings(dt, crossings);
  updateStations(next, crossings.find((c) => c.dist > 0));

  if (train.speed > 0.3) {
    chuffAcc += dt * train.speed / (2 * Math.PI * 0.8 / 4); // 4 chuffs per driver wheel turn
    if (chuffAcc >= 1) { chuffAcc %= 1; sound.chuff(0.12 + Math.min(1, train.speed / 20) * 0.25); }
  }

  const jn = train.upcomingJunction();
  const side = train.resolvedSide(jn?.node);
  net.updateSigns(jn?.node, side, time);
  arrowsEl.style.opacity = jn && jn.dist < 260 ? 1 : 0.3;
  aL.classList.toggle('on', side === 'left');
  aR.classList.toggle('on', side === 'right');

  updateCamera(dt);
  world.update(dt, camera);
  dayNight.update(dt, camera, weather.overcast ?? 0, tunnelBlend);
  updateSkyHint();
  train.steamShade = 1 - 0.6 * dayNight.night;
  weather.update(dt, train.loco.group.position, camera, tunnelBlend, dayNight);
  const lp = train.loco.group.position;
  sun.position.copy(lp).addScaledVector(dayNight.sunDir, dayNight.sunHeight >= 0 ? 250 : -250); // sun or moon
  sun.target.position.copy(lp);
  window.game.debugCamera?.(camera); // console hook for looking around while testing
  renderer.render(scene, camera);
});
