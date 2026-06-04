import {
  BRICK_TYPES,
  BRICK_ORIENTATIONS,
  MORTAR_DENSITY,
  MORTAR_CEMENT_KG,
  MORTAR_SAND_KG,
  MORTAR_WATER_L,
  WASTE_FACTOR,
  DEFAULT_BRICK,
  DEFAULT_MORTAR_JOINT,
  DEFAULT_ORIENTATION,
} from "./config.js";

class Cutout {
  constructor({ cut_type, width, height, position, elevation = 0 }) {
    this.cutType = cut_type;
    this.width = width;
    this.height = height;
    this.position = position;
    this.elevation = elevation;
  }
}

class Wall {
  constructor({
    x1, z1, x2, z2, height,
    wall_type = "external", label = "",
    cutouts = [], base_elevation = 0,
  }) {
    this.x1 = x1; this.z1 = z1;
    this.x2 = x2; this.z2 = z2;
    this.height = height;
    this.wall_type = wall_type;
    this.label = label;
    this.cutouts = (cutouts || []).map(c => new Cutout(c));
    this.base_elevation = base_elevation;
  }

  get length() {
    return Math.hypot(this.x2 - this.x1, this.z2 - this.z1);
  }

  get angle() {
    return Math.atan2(-(this.z2 - this.z1), this.x2 - this.x1);
  }

  get area() {
    const gross = this.length * this.height;
    const cut = this.cutouts.reduce((s, c) => s + c.width * c.height, 0);
    return Math.max(0, gross - cut);
  }

  _brickHitsCutout(cx, cy, brickW, brickH) {
    const halfW = brickW / 2;
    const halfH = brickH / 2;
    for (const c of this.cutouts) {
      if (
        c.position - halfW < cx && cx < c.position + c.width + halfW &&
        c.elevation - halfH < cy && cy < c.elevation + c.height + halfH
      ) {
        return true;
      }
    }
    return false;
  }

  brickPositions(brickAlong, brickUp, brickD, mortarJoint) {
    const stepX = brickAlong + mortarJoint;
    const stepY = brickUp + mortarJoint;
    const length = this.length;
    const h = this.height;

    const nAlong = Math.max(1, Math.ceil(length / stepX));
    const nRows = Math.max(1, Math.ceil(h / stepY));
    const totalSpaceY = nRows * stepY;
    const startOffsetY = (totalSpaceY - h) / 2;

    const dx = this.x2 - this.x1;
    const dz = this.z2 - this.z1;
    const invLen = length > 0 ? 1 / length : 0;
    const ux = dx * invLen;
    const uz = dz * invLen;

    const positions = [];
    for (let row = 0; row < nRows; row++) {
      for (let col = 0; col < nAlong; col++) {
        const along = col * stepX;
        const yCell = startOffsetY + row * stepY;
        const brickStart = along + mortarJoint / 2;

        if (brickStart >= length) continue;

        const remaining = length - brickStart;
        const scaleX = Math.min(remaining / brickAlong, 1.0);

        const cx = brickStart + (brickAlong * scaleX) / 2;
        const cy = yCell + stepY / 2;

        if (this._brickHitsCutout(cx, cy, brickAlong * scaleX, brickUp)) continue;

        const wx = this.x1 + ux * cx;
        const wz = this.z1 + uz * cx;

        positions.push({
          x: +wx.toFixed(4),
          y: +(this.base_elevation + cy).toFixed(4),
          z: +wz.toFixed(4),
          rotY: +this.angle.toFixed(4),
          type: this.wall_type,
          scaleX: +scaleX.toFixed(4),
        });
      }
    }
    return positions;
  }
}

