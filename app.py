import os

from flask import Flask, render_template, request, jsonify, send_from_directory

from src.calculator import BrickCalculator
from src.model_3d import Wall3DBuilder

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "uploads"
)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/calculate", methods=["POST"])
def calculate():
    try:
        data = request.get_json()

        layers_data = data.get("layers") or data.get("walls")
        brick_type_key = data.get("brick_type", "bloco_estrutural_19x14x39")
        mortar_joint = float(data.get("mortar_joint", 0.01))
        orientation = data.get("orientation", "espelho")

        if not layers_data:
            return jsonify({"error": "Nenhuma parede informada."}), 400

        is_layers = (
            isinstance(layers_data, list)
            and len(layers_data) > 0
            and isinstance(layers_data[0], dict)
            and "walls" in layers_data[0]
        )

        if is_layers:
            calc = BrickCalculator(
                layers=layers_data,
                brick_type_key=brick_type_key,
                mortar_joint=mortar_joint,
                orientation=orientation,
            )
        else:
            calc = BrickCalculator(
                walls=layers_data,
                brick_type_key=brick_type_key,
                mortar_joint=mortar_joint,
                orientation=orientation,
            )

        if calc.total_wall_area <= 0:
            return jsonify({"error": "Area total das paredes invalida."}), 400

        builder = Wall3DBuilder(calc, export_dir=app.config["UPLOAD_FOLDER"])
        glb_path = builder.export_glb()
        stl_path = builder.export_stl()

        result = calc.summary
        result["glb_url"] = f"/model_glb/{os.path.basename(glb_path)}"
        result["stl_url"] = f"/model_stl/{os.path.basename(stl_path)}"
        result["brick_positions"] = calc.all_brick_positions
        result["brick_dims"] = calc.effective_brick_dims

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/model_glb/<filename>")
def serve_glb(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/model_stl/<filename>")
def serve_stl(filename):
    return send_from_directory(
        app.config["UPLOAD_FOLDER"],
        filename,
        as_attachment=True,
        download_name=filename,
    )


if __name__ == "__main__":
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    app.run(host="0.0.0.0", port=5020, debug=True)
