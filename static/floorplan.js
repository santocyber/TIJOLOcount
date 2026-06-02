/**
 * FloorPlan — Canvas 2D para desenho de paredes e recortes.
 */
export class FloorPlan {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onWallsChange = options.onWallsChange || (() => {});

    this.mode = "draw";
    this.halfwallMode = false;
    this.snapSize = options.snapSize || 0.05;
    this.wallHeight = options.wallHeight || 2.8;
    this.scale = 40;
    this.offsetX = 0;
    this.offsetY = 0;

    // Cursor tracking
    this.cursorWorldX = 0;
    this.cursorWorldZ = 0;
    this._lastMouseX = 0;
    this._lastMouseY = 0;

    this.walls = [];
    this.nextId = 1;

    this.referenceLayers = [];
    this.layerPalette = [
      "#d28250", "#4da6ff", "#4caf50", "#9c27b0",
      "#ff9800", "#00bcd4", "#e91e63", "#607d8b",
    ];

    this.endpointSnapEnabled = options.endpointSnapEnabled !== false;
    this.endpointSnapThreshold = options.endpointSnapThreshold || 0.5;
    this.midpointSnapThreshold = options.midpointSnapThreshold || 0.3;
    this.endpointSnapTarget = null;

    this.drawing = false;
    this.startX = 0;
    this.startZ = 0;
    this.mouseX = 0;
    this.mouseZ = 0;

    this.selectedWallIds = new Set();

    this.dragging = false;
    this.dragEndpoint = null;
    this.dragWall = null;
    this.dragStartMX = 0;
    this.dragStartMZ = 0;
    this._dragWalls = null;
    this._dragOffsets = null;

    this._undoHistory = [];
    this._undoMaxDepth = 50;
    this._shiftKey = false;

    this.selectedCutoutId = null;
    this._nextCutoutId = 1;
    this._dragCutout = false;
    this._dragCutoutWall = null;
    this._dragCutoutData = null;

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

  setHalfwallMode(active) {
    this.halfwallMode = active;
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
    let maxCid = 0;
    this.walls = (wallsData || []).map((w, i) => ({
      id: this.nextId++,
      x1: w.x1,
      z1: w.z1,
      x2: w.x2,
      z2: w.z2,
      height: w.height || this.wallHeight,
      type: w.type || "external",
      label: w.label || "",
      cutouts: (w.cutouts || []).map((c) => {
        const cid = c.cutoutId || 0;
        if (cid > maxCid) maxCid = cid;
        return {
          cutoutId: cid || this._nextCutoutId++,
          cutType: c.cut_type || c.cutType || "door",
          width: c.width,
          height: c.height,
          position: c.position,
          elevation: c.elevation || 0,
        };
      }),
    }));
    this._nextCutoutId = Math.max(this._nextCutoutId, maxCid + 1);
    this.selectedWallIds.clear();
    this.selectedCutoutId = null;
    this._undoHistory = [];
    this.drawing = false;
    this._render();
  }

  clear() {
    this._pushUndo();
    this.walls = [];
    this.selectedWallIds.clear();
    this.drawing = false;
    this._render();
    this.onWallsChange();
  }

  mirror() {
    if (this.walls.length === 0) return;
    this._pushUndo();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const w of this.walls) {
      if (w.x1 < minX) minX = w.x1; if (w.x1 > maxX) maxX = w.x1;
      if (w.x2 < minX) minX = w.x2; if (w.x2 > maxX) maxX = w.x2;
      if (w.z1 < minZ) minZ = w.z1; if (w.z1 > maxZ) maxZ = w.z1;
      if (w.z2 < minZ) minZ = w.z2; if (w.z2 > maxZ) maxZ = w.z2;
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    for (const w of this.walls) {
      w.x1 = 2 * cx - w.x1;
      w.x2 = 2 * cx - w.x2;
      w.z1 = 2 * cz - w.z1;
      w.z2 = 2 * cz - w.z2;
    }
    this.selectedWallIds.clear();
    this.selectedCutoutId = null;
    this._render();
    this.onWallsChange();
  }

  setReferenceLayers(allLayers, currentIdx) {
    this.referenceLayers = (allLayers || [])
      .map((l, i) => ({ ...l, _idx: i }))
      .filter((l) => l._idx !== currentIdx);
    this._render();
  }

