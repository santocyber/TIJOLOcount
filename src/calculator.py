import math
from dataclasses import dataclass, field

from src.config import BRICK_TYPES, BRICK_ORIENTATIONS, MORTAR_DENSITY, WASTE_FACTOR


@dataclass
class Cutout:
    """Recorte na parede (porta ou janela)."""

    cut_type: str  # 'door' | 'window'
    width: float
    height: float
    position: float  # distancia do inicio da parede
    elevation: float = 0.0  # altura do chao local (0 = porta, 1.10 = janela)


@dataclass
class Wall:
    """Representa uma parede definida por dois pontos no chao (XZ) + altura."""

    x1: float
    z1: float
    x2: float
    z2: float
    height: float
    wall_type: str = "external"
    label: str = ""
    cutouts: list[Cutout] = field(default_factory=list)
    base_elevation: float = 0.0  # elevacao da base (andar)

    @property
    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.z2 - self.z1)

    @property
    def angle(self) -> float:
        """Angulo da parede a partir do eixo X (rotacao em torno de Y)."""
        return math.atan2(self.z2 - self.z1, self.x2 - self.x1)

    @property
    def area(self) -> float:
        gross = self.length * self.height
        cut = sum(c.width * c.height for c in self.cutouts)
        return max(0, gross - cut)

    def _brick_hits_cutout(self, along, y_pos, brick_w, brick_h):
        for c in self.cutouts:
            if (
                c.position <= along <= c.position + c.width
                and c.elevation <= y_pos <= c.elevation + c.height
            ):
                return True
            if (
                c.position <= along + brick_w / 2
                and along - brick_w / 2 <= c.position + c.width
                and c.elevation <= y_pos + brick_h / 2
                and y_pos - brick_h / 2 <= c.elevation + c.height
            ):
                return True
        return False

    def brick_positions(self, brick_along, brick_up, brick_d, mortar_joint):
        step_x = brick_along + mortar_joint
        step_y = brick_up + mortar_joint

        length = self.length
        h = self.height

        n_along = max(1, int(math.ceil(length / step_x)))
        n_rows = max(1, int(math.ceil(h / step_y)))

        total_space_x = n_along * step_x
        start_offset_x = (total_space_x - length) / 2

        total_space_y = n_rows * step_y
        start_offset_y = (total_space_y - h) / 2

        dx = self.x2 - self.x1
        dz = self.z2 - self.z1
        inv_len = 1.0 / length if length > 0 else 0
        ux = dx * inv_len
        uz = dz * inv_len

        positions = []
        for row in range(n_rows):
            for col in range(n_along):
                along = start_offset_x + col * step_x
                y_pos = start_offset_y + row * step_y

                if self._brick_hits_cutout(along, y_pos, brick_along, brick_up):
                    continue

                wx = self.x1 + ux * (along + step_x / 2)
                wz = self.z1 + uz * (along + step_x / 2)

                positions.append(
                    {
                        "x": round(wx, 4),
                        "y": round(self.base_elevation + y_pos + step_y / 2, 4),
                        "z": round(wz, 4),
                        "rotY": round(self.angle, 4),
                        "type": self.wall_type,
                    }
                )

        return positions


