BRICK_TYPES = {
    "comum_19x9x9": {
        "name": "Tijolo Comum (19x9x9 cm)",
        "length": 0.19,  # metros
        "width": 0.09,  # metros (espessura da parede)
        "height": 0.09,  # metros
    },
    "bloco_estrutural_19x14x39": {
        "name": "Bloco Estrutural (19x14x39 cm)",
        "length": 0.39,
        "width": 0.14,
        "height": 0.19,
    },
    "bloco_ceramico_9x14x24": {
        "name": "Bloco Ceramico (9x14x24 cm)",
        "length": 0.24,
        "width": 0.14,
        "height": 0.09,
    },
    "tijolo_macico_21x10x5": {
        "name": "Tijolo Macico (21x10x5 cm)",
        "length": 0.21,
        "width": 0.10,
        "height": 0.05,
    },
}

DEFAULT_BRICK = "bloco_estrutural_19x14x39"
DEFAULT_MORTAR_JOINT = 0.01  # 1 cm em metros
WASTE_FACTOR = 0.10  # 10% de perda
MORTAR_DENSITY = 2000  # kg/m³ (densidade media argamassa cimento-areia)

# Traço padrão 1:3 (alvenaria) — kg por m³ de argamassa
MORTAR_CEMENT_KG = 350  # kg de cimento por m³
MORTAR_SAND_KG = 1200  # kg de areia por m³
MORTAR_WATER_L = 175  # litros de água por m³

DEFAULT_WALL_HEIGHT = 2.80  # metros
DEFAULT_EXTERNAL_WALLS = 4

# Posicao/assentamento do tijolo:
#   along  -> dimensao ao longo da parede
#   up     -> dimensao vertical (altura da fiada)
#   thick  -> espessura da parede
BRICK_ORIENTATIONS = {
    "deitado": {
        "name": "Deitado (frente)",
        "along": "length",  # comprimento do tijolo ao longo da parede
        "up": "height",  # altura do tijolo como altura da fiada
        "thick": "width",  # largura do tijolo = espessura da parede
    },
    "cutelo": {
        "name": "De cutelo (lado)",
        "along": "width",
        "up": "length",
        "thick": "height",
    },
    "espelho": {
        "name": "De espelho",
        "along": "width",
        "up": "height",
        "thick": "length",
    },
}

DEFAULT_ORIENTATION = "espelho"
