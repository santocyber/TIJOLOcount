import * as THREE from "three";

/**
 * Cutout3D — corte de portas/janelas diretamente no viewer 3D.
 */
export class Cutout3D {
  constructor(viewerEl, scene, camera, renderer, controls) {
    this.viewerEl = viewerEl;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.raycaster = new THREE.Raycaster();

    this.active = false;
    this.cutType = "door";
    this.cutWidth = 0.8;
    this.cutHeight = 2.1;
    this.cutElevation = 0;

    // Dados das paredes para hit detection
    this.wallsData = [];
    this.layersData = [];
    this.wallThickness = 0.39;

    // Preview
    this.previewMesh = null;
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onClick = this._onClick.bind(this);

    this.onCutoutChange = null; // callback(updatedLayers)
  }

  setConfig({ type, width, height, elevation }) {
    if (type !== undefined) this.cutType = type;
    if (width !== undefined) this.cutWidth = width;
    if (height !== undefined) this.cutHeight = height;
    if (elevation !== undefined) this.cutElevation = elevation;
  }

  setWallData(layersData, wallThickness) {
    this.layersData = layersData;
    this.wallThickness = wallThickness;
    this.wallsData = [];
    for (let li = 0; li < layersData.length; li++) {
      const layer = layersData[li];
      const le = layer.elevation || 0;
      const lh = layer.height || 2.8;
      for (let wi = 0; wi < (layer.walls || []).length; wi++) {
        const w = (layer.walls || [])[wi];
        this.wallsData.push({
          layerIdx: li,
          wallIdx: wi,
          x1: w.x1,
          z1: w.z1,
          x2: w.x2,
          z2: w.z2,
          height: w.height || lh,
          baseElevation: le,
          cutouts: w.cutouts || [],
          type: w.type,
        });
      }
    }
    if (this.active) this._updateMarkers();
  }

  activate() {
    this.active = true;
    this.viewerEl.style.cursor = "crosshair";
  }
  deactivate() {
    this.active = false;
    this._hidePreview();
    this._clearMarkers();
    this.viewerEl.style.cursor = "";
  }

  _onMouseMove(event) {
    if (!this.active) return;
    const rect = this.viewerEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const hit = this._hitWall(this.raycaster);
    if (hit) {
      this._showPreview(hit);
    } else {
      this._hidePreview();
    }
  }

  _onClick(event) {
    if (!this.active) return;
    const rect = this.viewerEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const hit = this._hitWall(this.raycaster);
    if (hit) {
      const wd = hit.wallData;
      // Clamp position
      const pos = Math.max(
        0,
        Math.min(wd.length - this.cutWidth, hit.position),
      );
      const elev = this.cutElevation;

      // Toggle: se ja existe cutout proximo, remove; senao adiciona
      const cutouts = wd.cutouts || [];
      const existingIdx = cutouts.findIndex(
        (c) => Math.abs(c.position - pos) < 0.3 && c.cut_type === this.cutType,
      );
      if (existingIdx >= 0) {
        cutouts.splice(existingIdx, 1);
      } else {
        cutouts.push({
          cut_type: this.cutType,
          width: this.cutWidth,
          height: this.cutHeight,
          position: pos,
          elevation: elev,
        });
      }

      // Update wall in layersData
      const layer = this.layersData[hit.layerIdx];
      if (layer) {
        layer.walls[hit.wallIdx].cutouts = cutouts;
      }

      this.setWallData(this.layersData, this.wallThickness);
      if (this.onCutoutChange) this.onCutoutChange(this.layersData);
    }
  }

