import * as THREE from 'three';
import { WATER_Y, mulberry32 } from './heights.js';

// Things that surround the camera everywhere: sky, water level, clouds.
export const SKY_TOP = 0x2f7fe0, SKY_HORIZON = 0xcfe6ff;

export function createWorld(scene) {
  const sky = buildSky(scene);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2f86d0, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }));
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  scene.add(water);
  const clouds = buildClouds(scene, mulberry32(42));

  return {
    skyMat: sky.material, water, clouds, cloudMat: clouds[0].children[0].material,
    update(dt, camera) {
      const cp = camera.position;
      sky.position.copy(cp);
      water.position.x = cp.x; water.position.z = cp.z;
      for (const c of clouds) {
        c.position.x += dt * 5;
        // keep clouds in a 2400 m box around the camera
        if (c.position.x - cp.x > 1200) c.position.x -= 2400; else if (c.position.x - cp.x < -1200) c.position.x += 2400;
        if (c.position.z - cp.z > 1200) c.position.z -= 2400; else if (c.position.z - cp.z < -1200) c.position.z += 2400;
      }
    },
  };
}

function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(SKY_TOP) }, bottom: { value: new THREE.Color(SKY_HORIZON) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = clamp(vP.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

function buildClouds(scene, rand) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0x99aabb, emissiveIntensity: 0.35 });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const clouds = [];
  for (let i = 0; i < 30; i++) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(rand() * 4);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(geo, mat);
      const s = 10 + rand() * 10;
      m.scale.set(s, s * 0.6, s);
      m.position.set((j - n / 2) * 12 + rand() * 6, rand() * 6, rand() * 14 - 7);
      g.add(m);
    }
    g.position.set(rand() * 2400 - 1200, 170 + rand() * 90, rand() * 2400 - 1200);
    scene.add(g);
    clouds.push(g);
  }
  return clouds;
}
