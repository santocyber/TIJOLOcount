/**
 * FloorPlan — Canvas 2D para desenho de paredes e recortes.
 */
export class FloorPlan {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onWallsChange = options.onWallsChange || (() => {});

    this.mode = "draw";
    this.snapSize = options.snapSize || 0.05;
    this.wallHeight = options.wallHeight || 2.8;
    this.scale = 40;
    this.offsetX = 0;
    this.offsetY = 0;

    // Cursor tracking
    this.cursorWorldX = 0;
    this.cursorWorldZ = 0;

    this.walls = [];
    this.nextId = 1;

    this.drawing = false;
    this.startX = 0;
    this.startZ = 0;
    this.mouseX = 0;
    this.mouseZ = 0;

    this.selectedWallId = null;

    this.panning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.panOffsetStartX = 0;
    this.panOffsetStartY = 0;

    this._bindEvents();
    this._resize();
    this._centerView();
    this._render();

    // Garante resize confiavel apos layout
    requestAnimationFrame(() => {
      this._resize();
      this._render();
    });
  }

  // ----- Public API -----

  setMode(mode) {
    this.mode = mode;
    this.drawing = false;
    this._render();
  }

  setSnapSize(size) {
    this.snapSize = size;
    this._render();
  }

  setWallHeight(h) {
    this.wallHeight = h;
  }

  getWalls() {
    return this.walls.map((w) => ({
      x1: w.x1,
      z1: w.z1,
      x2: w.x2,
      z2: w.z2,
      height: w.height,
      type: w.type,
      label: w.label,
      cutouts: w.cutouts.map((c) => ({
        cut_type: c.cutType,
        width: c.width,
        height: c.height,
        position: c.position,
        elevation: c.elevation,
      })),
    }));
  }

  setWalls(wallsData) {
    this.walls = (wallsData || []).map((w, i) => ({
      id: this.nextId++,
      x1: w.x1,
      z1: w.z1,
      x2: w.x2,
      z2: w.z2,
      height: w.height || this.wallHeight,
      type: w.type || "external",
      label: w.label || "",
      cutouts: (w.cutouts || []).map((c) => ({
        cutType: c.cut_type || c.cutType || "door",
        width: c.width,
        height: c.height,
        position: c.position,
        elevation: c.elevation || 0,
      })),
    }));
    this.selectedWallId = null;
    this.drawing = false;
    this._render();
  }

  clear() {
    this.walls = [];
    this.selectedWallId = null;
    this.drawing = false;
    this._render();
    this.onWallsChange();
  }

  // ----- Eventos -----

  _bindEvents() {
    this.canvas.addEventListener("mousedown", (e) => this._onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this._onMouseMove(e));
    this.canvas.addEventListener("mouseup", (e) => this._onMouseUp(e));
    this.canvas.addEventListener("mouseleave", () => this._onMouseLeave());
    this.canvas.addEventListener("wheel", (e) => this._onWheel(e));
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", () => this._onResize());
    window.addEventListener("keydown", (e) => this._onKeyDown(e));
  }

  _snap(v) {
    return Math.round(v / this.snapSize) * this.snapSize;
  }

  _canvasToWorld(cx, cy) {
    const wx = (cx - this.canvas.width / 2 - this.offsetX) / this.scale;
    const wz = -(cy - this.canvas.height / 2 - this.offsetY) / this.scale;
    return { x: wx, z: wz };
  }

  _worldToCanvas(wx, wz) {
    const cx = this.canvas.width / 2 + this.offsetX + wx * this.scale;
    const cy = this.canvas.height / 2 + this.offsetY - wz * this.scale;
    return { x: cx, y: cy };
  }

  _onMouseDown(e) {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.ctrlKey)) {
      this.panning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.panOffsetStartX = this.offsetX;
      this.panOffsetStartY = this.offsetY;
      return;
    }
    if (e.button !== 0) return;

    const cPos = this._canvasToWorld(e.offsetX, e.offsetY);
    const sx = this._snap(cPos.x);
    const sz = this._snap(cPos.z);

    switch (this.mode) {
      case "draw":
        this._onDrawDown(sx, sz);
        break;
      case "rect":
        this._onRectDown(sx, sz);
        break;
      case "delete":
        this._onDeleteDown(e.offsetX, e.offsetY);
        break;
      case "select":
        this._onSelectDown(e.offsetX, e.offsetY);
        break;
    }
  }

  _onMouseMove(e) {
    if (this.panning) {
      this.offsetX = this.panOffsetStartX + (e.clientX - this.panStartX);
      this.offsetY = this.panOffsetStartY + (e.clientY - this.panStartY);
      this._render();
      return;
    }

    const cPos = this._canvasToWorld(e.offsetX, e.offsetY);
    const sx = this._snap(cPos.x);
    const sz = this._snap(cPos.z);

    // Cursor tracking
    this.cursorWorldX = cPos.x;
    this.cursorWorldZ = cPos.z;

    if (this.drawing) {
      this.mouseX = sx;
      this.mouseZ = sz;
      this._render();
    }

    const cursors = {
      draw: "crosshair",
      rect: "crosshair",
      select: "default",
      delete: "pointer",
    };
    this.canvas.style.cursor = cursors[this.mode] || "default";
  }

  _onMouseUp() {
    this.panning = false;
  }

  _onMouseLeave() {
    this.panning = false;
  }

  _onWheel(e) {
    e.preventDefault();
    const zoom = e.deltaY > 0 ? 0.9 : 1.1;
    const mx = e.offsetX;
    const my = e.offsetY;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    this.offsetX = (this.offsetX - (mx - cx)) * zoom + (mx - cx);
    this.offsetY = (this.offsetY - (my - cy)) * zoom + (my - cy);
    this.scale *= zoom;
    this.scale = Math.max(5, Math.min(300, this.scale));
    this._render();
  }

  _onResize() {
    this._resize();
    this._render();
  }

  _onKeyDown(e) {
    const key = e.key.toLowerCase();
    if (key === "d") {
      this.setMode("draw");
      return;
    }
    if (key === "s") {
      this.setMode("select");
      return;
    }
    if (key === "r") {
      this.setMode("rect");
      return;
    }
    if (key === "x") {
      this.setMode("delete");
      return;
    }
    if (key === "escape") {
      this.drawing = false;
      this.selectedWallId = null;
      this._render();
      return;
    }
    if (key === "delete" || key === "backspace") {
      if (this.selectedWallId !== null) {
        const idx = this.walls.findIndex((w) => w.id === this.selectedWallId);
        if (idx >= 0) {
          this.walls.splice(idx, 1);
          this.selectedWallId = null;
          this._render();
          this.onWallsChange();
        }
      }
      return;
    }
    if (key === "e") this._toggleWallType();
  }

  // ----- Modos -----

  _onDrawDown(sx, sz) {
    if (!this.drawing) {
      this.drawing = true;
      this.startX = sx;
      this.startZ = sz;
      this.mouseX = sx;
      this.mouseZ = sz;
    } else {
      this._finishWall(sx, sz);
    }
  }

  _onDeleteDown(mx, my) {
    const idx = this._hitWall(mx, my);
    if (idx >= 0) {
      this.walls.splice(idx, 1);
      this._render();
      this.onWallsChange();
    }
  }

  _onSelectDown(mx, my) {
    const idx = this._hitWall(mx, my);
    this.selectedWallId = idx >= 0 ? this.walls[idx].id : null;
    this._render();
  }

  _onRectDown(sx, sz) {
    if (!this.drawing) {
      this.drawing = true;
      this.startX = sx;
      this.startZ = sz;
      this.mouseX = sx;
      this.mouseZ = sz;
    } else {
      this._finishRect(sx, sz);
    }
  }

  _finishRect(ex, ez) {
    if (
      Math.abs(this.startX - ex) < 0.01 &&
      Math.abs(this.startZ - ez) < 0.01
    ) {
      this.drawing = false;
      this._render();
      return;
    }
    const x1 = this.startX,
      z1 = this.startZ,
      x2 = ex,
      z2 = ez;
    const walls = [
      { x1: x1, z1: z1, x2: x2, z2: z1, type: "external" },
      { x1: x2, z1: z1, x2: x2, z2: z2, type: "external" },
      { x1: x2, z1: z2, x2: x1, z2: z2, type: "external" },
      { x1: x1, z1: z2, x2: x1, z2: z1, type: "external" },
    ];
    for (const w of walls) {
      if (Math.hypot(w.x2 - w.x1, w.z2 - w.z1) > 0.01) {
        this.walls.push({
          id: this.nextId++,
          x1: w.x1,
          z1: w.z1,
          x2: w.x2,
          z2: w.z2,
          height: this.wallHeight,
          type: w.type,
          label: "",
          cutouts: [],
        });
      }
    }
    this.drawing = false;
    this._render();
    this.onWallsChange();
  }

  // ----- Finalizacao -----

  _finishWall(ex, ez) {
    if (
      Math.abs(this.startX - ex) < 0.01 &&
      Math.abs(this.startZ - ez) < 0.01
    ) {
      this.drawing = false;
      this._render();
      return;
    }
    this.walls.push({
      id: this.nextId++,
      x1: this.startX,
      z1: this.startZ,
      x2: ex,
      z2: ez,
      height: this.wallHeight,
      type: "external",
      label: "",
      cutouts: [],
    });
    this.drawing = false;
    this._render();
    this.onWallsChange();
  }

  _toggleWallType() {
    const wall = this.walls.find((w) => w.id === this.selectedWallId);
    if (wall) {
      wall.type = wall.type === "external" ? "internal" : "external";
      wall.label = "";
      this._render();
      this.onWallsChange();
    }
  }

  // ----- Hit testing -----

  _hitWall(mx, my) {
    const result = this._hitWallWithPos(mx, my);
    return result ? this.walls.indexOf(result.wall) : -1;
  }

  _hitWallWithPos(mx, my) {
    const pos = this._canvasToWorld(mx, my);
    const threshold = 0.5 / this.scale + 0.3;

    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      const dx = w.x2 - w.x1;
      const dz = w.z2 - w.z1;
      const len2 = dx * dx + dz * dz;
      if (len2 === 0) continue;

      let t = ((pos.x - w.x1) * dx + (pos.z - w.z1) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = w.x1 + t * dx;
      const cz = w.z1 + t * dz;
      const dist = Math.hypot(pos.x - cx, pos.z - cz);
      if (dist < threshold) return { wall: w, t, dist };
    }
    return null;
  }

  // ----- Renderizacao -----

  _resize() {
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  _centerView() {
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 40;
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawGrid();
    this._drawWalls();
    this._drawPreview();
    this._drawLabels();
  }

  _drawGrid() {
    const ctx = this.ctx;
    const gridStep = this.snapSize >= 0.5 ? this.snapSize : 0.5;
    const pxStep = gridStep * this.scale;
    if (pxStep < 20) return;

    const ox = ((this.offsetX % pxStep) + pxStep) % pxStep;
    const oy = ((this.offsetY % pxStep) + pxStep) % pxStep;

    ctx.strokeStyle = "#1a1a40";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = ox; x < this.canvas.width; x += pxStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
    }
    for (let y = oy; y < this.canvas.height; y += pxStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas.width, y);
    }
    ctx.stroke();

    const origin = this._worldToCanvas(0, 0);
    ctx.strokeStyle = "#334466";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, this.canvas.height);
    ctx.moveTo(0, origin.y);
    ctx.lineTo(this.canvas.width, origin.y);
    ctx.stroke();
  }

  _drawWalls() {
    for (const wall of this.walls) {
      const p1 = this._worldToCanvas(wall.x1, wall.z1);
      const p2 = this._worldToCanvas(wall.x2, wall.z2);
      const isSelected = wall.id === this.selectedWallId;
      const color = wall.type === "external" ? "#d28250" : "#8c8c8c";

      this.ctx.strokeStyle = isSelected ? "#e94560" : color;
      this.ctx.lineWidth = isSelected ? 4 : 3;
      this.ctx.lineCap = "round";
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();

      if (isSelected) {
        this._drawHandle(p1.x, p1.y);
        this._drawHandle(p2.x, p2.y);
      }
    }
  }

  _drawHandle(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#e94560";
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawPreview() {
    if (!this.drawing) return;
    const p1 = this._worldToCanvas(this.startX, this.startZ);
    const p2 = this._worldToCanvas(this.mouseX, this.mouseZ);

    if (this.mode === "rect") {
      // Draw 4 dashed lines for rectangle preview
      const p3 = this._worldToCanvas(this.startX, this.mouseZ);
      const p4 = this._worldToCanvas(this.mouseX, this.startZ);
      this.ctx.strokeStyle = "#f0a500";
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p4.x, p4.y);
      this.ctx.moveTo(p4.x, p4.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.moveTo(p2.x, p2.y);
      this.ctx.lineTo(p3.x, p3.y);
      this.ctx.moveTo(p3.x, p3.y);
      this.ctx.lineTo(p1.x, p1.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    } else {
      this.ctx.strokeStyle = "#f0a500";
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    const dx = Math.abs(this.mouseX - this.startX);
    const dz = Math.abs(this.mouseZ - this.startZ);
    const dist = Math.hypot(
      this.mouseX - this.startX,
      this.mouseZ - this.startZ,
    );
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    this.ctx.fillStyle = "#f0a500";
    this.ctx.font = "12px monospace";
    this.ctx.textAlign = "center";
    if (this.mode === "rect") {
      this.ctx.fillText(
        dx.toFixed(2) + " x " + dz.toFixed(2) + " m",
        midX,
        midY - 10,
      );
    } else {
      this.ctx.fillText(dist.toFixed(2) + " m", midX, midY - 10);
    }
  }

  _drawLabels() {
    this.ctx.fillStyle = "#aaa";
    this.ctx.font = "11px monospace";

    for (const wall of this.walls) {
      const p1 = this._worldToCanvas(wall.x1, wall.z1);
      const p2 = this._worldToCanvas(wall.x2, wall.z2);
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const pdx = p2.x - p1.x;
      const pdy = p2.y - p1.y;
      const nx = -pdy;
      const ny = pdx;
      const nLen = Math.hypot(nx, ny) || 1;

      const len = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
      const deg =
        (Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1) * 180) / Math.PI;
      const angleStr = (deg < 0 ? deg + 360 : deg).toFixed(0) + "\u00b0";
      const lbl = wall.label || len.toFixed(2) + " m  " + angleStr;

      this.ctx.textAlign = "center";
      this.ctx.fillText(lbl, mx + (nx / nLen) * 20, my + (ny / nLen) * 20);
    }

    // Info bar
    const modeLabels = {
      draw: "Desenhar (D)",
      rect: "Retangulo (R)",
      select: "Selecionar (S)",
      delete: "Apagar (X)",
    };
    this.ctx.fillStyle = "#555";
    this.ctx.font = "11px sans-serif";
    this.ctx.textAlign = "left";
    this.ctx.fillText(
      (modeLabels[this.mode] || this.mode) +
        " | Snap: " +
        (this.snapSize * 100).toFixed(0) +
        "cm" +
        " | Zoom: " +
        ((this.scale / 40) * 100).toFixed(0) +
        "%" +
        " | Altura: " +
        this.wallHeight +
        "m",
      10,
      this.canvas.height - 10,
    );
  }

  exportSVG() {
    const walls = this.walls;
    if (!walls.length) return null;

    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (const w of walls) {
      if (w.x1 < minX) minX = w.x1;
      if (w.x2 < minX) minX = w.x2;
      if (w.z1 < minZ) minZ = w.z1;
      if (w.z2 < minZ) minZ = w.z2;
      if (w.x1 > maxX) maxX = w.x1;
      if (w.x2 > maxX) maxX = w.x2;
      if (w.z1 > maxZ) maxZ = w.z1;
      if (w.z2 > maxZ) maxZ = w.z2;
    }

    const pad = 2;
    const vbX = minX - pad,
      vbZ = minZ - pad;
    const vbW = maxX - minX + pad * 2,
      vbH = maxZ - minZ + pad * 2;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${-vbZ - vbH} ${vbW} ${vbH}" width="800" height="${((800 * vbH) / vbW).toFixed(0)}">`;
    svg += `<rect x="${vbX}" y="${-vbZ - vbH}" width="${vbW}" height="${vbH}" fill="#0a0a1e"/>`;

    // Grid
    svg += `<g stroke="#1a1a40" stroke-width="0.03">`;
    const gridS = 0.5;
    for (let x = Math.floor(vbX / gridS) * gridS; x <= vbX + vbW; x += gridS) {
      svg += `<line x1="${x}" y1="${-vbZ}" x2="${x}" y2="${-vbZ - vbH}"/>`;
    }
    for (let z = Math.floor(vbZ / gridS) * gridS; z <= vbZ + vbH; z += gridS) {
      svg += `<line x1="${vbX}" y1="${-z}" x2="${vbX + vbW}" y2="${-z}"/>`;
    }
    svg += `</g>`;

    // Walls
    for (const wall of walls) {
      const color = wall.type === "external" ? "#d28250" : "#8c8c8c";
      svg += `<line x1="${wall.x1}" y1="${-wall.z1}" x2="${wall.x2}" y2="${-wall.z2}" stroke="${color}" stroke-width="0.15" stroke-linecap="round"/>`;
      const len = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
      const deg =
        (Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1) * 180) / Math.PI;
      const mx = (wall.x1 + wall.x2) / 2,
        mz = -(wall.z1 + wall.z2) / 2;
      const nx = -(wall.z2 - wall.z1),
        nz = wall.x2 - wall.x1;
      const nl = Math.hypot(nx, nz) || 1;
      const ox = (nx / nl) * 0.8,
        oy = (nz / nl) * 0.8;
      svg += `<text x="${mx + ox}" y="${mz + oy}" fill="#aaa" font-size="0.35" text-anchor="middle">${len.toFixed(2)}m ${deg.toFixed(0)}°</text>`;
    }

    // Cutouts
    for (const wall of walls) {
      const wlen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
      for (const c of wall.cutouts) {
        const t1 = c.position / wlen;
        const t2 = (c.position + c.width) / wlen;
        const cx1 = wall.x1 + (wall.x2 - wall.x1) * t1;
        const cz1 = wall.z1 + (wall.z2 - wall.z1) * t1;
        const cx2 = wall.x1 + (wall.x2 - wall.x1) * t2;
        const cz2 = wall.z1 + (wall.z2 - wall.z1) * t2;
        const dx = cx2 - cx1,
          dz = cz2 - cz1;
        const nx = -dz,
          nz = dx;
        const nl = Math.hypot(nx, nz) || 1;
        const s = 0.3;
        const color =
          c.cutType === "door" ? "rgba(0,212,255,0.4)" : "rgba(77,166,255,0.4)";
        const stroke = c.cutType === "door" ? "#00d4ff" : "#4da6ff";
        svg += `<polygon points="${cx1 + (nx / nl) * s},${-cz1 + (nz / nl) * s} ${cx1 - (nx / nl) * s},${-cz1 - (nz / nl) * s} ${cx2 - (nx / nl) * s},${-cz2 - (nz / nl) * s} ${cx2 + (nx / nl) * s},${-cz2 + (nz / nl) * s}" fill="${color}" stroke="${stroke}" stroke-width="0.06"/>`;
        svg += `<text x="${(cx1 + cx2) / 2 + (nx / nl) * 0.5}" y="${-(cz1 + cz2) / 2 + (nz / nl) * 0.5}" fill="${stroke}" font-size="0.25" text-anchor="middle">${c.cutType === "door" ? "P" : "J"}</text>`;
      }
    }

    svg += `</svg>`;
    return svg;
  }
}
