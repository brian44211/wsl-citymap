/* CITY MAP 01 — public 3D city map viewer.  Reads data/citymap.bin.gz (exported from the game by devtools __CITYEXPORT), places.json
   (curated landmark text) and changelog.json (the development log shown in the side panel).  Read-only: no saves, no game code. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = s => document.querySelector(s);
const canvas = $('#c'), labelsEl = $('#labels');
const setLoad = (p, msg) => { $('#lbar').style.width = Math.round(p * 100) + '%'; if (msg) $('#lmsg').textContent = msg; };

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });   /* the city has coplanar layers (ground, road, markings) seen from 4 km: log depth stops them fighting */
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 2, 12000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = .08; controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI * .47; controls.minDistance = 25; controls.maxDistance = 5200;
const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x4a4036, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(-600, 900, 400); scene.add(sun);
const SKY = { day: [0x9cc4e4, 0xdfe8ef], night: [0x0b1020, 0x1a2236] };
let night = false;
function applySky() {
  const [a, b] = night ? SKY.night : SKY.day;
  const c = document.createElement('canvas'); c.width = 2; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#' + a.toString(16).padStart(6, '0')); gr.addColorStop(1, '#' + b.toString(16).padStart(6, '0'));
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
  scene.fog = new THREE.Fog(b, 2600, 9000);
  hemi.intensity = night ? .28 : 1.1; sun.intensity = night ? .12 : 2.2; sun.color.set(night ? 0x8fa6d6 : 0xfff1dc);
  for (const m of EMIT) m.emissiveIntensity = night ? m.userData.ei * 2.4 + .6 : m.userData.ei;
  renderer.toneMappingExposure = night ? 1.25 : 1.0;
}
const EMIT = [];

/* ---------- data ---------- */
async function fetchBin(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const total = +r.headers.get('content-length') || 0; const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total) setLoad(.05 + .55 * got / total, `下載城市資料 ${(got / 1048576).toFixed(1)} MB`); }
  let buf = new Uint8Array(got), o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  if (buf[0] === 0x1f && buf[1] === 0x8b) { setLoad(.62, '解壓縮…'); buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
  return buf.buffer;
}
function parse(ab) {
  const hl = new DataView(ab).getUint32(0, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, hl)));
  const base = 4 + hl, view = (i, T) => { const [off, len] = H.offs[i]; return new T(ab, base + off, len / T.BYTES_PER_ELEMENT); };
  return { H, view };
}
const texCache = [];
function texture(H, i) {
  if (i < 0) return null; if (texCache[i]) return texCache[i];
  const d = H.texs[i], img = new Image(); const t = new THREE.Texture(img); img.onload = () => { t.needsUpdate = true; }; img.src = d.d;
  t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(d.rx, d.ry); t.offset.set(d.ox, d.oy); if (d.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; return (texCache[i] = t);
}
function material(H, mi, instColor) {
  const d = H.mats[mi], map = texture(H, d.map);
  const o = { color: d.c, map, transparent: d.op < 1, opacity: d.op, side: d.ds ? THREE.DoubleSide : THREE.FrontSide, vertexColors: d.vc };
  let m;
  if (d.basic) m = new THREE.MeshBasicMaterial(o);
  else { m = new THREE.MeshStandardMaterial(Object.assign(o, { roughness: d.r, metalness: d.mt })); if (d.e) { m.emissive.set(d.e); m.emissiveIntensity = d.ei; m.userData.ei = d.ei; EMIT.push(m); } }
  if (d.op < 1) m.depthWrite = false;
  return m;
}
const PICK = [];
function build({ H, view }) {
  const city = new THREE.Group(); scene.add(city);
  const matCache = new Map(), mat = mi => { if (!matCache.has(mi)) matCache.set(mi, material(H, mi)); return matCache.get(mi); };
  for (const s of H.stat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(view(s.pos, Float32Array), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(view(s.nor, Int8Array), 3, true));
    if (s.uv >= 0) g.setAttribute('uv', new THREE.BufferAttribute(view(s.uv, Float32Array), 2));
    if (s.col >= 0) g.setAttribute('color', new THREE.BufferAttribute(view(s.col, Uint8Array), 3, true));
    g.setIndex(new THREE.BufferAttribute(view(s.idx, s.i32 ? Uint32Array : Uint16Array), 1));
    g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat(s.mat)); m.matrixAutoUpdate = false; city.add(m); PICK.push(m);
  }
  const geos = H.geos.map(G => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(view(G.pos, Float32Array), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(view(G.nor, Int8Array), 3, true));
    if (G.uv >= 0) g.setAttribute('uv', new THREE.BufferAttribute(view(G.uv, Float32Array), 2));
    if (G.idx >= 0) g.setIndex(new THREE.BufferAttribute(view(G.idx, G.i32 ? Uint32Array : Uint16Array), 1));
    return g;
  });
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const setMats = H.sets.map(S => { const T = view(S.t, Float32Array), out = new Float32Array(S.n * 16);
    for (let i = 0; i < S.n; i++) { const k = i * 7; p.set(T[k], T[k + 1], T[k + 2]); q.setFromAxisAngle(Y, T[k + 3]); s.set(T[k + 4], T[k + 5], T[k + 6]); M.compose(p, q, s); M.toArray(out, i * 16); }
    return out; });
  for (const I of H.inst) {
    const m = new THREE.InstancedMesh(geos[I.g], mat(I.mat), I.n);
    m.instanceMatrix.array.set(setMats[I.s]); m.instanceMatrix.needsUpdate = true;
    if (I.col >= 0) { const c = view(I.col, Uint8Array), f = new Float32Array(I.n * 3); for (let i = 0; i < f.length; i++) f[i] = c[i] / 255; m.instanceColor = new THREE.InstancedBufferAttribute(f, 3); }
    m.computeBoundingSphere(); m.frustumCulled = true; city.add(m); PICK.push(m);
  }
  return city;
}

