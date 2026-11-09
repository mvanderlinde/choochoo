# Toddler Train Simulator: Plan

A casual 3D train ride in the browser. There are no goals, no score and no way to fail. The arrow keys drive the train, the space bar blows the horn, and at a junction the left and right keys pick which way to go.

## 1. Tech stack (all free, no build step)

| Need | Choice | Why |
|---|---|---|
| 3D engine | **Three.js** (MIT), loaded via an import map from a CDN | The most-used WebGL library. It includes glTF loading, sky, fog, shadows and spline curves, so we don't write any rendering code ourselves. |
| Splines for tracks | `THREE.CatmullRomCurve3` (built in) | Smooth curved track paths, with position and tangent at any point. |
| Terrain noise | `ImprovedNoise` from `three/addons/math` (built in) | Generates hills and mountains with no extra dependency. |
| Sky / lighting | `Sky` addon + `HemisphereLight` + `DirectionalLight` with shadows | A good-looking outdoor scene with very little code. |
| Horn and chugging sounds | Web Audio API (built into the browser) | We can synthesize a two-tone horn and a "chuff" sound, so no audio files are needed. An optional CC0 `.mp3` from freesound.org can replace them later. |
| Physics | **None** | The train follows a spline, so no physics engine is needed. |

**Running it:** ES modules need an HTTP server, so we run `python3 -m http.server` in `train-game/` and open `http://localhost:8000`. There's no npm install and no bundler.

## 2. Free 3D assets (CC0, so there are no license worries)

- **Kenney "Train Kit"** (kenney.nl): locomotives, carriages and track pieces in glTF format.
- **Kenney "City Kit (Commercial / Suburban / Roads)"**: buildings, houses and roads for a town.
- **Kenney "Nature Kit"** or **Quaternius "Ultimate Nature"**: trees, rocks, bushes and flowers.
- **Poly Pizza** (poly.pizza): a searchable CC0 and CC-BY model library, as a fallback for a nicer steam locomotive.
- **ambientCG / Poly Haven** (CC0): grass, rock and gravel textures for the ground and the track bed.

The assets go in `train-game/assets/{trains,city,nature,textures}/`. Kenney's style is clean, colorful and low-poly. It reads well for a toddler and stays fast on any laptop.

> "Real 3D environments" means hand-made landscapes built from these kits. Real-world map data (Google 3D Tiles or Cesium) needs API keys and accounts and is much more complex, so it's out of scope.

## 3. Project layout

```
train-game/
  index.html          # canvas, import map, "Click to start" overlay (needed to unlock audio)
  src/
    main.js           # scene, camera, renderer, main loop
    world.js          # terrain, sky, fog, scatter trees/rocks, city placement
    tracks.js         # track graph (nodes/edges/junctions) + rail & sleeper meshes
    train.js          # load loco + carriages, move them along the track graph
    controls.js       # keyboard state (arrows, space)
    audio.js          # horn + chuff + bell synthesis
    assets.js         # GLTFLoader wrapper with a loading bar
  assets/...
```

## 4. Core systems

### 4.1 Track network (the most complex part)
- A **graph**: each **edge** is a `CatmullRomCurve3` from one node to another. Each **node** is either a plain connection or a **junction**, where one incoming edge splits into a *left* and a *right* outgoing edge.
- The layout is hand-authored as a small JSON-like list of control points in `tracks.js`. It's designed as **several connected loops**, for example a big outer loop through hills and mountains, a branch loop through the town, and a branch loop around a lake. Because every path leads somewhere, there are **no dead ends** and the train never has to stop.
- **Track meshes:** two rails are made by sweeping a small rectangle profile along each curve (`ExtrudeGeometry` with `extrudePath`, or a custom ribbon). The sleepers are an `InstancedMesh` of brown boxes placed every ~0.6 m using `curve.getPointAt()` and `getTangentAt()`. This is fast and looks right.
- **Track bed:** the terrain is flattened along every curve, and a gravel-textured strip is laid under the tracks.

