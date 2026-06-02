# AGENTS.md — TIJOLOcount

## Run / Dev Commands

```bash
python app.py                # Servidor Flask na porta 5020
pip install -r requirements.txt
```

Nao ha testes, linter, typecheck ou CI configurados.

## Architecture

```
app.py                       # Unico entrypoint — Flask, porta 5020, debug=True
src/calculator.py            # Logica de calculo (portugues)
src/config.py                # BRICK_TYPES, WASTE_FACTOR, defaults
src/model_3d.py              # Trimesh → .glb (ingles)
templates/index.html         # UI completa (formulario inline + viewer)
static/app.js                # Viewer Three.js principal (ES modules)
static/animation.js          # BrickAnimator — cena propria de tijolos
static/cutout3d.js           # Cutout3D — corte de portas/janelas
static/floorplan.js          # FloorPlan — canvas 2D interativo
static/rulers.js             # Réguas X/Z no viewer
uploads/                     # .glb gerados (criado em __main__ apenas)
```

## Gotchas

- **Porta 5020**, nao a default 5000 do Flask.
- **mortar_joint**: o formulário HTML envia em **cm** (divide por 100 antes do POST). A API `/calculate` espera **metros** (`0.01` = 1 cm). Testes via curl devem usar metros.
- **Idioma misto**: `calculator.py` e config usam nomes em português (`paredes`, `tijolos`, `junta_argamassa`, `area_piso_m2`). `model_3d.py` e frontend usam inglês. JSON da API retorna chaves em português.
- **`uploads/`** só é criado automaticamente com `python app.py`. Em WSGI/gunicorn, crie manualmente.
- **Three.js via CDN** (jsDelivr import maps). O viewer 3D requer internet.
- **`debug=True`** hardcoded em `app.py`. Não usar em produção.