/* ---------- labels ---------- */
const LBL = [];
function addLabel(text, pos, cls, info) {
  const el = document.createElement('div'); el.className = 'lbl ' + (cls || ''); el.textContent = text; labelsEl.appendChild(el);
  const L = { el, pos, cls, info, w: 0 }; if (info) el.addEventListener('click', e => { e.stopPropagation(); showCard(info); flyTo(pos, info.dist || 180); }); LBL.push(L); return L;
}
let showLabels = true;
const _v = new THREE.Vector3();
function updateLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dist = camera.position.distanceTo(controls.target), shown = [];
  for (const L of LBL) {   /* landmarks first (they were added after districts, so walk them first), then districts that do not collide */
    if (L.cls === 'dist') continue; place(L);
  }
  for (const L of LBL) if (L.cls === 'dist') place(L);
  function place(L) {
    _v.copy(L.pos); const d = camera.position.distanceTo(L.pos); _v.project(camera);
    let vis = showLabels && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && (L.cls === 'dist' ? dist > 500 : d < (L.info && L.info.big ? 5000 : 1500));
    const x = (_v.x + 1) / 2 * w, y = (1 - _v.y) / 2 * h;
    if (vis) for (const [sx, sy, sw] of shown) if (Math.abs(sx - x) < (sw + L.w) / 2 + 6 && Math.abs(sy - y) < 22) { vis = false; break; }
    L.el.style.display = vis ? '' : 'none';
    if (vis) { L.el.style.left = x + 'px'; L.el.style.top = y + 'px'; L.el.style.opacity = L.cls === 'dist' ? Math.min(1, (dist - 500) / 300) : 1; shown.push([x, y, L.w]); }
  }
}
function showCard(info) {
  $('#card').style.display = 'block'; $('#cName').textContent = info.name;
  $('#cTags').innerHTML = ''; for (const t of info.tags || []) { const s = document.createElement('span'); s.className = 'tag' + (t === '規劃中' ? ' plan' : ''); s.textContent = t; $('#cTags').appendChild(s); }
  $('#cText').textContent = info.text || '';
}

/* ---------- camera moves ---------- */
let fly = null;
function flyTo(pos, dist = 180, pitch = .9) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize(); if (!dir.lengthSq()) dir.set(0, 0, 1);
  const to = pos.clone(), cam = to.clone().addScaledVector(dir, Math.cos(pitch) * dist).setY(to.y + Math.sin(pitch) * dist);
  fly = { t: 0, a0: controls.target.clone(), c0: camera.position.clone(), a1: to, c1: cam };
}
const VIEWS = { top: () => { fly = { t: 0, a0: controls.target.clone(), c0: camera.position.clone(), a1: new THREE.Vector3(0, 0, -60), c1: new THREE.Vector3(0, 1750, 750) }; },
  street: () => flyTo(new THREE.Vector3(0, 0, -150), 110, .28) };

