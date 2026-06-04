export const BRICK_TYPES = {
  comum_19x9x9: {
    name: "Tijolo Comum (19x9x9 cm)",
    length: 0.19,
    width: 0.09,
    height: 0.09,
  },
  bloco_estrutural_19x14x39: {
    name: "Bloco Estrutural (19x14x39 cm)",
    length: 0.39,
    width: 0.14,
    height: 0.19,
  },
  bloco_ceramico_9x14x24: {
    name: "Bloco Ceramico (9x14x24 cm)",
    length: 0.24,
    width: 0.14,
    height: 0.09,
  },
  tijolo_macico_21x10x5: {
    name: "Tijolo Macico (21x10x5 cm)",
    length: 0.21,
    width: 0.10,
    height: 0.05,
  },
};

export const DEFAULT_BRICK = "bloco_estrutural_19x14x39";
export const DEFAULT_MORTAR_JOINT = 0.01;
export const WASTE_FACTOR = 0.10;
export const MORTAR_DENSITY = 2000;
export const MORTAR_CEMENT_KG = 350;
export const MORTAR_SAND_KG = 1200;
export const MORTAR_WATER_L = 175;
export const DEFAULT_WALL_HEIGHT = 2.80;
export const DEFAULT_EXTERNAL_WALLS = 4;

export const BRICK_ORIENTATIONS = {
  deitado: {
    name: "Deitado (frente)",
    along: "length",
    up: "height",
    thick: "width",
  },
  cutelo: {
    name: "De cutelo (lado)",
    along: "width",
    up: "length",
    thick: "height",
  },
  espelho: {
    name: "De espelho",
    along: "width",
    up: "height",
    thick: "length",
  },
};

export const DEFAULT_ORIENTATION = "espelho";
