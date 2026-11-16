// Transient visuals: tracers, muzzle flashes, impact sparks, explosions and
// grenade smoke. Everything is pooled or short-lived and updated from one
// list, so a firefight never allocates in the hot loop beyond a few objects
// per shot. Smoke clouds are also data: bots test their sight lines against
// `smokes` so a Veil genuinely breaks vision, not just the picture.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,220,150,0.8)');
  grad.addColorStop(1, 'rgba(255,180,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createFx(scene) {
  const active = []; // {until, update(now, dt) -> alive}
  const smokes = []; // {x, y, z, r, until}
  const glow = glowTexture();

  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  const _mid = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function add(effect) {
    active.push(effect);
    return effect;
  }

  function tracer(from, to) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    _mid.addVectors(from, to).multiplyScalar(0.5);
    mesh.position.copy(_mid);
    _dir.subVectors(to, from);
    mesh.scale.z = Math.max(0.1, _dir.length());
    mesh.lookAt(to);
    scene.add(mesh);
    const until = performance.now() + 55;
    add({
      until,
      update(now) {
        mesh.material.opacity = Math.max(0, (until - now) / 55) * 0.9;
        if (now >= until) scene.remove(mesh);
        return now < until;
      },
    });
  }

  function muzzle(worldPos, scale = 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffcf8a, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.position.copy(worldPos);
    sprite.scale.setScalar(0.34 * scale * (0.8 + Math.random() * 0.5));
    sprite.material.rotation = Math.random() * Math.PI;
    scene.add(sprite);
    const until = performance.now() + 45;
    add({
      until,
      update(now) {
        if (now >= until) scene.remove(sprite);
        return now < until;
      },
    });
  }

  function sparks(point, color = 0xffc37a, count = 7, speed = 3.2) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i += 1) {
      pos[i * 3] = point.x;
      pos[i * 3 + 1] = point.y;
      pos[i * 3 + 2] = point.z;
      vel.push(new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.07, transparent: true, opacity: 1 }));
    scene.add(points);
    const until = performance.now() + 320;
    add({
      until,
      update(now, dt) {
        const arr = geo.attributes.position.array;
        for (let i = 0; i < count; i += 1) {
          vel[i].y -= 9 * dt;
          arr[i * 3] += vel[i].x * dt;
          arr[i * 3 + 1] += vel[i].y * dt;
          arr[i * 3 + 2] += vel[i].z * dt;
        }
        geo.attributes.position.needsUpdate = true;
        points.material.opacity = Math.max(0, (until - now) / 320);
        if (now >= until) {
          scene.remove(points);
          geo.dispose();
        }
        return now < until;
      },
    });
  }

  function explosion(point) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffa050, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.position.copy(point).y += 0.6;
    sprite.scale.setScalar(1);
    scene.add(sprite);
    const light = new THREE.PointLight(0xff9a40, 220, 22, 1.9);
    light.position.copy(point).y += 1;
    scene.add(light);
    const start = performance.now();
    const until = start + 380;
    add({
      until,
      update(now) {
        const t = (now - start) / 380;
        sprite.scale.setScalar(1 + t * 7);
        sprite.material.opacity = 1 - t;
        light.intensity = 220 * (1 - t);
        if (now >= until) {
          scene.remove(sprite);
          scene.remove(light);
        }
        return now < until;
      },
    });
    sparks(point, 0xff9a50, 22, 6);
  }

  function flashBang(point) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.position.copy(point);
    sprite.scale.setScalar(6);
    scene.add(sprite);
    const until = performance.now() + 130;
    add({
      until,
      update(now) {
        sprite.material.opacity = Math.max(0, (until - now) / 130);
        if (now >= until) scene.remove(sprite);
        return now < until;
      },
    });
  }

  function smokeCloud(point, radius, lifeMs) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xb9bec2, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }),
    );
    mesh.position.copy(point);
    mesh.scale.setScalar(0.3);
    scene.add(mesh);
    const cloud = { x: point.x, y: point.y, z: point.z, r: radius, until: performance.now() + lifeMs };
    smokes.push(cloud);
    const born = performance.now();
    add({
      until: cloud.until,
      update(now) {
        const age = now - born;
        const grow = Math.min(1, age / 700);
        mesh.scale.setScalar(0.3 + 0.7 * grow);
        const remain = cloud.until - now;
        mesh.material.opacity = remain < 1500 ? 0.5 * (remain / 1500) : 0.5;
        if (now >= cloud.until) {
          scene.remove(mesh);
          const i = smokes.indexOf(cloud);
          if (i >= 0) smokes.splice(i, 1);
        }
        return now < cloud.until;
      },
    });
    return cloud;
  }

  function grenadeMesh(kind) {
    const color = kind === 'frag' ? 0x4a5548 : kind === 'flash' ? 0xd8d8d8 : 0x707880;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }));
    mesh.castShadow = true;
    return mesh;
  }

  // A planted charge: a dark box with a red beacon that pulses faster as the
  // timer runs down. Returned handle lets the round logic drive the pulse.
  function chargeMesh() {
    const group = new THREE.Group();
    const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.34), new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6 }));
    boxMesh.position.y = 0.15;
    boxMesh.castShadow = true;
    group.add(boxMesh);
    const beaconMat = new THREE.MeshStandardMaterial({ color: PALETTE.charge, emissive: PALETTE.charge, emissiveIntensity: 1 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), beaconMat);
    beacon.position.y = 0.36;
    group.add(beacon);
    const light = new THREE.PointLight(PALETTE.charge, 6, 7, 2);
    light.position.y = 0.5;
    group.add(light);
    return {
      group,
      setPulse(intensity) {
        beaconMat.emissiveIntensity = intensity;
        light.intensity = intensity * 5;
      },
    };
  }

  return {
    smokes,
    tracer,
    muzzle,
    sparks,
    explosion,
    flashBang,
    smokeCloud,
    grenadeMesh,
    chargeMesh,
    update(dt) {
      const now = performance.now();
      for (let i = active.length - 1; i >= 0; i -= 1) {
        if (!active[i].update(now, dt)) active.splice(i, 1);
      }
    },
  };
}