  _pushUndo() {
    const snapshot = {
      walls: this.walls.map((w) => ({
        id: w.id,
        x1: w.x1,
        z1: w.z1,
        x2: w.x2,
        z2: w.z2,
        height: w.height,
        type: w.type,
        label: w.label,
        cutouts: w.cutouts.map((c) => ({
          cutType: c.cutType,
          cutoutId: c.cutoutId || (this._nextCutoutId = this._nextCutoutId + 1) - 1,
          width: c.width,
          height: c.height,
          position: c.position,
          elevation: c.elevation,
        })),
      })),
      selectedWallIds: [...this.selectedWallIds],
    };
    this._undoHistory.push(snapshot);
    if (this._undoHistory.length > this._undoMaxDepth) {
      this._undoHistory.shift();
    }
  }

  _undo() {
    if (this._undoHistory.length === 0) return;
    const snapshot = this._undoHistory.pop();
    this.walls = snapshot.walls;
    this.nextId =
      Math.max(1, ...snapshot.walls.map((w) => w.id || 0), 0) + 1;
    this.selectedWallIds = new Set(snapshot.selectedWallIds);
    this.selectedCutoutId = null;
    this._nextCutoutId = Math.max(
      1,
      ...snapshot.walls.flatMap((w) => w.cutouts.map((c) => c.cutoutId || 0)),
      0,
    ) + 1;
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

  setEndpointSnapEnabled(enabled) {
    this.endpointSnapEnabled = enabled;
    this.endpointSnapTarget = null;
    this._render();
  }

  _findSnapTarget(wx, wz, excludeIds = new Set()) {
    const allWalls = [
      ...this.walls,
      ...this.referenceLayers.flatMap((l) => l.walls || []),
    ].filter((w) => !excludeIds.has(w.id));
    let best = null;
    let bestDist = Infinity;

    for (const w of allWalls) {
      let d = Math.hypot(wx - w.x1, wz - w.z1);
      if (d < bestDist && d < this.endpointSnapThreshold) {
        bestDist = d;
        best = { x: w.x1, z: w.z1, type: "endpoint" };
      }
      d = Math.hypot(wx - w.x2, wz - w.z2);
      if (d < bestDist && d < this.endpointSnapThreshold) {
        bestDist = d;
        best = { x: w.x2, z: w.z2, type: "endpoint" };
      }
      if (this.midpointSnapThreshold > 0) {
        const mx = (w.x1 + w.x2) / 2;
        const mz = (w.z1 + w.z2) / 2;
        d = Math.hypot(wx - mx, wz - mz);
        if (d < bestDist && d < this.midpointSnapThreshold) {
          bestDist = d;
          best = { x: mx, z: mz, type: "midpoint" };
        }
      }
    }
    return best;
  }

  _applyAllSnaps(wx, wz, excludeIds = new Set()) {
    const sx = this._snap(wx);
    const sz = this._snap(wz);

    if (this.endpointSnapEnabled) {
      const target = this._findSnapTarget(wx, wz, excludeIds);
      if (target) {
        this.endpointSnapTarget = target;
        return { x: target.x, z: target.z };
      }
    }

    this.endpointSnapTarget = null;
    return { x: sx, z: sz };
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

    this._shiftKey = e.shiftKey;

    const cPos = this._canvasToWorld(e.offsetX, e.offsetY);
    const snapped = this._applyAllSnaps(cPos.x, cPos.z);
    const sx = snapped.x;
    const sz = snapped.z;

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

    if (this._dragCutout && this._dragCutoutWall && this._dragCutoutData) {
      const cPos = this._canvasToWorld(e.offsetX, e.offsetY);
      const snapped = this._applyAllSnaps(cPos.x, cPos.z);
      const wall = this._dragCutoutWall;
      const dx = wall.x2 - wall.x1;
      const dz = wall.z2 - wall.z1;
      const wlen = Math.hypot(dx, dz);
      if (wlen > 0.001) {
        const t = ((snapped.x - wall.x1) * dx + (snapped.z - wall.z1) * dz) / (wlen * wlen);
        this._dragCutoutData.position = Math.max(0, Math.min(wlen - this._dragCutoutData.width, t * wlen));
      }
      this._render();
      return;
    }

    if (this.dragging && this.dragWall) {
      const excludeIds = this._dragWalls
        ? new Set(this._dragWalls.map((w) => w.id))
        : new Set([this.dragWall.id]);

      const cPos = this._canvasToWorld(e.offsetX, e.offsetY);
      const snapped = this._applyAllSnaps(cPos.x, cPos.z, excludeIds);

      if (this.dragEndpoint === 0) {
        const dx = snapped.x - this.dragStartMX;
        const dz = snapped.z - this.dragStartMZ;

        if (this._dragWalls && this._dragWalls.length > 1) {
          for (let i = 0; i < this._dragWalls.length; i++) {
            this._dragWalls[i].x1 = snapped.x + this._dragOffsets[i].x1;
            this._dragWalls[i].z1 = snapped.z + this._dragOffsets[i].z1;
            this._dragWalls[i].x2 = snapped.x + this._dragOffsets[i].x2;
            this._dragWalls[i].z2 = snapped.z + this._dragOffsets[i].z2;
          }
        } else {
          this.dragWall.x1 = this._dragOrigX1 + dx;
          this.dragWall.z1 = this._dragOrigZ1 + dz;
          this.dragWall.x2 = this._dragOrigX2 + dx;
          this.dragWall.z2 = this._dragOrigZ2 + dz;

          if (this.endpointSnapEnabled) {
            this._alignDragEndpoints(excludeIds, snapped.x, snapped.z);
          }
        }
      } else if (this.dragEndpoint === 1) {
        this.dragWall.x1 = snapped.x;
        this.dragWall.z1 = snapped.z;
      } else if (this.dragEndpoint === 2) {
        this.dragWall.x2 = snapped.x;
        this.dragWall.z2 = snapped.z;
      }

      this._render();
      return;
    }

    const cPos = this._canvasToWorld(e.offsetX, e.offsetY);
    const snapped = this._applyAllSnaps(cPos.x, cPos.z);
    this._lastMouseX = e.offsetX;
    this._lastMouseY = e.offsetY;
    const sx = snapped.x;
    const sz = snapped.z;

    this.cursorWorldX = snapped.x;
    this.cursorWorldZ = snapped.z;

    if (this.drawing) {
      this.mouseX = sx;
      this.mouseZ = sz;
      this._render();
    }

    let cursor = "default";
    if (this.mode === "draw" || this.mode === "rect") {
      cursor = "crosshair";
    } else if (this.mode === "delete") {
      cursor = "pointer";
    } else if (this.mode === "select") {
      if (this.dragging || this._dragCutout) {
        cursor = "grabbing";
      } else if (this._hitCutout(e.offsetX, e.offsetY)) {
        cursor = "pointer";
      } else if (this.selectedWallIds.size === 1) {
        let foundHandle = false;

        for (const wall of this.walls) {
          if (!this.selectedWallIds.has(wall.id)) continue;

          const handle = this._hitHandle(e.offsetX, e.offsetY, wall);
          if (handle === 1 || handle === 2) {
            cursor = "grab";
            foundHandle = true;
            break;
          }
        }

        if (!foundHandle) {
          const selHit = this._hitWallWithPos(e.offsetX, e.offsetY);
          cursor =
            selHit && this.selectedWallIds.has(selHit.wall.id)
              ? "move"
              : "default";
        }
      } else if (this.selectedWallIds.size > 1) {
        const selHit = this._hitWallWithPos(e.offsetX, e.offsetY);
        cursor =
          selHit && this.selectedWallIds.has(selHit.wall.id)
            ? "move"
            : "default";
      }
    }

    this.canvas.style.cursor = cursor;
  }

  _onMouseUp() {
    if (this._dragCutout) {
      this._dragCutout = false;
      this._dragCutoutWall = null;
      this._dragCutoutData = null;
      this._render();
      this.onWallsChange();
      return;
    }

    if (this.dragging) {
      this.dragging = false;
      this.dragWall = null;
      this.dragEndpoint = null;
      this._dragWalls = null;
      this._dragOffsets = null;

      const didSplit = this._splitWallsAtIntersections(false);

      if (!didSplit) {
        this._render();
        this.onWallsChange();
      }

      return;
    }

    this.panning = false;
  }

  _onMouseLeave() {
    this.panning = false;
  }

  _onWheel(e) {
    e.preventDefault();
    const zoom = e.deltaY > 0 ? 0.9 : 1.1;
    this._zoomAt(zoom, e.offsetX, e.offsetY);
  }

  zoomIn() {
    this._zoomAt(1.15, this._lastMouseX, this._lastMouseY);
  }

  zoomOut() {
    this._zoomAt(1 / 1.15, this._lastMouseX, this._lastMouseY);
  }

  _zoomAt(zoom, mx, my) {
    const newScale = this.scale * zoom;
    if (newScale < 5 || newScale > 500) return;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    this.offsetX = (this.offsetX - (mx - cx)) * zoom + (mx - cx);
    this.offsetY = (this.offsetY - (my - cy)) * zoom + (my - cy);
    this.scale = newScale;
    this._render();
  }

  _onResize() {
    this._resize();
    this._render();
  }

  _onKeyDown(e) {
    if (e.ctrlKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (this.drawing) {
        this.drawing = false;
        this._render();
        return;
      }
      this._undo();
      return;
    }
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
      if (this.dragging) {
        this.dragging = false;
        this.dragWall = null;
        this.dragEndpoint = null;
        this._dragWalls = null;
        this._dragOffsets = null;
        this._render();
        this.onWallsChange();
        return;
      }
      this._dragCutout = false;
      this._dragCutoutWall = null;
      this._dragCutoutData = null;
      this.selectedCutoutId = null;
      this.drawing = false;
      this.selectedWallIds.clear();
      this._render();
      return;
    }
    if (key === "delete" || key === "backspace") {
      if (this.selectedCutoutId !== null) {
        this._pushUndo();
        for (const wall of this.walls) {
          const idx = wall.cutouts.findIndex(
            (c) => c.cutoutId === this.selectedCutoutId,
          );
          if (idx >= 0) {
            wall.cutouts.splice(idx, 1);
            break;
          }
        }
        this.selectedCutoutId = null;
        this._render();
        this.onWallsChange();
        return;
      }
      if (this.selectedWallIds.size > 0) {
        this._pushUndo();
        this.walls = this.walls.filter(
          (w) => !this.selectedWallIds.has(w.id),
        );
        this.selectedWallIds.clear();
        this._render();
        this.onWallsChange();
      }
      return;
    }
    if (key === "e") this._toggleWallType();
    if (key === "h") {
      this.halfwallMode = !this.halfwallMode;
      const btn = document.getElementById("btn-halfwall");
      if (btn) btn.classList.toggle("active", this.halfwallMode);
      this._render();
      return;
    }
    if (key === "m") {
      this.endpointSnapEnabled = !this.endpointSnapEnabled;
      const toggle = document.getElementById("endpoint-snap-toggle");
      if (toggle) toggle.checked = this.endpointSnapEnabled;
      this.endpointSnapTarget = null;
      this._render();
      return;
    }
  }

