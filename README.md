# Yifei Lyu — personal website

A single-page portfolio in plain HTML, CSS and JavaScript, styled after Apple-style product pages:
a floating nav pill, eyebrow + headline + lede story sections, carousels, metric tiles, and a live
3D viewer that renders robots straight from their URDFs.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

A local server is needed (not `file://`) because the 3D viewer fetches URDF and mesh files.

## Layout

- `index.html` — all content, top to bottom: hero, highlights, about; Dexmate (legged humanoid, Vega);
  Addverb (Elixis, Trakr, Syncro, Zippy AGVs, deployments); robots (3D viewer, gallery, personal
  builds); experience, education, skills, contact. The Explore menu groups links the same way.
- `assets/css/style.css` — design tokens and components.
- `assets/js/script.js` — reveal-on-scroll, menu, carousels, robot filter, copy email; lazy-loads the viewer.
- `assets/js/robot-viewer.js` — three.js + [urdf-loader](https://github.com/gkjohnson/urdf-loaders)
  (both from jsDelivr, pinned), loaded only when the viewer section nears the screen.
- `assets/robots/<id>/` — web-ready robots: a visual-only URDF plus decimated, quantized GLB meshes.
  Each folder has a `SOURCE.md` (upstream repo, commit, license) and, where upstream has one, its `LICENSE`.
- `assets/images/site/` — generated images: the hero lineup and the Vega renders.

## Adding a robot to the viewer

```bash
python3 -m venv .venv && .venv/bin/pip install "numpy<2" trimesh fast-simplification==0.1.7 pycollada
.venv/bin/python tools/urdf2web.py <id> path/to/robot.urdf <face budget> assets/robots [--base DIR]
```

Then add a chip with `data-robot="<id>" data-urdf="./assets/robots/<id>/<id>.urdf"` to the viewer in
`index.html`. If its URDF colours or all-zero pose look wrong, add entries to `RECOLOR` or `HOME` in
`robot-viewer.js`.
