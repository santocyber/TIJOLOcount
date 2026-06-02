import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { FloorPlan } from "./floorplan.js";
import { BrickAnimator } from "./animation.js";
import { Cutout3D } from "./cutout3d.js";
import { Rulers } from "./rulers.js";

// TDZ-safe declarations
let generateTimer = null;
let lastBrickPositions = [];
let lastBrickDims = null;
let currentModel = null;
let modalAnimator = null;
let mirrorMode = false;

// ----- Three.js -----
const viewerEl = document.getElementById("viewer-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111122);

const camera = new THREE.PerspectiveCamera(
  50,
  (viewerEl.clientWidth || 800) / Math.max(viewerEl.clientHeight || 600, 1),
  0.1,
  200,
);
camera.position.set(10, 8, -14);
camera.lookAt(0, 1.5, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewerEl.clientWidth || 800, viewerEl.clientHeight || 600);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
viewerEl.appendChild(renderer.domElement);

function triggerResize() {
  const w = viewerEl.clientWidth || 800,
    h = viewerEl.clientHeight || 600;
  if (w > 0 && h > 0) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
}
triggerResize();

// rAF delayed — garantia apos layout
requestAnimationFrame(() => {
  const w = viewerEl.clientWidth,
    h = viewerEl.clientHeight;
  if (w > 0 && h > 0) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
});

// ResizeObserver — reage a mudancas de layout
if (window.ResizeObserver) {
  new ResizeObserver(() => {
    const w = viewerEl.clientWidth,
      h = viewerEl.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  }).observe(viewerEl);
}

window.addEventListener("resize", () => {
  const w = viewerEl.clientWidth,
    h = viewerEl.clientHeight;
  if (w > 0) {
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
});

let grid = new THREE.GridHelper(16, 16, 0x444466, 0x222244);
grid.position.y = 0.005;
scene.add(grid);

scene.add(new THREE.HemisphereLight(0x8899cc, 0x334466, 0.8));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(10, 15, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0xffddaa, 0.6);
fillLight.position.set(-8, 5, -8);
scene.add(fillLight);

scene.add(new THREE.AxesHelper(2));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 100;
controls.maxPolarAngle = Math.PI / 2.1;
controls.update();

function frameCameraOnModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const md = Math.max(s.x, s.y, s.z, 3);
  controls.target.copy(c);
  camera.position.set(c.x + md * 0.8, c.y + md * 0.6, c.z - md * 1.1);
  camera.far = md * 5;
  camera.updateProjectionMatrix();
  controls.update();

  // Reposiciona grid sob o modelo
  const gs = Math.ceil((Math.max(s.x, s.z, 8) * 1.5) / 2) * 2;
  scene.remove(grid);
  grid = new THREE.GridHelper(gs, Math.max(16, gs), 0x444466, 0x222244);
  grid.position.set(c.x, 0.005, c.z);
  scene.add(grid);
}

function loadGLB(url, keepCamera = false) {
  const savedTarget = keepCamera ? controls.target.clone() : null;
  const savedPos = keepCamera ? camera.position.clone() : null;

  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }
  new GLTFLoader().load(url, (gltf) => {
    currentModel = gltf.scene;
    scene.add(currentModel);
    if (keepCamera && savedTarget) {
      controls.target.copy(savedTarget);
      camera.position.copy(savedPos);
      controls.update();
      return;
    }
    frameCameraOnModel(currentModel);
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ----- Cutout3D -----
const cutout3d = new Cutout3D(viewerEl, scene, camera, renderer, controls);
cutout3d.onCutoutChange = (updatedLayers) => {
  layers = updatedLayers;
  const cl = layers[currentLayerIdx];
  if (cl) {
    floorplan.setWalls(cl.walls);
    floorplan.setReferenceLayers(layers, currentLayerIdx);
  }
  scheduleGenerate();
};

viewerEl.addEventListener("mousemove", (e) => cutout3d._onMouseMove(e));
viewerEl.addEventListener("click", (e) => {
  // Prevent click when dragging OrbitControls
  cutout3d._onClick(e);
});

// ----- Layers -----
const LS_KEY = "tijolocount_project";
let layers = [];
let currentLayerIdx = 0;

function defaultLayer(name, elevation, height) {
  return { name, elevation, height: height || 2.8, walls: [] };
}

function restoreProject() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.layers && data.layers.length > 0) {
        layers = data.layers;
        if (data.brick_type)
          document.getElementById("brick-type-select").value = data.brick_type;
        if (data.orientation)
          document.getElementById("orientation-select").value =
            data.orientation;
        if (data.mortar_joint)
          document.getElementById("mortar-joint-input").value = (
            data.mortar_joint * 100
          ).toFixed(1);
        if (data.snap_size) {
          document.getElementById("snap-select").value = data.snap_size;
          floorplan.setSnapSize(data.snap_size);
        }
        if (data.endpoint_snap !== undefined) {
          floorplan.setEndpointSnapEnabled(data.endpoint_snap);
          document.getElementById("endpoint-snap-toggle").checked =
            data.endpoint_snap;
        }
        currentLayerIdx = Math.min(data.current_layer || 0, layers.length - 1);
        switchToLayer(currentLayerIdx, false);
        return true;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return false;
}

function autoSave() {
  try {
    saveCurrentWalls();
    const data = {
      version: 1,
      brick_type: document.getElementById("brick-type-select").value,
      orientation: document.getElementById("orientation-select").value,
      mortar_joint:
        parseFloat(
          document.getElementById("mortar-joint-input").value || "1.0",
        ) / 100,
      snap_size: floorplan.snapSize,
      endpoint_snap: floorplan.endpointSnapEnabled,
      current_layer: currentLayerIdx,
      layers: layers,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    /* ignore */
  }
}

function saveCurrentWalls() {
  if (layers[currentLayerIdx]) {
    layers[currentLayerIdx].walls = floorplan.getWalls();
    layers[currentLayerIdx].height = floorplan.wallHeight;
  }
}

function switchToLayer(idx, savePrev) {
  if (savePrev !== false) saveCurrentWalls();
  if (idx < 0 || idx >= layers.length) return;
  currentLayerIdx = idx;
  const l = layers[idx];
  floorplan.setWallHeight(l.height || 2.8);
  document.getElementById("wall-height-input").value = l.height || 2.8;
  floorplan.setWalls(l.walls || []);
  floorplan.setReferenceLayers(layers, currentLayerIdx);
  updateLayerUI();
}

function newLayer() {
  saveCurrentWalls();
  const prev =
    layers.length > 0
      ? layers[layers.length - 1].elevation +
        (layers[layers.length - 1].height || 2.8)
      : 0;
  layers.push(defaultLayer("Andar " + (layers.length + 1), prev, 2.8));
  switchToLayer(layers.length - 1, false);
}

function removeLayer() {
  if (layers.length <= 1) return;
  layers.splice(currentLayerIdx, 1);
  currentLayerIdx = Math.min(currentLayerIdx, layers.length - 1);
  switchToLayer(currentLayerIdx, false);
  scheduleGenerate();
}

function updateLayerUI() {
  const sel = document.getElementById("layer-select");
  sel.innerHTML = "";
  layers.forEach((l, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = l.name + " (elev: " + l.elevation.toFixed(2) + "m)";
    if (i === currentLayerIdx) opt.selected = true;
    sel.appendChild(opt);
  });
  document.getElementById("btn-remove-layer").disabled = layers.length <= 1;
  document.getElementById("wall-count").textContent = floorplan.walls.length;
}

// ----- FloorPlan -----
const canvas = document.getElementById("floorplan-canvas");
const floorplan = new FloorPlan(canvas, {
  snapSize: 0.05,
  wallHeight: 2.8,
  onWallsChange: () => {
    saveCurrentWalls();
    document.getElementById("wall-count").textContent = floorplan.walls.length;
    scheduleGenerate();
  },
});

// ----- Rulers -----
const rulers = new Rulers(document.getElementById("canvas-panel"), floorplan);

// Init layers
if (!restoreProject()) {
  layers = [defaultLayer("Térreo", 0, 2.8)];
  switchToLayer(0, false);
}
updateLayerUI();

// Layer controls
document.getElementById("layer-select").addEventListener("change", (e) => {
  switchToLayer(parseInt(e.target.value));
  scheduleGenerate();
});
document.getElementById("btn-new-layer").addEventListener("click", () => {
  newLayer();
  scheduleGenerate();
});
document.getElementById("btn-remove-layer").addEventListener("click", () => {
  removeLayer();
  scheduleGenerate();
});
document.getElementById("wall-height-input").addEventListener("change", (e) => {
  const h = parseFloat(e.target.value) || 2.8;
  floorplan.setWallHeight(h);
  if (layers[currentLayerIdx]) layers[currentLayerIdx].height = h;
  scheduleGenerate();
});

// ----- Modal -----
const modal = document.getElementById("anim-modal");

const modalOnProgress = (cur, total) => {
  document.getElementById("modal-progress-fill").style.width =
    ((cur / total) * 100).toFixed(0) + "%";
  document.getElementById("modal-progress-text").textContent =
    cur.toLocaleString("pt-BR") +
    " / " +
    total.toLocaleString("pt-BR") +
    " tijolos";
};

const modalOnComplete = () => {
  document.getElementById("modal-progress-fill").style.width = "100%";
  document.getElementById("modal-progress-text").textContent = "Concluido!";
  document.getElementById("btn-pause").disabled = true;
};

function openModal() {
  if (!lastBrickPositions.length) return;
  modal.classList.add("active");
  document.addEventListener("keydown", onModalKey);
  const container = document.getElementById("modal-container");
  modalAnimator = new BrickAnimator(container, { bricksPerFrame: 5 });
  const sunTarget = parseFloat(
    document.getElementById("sun-preset-select").value,
  );
  modalAnimator.setSunTarget(sunTarget);
  document.getElementById("modal-progress-fill").style.width = "0%";
  document.getElementById("modal-progress-text").textContent = "Preparando...";
  document.getElementById("modal-progress").classList.add("active");
  document.getElementById("btn-pause").textContent = "Pausar";
  document.getElementById("btn-pause").disabled = false;
  modalAnimator.load(lastBrickPositions, lastBrickDims);
  modalAnimator.start(modalOnProgress, modalOnComplete);
}

function closeModal() {
  if (modalAnimator) {
    modalAnimator.stop();
    modalAnimator.dispose();
    modalAnimator = null;
  }
  modal.classList.remove("active");
  document.removeEventListener("keydown", onModalKey);
}
function onModalKey(e) {
  if (e.key === "Escape") closeModal();
}

document
  .getElementById("btn-close-modal")
  .addEventListener("click", closeModal);
document.getElementById("btn-pause").addEventListener("click", () => {
  if (!modalAnimator) return;
  const btn = document.getElementById("btn-pause");
  if (modalAnimator.paused) {
    modalAnimator.resume();
    btn.textContent = "Pausar";
  } else {
    modalAnimator.pause();
    btn.textContent = "Continuar";
  }
});
document.getElementById("btn-repeat").addEventListener("click", () => {
  if (!modalAnimator) return;
  modalAnimator.stop();
  modalAnimator.load(lastBrickPositions, lastBrickDims);
  document.getElementById("modal-progress-fill").style.width = "0%";
  document.getElementById("modal-progress-text").textContent = "Preparando...";
  document.getElementById("btn-pause").textContent = "Pausar";
  document.getElementById("btn-pause").disabled = false;
  modalAnimator.start(modalOnProgress, modalOnComplete);
});
document.getElementById("speed-select").addEventListener("change", (e) => {
  if (modalAnimator) {
    modalAnimator.bricksPerFrame = parseFloat(e.target.value);
    modalAnimator._brickDuration = Math.max(
      1,
      modalAnimator.totalBricks / (modalAnimator.bricksPerFrame * 60),
    );
  }
});
document.getElementById("modal-overlay").addEventListener("click", closeModal);

document.getElementById("btn-sun-repeat").addEventListener("click", () => {
  if (!modalAnimator) return;
  modalAnimator.startSunCycleOnly(modalAnimator._brickDuration || 20);
});
document.getElementById("sun-dir-select").addEventListener("change", (e) => {
  if (modalAnimator) modalAnimator.setSunHeading(parseFloat(e.target.value));
});
document
  .getElementById("sun-preset-select")
  .addEventListener("change", (e) => {
    if (modalAnimator) modalAnimator.setSunTarget(parseFloat(e.target.value));
  });

// ----- Toolbar -----
const btnDraw = document.getElementById("btn-draw");
const btnRect = document.getElementById("btn-rect");
const btnSelect = document.getElementById("btn-select");
const btnDelete = document.getElementById("btn-delete");
const btnHalfwall = document.getElementById("btn-halfwall");
const modeButtons = [btnDraw, btnRect, btnSelect, btnDelete];

function activateBtn(btn, mode) {
  modeButtons.forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  floorplan.setMode(mode);
}

btnDraw.addEventListener("click", () => activateBtn(btnDraw, "draw"));
btnRect.addEventListener("click", () => activateBtn(btnRect, "rect"));
btnSelect.addEventListener("click", () => {
  activateBtn(btnSelect, "select");
  btnHalfwall.classList.remove("active");
  floorplan.setHalfwallMode(false);
});
btnDelete.addEventListener("click", () => {
  activateBtn(btnDelete, "delete");
  btnHalfwall.classList.remove("active");
  floorplan.setHalfwallMode(false);
});

btnHalfwall.addEventListener("click", () => {
  const isActive = btnHalfwall.classList.toggle("active");
  floorplan.setHalfwallMode(isActive);
  if (isActive) {
    document.getElementById("status-bar").textContent =
      "Meia parede — altura: " + (floorplan.wallHeight / 2).toFixed(2) + "m";
  } else {
    document.getElementById("status-bar").textContent = "";
  }
});

// Cutout 3D controls
const btnCutDoor = document.getElementById("btn-cut-door");
const btnCutWindow = document.getElementById("btn-cut-window");
const cutButtons = [btnCutDoor, btnCutWindow];
let cutoutActive = null;

function activateCutout(type) {
  if (cutoutActive === type) {
    cutout3d.deactivate();
    cutButtons.forEach((b) => b.classList.remove("active"));
    cutoutActive = null;
    document.getElementById("status-bar").textContent = "";
    return;
  }
  cutButtons.forEach((b) => b.classList.remove("active"));
  cutoutActive = type;
  const btn = type === "door" ? btnCutDoor : btnCutWindow;
  btn.classList.add("active");

  const w = parseFloat(
    document.getElementById(
      type === "door" ? "door-size-select" : "window-size-select",
    ).value,
  );
  const h = type === "door" ? 2.1 : 1.0;
  const elev = type === "door" ? 0 : 1.1;

  cutout3d.setConfig({ type, width: w, height: h, elevation: elev });
  cutout3d.setWallData(allLayersData(), calcWallThickness());
  cutout3d.activate();
  document.getElementById("status-bar").textContent =
    "Modo corte 3D: " +
    (type === "door" ? "Porta" : "Janela") +
    " - clique na parede";
}

function calcWallThickness() {
  // Match the backend calculation
  const brickType = document.getElementById("brick-type-select").value;
  const orient = document.getElementById("orientation-select").value;
  // Simple approximation: use config
  const dims = {
    comum_19x9x9: [0.19, 0.09, 0.09],
    bloco_estrutural_19x14x39: [0.39, 0.14, 0.19],
    bloco_ceramico_9x14x24: [0.24, 0.14, 0.09],
    tijolo_macico_21x10x5: [0.21, 0.1, 0.05],
  };
  const [l, w, h] = dims[brickType] || [0.39, 0.14, 0.19];
  if (orient === "deitado") return w;
  if (orient === "cutelo") return h;
  return l; // espelho
}

function allLayersData() {
  // Usa layers diretamente (ja sincronizado por onWallsChange/onCutoutChange)
  return layers.map((l) => ({
    name: l.name,
    elevation: l.elevation,
    height: l.height,
    walls: l.walls,
  }));
}

document.getElementById("btn-zoom-in").addEventListener("click", () => {
  floorplan.zoomIn();
});
document.getElementById("btn-zoom-out").addEventListener("click", () => {
  floorplan.zoomOut();
});

btnCutDoor.addEventListener("click", () => activateCutout("door"));
btnCutWindow.addEventListener("click", () => activateCutout("window"));
document.getElementById("door-size-select").addEventListener("change", (e) => {
  if (cutoutActive === "door") {
    cutout3d.setConfig({
      width: parseFloat(e.target.value),
      height: 2.1,
      elevation: 0,
    });
    cutout3d.setWallData(allLayersData(), calcWallThickness());
  }
});
document
  .getElementById("window-size-select")
  .addEventListener("change", (e) => {
    if (cutoutActive === "window") {
      cutout3d.setConfig({
        width: parseFloat(e.target.value),
        height: 1.0,
        elevation: 1.1,
      });
      cutout3d.setWallData(allLayersData(), calcWallThickness());
    }
  });

document.getElementById("snap-select").addEventListener("change", (e) => {
  floorplan.setSnapSize(parseFloat(e.target.value));
  autoSave();
});
document
  .getElementById("endpoint-snap-toggle")
  .addEventListener("change", (e) => {
    floorplan.setEndpointSnapEnabled(e.target.checked);
    autoSave();
  });
document.getElementById("btn-mirror").addEventListener("click", () => {
  mirrorMode = !mirrorMode;
  document.getElementById("btn-mirror").classList.toggle("active", mirrorMode);
  saveCurrentWalls();
  doGenerate();
});
document.getElementById("btn-clear").addEventListener("click", () => {
  floorplan.clear();
  layers[currentLayerIdx].walls = [];
  doGenerate();
});
document.getElementById("btn-reset-cam").addEventListener("click", () => {
  if (currentModel) {
    frameCameraOnModel(currentModel);
  } else {
    controls.target.set(0, 1.5, 0);
    camera.position.set(10, 8, -14);
    controls.update();
  }
});

// Save/Load/Export
document.getElementById("btn-save").addEventListener("click", () => {
  saveCurrentWalls();
  autoSave();
  const data = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "projeto.tijolocount.json";
  a.click();
});

document.getElementById("btn-export-svg").addEventListener("click", () => {
  const svg = floorplan.exportSVG();
  if (!svg) {
    alert("Nenhuma parede para exportar.");
    return;
  }
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "planta_tijolocount.svg";
  a.click();
});

document.getElementById("btn-load-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.layers) {
        layers = data.layers;
        if (data.brick_type)
          document.getElementById("brick-type-select").value = data.brick_type;
        if (data.orientation)
          document.getElementById("orientation-select").value =
            data.orientation;
        if (data.mortar_joint)
          document.getElementById("mortar-joint-input").value = (
            data.mortar_joint * 100
          ).toFixed(1);
        if (data.snap_size) {
          document.getElementById("snap-select").value = data.snap_size;
          floorplan.setSnapSize(data.snap_size);
        }
        if (data.endpoint_snap !== undefined) {
          floorplan.setEndpointSnapEnabled(data.endpoint_snap);
          document.getElementById("endpoint-snap-toggle").checked =
            data.endpoint_snap;
        }
        currentLayerIdx = Math.min(data.current_layer || 0, layers.length - 1);
        switchToLayer(currentLayerIdx, false);
        scheduleGenerate();
        autoSave();
      }
    } catch (err) {
      alert("Arquivo invalido.");
    }
  };
  reader.readAsText(file);
});