class BrickCalculator:
    """Calcula quantidade de tijolos baseado em camadas de paredes."""

    def __init__(
        self,
        walls: list[dict] | None = None,
        layers: list[dict] | None = None,
        brick_type_key: str = "bloco_estrutural_19x14x39",
        mortar_joint: float = 0.01,
        orientation: str = "espelho",
    ):
        self.brick_raw = BRICK_TYPES[brick_type_key]
        self.brick_type_key = brick_type_key
        self.mortar_joint = mortar_joint
        self.orientation = orientation

        orient = BRICK_ORIENTATIONS.get(orientation, BRICK_ORIENTATIONS["espelho"])
        self.brick_along = self.brick_raw[orient["along"]]
        self.brick_up = self.brick_raw[orient["up"]]
        self.brick_thick = self.brick_raw[orient["thick"]]

        self.layers_data = []
        self.walls = []

        if layers:
            self.layers_data = layers
            for layer in layers:
                lw = layer.get("walls", [])
                lh = layer.get("height", 2.80)
                le = layer.get("elevation", 0.0)
                for w in lw:
                    cutouts = [
                        Cutout(
                            cut_type=c["cut_type"],
                            width=float(c["width"]),
                            height=float(c["height"]),
                            position=float(c["position"]),
                            elevation=float(c.get("elevation", 0)),
                        )
                        for c in w.get("cutouts", [])
                    ]
                    self.walls.append(
                        Wall(
                            x1=float(w["x1"]),
                            z1=float(w["z1"]),
                            x2=float(w["x2"]),
                            z2=float(w["z2"]),
                            height=float(w.get("height", lh)),
                            wall_type=w.get("type", "external"),
                            label=w.get("label", ""),
                            cutouts=cutouts,
                            base_elevation=le,
                        )
                    )
        elif walls:
            self.layers_data = [
                {
                    "name": "Térreo",
                    "height": 2.80,
                    "elevation": 0.0,
                    "walls": walls,
                }
            ]
            for w in walls:
                cutouts = [
                    Cutout(
                        cut_type=c["cut_type"],
                        width=float(c["width"]),
                        height=float(c["height"]),
                        position=float(c["position"]),
                        elevation=float(c.get("elevation", 0)),
                    )
                    for c in w.get("cutouts", [])
                ]
                self.walls.append(
                    Wall(
                        x1=float(w["x1"]),
                        z1=float(w["z1"]),
                        x2=float(w["x2"]),
                        z2=float(w["z2"]),
                        height=float(w.get("height", 2.80)),
                        wall_type=w.get("type", "external"),
                        label=w.get("label", ""),
                        cutouts=cutouts,
                        base_elevation=0.0,
                    )
                )

    @property
    def total_wall_area(self) -> float:
        return sum(w.area for w in self.walls)

    @property
    def external_area(self) -> float:
        return sum(w.area for w in self.walls if w.wall_type == "external")

    @property
    def internal_area(self) -> float:
        return sum(w.area for w in self.walls if w.wall_type == "internal")

    @property
    def bricks_per_m2(self) -> float:
        return 1.0 / (
            (self.brick_along + self.mortar_joint) * (self.brick_up + self.mortar_joint)
        )

    @property
    def total_bricks(self) -> int:
        raw = self.total_wall_area * self.bricks_per_m2
        return math.ceil(raw * (1 + WASTE_FACTOR))

    @property
    def all_brick_positions(self) -> list[dict]:
        positions = []
        for wall in self.walls:
            positions.extend(
                wall.brick_positions(
                    self.brick_along, self.brick_up, self.brick_thick, self.mortar_joint
                )
            )
        return positions

    @property
    def wall_thickness(self) -> float:
        return self.brick_thick

    @property
    def effective_brick_dims(self) -> dict:
        return {
            "length": self.brick_along,
            "width": self.brick_thick,
            "height": self.brick_up,
        }

    @property
    def mortar_volume_per_brick(self) -> float:
        """Volume de argamassa ao redor de um tijolo (m³)."""
        j = self.mortar_joint
        return j * (self.brick_along + self.brick_up + j) * self.brick_thick

    @property
    def total_mortar_kg(self) -> float:
        """Massa total de argamassa em kg."""
        n = len(self.all_brick_positions)
        return n * self.mortar_volume_per_brick * MORTAR_DENSITY

    @property
    def summary(self) -> dict:
        walls_info = []
        for w in self.walls:
            n = len(
                w.brick_positions(
                    self.brick_along, self.brick_up, self.brick_thick, self.mortar_joint
                )
            )
            cut = sum(c.width * c.height for c in w.cutouts)
            walls_info.append(
                {
                    "label": w.label or f"Parede ({w.wall_type})",
                    "type": w.wall_type,
                    "length_m": round(w.length, 2),
                    "height_m": round(w.height, 2),
                    "area_m2": round(w.area, 2),
                    "cutouts": len(w.cutouts),
                    "cut_area_m2": round(cut, 2),
                    "bricks": n,
                    "andar_elev": round(w.base_elevation, 2),
                }
            )

        orient_name = BRICK_ORIENTATIONS.get(self.orientation, {}).get(
            "name", "Espelho"
        )

        return {
            "area_paredes_externas_m2": round(self.external_area, 2),
            "area_paredes_internas_m2": round(self.internal_area, 2),
            "area_total_paredes_m2": round(self.total_wall_area, 2),
            "tijolos_por_m2": round(self.bricks_per_m2, 1),
            "total_tijolos": self.total_bricks,
            "espessura_parede_m": round(self.wall_thickness, 3),
            "tipo_tijolo": self.brick_raw["name"],
            "posicao": orient_name,
            "junta_argamassa_cm": round(self.mortar_joint * 100, 1),
            "total_argamassa_kg": round(self.total_mortar_kg, 1),
            "paredes": walls_info,
        }