### 4.2 Train movement
- The train stores `(currentEdge, distanceAlongEdge, speed)`. Each frame it does `distance += speed * dt`. When it reaches the end of an edge, it moves to the next one. At a junction, the next edge is whichever branch is selected.
- The locomotive and each carriage are placed at `distance - k * carSpacing`, looking back through previous edges as needed. They are oriented using the curve tangent, so the cars follow the curves naturally.
- Speed eases toward a target, so starting and stopping feel gentle. The maximum speed is capped so it's never scary-fast.

### 4.3 Controls (built to survive toddler key-mashing)
| Key | Action |
|---|---|
| ↑ | Speed up (hold) |
| ↓ | Slow down. If held while stopped, slowly reverse. |
| ← / → | Select the left or right branch at the **next** junction. A big glowing arrow sign at the junction and a small arrow on screen show the choice. |
| Space | Horn (two-tone "toot toot", with a short cooldown so mashing it isn't deafening) |
| Any other key | Ignored. Optionally, any letter key rings a bell for fun. |

The train never derails, crashes or stops for good, and nothing on screen can go wrong.

### 4.4 Camera
- A smooth chase camera behind and above the locomotive, lerped for gentle motion.
- Optional: the `C` key cycles chase / side view / cab view. Toddlers might enjoy a parent switching views.

### 4.5 World
- **Terrain:** a large plane (~1000 m) displaced with layered `ImprovedNoise`. It has gentle rolling hills near the tracks and tall mountains toward the edges, colored by height (grass, then rock, then snowy peaks).
- **Town zone:** a flat area where Kenney city buildings are placed in a grid along the town branch, with a little station platform.
- **Nature:** trees and rocks scattered randomly, but kept away from the track corridor. A flat blue water plane makes the lake.
- **Atmosphere:** the `Sky` shader, distance fog that hides the world edge, and soft shadows.
- **Optional extras:** a tunnel through one mountain, a bridge over the lake, animated clouds, steam puffs from the chimney (a simple sprite particle system).

### 4.6 Audio
- **Horn:** two detuned sawtooth oscillators with a lowpass filter and a quick envelope.
- **Chuff:** filtered noise bursts whose rate scales with speed.
- A "Click to Start" overlay is required because browsers block audio until the user interacts with the page.

## 5. Build steps (in order)

1. **Scaffold:** `index.html`, the import map pinned to a specific Three.js version, a basic scene with a ground plane and camera, and a local server check.
2. **Track graph:** define a two-loop layout with one junction, render the rails and sleepers, and use a placeholder box train to verify movement and branch switching.
3. **Controls and camera:** arrow keys, the junction selection indicator and the chase camera.
4. **Real assets:** download the Kenney Train / City / Nature kits, swap the box for the locomotive and 2–3 carriages, and add trees and buildings.
5. **Terrain:** noise hills and mountains, flattened under the tracks, plus sky and fog.
6. **Expand the layout:** 3–4 loops (mountains, town, lake) and 3–4 junctions.
7. **Audio:** horn, chuff and the start overlay.
8. **Polish:** steam particles, a station, a bridge or tunnel, fullscreen (`F` key), and a performance check (instancing and shadow-map size).

## 6. Effort / token budget
Most of the visual work comes from Three.js and the Kenney models. Hand-written code should be roughly **800–1200 lines of JS** in total. The track graph and train-following logic (~250 lines) is the only real "logic" piece. Everything else is placing loaded models and tuning numbers.

## 7. Risks / notes
- **Asset download:** the Kenney kits are zip files from kenney.nl. If they can't be fetched automatically, download them by hand into `assets/` (about a 2-minute task).
- **Matching track geometry:** we generate our own rails along splines instead of snapping Kenney's fixed track pieces together. That's far simpler for curves and junctions.
- **Browsers:** works in Chrome, Safari and Firefox on any recent laptop. No mobile or touch controls in v1. On-screen buttons for a tablet could be a later addition.