document.getElementById("btn-new-project").addEventListener("click", () => {
  if (confirm("Criar novo projeto? O atual sera descartado.")) {
    localStorage.removeItem(LS_KEY);
    layers = [defaultLayer("Térreo", 0, 2.8)];
    currentLayerIdx = 0;
    switchToLayer(0, false);
    resultsBar.classList.remove("show");
    btnAnimate.style.display = "none";
    if (currentModel) {
      scene.remove(currentModel);
      currentModel = null;
    }
    document.getElementById("viewer-placeholder").style.display = "";
    doGenerate();
  }
});

// ----- Status Bar + Cursor Tracking -----
// Update status bar from floorplan cursor + render loop
function updateStatusBar() {
  const x = floorplan.cursorWorldX,
    z = floorplan.cursorWorldZ;
  document.getElementById("cursor-x").textContent = x.toFixed(2);
  document.getElementById("cursor-z").textContent = z.toFixed(2);
}
// Hook into floorplan's _onMouseMove by overriding or using a separate interval
// Simple approach: update in render loop
const origAnimate = animate;
// Use setInterval for status updates
setInterval(updateStatusBar, 100);

// Ruler update on render
const origFloorplanRender = floorplan._render.bind(floorplan);
floorplan._render = function () {
  origFloorplanRender();
  rulers.render();
};

