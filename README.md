# TIJOLOcount — Calculadora 3D de Tijolos

Aplicação web em Flask que calcula a quantidade de tijolos necessária para uma construção e gera um modelo 3D interativo das paredes usando **Trimesh** + **Three.js**.

## Funcionalidades

- Cálculo de área do piso e área total das paredes
- Suporte a paredes externas (1 a 4) e paredes internas ilimitadas
- 4 tipos de tijolo configuráveis (comum, estrutural, cerâmico, maciço)
- Margem de perda de 10% automática
- Modelo 3D gerado com **trimesh** e exibido com **Three.js**
- Viewer interativo: orbit controls (rotacionar, zoom, pan)
- Paredes externas (terracota), internas (cinza) e piso com cores distintas
- Desenho de planta baixa 2D com canvas interativo
- Corte de vãos (portas/janelas) diretamente no modelo 3D
- Animação de tijolos
- Réguas de medida no viewer

## Tecnologias

| Camada      | Tecnologia                    |
| ----------- | ----------------------------- |
| Backend     | Flask (Python)                |
| Cálculo 3D  | Trimesh                       |
| Frontend 3D | Three.js (ES modules via CDN) |
| Estilo      | CSS puro, tema escuro         |

## Como rodar

```bash
# 1. Clone o repositorio
git clone https://github.com/santocyber/TIJOLOcount.git
cd TIJOLOcount

# 2. Crie um ambiente virtual (recomendado)
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# 3. Instale as dependencias
pip install -r requirements.txt

# 4. Inicie o servidor
python app.py
```

Acesse **http://localhost:5020**

> **Nota:** O diretorio `uploads/` e criado automaticamente ao iniciar com `python app.py`. Se usar outro servidor WSGI (ex: gunicorn), crie o diretorio manualmente.

## Como usar

1. Preencha **Largura**, **Comprimento** e **Altura** da construção
2. Escolha a quantidade de **paredes externas** (1-4)
3. Selecione o **tipo de tijolo** e a **junta de argamassa**
4. Adicione **paredes internas** conforme necessário (nome + largura)
5. Clique em **"Calcular Tijolos e Gerar 3D"**
6. Veja os resultados (áreas, tijolos/m², total) e o modelo 3D interativo

## Tipos de Tijolo

| Tipo             | Dimensões (cm) |
| ---------------- | -------------- |
| Comum            | 19 × 9 × 9     |
| Bloco Estrutural | 19 × 14 × 39   |
| Bloco Cerâmico   | 9 × 14 × 24    |
| Tijolo Maciço    | 21 × 10 × 5    |

## Fórmula de Cálculo

```
Tijolos/m² = 1 / ((comprimento_tijolo + junta) × (altura_tijolo + junta))
Total = teto(área_total_paredes × tijolos/m² × 1.10)
```

A margem de 10% cobre quebras e recortes.

## Estrutura do Projeto

```
TIJOLOcount/
├── app.py                  # Servidor Flask (porta 5020)
├── requirements.txt        # Dependências Python
├── src/
│   ├── calculator.py       # Lógica de cálculo de tijolos
│   ├── config.py           # Tipos de tijolo e constantes
│   ├── model_3d.py         # Geração do modelo .glb (trimesh)
│   └── __init__.py
├── templates/
│   └── index.html          # Interface web (formulário + viewer)
├── static/
│   ├── style.css           # Estilos (tema escuro)
│   ├── app.js              # Viewer Three.js + orbit controls
│   ├── animation.js        # Animação de tijolos (BrickAnimator)
│   ├── cutout3d.js         # Corte de portas/janelas no 3D
│   ├── floorplan.js        # Canvas 2D para desenho de paredes
│   └── rulers.js           # Réguas de medida no viewer
└── uploads/                # Modelos .glb gerados (temporários)
```

## Endpoints da API

| Rota                | Método | Descrição                          |
| ------------------- | ------ | ---------------------------------- |
| `/`                 | GET    | Interface principal                |
| `/calculate`        | POST   | Calcula tijolos e gera .glb (JSON) |
| `/model/<filename>` | GET    | Serve arquivo .glb gerado          |

### Exemplo de requisição

```bash
curl -X POST http://localhost:5020/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "width": 8,
    "length": 10,
    "height": 2.8,
    "num_walls": 4,
    "brick_type": "comum_19x9x9",
    "mortar_joint": 0.01,
    "internal_walls": [{"label": "Sala", "width": 5}]
  }'
```

> **Atencao:** O campo `mortar_joint` espera valor em **metros** na API (ex: `0.01` = 1 cm). No formulario web a conversao e feita automaticamente (cm → m).

## Observacoes

- **Three.js via CDN:** O viewer 3D carrega Three.js por CDN (jsDelivr). E necessario conexao com internet para visualizar o modelo.
- **Modo debug:** O servidor roda com `debug=True` por padrao. Para producao, desabilite o debug e use um servidor WSGI (ex: gunicorn).
- **Modelos .glb:** Os arquivos 3D gerados ficam em `uploads/` e sao servidos via `/model/<filename>`. Sao nomeados com UUID (ex: `model_a1b2c3d4.glb`).

## Requisitos

- Python 3.8+
- Flask, Trimesh, NumPy
