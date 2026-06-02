import math
import os
import uuid

import trimesh

from src.calculator import BrickCalculator


class Wall3DBuilder:
    """Gera modelo 3D das paredes com recortes e exporta GLB/STL."""

    def __init__(self, calculator: BrickCalculator, export_dir: str = "uploads"):
        self.calc = calculator
        self.export_dir = export_dir
        self.wall_thickness = calculator.wall_thickness
        self.mesh = None

    def build(self) -> trimesh.Trimesh:
        t = self.wall_thickness
        meshes = []

        for layer in self.calc.layers_data:
            le = layer.get("elevation", 0.0)
            for wall in self.calc.walls:
                if wall.base_elevation != le:
                    continue
                box = self._wall_box(wall, t)
                if box is not None and len(box.faces) > 0:
                    meshes.append(box)

        floor = self._floor_mesh()
        meshes.append(floor)

        valid = [m for m in meshes if len(m.faces) > 0]
        if valid:
            self.mesh = trimesh.util.concatenate(valid)
        return self.mesh

    def _wall_box(self, wall, thickness):
        length = wall.length
        height = wall.height
        le = wall.base_elevation

        if length < 1e-6:
            return None

        # Correcao: rotacao Y em trimesh: R_y(theta) mapeia X -> (cos(theta), 0, -sin(theta))
        # Precisamos que +X alinhe com (dx, dz). Entao cos(theta)=dx/L, -sin(theta)=dz/L
        # Logo theta = atan2(-dz, dx)
        theta = math.atan2(
            -(wall.z2 - wall.z1),
            wall.x2 - wall.x1,
        )

        box = trimesh.creation.box(extents=(length, height, thickness))

        # Recortes (em coordenadas locais: centro na origem, +X ao longo da parede)
        half_len = length / 2
        half_h = height / 2
        _EPS = 1e-4  # evita faces coplanares que confundem boolean engines
        for cutout in wall.cutouts:
            # Valida se o recorte cabe na parede (pre-grid check)
            if cutout.position + cutout.width > length or cutout.position < -_EPS:
                continue
            if cutout.elevation + cutout.height > height or cutout.elevation < -_EPS:
                continue

            cut_box = trimesh.creation.box(
                extents=(cutout.width + _EPS, cutout.height + _EPS, thickness * 3)
            )
            cut_x = cutout.position + cutout.width / 2 - half_len
            cut_y = cutout.elevation + cutout.height / 2 - half_h
            cut_box.apply_translation((cut_x, cut_y, 0))

            # Tenta engines em ordem: manifold (mais confiavel), blender, default
            result = None
            for engine in ("manifold", "blender", None):
                try:
                    result = box.difference(cut_box, engine=engine)
                except Exception:
                    continue
                if result is not None and len(result.faces) > 0 and not result.is_empty:
                    break
                result = None  # engine retornou mesh vazio — tenta proximo

            if result is not None and len(result.faces) > 0 and not result.is_empty:
                box = result
            # else: mantem a parede original (sem o recorte), melhor que sumir

        # Rotaciona na origem
        matrix = trimesh.transformations.rotation_matrix(theta, (0, 1, 0))
        box.apply_transform(matrix)

        # Translada para posicao final (com elevacao do andar)
        cx = (wall.x1 + wall.x2) / 2
        cz = (wall.z1 + wall.z2) / 2
        box.apply_translation((cx, le + height / 2, cz))

        if wall.wall_type == "external":
            box.visual.face_colors = [210, 130, 80, 255]
        elif wall.wall_type == "half_wall":
            box.visual.face_colors = [77, 166, 255, 255]
        else:
            box.visual.face_colors = [140, 140, 140, 255]

        return box

    def _floor_mesh(self):
        if not self.calc.walls:
            return trimesh.Trimesh()

        xs = [w.x1 for w in self.calc.walls] + [w.x2 for w in self.calc.walls]
        zs = [w.z1 for w in self.calc.walls] + [w.z2 for w in self.calc.walls]
        min_x, max_x = min(xs), max(xs)
        min_z, max_z = min(zs), max(zs)

        margin = 1.0
        bw = max_x - min_x + margin * 2
        bl = max_z - min_z + margin * 2
        cx = (min_x + max_x) / 2
        cz = (min_z + max_z) / 2

        floor = trimesh.creation.box(extents=(bw, 0.02, bl))
        floor.apply_translation((cx, -0.01, cz))
        floor.visual.face_colors = [180, 180, 180, 255]
        return floor

    def _make_uid(self):
        return uuid.uuid4().hex[:8]

    def export_glb(self):
        if self.mesh is None:
            self.build()
        os.makedirs(self.export_dir, exist_ok=True)
        filename = f"walls_{self._make_uid()}.glb"
        filepath = os.path.join(self.export_dir, filename)
        self.mesh.export(filepath, file_type="glb")
        return filepath

    def export_stl(self):
        if self.mesh is None:
            self.build()
        os.makedirs(self.export_dir, exist_ok=True)
        filename = f"walls_{self._make_uid()}.stl"
        filepath = os.path.join(self.export_dir, filename)
        self.mesh.export(filepath, file_type="stl")
        return filepath
