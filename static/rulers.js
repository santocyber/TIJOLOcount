/**
 * Rulers — overlay canvas para réguas X (topo) e Z (esquerda).
 */
export class Rulers {
  constructor(container, floorplan) {
    this.fp = floorplan;
    this.container = container;

    this.canvasTop = document.createElement("canvas");
    this.canvasTop.className = "ruler ruler-top";
    this.ctxTop = this.canvasTop.getContext("2d");

    this.canvasLeft = document.createElement("canvas");
    this.canvasLeft.className = "ruler ruler-left";
    this.ctxLeft = this.canvasLeft.getContext("2d");

    container.appendChild(this.canvasTop);
    container.appendChild(this.canvasLeft);

    this._resize();
    this._render();
    window.addEventListener("resize", () => {
      this._resize();
      this._render();
    });
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const rw = 22;

    this.canvasTop.width = w;
    this.canvasTop.height = rw;
    this.canvasTop.style.width = w + "px";
    this.canvasTop.style.height = rw + "px";
    this.canvasTop.style.top = "0";
    this.canvasTop.style.left = rw + "px";

    this.canvasLeft.width = rw;
    this.canvasLeft.height = h;
    this.canvasLeft.style.width = rw + "px";
    this.canvasLeft.style.height = h + "px";
    this.canvasLeft.style.top = "0";
    this.canvasLeft.style.left = "0";
  }

  render() {
    this._render();
  }

  _render() {
    const fp = this.fp;
    const scale = fp.scale;
    const ox = fp.offsetX;
    const oy = fp.offsetY;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const rw = 22;

    // Ruler top (X axis)
    const ctxT = this.ctxTop;
    ctxT.clearRect(0, 0, this.canvasTop.width, rw);
    ctxT.fillStyle = "#111128";
    ctxT.fillRect(0, 0, this.canvasTop.width, rw);
    ctxT.strokeStyle = "#1e1e3a";
    ctxT.lineWidth = 1;
    ctxT.strokeRect(0, 0, this.canvasTop.width - 1, rw - 1);

    const gridStep = fp.snapSize >= 0.5 ? fp.snapSize : 0.5;
    let pxStep = gridStep * scale;
    if (pxStep < 30) {
      // Multiplica step ate ficar >= 30px
      let mult = 1;
      while (gridStep * mult * scale < 30) mult *= 2;
      pxStep = gridStep * mult * scale;
    }

    const originX = cw / 2 + ox;
    const startX = ((originX % pxStep) + pxStep) % pxStep;

    ctxT.fillStyle = "#888";
    ctxT.font = "9px monospace";
    ctxT.textAlign = "center";
    ctxT.strokeStyle = "#2a2a4a";
    ctxT.lineWidth = 0.5;

    for (let x = startX; x < cw; x += pxStep) {
      ctxT.beginPath();
      ctxT.moveTo(x, rw - 8);
      ctxT.lineTo(x, rw);
      ctxT.stroke();
      const val = (x - originX) / scale;
      ctxT.fillText(val.toFixed(1), x, rw - 9);
    }

    // Origin tick
    ctxT.strokeStyle = "#e94560";
    ctxT.lineWidth = 1;
    ctxT.beginPath();
    ctxT.moveTo(originX, 0);
    ctxT.lineTo(originX, rw);
    ctxT.stroke();

    // Ruler left (Z axis)
    const ctxL = this.ctxLeft;
    ctxL.clearRect(0, 0, rw, this.canvasLeft.height);
    ctxL.fillStyle = "#111128";
    ctxL.fillRect(0, 0, rw, this.canvasLeft.height);
    ctxL.strokeStyle = "#1e1e3a";
    ctxL.lineWidth = 1;
    ctxL.strokeRect(0, 0, rw - 1, this.canvasLeft.height - 1);

    // Z axis: canvas Y decreasing = world Z increasing
    const originZ = ch / 2 + oy;
    const startZ = ((originZ % pxStep) + pxStep) % pxStep;

    ctxL.fillStyle = "#888";
    ctxL.font = "9px monospace";
    ctxL.textAlign = "right";
    ctxL.strokeStyle = "#2a2a4a";
    ctxL.lineWidth = 0.5;

    for (let y = startZ; y < ch; y += pxStep) {
      ctxL.beginPath();
      ctxL.moveTo(rw - 8, y);
      ctxL.lineTo(rw, y);
      ctxL.stroke();
      const val = -((y - originZ) / scale);
      ctxL.fillText(val.toFixed(1), rw - 10, y + 3);
    }

    // Origin tick
    ctxL.strokeStyle = "#e94560";
    ctxL.lineWidth = 1;
    ctxL.beginPath();
    ctxL.moveTo(0, originZ);
    ctxL.lineTo(rw, originZ);
    ctxL.stroke();
  }
}