export class BrickCalculator {
  constructor({ walls, layers, brick_type_key, mortar_joint, orientation } = {}) {
    this.brickTypeKey = brick_type_key || DEFAULT_BRICK;
    this.brickRaw = BRICK_TYPES[this.brickTypeKey] || BRICK_TYPES[DEFAULT_BRICK];
    this.mortarJoint = mortar_joint != null ? mortar_joint : DEFAULT_MORTAR_JOINT;
    this.orientation = orientation || DEFAULT_ORIENTATION;

    const orient = BRICK_ORIENTATIONS[this.orientation] || BRICK_ORIENTATIONS.espelho;
    this.brickAlong = this.brickRaw[orient.along];
    this.brickUp = this.brickRaw[orient.up];
    this.brickThick = this.brickRaw[orient.thick];

    this.layersData = [];
    this.walls = [];

    if (layers) {
      this.layersData = layers;
      for (const layer of layers) {
        const lw = layer.walls || [];
        const lh = layer.height || 2.80;
        const le = layer.elevation || 0.0;
        for (const w of lw) {
          const cutouts = (w.cutouts || []).map(c => ({
            cut_type: c.cut_type,
            width: +c.width,
            height: +c.height,
            position: +c.position,
            elevation: +(c.elevation || 0),
          }));
          this.walls.push(new Wall({
            x1: +w.x1, z1: +w.z1, x2: +w.x2, z2: +w.z2,
            height: +(w.height || lh),
            wall_type: w.type || "external",
            label: w.label || "",
            cutouts,
            base_elevation: le,
          }));
        }
      }
    } else if (walls) {
      this.layersData = [{
        name: "Térreo",
        height: 2.80,
        elevation: 0.0,
        walls: walls,
      }];
      for (const w of walls) {
        const cutouts = (w.cutouts || []).map(c => ({
          cut_type: c.cut_type,
          width: +c.width,
          height: +c.height,
          position: +c.position,
          elevation: +(c.elevation || 0),
        }));
        this.walls.push(new Wall({
          x1: +w.x1, z1: +w.z1, x2: +w.x2, z2: +w.z2,
          height: +(w.height || 2.80),
          wall_type: w.type || "external",
          label: w.label || "",
          cutouts,
          base_elevation: 0.0,
        }));
      }
    }
  }

  get totalWallArea() {
    return this.walls.reduce((s, w) => s + w.area, 0);
  }

  get externalArea() {
    return this.walls.filter(w => w.wall_type === "external").reduce((s, w) => s + w.area, 0);
  }

  get internalArea() {
    return this.walls.filter(w => w.wall_type === "internal").reduce((s, w) => s + w.area, 0);
  }

  get bricksPerM2() {
    return 1 / ((this.brickAlong + this.mortarJoint) * (this.brickUp + this.mortarJoint));
  }

  get totalBricks() {
    const raw = this.totalWallArea * this.bricksPerM2;
    return Math.ceil(raw * (1 + WASTE_FACTOR));
  }

  get allBrickPositions() {
    const positions = [];
    for (const wall of this.walls) {
      positions.push(...wall.brickPositions(this.brickAlong, this.brickUp, this.brickThick, this.mortarJoint));
    }
    return positions;
  }

  get wallThickness() {
    return this.brickThick;
  }

  get effectiveBrickDims() {
    return {
      length: this.brickAlong,
      width: this.brickThick,
      height: this.brickUp,
    };
  }

  get mortarVolumePerBrick() {
    const j = this.mortarJoint;
    return j * (this.brickAlong + this.brickUp + j) * this.brickThick;
  }

  get totalMortarKg() {
    const n = this.allBrickPositions.length;
    return n * this.mortarVolumePerBrick * MORTAR_DENSITY;
  }

  get totalMortarM3() {
    return this.totalMortarKg / MORTAR_DENSITY;
  }

  get totalCementKg() {
    return this.totalMortarM3 * MORTAR_CEMENT_KG;
  }

  get totalSandKg() {
    return this.totalMortarM3 * MORTAR_SAND_KG;
  }

  get totalWaterL() {
    return this.totalMortarM3 * MORTAR_WATER_L;
  }

  get summary() {
    const wallsInfo = this.walls.map(w => {
      const n = w.brickPositions(this.brickAlong, this.brickUp, this.brickThick, this.mortarJoint).length;
      const cut = w.cutouts.reduce((s, c) => s + c.width * c.height, 0);
      return {
        label: w.label || `Parede (${w.wall_type})`,
        type: w.wall_type,
        length_m: +w.length.toFixed(2),
        height_m: +w.height.toFixed(2),
        area_m2: +w.area.toFixed(2),
        cutouts: w.cutouts.length,
        cut_area_m2: +cut.toFixed(2),
        bricks: n,
        andar_elev: +w.base_elevation.toFixed(2),
      };
    });

    const orientName = (BRICK_ORIENTATIONS[this.orientation] || {}).name || "Espelho";

    return {
      area_paredes_externas_m2: +this.externalArea.toFixed(2),
      area_paredes_internas_m2: +this.internalArea.toFixed(2),
      area_total_paredes_m2: +this.totalWallArea.toFixed(2),
      tijolos_por_m2: +this.bricksPerM2.toFixed(1),
      total_tijolos: this.totalBricks,
      espessura_parede_m: +this.wallThickness.toFixed(3),
      tipo_tijolo: this.brickRaw.name,
      posicao: orientName,
      junta_argamassa_cm: +(this.mortarJoint * 100).toFixed(1),
      total_argamassa_kg: +this.totalMortarKg.toFixed(1),
      cimento_kg: +this.totalCementKg.toFixed(1),
      areia_kg: +this.totalSandKg.toFixed(1),
      agua_l: +this.totalWaterL.toFixed(1),
      paredes: wallsInfo,
    };
  }
}
