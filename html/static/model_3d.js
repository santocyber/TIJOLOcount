import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

export class Wall3DBuilder {
  constructor(calculator) {
    this.calc = calculator;
    this.model = null;
  }

  build() {
    const group = new THREE.Group();
    const thickness = this.calc.wallThickness;

    for (const wall of this.calc.walls) {
      const length = wall.length;
      const height = wall.height;
      if (length < 0.001 || height < 0.001) continue;

      const angle = wall.angle;
      const color = wall.wall_type === "external" ? 0xd28250
        : wall.wall_type === "half_wall" ? 0x4da6ff
        : 0x8c8c8c;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

      const mesh = this._buildWallMesh(length, height, thickness, wall.cutouts, mat);
      mesh.position.set(wall.x1, wall.base_elevation, wall.z1);
      mesh.rotation.y = angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      group.add(mesh);
    }

    this._addFloor(group);
    this.model = group;
    return group;
  }

  _buildWallMesh(length, height, thickness, cutouts, material) {
    const validCutouts = (cutouts || []).filter(c => {
      const pos = c.position || 0;
      const w = c.width || 0;
      const h = c.height || 0;
      const elev = c.elevation || 0;
      return pos >= 0 && pos + w <= length + 0.001 &&
             w > 0.001 && h > 0.001 &&
             elev >= 0 && elev + h <= height + 0.001;
    });

    let geometry;

    if (validCutouts.length === 0) {
      geometry = new THREE.BoxGeometry(length, height, thickness);
      geometry.translate(length / 2, height / 2, 0);
    } else {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(length, 0);
      shape.lineTo(length, height);
      shape.lineTo(0, height);

      for (const cut of validCutouts) {
        const hole = new THREE.Path();
        hole.moveTo(cut.position, cut.elevation);
        hole.lineTo(cut.position + cut.width, cut.elevation);
        hole.lineTo(cut.position + cut.width, cut.elevation + cut.height);
        hole.lineTo(cut.position, cut.elevation + cut.height);
        shape.holes.push(hole);
      }

      geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
      });
      geometry.translate(0, 0, -thickness / 2);
    }

    return new THREE.Mesh(geometry, material);
  }

  _addFloor(group) {
    if (this.calc.walls.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const w of this.calc.walls) {
      if (w.x1 < minX) minX = w.x1;
      if (w.x2 < minX) minX = w.x2;
      if (w.x1 > maxX) maxX = w.x1;
      if (w.x2 > maxX) maxX = w.x2;
      if (w.z1 < minZ) minZ = w.z1;
      if (w.z2 < minZ) minZ = w.z2;
      if (w.z1 > maxZ) maxZ = w.z1;
      if (w.z2 > maxZ) maxZ = w.z2;
    }

    const margin = 1.0;
    const bw = maxX - minX + margin * 2;
    const bl = maxZ - minZ + margin * 2;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(bw, 0.02, bl),
      new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.9 }),
    );
    floor.position.set(cx, -0.01, cz);
    floor.receiveShadow = true;
    group.add(floor);
  }

  exportGLB() {
    if (!this.model) this.build();
    return new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      exporter.parse(
        this.model,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(new Blob([result], { type: "model/gltf-binary" }));
          } else {
            resolve(new Blob([result], { type: "model/gltf+json" }));
          }
        },
        (error) => reject(error),
        { binary: true },
      );
    });
  }

  exportSTL() {
    if (!this.model) this.build();
    const exporter = new STLExporter();
    const result = exporter.parse(this.model, { binary: true });
    return new Blob([result], { type: "application/vnd.ms-pki.stl" });
  }
}
