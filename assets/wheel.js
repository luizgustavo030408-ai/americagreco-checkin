// Roda de bike em ouro girando no hero (Three.js). Acelera com o scroll e inclina com o mouse/toque.
import * as THREE from 'three';

const canvas = document.getElementById('wheel');
if (canvas) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 11);

  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a84c, metalness: 0.95, roughness: 0.28 });
  const darkGold = new THREE.MeshStandardMaterial({ color: 0x8b7043, metalness: 0.9, roughness: 0.4 });
  const spokeMat = new THREE.LineBasicMaterial({ color: 0xe8d29a, transparent: true, opacity: 0.55 });

  const wheel = new THREE.Group();
  // pneu + aro
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.13, 24, 160), darkGold));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(2.38, 0.045, 16, 160), gold));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 16, 80), gold));
  // cubo
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 40), gold);
  hub.rotation.x = Math.PI / 2; wheel.add(hub);
  // raios cruzados (padrão de bike)
  const pts = [], N = 36;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, side = i % 2 ? 0.18 : -0.18;
    const hubA = a + (i % 2 ? 0.35 : -0.35);
    pts.push(new THREE.Vector3(Math.cos(hubA) * 0.22, Math.sin(hubA) * 0.22, side));
    pts.push(new THREE.Vector3(Math.cos(a) * 2.36, Math.sin(a) * 2.36, 0));
  }
  wheel.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), spokeMat));
  // coroa dentada
  const teeth = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.05), gold);
    const a = (i / 40) * Math.PI * 2; t.position.set(Math.cos(a) * 0.98, Math.sin(a) * 0.98, 0.2); t.rotation.z = a; teeth.add(t);
  }
  teeth.add(new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 12, 90), gold));
  teeth.children.at(-1).position.z = 0.2;
  wheel.add(teeth);

  // partículas de poeira dourada
  const dustGeo = new THREE.BufferGeometry(), D = 220, pos = new Float32Array(D * 3);
  for (let i = 0; i < D; i++) { const r = 2.8 + Math.random() * 2.2, a = Math.random() * Math.PI * 2; pos.set([Math.cos(a) * r, Math.sin(a) * r, (Math.random() - .5) * 3], i * 3); }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xf3e4bd, size: 0.03, transparent: true, opacity: 0.6 }));

  const rig = new THREE.Group(); rig.add(wheel); rig.add(dust); scene.add(rig);
  rig.rotation.set(-0.25, -0.55, 0);

  scene.add(new THREE.AmbientLight(0xfff1d6, 0.5));
  const key = new THREE.DirectionalLight(0xffe3a3, 2.4); key.position.set(4, 5, 6); scene.add(key);
  const rim = new THREE.PointLight(0xc9a07a, 30, 30); rim.position.set(-5, -2, 3); scene.add(rim);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();

  // interação: o ponteiro inclina a roda
  const target = { x: -0.25, y: -0.55 };
  addEventListener('pointermove', e => {
    const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
    target.y = -0.55 + nx * 0.6; target.x = -0.25 + ny * 0.4;
  }, { passive: true });

  let visible = true, running = false, last = performance.now(), speed = 0.6;
  function step() {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const want = 0.6 + (window.__wheelBoost || 0);
    speed += (want - speed) * Math.min(1, dt * 3);
    window.__wheelBoost = (window.__wheelBoost || 0) * 0.92;
    wheel.rotation.z -= speed * dt;
    teeth.rotation.z -= speed * dt * 0.4;
    dust.rotation.z -= speed * dt * 0.15;
    rig.rotation.x += (target.x - rig.rotation.x) * dt * 2;
    rig.rotation.y += (target.y - rig.rotation.y) * dt * 2;
    renderer.render(scene, camera);
  }
  function tick() { if (!visible) { running = false; return; } step(); requestAnimationFrame(tick); }
  function start() { if (running || reduced) return; running = true; last = performance.now(); requestAnimationFrame(tick); }
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) start(); }).observe(canvas);
  if (reduced) renderer.render(scene, camera);
}