  _hitWall(raycaster) {
    let bestHit = null;
    let bestDist = Infinity;

    for (let i = 0; i < this.wallsData.length; i++) {
      const wd = this.wallsData[i];
      wd.length = Math.hypot(wd.x2 - wd.x1, wd.z2 - wd.z1);
      if (wd.length < 1e-6) continue;

      const dx = wd.x2 - wd.x1;
      const dz = wd.z2 - wd.z1;
      const ux = dx / wd.length;
      const uz = dz / wd.length;
      const nx = -uz;
      const nz = ux;
      const t = this.wallThickness / 2;

      // Plane of wall center
      const cx = (wd.x1 + wd.x2) / 2;
      const cz = (wd.z1 + wd.z2) / 2;

      // Ray-plane intersection (infinite plane at wall center, facing wall direction)
      const planeNormal = new THREE.Vector3(nx, 0, nz);
      const planePoint = new THREE.Vector3(cx, 0, cz);

      const rayOrigin = raycaster.ray.origin.clone();
      const rayDir = raycaster.ray.direction.clone();

      const denom = rayDir.dot(planeNormal);
      if (Math.abs(denom) < 1e-6) continue;

      const tParam = planePoint.clone().sub(rayOrigin).dot(planeNormal) / denom;
      if (tParam < 0) continue;

      const hitPoint = rayOrigin.add(rayDir.clone().multiplyScalar(tParam));

      // Check if point is within wall bounds (XZ)
      const along = (hitPoint.x - wd.x1) * ux + (hitPoint.z - wd.z1) * uz;
      if (along < 0 || along > wd.length) continue;

      // Check thickness
      const perpDist = Math.abs(
        (hitPoint.x - cx) * nx + (hitPoint.z - cz) * nz,
      );
      if (perpDist > t * 2) continue;

      // Check elevation
      const dist = raycaster.ray.origin.distanceTo(hitPoint);
      if (dist < bestDist) {
        // Y from ray-plane intersection height
        const yWorld = hitPoint.y;
        const baseElev = wd.baseElevation;
        const wallTop = baseElev + wd.height;

        if (yWorld >= baseElev - 0.2 && yWorld <= wallTop + 0.2) {
          bestDist = dist;
          bestHit = {
            layerIdx: wd.layerIdx,
            wallIdx: wd.wallIdx,
            wallData: wd,
            position: along,
            elevation: yWorld - baseElev,
            point: hitPoint.clone(),
          };
        }
      }
    }
    return bestHit;
  }

  _showPreview(hit) {
    this._hidePreview();

    const geom = new THREE.BoxGeometry(
      this.cutWidth,
      this.cutHeight,
      this.wallThickness * 2,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: this.cutType === "door" ? 0x00d4ff : 0x4da6ff,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
    });
    this.previewMesh = new THREE.Mesh(geom, mat);

    const wd = hit.wallData;
    const dx = wd.x2 - wd.x1;
    const dz = wd.z2 - wd.z1;
    const len = wd.length;
    const ux = dx / len;
    const uz = dz / len;
    const angle = Math.atan2(dz, dx);

    const cx = wd.x1 + ux * (hit.position + this.cutWidth / 2);
    const cz = wd.z1 + uz * (hit.position + this.cutWidth / 2);
    const cy = wd.baseElevation + this.cutElevation + this.cutHeight / 2;

    this.previewMesh.position.set(cx, cy, cz);
    this.previewMesh.rotation.y = angle;
    this.scene.add(this.previewMesh);
  }

  _hidePreview() {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      this.previewMesh.material.dispose();
      this.previewMesh = null;
    }
  }

  _updateMarkers() {
    // Remove old markers
    while (this.markerGroup.children.length > 0) {
      const c = this.markerGroup.children[0];
      this.markerGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }

    if (!this.active) return;

    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.3,
      depthTest: true,
    });

    for (const wd of this.wallsData) {
      const cutouts = wd.cutouts || [];
      if (cutouts.length === 0) continue;

      const dx = wd.x2 - wd.x1;
      const dz = wd.z2 - wd.z1;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const ux = dx / len;
      const uz = dz / len;
      const angle = Math.atan2(dz, dx);

      for (const c of cutouts) {
        const color = c.cut_type === "door" ? 0x00d4ff : 0x4da6ff;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(c.width, c.height, this.wallThickness * 1.5),
          mat.clone(),
        );
        m.material.color.set(color);
        const cx = wd.x1 + ux * (c.position + c.width / 2);
        const cz = wd.z1 + uz * (c.position + c.width / 2);
        const cy = wd.baseElevation + (c.elevation || 0) + c.height / 2;
        m.position.set(cx, cy, cz);
        m.rotation.y = angle;
        this.markerGroup.add(m);
      }
    }
  }

  _clearMarkers() {
    while (this.markerGroup.children.length > 0) {
      const c = this.markerGroup.children[0];
      this.markerGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }
}
