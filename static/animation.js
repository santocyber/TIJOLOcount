import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * BrickAnimator — standalone: cria cena propria, anima tijolos.
 */
export class BrickAnimator {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.bricksPerFrame = options.bricksPerFrame || 5;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1e);

    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;

    this.camera = new THREE.PerspectiveCamera(50, w / Math.max(h, 1), 0.1, 60);
    this.camera.position.set(10, 8, -14);
    this.camera.lookAt(0, 1.5, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerEl.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(2, 1.5, 3);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.update();

    // Shadows
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Sun light (casts shadows)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2);
    this.sunLight.position.set(10, 15, 10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 60;
    this.sunLight.shadow.camera.left = -15;
    this.sunLight.shadow.camera.right = 15;
    this.sunLight.shadow.camera.top = 15;
    this.sunLight.shadow.camera.bottom = -15;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Visual sun sphere
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.sunMesh.position.copy(this.sunLight.position);
    this.scene.add(this.sunMesh);

    // Ambient light (dynamic)
    this.ambientLight = new THREE.AmbientLight(0x666688, 1.5);
    this.scene.add(this.ambientLight);

    // Ground plane to receive shadows
    this.groundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -0.01;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    // Sun orbit reference (updated in load())
    this._sunCenter = new THREE.Vector3(0, 0, 0);
    this._sunRadius = 8;

    // Sun cycle state
    this._sunHeading = 0;
    this._sunCycleOnly = false;
    this._sunCycleDuration = 20;
    this._sunCycleStartTime = 0;

    // Grid
    const grid = new THREE.GridHelper(16, 16, 0x333355, 0x1a1a33);
    grid.position.y = 0.003;
    this.scene.add(grid);

    // Instanced meshes
    this.instancedExternal = null;
    this.instancedInternal = null;

    this.positions = [];
    this.totalBricks = 0;
    this.currentIndex = 0;
    this._brickAccum = 0;
    this.running = false;
    this.paused = false;
    this.onProgress = null;
    this.onComplete = null;

    this._boundAnimate = this._animateFrame.bind(this);
    this._boundResize = this._onResize.bind(this);
    window.addEventListener("resize", this._boundResize);
    this._animateFrame();
  }

  load(positions, brickDims) {
    this._cleanupInstances();
    this.positions = positions;
    this.totalBricks = positions.length;
    this.currentIndex = 0;
    this._brickAccum = 0;
    this.running = false;
    this.paused = false;

    const extPos = positions.filter((p) => p.type === "external");
    const intPos = positions.filter((p) => p.type === "internal");

    const geom = new THREE.BoxGeometry(
      brickDims.length,
      brickDims.height,
      brickDims.width,
    );
    const matExt = new THREE.MeshStandardMaterial({
      color: 0xd28250,
      roughness: 0.7,
    });
    const matInt = new THREE.MeshStandardMaterial({
      color: 0x8c8c8c,
      roughness: 0.7,
    });

    if (extPos.length > 0) {
      this.instancedExternal = new THREE.InstancedMesh(
        geom,
        matExt,
        extPos.length,
      );
      this.instancedExternal.count = 0;
      this.instancedExternal.castShadow = true;
      this.instancedExternal.userData.positions = extPos;
      this.scene.add(this.instancedExternal);
    }
    if (intPos.length > 0) {
      this.instancedInternal = new THREE.InstancedMesh(
        geom,
        matInt,
        intPos.length,
      );
      this.instancedInternal.count = 0;
      this.instancedInternal.castShadow = true;
      this.instancedInternal.userData.positions = intPos;
      this.scene.add(this.instancedInternal);
    }

    if (positions.length > 0) {
      let cx = 0,
        cz = 0;
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const p of positions) {
        cx += p.x;
        cz += p.z;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      cx /= positions.length;
      cz /= positions.length;
      const maxDim = Math.max(maxX - minX, maxZ - minZ, 3);

      // Store sun orbit reference
      this._sunCenter.set(cx, 0, cz);
      this._sunRadius = maxDim * 1.5;
      this.sunLight.target.position.copy(this._sunCenter);
      const sc = this._sunRadius * 1.3;
      this.sunLight.shadow.camera.left = -sc;
      this.sunLight.shadow.camera.right = sc;
      this.sunLight.shadow.camera.top = sc;
      this.sunLight.shadow.camera.bottom = -sc;
      this.sunLight.shadow.camera.far = this._sunRadius * 3;
      this.sunLight.shadow.camera.updateProjectionMatrix();
      this.groundPlane.position.set(cx, -0.01, cz);

      this.controls.target.set(cx, 1.2, cz);
      this.camera.position.set(
        cx + maxDim * 0.7,
        maxDim * 0.5,
        cz - maxDim * 0.9,
      );
      this.controls.update();
    }
  }

  start(onProgress, onComplete) {
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.running = true;
    this.paused = false;
    this.currentIndex = 0;
    this._brickAccum = 0;
    if (this.instancedExternal) this.instancedExternal.count = 0;
    if (this.instancedInternal) this.instancedInternal.count = 0;
    this._animStep();
  }

  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    this._animStep();
  }

  stop() {
    this.running = false;
    this.paused = false;
  }

  _animStep() {
    if (!this.running || this.paused) return;

    this._brickAccum += this.bricksPerFrame;
    const toAdd = Math.max(0, Math.floor(this._brickAccum));
    this._brickAccum -= toAdd;

    const target = Math.min(this.currentIndex + toAdd, this.totalBricks);
    for (let i = this.currentIndex; i < target; i++) {
      this._placeBrick(this.positions[i], i);
    }
    this.currentIndex = target;
    if (this.onProgress) this.onProgress(this.currentIndex, this.totalBricks);

    if (this.currentIndex < this.totalBricks) {
      requestAnimationFrame(() => this._animStep());
    } else {
      this.running = false;
      if (this.onComplete) this.onComplete();
    }
  }

  _placeBrick(pos) {
    const mesh =
      pos.type === "external" ? this.instancedExternal : this.instancedInternal;
    if (!mesh) return;
    const idx = mesh.count;
    if (idx >= mesh.userData.positions.length) return;

    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(pos.x, pos.y, pos.z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        pos.rotY,
      ),
      new THREE.Vector3(1, 1, 1),
    );
    mesh.setMatrixAt(idx, matrix);
    mesh.count = idx + 1;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  _cleanupInstances() {
    if (this.instancedExternal) {
      this.scene.remove(this.instancedExternal);
      this.instancedExternal.geometry.dispose();
      this.instancedExternal.material.dispose();
    }
    if (this.instancedInternal) {
      this.scene.remove(this.instancedInternal);
      this.instancedInternal.geometry.dispose();
      this.instancedInternal.material.dispose();
    }
    this.instancedExternal = null;
    this.instancedInternal = null;
  }

  startSunCycleOnly(duration = 20) {
    this._sunCycleOnly = true;
    this._sunCycleDuration = duration;
    this._sunCycleStartTime = performance.now();
  }

  stopSunCycleOnly() {
    this._sunCycleOnly = false;
  }

  setSunHeading(deg) {
    this._sunHeading = deg * Math.PI / 180;
  }

  _updateSun(progress) {
    const phi = progress * Math.PI;
    const cx = this._sunCenter.x;
    const cz = this._sunCenter.z;
    const radius = Math.max(this._sunRadius, 5);
    const maxHeight = radius * 0.8;

    // Sun position: arc from east to west, rotated by heading
    const dxRaw = radius * Math.cos(phi);
    const dzRaw = radius * Math.sin(phi);
    const cosH = Math.cos(this._sunHeading);
    const sinH = Math.sin(this._sunHeading);
    const sx = cx + dxRaw * cosH - dzRaw * sinH;
    const sy = maxHeight * Math.sin(phi);
    const sz = cz + dxRaw * sinH + dzRaw * cosH;

    this.sunLight.position.set(sx, sy, sz);
    this.sunMesh.position.copy(this.sunLight.position);

    // Light color and intensity
    const sunColor = this._sunColorAt(progress);
    const sunIntensity = 0.2 + 2.0 * Math.sin(phi);
    this.sunLight.color.set(sunColor);
    this.sunLight.intensity = sunIntensity;
    this.sunMesh.material.color.set(sunColor);

    // Ambient
    const ambColor = this._ambientColorAt(progress);
    const ambIntensity = 0.15 + 1.3 * Math.sin(phi);
    this.ambientLight.color.set(ambColor);
    this.ambientLight.intensity = ambIntensity;

    // Sky background
    this.scene.background.set(this._skyColorAt(progress));
  }

  _sunColorAt(t) {
    const stops = [
      { t: 0.0, r: 1.0, g: 0.42, b: 0.21 },
      { t: 0.25, r: 1.0, g: 0.84, b: 0.0 },
      { t: 0.5, r: 1.0, g: 1.0, b: 1.0 },
      { t: 0.75, r: 1.0, g: 0.84, b: 0.0 },
      { t: 1.0, r: 1.0, g: 0.27, b: 0.0 },
    ];
    return this._lerpColorStops(stops, t);
  }

  _ambientColorAt(t) {
    const stops = [
      { t: 0.0, r: 0.15, g: 0.15, b: 0.35 },
      { t: 0.25, r: 0.45, g: 0.50, b: 0.65 },
      { t: 0.5, r: 0.65, g: 0.65, b: 0.65 },
      { t: 0.75, r: 0.55, g: 0.45, b: 0.35 },
      { t: 1.0, r: 0.25, g: 0.18, b: 0.12 },
    ];
    return this._lerpColorStops(stops, t);
  }

  _skyColorAt(t) {
    const stops = [
      { t: 0.0, r: 0.10, g: 0.04, b: 0.18 },
      { t: 0.25, r: 0.29, g: 0.56, b: 0.85 },
      { t: 0.5, r: 0.53, g: 0.81, b: 0.92 },
      { t: 0.75, r: 0.83, g: 0.53, b: 0.37 },
      { t: 1.0, r: 0.18, g: 0.11, b: 0.05 },
    ];
    return this._lerpColorStops(stops, t);
  }

  _lerpColorStops(stops, t) {
    if (t <= stops[0].t) {
      const s = stops[0];
      return new THREE.Color(s.r, s.g, s.b);
    }
    if (t >= stops[stops.length - 1].t) {
      const s = stops[stops.length - 1];
      return new THREE.Color(s.r, s.g, s.b);
    }
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].t && t <= stops[i + 1].t) {
        const a = stops[i];
        const b = stops[i + 1];
        const f = (t - a.t) / (b.t - a.t);
        return new THREE.Color(
          a.r + (b.r - a.r) * f,
          a.g + (b.g - a.g) * f,
          a.b + (b.b - a.b) * f,
        );
      }
    }
    return new THREE.Color(1, 1, 1);
  }

  _animateFrame() {
    requestAnimationFrame(this._boundAnimate);
    this.controls.update();
    if (this._sunCycleOnly) {
      const elapsed = (performance.now() - this._sunCycleStartTime) / 1000;
      const p = Math.min(elapsed / this._sunCycleDuration, 1.0);
      this._updateSun(p);
      if (p >= 1.0) this._sunCycleOnly = false;
    } else if (this.totalBricks > 0) {
      this._updateSun(this.currentIndex / this.totalBricks);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 0 && h > 0) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }
  }

  dispose() {
    window.removeEventListener("resize", this._boundResize);
    this._cleanupInstances();
    if (this.sunMesh) {
      this.sunMesh.geometry.dispose();
      this.sunMesh.material.dispose();
    }
    if (this.groundPlane) {
      this.groundPlane.geometry.dispose();
      this.groundPlane.material.dispose();
    }
    if (this.sunLight) {
      this.sunLight.dispose();
    }
    this.scene.clear();
    this.renderer.dispose();
    this.container.innerHTML = "";
  }
}