  // ----- Modos -----

  _hitCutout(mx, my) {
    const pos = this._canvasToWorld(mx, my);
    for (const wall of this.walls) {
      const wlen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
      if (!wlen) continue;
      for (const c of wall.cutouts) {
        const t1 = c.position / wlen;
        const t2 = (c.position + c.width) / wlen;
        const cx1 = wall.x1 + (wall.x2 - wall.x1) * t1;
        const cz1 = wall.z1 + (wall.z2 - wall.z1) * t1;
        const cx2 = wall.x1 + (wall.x2 - wall.x1) * t2;
        const cz2 = wall.z1 + (wall.z2 - wall.z1) * t2;
        const dx = cx2 - cx1;
        const dz = cz2 - cz1;
        const nx = -dz;
        const nz = dx;
        const nl = Math.hypot(nx, nz) || 1;
        const along = ((pos.x - cx1) * dx + (pos.z - cz1) * dz) / (wlen * wlen);
        const across = ((pos.x - cx1) * nx + (pos.z - cz1) * nz) / (nl * nl);
        if (along >= 0 && along <= 1 && Math.abs(across) <= 0.35 / nl) {
          return { wall, cutout: c };
        }
      }
    }
    return null;
  }

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
      this._pushUndo();
      this.walls.splice(idx, 1);
      this._render();
      this.onWallsChange();
    }
  }

  _onSelectDown(mx, my) {
    const shift = this._shiftKey;

    if (!shift && this.selectedWallIds.size === 1) {
      for (const wall of this.walls) {
        if (!this.selectedWallIds.has(wall.id)) continue;

        const handle = this._hitHandle(mx, my, wall);

        if (handle === 1 || handle === 2) {
          this._pushUndo();

          this.dragging = true;
          this.dragWall = wall;
          this.dragEndpoint = handle;

          this._dragWalls = null;
          this._dragOffsets = null;

          this._dragOrigX1 = wall.x1;
          this._dragOrigZ1 = wall.z1;
          this._dragOrigX2 = wall.x2;
          this._dragOrigZ2 = wall.z2;

          return;
        }
      }
    }

    if (!shift && this.selectedWallIds.size > 0) {
      const hit = this._hitWallWithPos(mx, my);

      if (hit && this.selectedWallIds.has(hit.wall.id)) {
        this._pushUndo();

        this.dragging = true;
        this.dragWall = hit.wall;
        this.dragEndpoint = 0;

        const mw = this._canvasToWorld(mx, my);
        this.dragStartMX = mw.x;
        this.dragStartMZ = mw.z;

        this._dragOrigX1 = hit.wall.x1;
        this._dragOrigZ1 = hit.wall.z1;
        this._dragOrigX2 = hit.wall.x2;
        this._dragOrigZ2 = hit.wall.z2;

        this._dragWalls = this.walls.filter((w) =>
          this.selectedWallIds.has(w.id),
        );

        this._dragOffsets = this._dragWalls.map((w) => ({
          x1: w.x1 - mw.x,
          z1: w.z1 - mw.z,
          x2: w.x2 - mw.x,
          z2: w.z2 - mw.z,
        }));

        return;
      }
    }

    const cutHit = this._hitCutout(mx, my);
    if (cutHit && !shift) {
      this.selectedWallIds.clear();
      this.selectedCutoutId = cutHit.cutout.cutoutId;
      this._dragCutout = true;
      this._dragCutoutWall = cutHit.wall;
      this._dragCutoutData = cutHit.cutout;
      this._render();
      return;
    }

    if (this.selectedCutoutId !== null) {
      this.selectedCutoutId = null;
    }

    const idx = this._hitWall(mx, my);

    if (shift) {
      if (idx >= 0) {
        const wallId = this.walls[idx].id;

        if (this.selectedWallIds.has(wallId)) {
          this.selectedWallIds.delete(wallId);
        } else {
          this.selectedWallIds.add(wallId);
        }
      }
    } else {
      this.selectedWallIds.clear();

      if (idx >= 0) {
        this.selectedWallIds.add(this.walls[idx].id);
      }
    }

    this._render();
  }

  _alignDragEndpoints(excludeIds, mx, mz) {
    if (!this.dragWall || this.dragEndpoint !== 0) return;
    const targets = [];
    for (const w of this.walls) {
      if (excludeIds.has(w.id)) continue;
      targets.push({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 });
    }
    for (const rl of this.referenceLayers) {
      for (const w of rl.walls || []) {
        targets.push({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 });
      }
    }
    const thresh = this.endpointSnapThreshold;
    let best = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const d = Math.hypot(mx - t.x, mz - t.z);
      if (d < bestDist && d < thresh) {
        bestDist = d;
        best = t;
      }
    }
    if (!best) return;
    const d1 = Math.hypot(this.dragWall.x1 - best.x, this.dragWall.z1 - best.z);
    const d2 = Math.hypot(this.dragWall.x2 - best.x, this.dragWall.z2 - best.z);
    const [ex, ez] =
      d1 <= d2 ? [this.dragWall.x1, this.dragWall.z1] : [this.dragWall.x2, this.dragWall.z2];
    const sx = best.x - ex;
    const sz = best.z - ez;
    this.dragWall.x1 += sx; this.dragWall.z1 += sz;
    this.dragWall.x2 += sx; this.dragWall.z2 += sz;
    this.dragWall.x1 = this._snap(this.dragWall.x1);
    this.dragWall.z1 = this._snap(this.dragWall.z1);
    this.dragWall.x2 = this._snap(this.dragWall.x2);
    this.dragWall.z2 = this._snap(this.dragWall.z2);
  }

  _getIntersection(a, b) {
    const dax = a.x2 - a.x1;
    const daz = a.z2 - a.z1;
    const dbx = b.x2 - b.x1;
    const dbz = b.z2 - b.z1;
    const cross = dax * dbz - daz * dbx;
    if (Math.abs(cross) < 1e-8) return null;
    const dx = b.x1 - a.x1;
    const dz = b.z1 - a.z1;
    const t = (dx * dbz - dz * dbx) / cross;
    const u = (dx * daz - dz * dax) / cross;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { t, u, x: a.x1 + t * dax, z: a.z1 + t * daz };
  }

  _splitWallsAtIntersections(recordUndo = true) {
    if (this.walls.length < 2) return false;

    const eps = 0.001;
    const splitMap = new Map();

    const addSplitPoint = (wall, point) => {
      const dx = wall.x2 - wall.x1;
      const dz = wall.z2 - wall.z1;
      const len2 = dx * dx + dz * dz;

      if (len2 < eps * eps) return;

      const t = ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / len2;

      if (t <= eps || t >= 1 - eps) return;

      const x = wall.x1 + t * dx;
      const z = wall.z1 + t * dz;

      if (!splitMap.has(wall.id)) splitMap.set(wall.id, []);

      const exists = splitMap
        .get(wall.id)
        .some((p) => Math.hypot(p.x - x, p.z - z) < eps);

      if (!exists) {
        splitMap.get(wall.id).push({ x, z });
      }
    };

    const addColinearSplits = (a, b) => {
      const adx = a.x2 - a.x1;
      const adz = a.z2 - a.z1;
      const bdx = b.x2 - b.x1;
      const bdz = b.z2 - b.z1;

      const crossDir = adx * bdz - adz * bdx;
      if (Math.abs(crossDir) > eps) return;

      const crossStart = adx * (b.z1 - a.z1) - adz * (b.x1 - a.x1);
      if (Math.abs(crossStart) > eps) return;

      addSplitPoint(a, { x: b.x1, z: b.z1 });
      addSplitPoint(a, { x: b.x2, z: b.z2 });
      addSplitPoint(b, { x: a.x1, z: a.z1 });
      addSplitPoint(b, { x: a.x2, z: a.z2 });
    };

    for (let i = 0; i < this.walls.length; i++) {
      for (let j = i + 1; j < this.walls.length; j++) {
        const a = this.walls[i];
        const b = this.walls[j];
        const p = this._getIntersection(a, b);

        if (p) {
          addSplitPoint(a, { x: p.x, z: p.z });
          addSplitPoint(b, { x: p.x, z: p.z });
        } else {
          addColinearSplits(a, b);
        }
      }
    }

    if (splitMap.size === 0) return false;

    if (recordUndo) this._pushUndo();

    const toRemove = new Set();
    const toAdd = [];

    for (const [wallId, pts] of splitMap) {
      const wall = this.walls.find((w) => w.id === wallId);
      if (!wall) continue;

      const dx = wall.x2 - wall.x1;
      const dz = wall.z2 - wall.z1;
      const len = Math.hypot(dx, dz);

      if (len < eps) continue;

      const ts = pts
        .map((p) => ((p.x - wall.x1) * dx + (p.z - wall.z1) * dz) / (len * len))
        .filter((t) => t > eps && t < 1 - eps)
        .sort((a, b) => a - b);

      const cuts = [0];

      for (const t of ts) {
        if (t - cuts[cuts.length - 1] > eps) {
          cuts.push(t);
        }
      }

      if (1 - cuts[cuts.length - 1] > eps) {
        cuts.push(1);
      }

      if (cuts.length <= 2) continue;

      toRemove.add(wallId);

      for (let k = 0; k < cuts.length - 1; k++) {
        const t1 = cuts[k];
        const t2 = cuts[k + 1];

        const sx1 = wall.x1 + t1 * dx;
        const sz1 = wall.z1 + t1 * dz;
        const sx2 = wall.x1 + t2 * dx;
        const sz2 = wall.z1 + t2 * dz;

        const partLen = Math.hypot(sx2 - sx1, sz2 - sz1);
        if (partLen < 0.05) continue;

        const segStart = t1 * len;
        const segEnd = t2 * len;

        const segCuts = (wall.cutouts || [])
          .filter((c) => {
            const cutStart = c.position;
            const cutEnd = c.position + c.width;
            return cutStart >= segStart - eps && cutEnd <= segEnd + eps;
          })
          .map((c) => ({
            cutType: c.cutType,
            cutoutId: c.cutoutId || this._nextCutoutId++,
            width: c.width,
            height: c.height,
            position: c.position - segStart,
            elevation: c.elevation,
          }));

        toAdd.push({
          x1: sx1,
          z1: sz1,
          x2: sx2,
          z2: sz2,
          height: wall.height,
          type: wall.type,
          label: wall.label || "",
          cutouts: segCuts,
        });
      }
    }

    if (toAdd.length === 0) return false;

    this.walls = this.walls.filter((w) => !toRemove.has(w.id));

    for (const w of toAdd) {
      this.walls.push({
        id: this.nextId++,
        x1: w.x1,
        z1: w.z1,
        x2: w.x2,
        z2: w.z2,
        height: w.height,
        type: w.type,
        label: w.label,
        cutouts: w.cutouts,
      });
    }

    this.selectedWallIds.clear();
    this.selectedCutoutId = null;
    this._render();
    this.onWallsChange();

    return true;
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

    const x1 = this.startX;
    const z1 = this.startZ;
    const x2 = ex;
    const z2 = ez;
    const h = this.halfwallMode ? this.wallHeight / 2 : this.wallHeight;
    const t = this.halfwallMode ? "half_wall" : "external";

    this._pushUndo();

    const walls = [
      { x1: x1, z1: z1, x2: x2, z2: z1, type: t },
      { x1: x2, z1: z1, x2: x2, z2: z2, type: t },
      { x1: x2, z1: z2, x2: x1, z2: z2, type: t },
      { x1: x1, z1: z2, x2: x1, z2: z1, type: t },
    ];

    for (const w of walls) {
      if (Math.hypot(w.x2 - w.x1, w.z2 - w.z1) > 0.01) {
        this.walls.push({
          id: this.nextId++,
          x1: w.x1,
          z1: w.z1,
          x2: w.x2,
          z2: w.z2,
          height: h,
          type: w.type,
          label: "",
          cutouts: [],
        });
      }
    }

    this.drawing = false;

    const didSplit = this._splitWallsAtIntersections(false);

    if (!didSplit) {
      this._render();
      this.onWallsChange();
    }
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

    const h = this.halfwallMode ? this.wallHeight / 2 : this.wallHeight;
    const t = this.halfwallMode ? "half_wall" : "external";

    this._pushUndo();

    this.walls.push({
      id: this.nextId++,
      x1: this.startX,
      z1: this.startZ,
      x2: ex,
      z2: ez,
      height: h,
      type: t,
      label: "",
      cutouts: [],
    });

    this.drawing = false;

    const didSplit = this._splitWallsAtIntersections(false);

    if (!didSplit) {
      this._render();
      this.onWallsChange();
    }
  }

  _toggleWallType() {
    if (this.selectedWallIds.size === 0) return;
    this._pushUndo();
    const cycle = ["external", "internal", "half_wall"];
    for (const wall of this.walls) {
      if (!this.selectedWallIds.has(wall.id)) continue;
      const idx = cycle.indexOf(wall.type);
      wall.type = cycle[(idx + 1) % cycle.length];
      if (wall.type === "half_wall") {
        wall.height = this.wallHeight / 2;
      } else if (wall.height < this.wallHeight) {
        wall.height = this.wallHeight;
      }
      wall.label = "";
    }
    this._render();
    this.onWallsChange();
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

  _hitHandle(mx, my, wall) {
    const radius = Math.max(6, Math.min(12, this.scale * 0.25));
    for (const [idx, wx, wz] of [
      [1, wall.x1, wall.z1],
      [2, wall.x2, wall.z2],
    ]) {
      const p = this._worldToCanvas(wx, wz);
      if (Math.hypot(mx - p.x, my - p.y) < radius) return idx;
    }
    return 0;
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
    this._drawReferenceLayers();
    this._drawWalls();
    this._drawPreview();
    this._drawCutouts();
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
      const isSelected = this.selectedWallIds.has(wall.id);
      const isHalf = wall.type === "half_wall";

      let color, lineW;
      if (isHalf) {
        color = "#4da6ff";
        lineW = isSelected ? 3 : 2;
      } else {
        color = wall.type === "external" ? "#d28250" : "#8c8c8c";
        lineW = isSelected ? 4 : 3;
      }

      this.ctx.strokeStyle = isSelected ? "#e94560" : color;
      this.ctx.lineWidth = lineW;
      this.ctx.lineCap = "round";
      if (isHalf) this.ctx.setLineDash([8, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

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

  _drawReferenceLayers() {
    if (!this.referenceLayers.length) return;
    const ctx = this.ctx;
    for (const layer of this.referenceLayers) {
      if (!layer.walls || !layer.walls.length) continue;
      const color = this.layerPalette[layer._idx % this.layerPalette.length];
      for (const wall of layer.walls) {
        const p1 = this._worldToCanvas(wall.x1, wall.z1);
        const p2 = this._worldToCanvas(wall.x2, wall.z2);
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1.0;
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

    if (this.endpointSnapTarget) {
      const pt = this._worldToCanvas(
        this.endpointSnapTarget.x,
        this.endpointSnapTarget.z,
      );
      const color =
        this.endpointSnapTarget.type === "midpoint" ? "#ff6b6b" : "#ffd700";
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = "#fff";
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();

      this.ctx.strokeStyle = color;
      this.ctx.globalAlpha = 0.4;
      this.ctx.beginPath();
      this.ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1.0;
    }
  }

  _drawCutouts() {
    const ctx = this.ctx;
    for (const wall of this.walls) {
      if (!wall.cutouts || !wall.cutouts.length) continue;
      const wlen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
      for (const c of wall.cutouts) {
        const t1 = c.position / wlen;
        const t2 = (c.position + c.width) / wlen;
        const cx1 = wall.x1 + (wall.x2 - wall.x1) * t1;
        const cz1 = wall.z1 + (wall.z2 - wall.z1) * t1;
        const cx2 = wall.x1 + (wall.x2 - wall.x1) * t2;
        const cz2 = wall.z1 + (wall.z2 - wall.z1) * t2;
        const dx = cx2 - cx1;
        const dz = cz2 - cz1;
        const nx = -dz;
        const nz = dx;
        const nl = Math.hypot(nx, nz) || 1;
        const s = 0.3;

        const p1 = this._worldToCanvas(cx1 + (nx / nl) * s, cz1 + (nz / nl) * s);
        const p2 = this._worldToCanvas(cx1 - (nx / nl) * s, cz1 - (nz / nl) * s);
        const p3 = this._worldToCanvas(cx2 - (nx / nl) * s, cz2 - (nz / nl) * s);
        const p4 = this._worldToCanvas(cx2 + (nx / nl) * s, cz2 + (nz / nl) * s);

        const isDoor = c.cutType === "door";
        const isSel = c.cutoutId === this.selectedCutoutId;
        const fillColor = isSel
          ? isDoor ? "rgba(0,212,255,0.7)" : "rgba(77,166,255,0.7)"
          : isDoor ? "rgba(0,212,255,0.4)" : "rgba(77,166,255,0.4)";
        const strokeColor = isSel ? "#ffffff" : isDoor ? "#00d4ff" : "#4da6ff";

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const midX = (p1.x + p3.x) / 2;
        const midY = (p1.y + p3.y) / 2;
        ctx.fillStyle = strokeColor;
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isDoor ? "P" : "J", midX, midY);

        if (isSel) {
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(midX, midY, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  _drawLabels() {
    this.ctx.fillStyle = "#aaa";
    this.ctx.font = "13px monospace";

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
    const halfNote = this.halfwallMode ? " | MEIA PAREDE" : "";
    const selNote =
      this.selectedWallIds.size > 1
        ? " | " + this.selectedWallIds.size + " sel"
        : "";
    this.ctx.fillText(
      (modeLabels[this.mode] || this.mode) + halfNote + selNote +
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
      const color = wall.type === "external" ? "#d28250"
        : wall.type === "half_wall" ? "#4da6ff" : "#8c8c8c";
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