/* ---------- picking ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(PICK, false)[0]; if (!hit) { $('#card').style.display = 'none'; return; }
  const P = hit.point; let best = null, bd = 45;
  for (const L of LBL) if (L.info) { const d = Math.hypot(L.pos.x - P.x, L.pos.z - P.z); if (d < bd) { bd = d; best = L; } }
  if (best) { showCard(best.info); return; }
  const D = DISTRICTS.find(d => inRing(d.ring, P.x, P.z)); showCard({ name: D ? D.name : '城市街區', tags: [], text: D ? '這一區的建築目前以外觀為主。' : '' });
});
function inRing(r, x, z) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
let DISTRICTS = [];

/* ---------- side panel ---------- */
function renderLog(list) {
  const el = $('#log'); el.innerHTML = '';
  for (const e of list) {
    const d = document.createElement('div'); d.className = 'entry';
    const dt = document.createElement('div'); dt.className = 'date'; dt.textContent = e.date; d.appendChild(dt);
    const h = document.createElement('h4'); h.textContent = e.title; d.appendChild(h);
    if (e.items && e.items.length) { const ul = document.createElement('ul'); for (const it of e.items) { const li = document.createElement('li'); li.textContent = it; ul.appendChild(li); } d.appendChild(ul); }
    if (e.image) { const im = document.createElement('img'); im.src = e.image; im.alt = e.title; im.loading = 'lazy'; d.appendChild(im); }
    el.appendChild(d);
  }
}

/* ---------- main ---------- */
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
const btn = (id, f) => $(id).addEventListener('click', f);
btn('#bDay', () => { night = false; applySky(); $('#bDay').classList.add('on'); $('#bNight').classList.remove('on'); });
btn('#bNight', () => { night = true; applySky(); $('#bNight').classList.add('on'); $('#bDay').classList.remove('on'); });
btn('#bTop', () => VIEWS.top()); btn('#bStreet', () => VIEWS.street());
btn('#bLbl', () => { showLabels = !showLabels; $('#bLbl').classList.toggle('on', showLabels); });

(async () => {
  try {
    setLoad(.02, '讀取地標與日誌…');
    const [places, log] = await Promise.all([fetch('./places.json').then(r => r.json()), fetch('./changelog.json').then(r => r.json())]);
    renderLog(log.entries || []); $('#ver').textContent = log.version ? '資料版本：' + log.version : '';
    const data = parse(await fetchBin('./data/citymap.bin.gz'));
    setLoad(.75, '建立城市模型…'); await new Promise(r => setTimeout(r, 30));
    build(data); applySky();
    DISTRICTS = data.H.districts || [];
    for (const d of DISTRICTS) { let x = 0, z = 0; for (const [a, b] of d.ring) { x += a; z += b; } if (d.ring.length && places.districts && places.districts[d.id] !== false) addLabel(d.name, new THREE.Vector3(x / d.ring.length, 30, z / d.ring.length), 'dist'); }
    const byId = Object.fromEntries((data.H.places || []).map(p => [p.id, p]));
    const plist = $('#places');
    for (const P of places.places) {
      const at = P.at || (byId[P.id] && [byId[P.id].x, byId[P.id].z]); if (!at) continue;
      const pos = new THREE.Vector3(at[0], P.h || 14, at[1]); const info = { name: P.name, tags: P.tags, text: P.text, big: P.big, dist: P.dist };
      addLabel(P.name, pos, '', info);
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = P.name; b.addEventListener('click', () => { showCard(info); flyTo(pos, info.dist || 180); }); plist.appendChild(b);
    }
    setLoad(1, ''); $('#load').style.display = 'none';
    for (const L of LBL) L.w = L.el.offsetWidth || L.el.textContent.length * 13 + 16;   /* measured once while all are shown: a hidden label measures 0, which made neighbours flip on and off every frame */
    camera.position.set(0, 1750, 750); controls.target.set(0, 0, -60); resize();
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      if (fly) { fly.t = Math.min(1, fly.t + dt / 1.4); const k = fly.t < .5 ? 2 * fly.t * fly.t : 1 - Math.pow(-2 * fly.t + 2, 2) / 2;
        controls.target.lerpVectors(fly.a0, fly.a1, k); camera.position.lerpVectors(fly.c0, fly.c1, k); if (fly.t >= 1) fly = null; }
      controls.update(); renderer.render(scene, camera); updateLabels();
    });
  } catch (e) { $('#lmsg').textContent = '載入失敗：' + e.message; console.error(e); }
})();
resize();
