import * as THREE from 'three';
import type { CharacterHead } from './characterHead';
import type { ScalpPaint } from './scalpPaint';
import { createScalpPaintOverlay } from './scalpPaintMaterial';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BustRig {
  rootGroup: THREE.Group;
  headPivot: THREE.Group;
  /** Tints the scalp core and the scalp paint; the paint mixes root and base (baseHex optional). */
  setRootTint: (hexColor: string, baseHex?: string, tipHex?: string) => void;
  /** Shows the style's painted short-hair layer on the head (null hides it). */
  setScalpPaint: (paint: ScalpPaint | null) => void;
  /** Replaces the mannequin head, ears, neck and scalp core with a character's fitted head (null restores the mannequin). */
  setCharacterHead: (head: CharacterHead | null) => void;
  dispose: () => void;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds a realistically proportioned anatomical head-and-bust mannequin:
 * - True adult/JRPG proportions: head width 0.56, head height 0.74 (aspect ~1.32),
 *   cranium dome at y=0.73, jawline & tapered chin at y=0.0, neck width 0.23 (~41% of head width),
 *   graceful slender bust shoulders (~0.92 wide) so the head is the realistic hero scale!
 * - Smooth warm-dark shadowed silhouette face (matching the dark shadowed interior in the reference)
 *   with realistic warm skin-toned ears positioned at anatomical temple/cheek height.
 */
export function createStylizedBust(): BustRig {
  const rootGroup = new THREE.Group();
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.44, 0);
  rootGroup.add(headPivot);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Smooth velvety dark-umber mannequin head silhouette (clean contrast behind bright/dark hair)
  const mannequinFaceMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#34261e',
      roughness: 0.82,
      metalness: 0.02,
    })
  );

  // Anatomically shaped warm-umber ears blending naturally with the dark studio mannequin
  const earSkinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#5a4236',
      roughness: 0.78,
      metalness: 0.02,
    })
  );

  // Inner scalp under-cap automatically tinted to match the hairstyle's deep root shadow
  const scalpCoreMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#181414',
      roughness: 0.94,
      metalness: 0.0,
    })
  );

  const bustTorsoMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#25272e',
      roughness: 0.76,
      metalness: 0.06,
    })
  );

  const collarMetalMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#515866',
      roughness: 0.34,
      metalness: 0.8,
      clearcoat: 0.2,
    })
  );

  const plinthMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#202229',
      roughness: 0.56,
      metalness: 0.25,
    })
  );

  // 1. Realistic Proportioned Anatomical Head (height 0.74, width 0.55, fuller natural cranium depth 0.62)
  const headProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.052, 0.012),
    new THREE.Vector2(0.122, 0.055),
    new THREE.Vector2(0.192, 0.135),
    new THREE.Vector2(0.244, 0.245),
    new THREE.Vector2(0.272, 0.365),
    new THREE.Vector2(0.28, 0.48),
    new THREE.Vector2(0.264, 0.585),
    new THREE.Vector2(0.208, 0.672),
    new THREE.Vector2(0.115, 0.725),
    new THREE.Vector2(0.0, 0.742),
  ];
  const headGeo = trackGeo(new THREE.LatheGeometry(headProfile, 40));
  headGeo.scale(0.97, 1.0, 1.09);
  const headMesh = new THREE.Mesh(headGeo, mannequinFaceMat);
  headMesh.position.set(0, 0.0, 0.0);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headPivot.add(headMesh);

  // 2. Inner Scalp Under-Dome (tucked inside hair roots to guarantee zero bright gaps)
  const scalpCoreGeo = trackGeo(new THREE.SphereGeometry(0.286, 32, 24));
  scalpCoreGeo.scale(0.96, 1.08, 1.07);
  const scalpCore = new THREE.Mesh(scalpCoreGeo, scalpCoreMat);
  scalpCore.position.set(0, 0.425, -0.015);
  headPivot.add(scalpCore);

  // 3. Anatomically Positioned Sculpted Ears (tucked closely to head so side hair drapes cleanly over upper ear)
  const buildEar = (side: -1 | 1) => {
    const earGroup = new THREE.Group();
    const outerGeo = trackGeo(new THREE.SphereGeometry(0.062, 18, 14));
    outerGeo.scale(0.28, 1.15, 0.68);
    const outer = new THREE.Mesh(outerGeo, earSkinMat);
    outer.castShadow = true;
    earGroup.add(outer);

    const helixGeo = trackGeo(new THREE.TorusGeometry(0.04, 0.01, 10, 20, Math.PI * 1.48));
    const helix = new THREE.Mesh(helixGeo, earSkinMat);
    helix.position.set(side * 0.008, 0.004, -0.004);
    helix.rotation.y = side * Math.PI * 0.44;
    helix.rotation.z = side * -0.42;
    earGroup.add(helix);

    earGroup.position.set(side * 0.256, 0.242, -0.028);
    earGroup.rotation.y = side * -0.26;
    earGroup.rotation.z = side * -0.1;
    return earGroup;
  };
  const earL = buildEar(-1);
  const earR = buildEar(1);
  headPivot.add(earL);
  headPivot.add(earR);

  // 4. Realistic Slender Anatomical Neck (width ~0.22, gracefully connecting jaw to collarbone)
  const neckProfile = [
    new THREE.Vector2(0.145, -0.22),
    new THREE.Vector2(0.118, -0.12),
    new THREE.Vector2(0.112, -0.02),
    new THREE.Vector2(0.122, 0.08),
  ];
  const neckGeo = trackGeo(new THREE.LatheGeometry(neckProfile, 28));
  neckGeo.scale(0.96, 1.0, 1.04);
  const neck = new THREE.Mesh(neckGeo, mannequinFaceMat);
  neck.position.set(0, 0.01, -0.032);
  neck.castShadow = true;
  neck.receiveShadow = true;
  headPivot.add(neck);

  // 5. Realistic Tapered Studio Bust Shoulders (compact sculpture bust, NOT an oversized football pad)
  const torsoProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.24, 0.0),
    new THREE.Vector2(0.36, 0.14),
    new THREE.Vector2(0.41, 0.24),
    new THREE.Vector2(0.34, 0.305),
    new THREE.Vector2(0.175, 0.355),
    new THREE.Vector2(0.145, 0.39),
    new THREE.Vector2(0.132, 0.39),
    new THREE.Vector2(0.12, 0.32),
  ];
  const torsoGeo = trackGeo(new THREE.LatheGeometry(torsoProfile, 40));
  torsoGeo.scale(1.12, 1.0, 0.56);
  const torso = new THREE.Mesh(torsoGeo, bustTorsoMat);
  torso.position.set(0, -0.04, -0.032);
  torso.castShadow = true;
  torso.receiveShadow = true;
  rootGroup.add(torso);

  // Subtle brushed gunmetal collar line
  const collarGeo = trackGeo(new THREE.TorusGeometry(0.148, 0.008, 10, 36));
  const collar = new THREE.Mesh(collarGeo, collarMetalMat);
  collar.position.set(0, 0.345, -0.028);
  collar.rotation.x = Math.PI * 0.5;
  collar.scale.set(1.08, 0.8, 1.0);
  rootGroup.add(collar);

  // 6. Sleek Low-Profile Pedestal & Contact Shadow
  const plinthProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.32, 0.0),
    new THREE.Vector2(0.3, 0.045),
    new THREE.Vector2(0.25, 0.075),
    new THREE.Vector2(0.24, 0.11),
    new THREE.Vector2(0.0, 0.11),
  ];
  const plinthGeo = trackGeo(new THREE.LatheGeometry(plinthProfile, 48));
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.set(0, -0.145, -0.032);
  plinth.receiveShadow = true;
  rootGroup.add(plinth);

  const shadowTex = createContactShadowTexture();
  textures.push(shadowTex);
  const shadowGeo = trackGeo(new THREE.PlaneGeometry(1.9, 1.9));
  const shadowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.52,
    })
  );
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI * 0.5;
  shadowPlane.position.set(0, -0.143, -0.032);
  rootGroup.add(shadowPlane);

  // Scalp paint overlay on whichever head is shown (surfaces in head-pivot-local space)
  const paintOverlay = createScalpPaintOverlay();
  headPivot.add(paintOverlay.group);
  const mannequinSurfaces = (): THREE.BufferGeometry[] => {
    const core = scalpCoreGeo.clone();
    core.translate(scalpCore.position.x, scalpCore.position.y, scalpCore.position.z);
    return [headGeo, trackGeo(core)];
  };
  paintOverlay.setSurfaces(mannequinSurfaces());
  paintOverlay.setPaint(null);
  const mannequinParts: THREE.Object3D[] = [headMesh, scalpCore, earL, earR, neck];
  let characterMesh: THREE.Mesh | null = null;
  const characterMat = trackMat(new THREE.MeshStandardMaterial({ color: '#bdb4ae', roughness: 0.7, metalness: 0.0 }));

  return {
    rootGroup,
    headPivot,
    setRootTint: (hexColor: string, baseHex?: string, tipHex?: string) => {
      scalpCoreMat.color.set(hexColor).multiplyScalar(0.55);
      paintOverlay.setColor(hexColor, baseHex, tipHex);
    },
    setScalpPaint: (paint) => paintOverlay.setPaint(paint),
    setCharacterHead: (head) => {
      if (characterMesh) {
        headPivot.remove(characterMesh);
        characterMesh.geometry.dispose();
        characterMesh = null;
      }
      if (head) {
        const soup = new THREE.BufferGeometry();
        soup.setAttribute('position', new THREE.BufferAttribute(head.positions.slice(), 3));
        const g = mergeVertices(soup, 1e-5);
        soup.dispose();
        g.computeVertexNormals();
        characterMesh = new THREE.Mesh(g, characterMat);
        characterMesh.name = 'CharacterHead_' + head.name;
        characterMesh.castShadow = true;
        characterMesh.receiveShadow = true;
        headPivot.add(characterMesh);
        paintOverlay.setSurfaces([g]);
      } else {
        paintOverlay.setSurfaces(mannequinSurfaces());
      }
      mannequinParts.forEach((o) => { o.visible = !head; });
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      paintOverlay.dispose();
      characterMesh?.geometry.dispose();
    },
  };
}
