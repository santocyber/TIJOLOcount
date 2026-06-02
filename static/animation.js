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
    this.camera.position.set(10, 8, 14);
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

    // Lights
    this.scene.add(new THREE.AmbientLight(0x666688, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.position.set(10, 15, 10);
    this.scene.add(dir);

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
      this.controls.target.set(cx, 1.2, cz);
      this.camera.position.set(
        cx + maxDim * 0.7,
        maxDim * 0.5,
        cz + maxDim * 0.9,
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

    const target = Math.min(
      this.currentIndex + this.bricksPerFrame,
      this.totalBricks,
    );
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
    const halfH = mesh.geometry.parameters.height / 2;
    matrix.compose(
      new THREE.Vector3(pos.x, pos.y + halfH, pos.z),
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

  _animateFrame() {
    requestAnimationFrame(this._boundAnimate);
    this.controls.update();
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
    this.scene.clear();
    this.renderer.dispose();
    this.container.innerHTML = "";
  }
}