// ----- Auto Generate -----
const resultsBar = document.getElementById("results-bar");
const btnAnimate = document.getElementById("btn-animate");

function scheduleGenerate() {
  clearTimeout(generateTimer);
  generateTimer = setTimeout(doGenerate, 300);
}

async function doGenerate() {
  let allLayers = allLayersData();

  if (mirrorMode) {
    const walls = allLayers.flatMap(l => l.walls);
    if (walls.length > 0) {
      let minX = Infinity, maxX = -Infinity;
      for (const w of walls) {
        if (w.x1 < minX) minX = w.x1; if (w.x1 > maxX) maxX = w.x1;
        if (w.x2 < minX) minX = w.x2; if (w.x2 > maxX) maxX = w.x2;
      }
      const cx = (minX + maxX) / 2;
      allLayers = allLayers.map(l => ({
        ...l,
        walls: l.walls.map(w => ({
          ...w,
          x1: 2 * cx - w.x1, x2: 2 * cx - w.x2,
        })),
      }));
    }
  }
  const hasWalls = allLayers.some((l) => l.walls.length > 0);

  if (!hasWalls) {
    resultsBar.classList.remove("show");
    btnAnimate.style.display = "none";
    if (currentModel) {
      scene.remove(currentModel);
      currentModel = null;
    }
    document.getElementById("viewer-placeholder").style.display = "";
    return;
  }

  const brickType = document.getElementById("brick-type-select").value;
  const mortarJoint =
    parseFloat(document.getElementById("mortar-joint-input").value || "1.0") /
    100;
  const orientation = document.getElementById("orientation-select").value;

  try {
    const resp = await fetch("/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layers: allLayers,
        brick_type: brickType,
        mortar_joint: mortarJoint,
        orientation,
      }),
    });
    if (!resp.ok) {
      const e = await resp.json();
      throw new Error(e.error);
    }

    const data = await resp.json();

    document.getElementById("res-total-area").textContent =
      data.area_total_paredes_m2 + " m\u00b2";
    document.getElementById("res-cement").textContent =
      (data.cimento_kg || 0).toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
      }) + " kg";
    document.getElementById("res-sand").textContent =
      (data.areia_kg || 0).toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
      }) + " kg";
    document.getElementById("res-water").textContent =
      (data.agua_l || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) +
      " L";
    document.getElementById("res-bpm2").textContent =
      data.tijolos_por_m2 + " un/m\u00b2";
    document.getElementById("res-total-bricks").textContent =
      data.total_tijolos.toLocaleString("pt-BR");
    resultsBar.classList.add("show");

    document.getElementById("btn-download-stl").href = data.stl_url;
    document.getElementById("btn-download-gltf").href = data.glb_url;

    document.getElementById("viewer-placeholder").style.display = "none";
    loadGLB(data.glb_url, cutoutActive !== null);

    lastBrickPositions = data.brick_positions;
    lastBrickDims = data.brick_dims;
    btnAnimate.style.display =
      data.brick_positions.length > 0 ? "inline-block" : "none";

    // Update cutout3d wall data (preserves preview if active)
    cutout3d.setWallData(allLayers, calcWallThickness());

    autoSave();
  } catch (err) {
    console.error("Erro auto-generate:", err);
  }
}

["brick-type-select", "mortar-joint-input", "orientation-select"].forEach(
  (id) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("change", () => {
        if (layers.some((l) => l.walls.length > 0)) scheduleGenerate();
      });
  },
);

btnAnimate.addEventListener("click", openModal);
