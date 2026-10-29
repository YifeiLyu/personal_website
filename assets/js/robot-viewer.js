// URDF viewer: three.js + urdf-loader, robots converted to decimated GLB meshes in assets/robots/<id>/.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import URDFLoader from "urdf-loader";

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
const box = document.getElementById("vwCanvas");
const status = document.getElementById("vwStatus");
const read = document.getElementById("vwRead");
const playBtn = document.getElementById("vwPlay");
const playIcon = document.getElementById("vwPlayIcon");
const PLAY_D = "M3 1.5v11l9.5-5.5z";
const PAUSE_D = "M3 1.5h3v11H3zM8 1.5h3v11H8z";

// URDF colours that read as exporter defaults get the robot's real finish instead; keys are the URDF's own rgb values
const RECOLOR = {
  trakr: { "0.50,0.50,1.00": 0xd7262c, "0.75,0.75,0.75": 0xe4e4e6, "0.30,0.30,0.30": 0x3a3a3c },
  syncro: { "0.75,0.75,0.75": 0xececee },
  // the URDF tints left and right links differently; show one finish, with the torso frame a step darker
  // pure black reads as a hole under studio light; lift it to graphite
  vega: { "0.00,0.00,0.00": 0x2c2c2e },
  elix: { "0.79,0.82,0.93": 0xe2e3e6, "0.90,0.92,0.93": 0xe2e3e6, "0.87,0.91,1.00": 0xe2e3e6, "0.78,0.76,0.74": 0x8e8e93 },
};

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.9;
box.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f7);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.autoRotate = !reduce.matches;
controls.autoRotateSpeed = 0.9;

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.radius = 6;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b8c0, 0.35));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- loading ----------
const cache = new Map();
let current = null, currentId = null, token = 0;

const finish = (id, material, own) => {
  const map = RECOLOR[id] || {};
  const { r, g, b } = material.color;
  const key = [r, g, b].map((v) => v.toFixed(2)).join(",");
  // a colour baked into the mesh file is already linear; a URDF rgba is stored linear by urdf-loader but CAD
  // exporters write sRGB-looking values, so read that one back as sRGB
  const color = key in map ? new THREE.Color(map[key]) : own ? material.color.clone() : new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05 });
};

// positions are int16 (KHR_mesh_quantization); bake each node's dequantizing transform into float geometry
const dequantize = (src) => {
  const q = src.geometry.attributes.position;
  const f = new Float32Array(q.count * 3);
  for (let i = 0; i < q.count; i++) { f[i * 3] = q.getX(i); f[i * 3 + 1] = q.getY(i); f[i * 3 + 2] = q.getZ(i); }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(f, 3));
  geom.setIndex(src.geometry.index);
  geom.applyMatrix4(src.matrixWorld);
  src.geometry.dispose();
  return toCreasedNormals(geom, 0.55);
};

const load = (id, url) => new Promise((resolve, reject) => {
  const manager = new THREE.LoadingManager();
  const gltf = new GLTFLoader(manager);
  const loader = new URDFLoader(manager);
  let robot = null;
  manager.onProgress = (_, done, total) => { status.textContent = `Loading ${done} of ${total} parts`; };
  manager.onError = (u) => reject(new Error("Could not load " + u));
  manager.onLoad = () => robot && resolve(robot);
  loader.loadMeshCb = (path, mgr, material, done) => {
    gltf.load(path, (g) => {
      g.scene.updateMatrixWorld(true);
      const group = new THREE.Group();
      // one primitive per colour; a material named "c" carries the mesh file's own colour
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const own = o.material && o.material.name === "c";
        const mesh = new THREE.Mesh(dequantize(o), finish(id, own ? o.material : material, own));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      });
      if (!group.children.length) return done(null, new Error("empty mesh " + path));
      done(group);
    }, undefined, (err) => done(null, err));
  };
  loader.load(url, (r) => {
    robot = r;
    robot.rotation.x = -Math.PI / 2; // ROS is Z-up, three is Y-up
  });
});

// ---------- framing ----------
const frame = (robot) => {
  robot.position.set(0, 0, 0);
  robot.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(robot);
  const c = b.getCenter(new THREE.Vector3());
  robot.position.set(-c.x, -b.min.y, -c.z);
  robot.updateMatrixWorld(true);
  const r = b.getBoundingSphere(new THREE.Sphere()).radius;
  const h = b.max.y - b.min.y;
  // fit the height and the turning footprint (it auto-rotates) to the view, whichever is tighter
  const foot = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z);
  const vf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hf = Math.atan(Math.tan(vf) * camera.aspect);
  const dist = Math.max(h * 0.62 / Math.tan(vf), foot * 0.55 / Math.tan(hf)) + foot / 2;
  controls.target.set(0, h * 0.48, 0);
  camera.position.copy(new THREE.Vector3(0.62, 0.3, 0.74).normalize().multiplyScalar(dist)).add(controls.target);
  camera.near = dist / 100;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  controls.minDistance = r * 1.2;
  controls.maxDistance = dist * 2.5;
  controls.update();
  ground.scale.setScalar(r * 12);
  sun.position.set(r * 2.2, r * 4, r * 1.6);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -r * 1.6;
  sc.right = sc.top = r * 1.6;
  sc.near = r * 0.5;
  sc.far = r * 10;
  sc.updateProjectionMatrix();
};

// ---------- joint motion ----------
// a robot whose all-zero pose is folded gets a home pose to stand in and to move around
const HOME = {
  vega: { torso_j1: 1.2, torso_j2: 2.4, torso_j3: 1.2, L_arm_j1: 1.25, R_arm_j1: -1.25, L_arm_j2: 0.08, R_arm_j2: -0.08, L_arm_j4: -0.7, R_arm_j4: -0.7 },
};
let playing = !reduce.matches, t = 0;
const moving = (robot) => Object.values(robot.joints).filter((j) => j.jointType !== "fixed" && !j.isURDFMimicJoint);
const home = (robot) => {
  const h = HOME[currentId] || {};
  moving(robot).forEach((j) => j.setJointValue(h[j.name] || 0));
};
const pose = (robot, time) => {
  const h = HOME[currentId] || {};
  moving(robot).forEach((j, i) => {
    if (j.jointType === "continuous") { j.setJointValue(time * 2.2); return; }
    const lo = j.limit.lower, hi = j.limit.upper;
    const span = hi - lo;
    const amp = Math.min(0.26, span > 0 ? span * 0.3 : 0.26);
    const mid = Math.min(Math.max(h[j.name] || 0, lo + amp), hi - amp);
    j.setJointValue(mid + amp * Math.sin(time * 1.1 + i * 0.9));
  });
};

const setPlaying = (on) => {
  playing = on;
  playIcon.setAttribute("d", on ? PAUSE_D : PLAY_D);
  playBtn.setAttribute("aria-label", on ? "Pause the joint animation" : "Animate the joints");
  playBtn.querySelector("span").textContent = on ? "Pause joints" : "Animate joints";
  kick();
};
playBtn.addEventListener("click", () => setPlaying(!playing));

// ---------- show ----------
async function show(id) {
  const chip = document.querySelector(`.chip[data-robot="${id}"]`);
  if (!chip || id === currentId) return;
  const my = ++token;
  currentId = id;
  status.hidden = false;
  status.textContent = "Loading";
  box.classList.add("busy");
  try {
    let robot = cache.get(id);
    if (!robot) {
      robot = await load(id, chip.getAttribute("data-urdf"));
      cache.set(id, robot);
    }
    if (my !== token) return;
    if (current) scene.remove(current);
    current = robot;
    scene.add(robot);
    home(robot);
    frame(robot);
    const joints = moving(robot).length;
    let tris = 0;
    robot.traverse((o) => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; });
    read.textContent = `${joints} movable joints · ${Math.round(tris).toLocaleString("en-US")} triangles`;
    status.hidden = true;
    box.classList.remove("busy");
    kick();
  } catch (err) {
    if (my !== token) return;
    status.textContent = "This model could not be loaded.";
    console.error(err);
  }
}

// ---------- loop ----------
let inView = true, raf = 0, idleTimer = 0;
const clock = new THREE.Clock();
const tick = () => {
  raf = 0;
  if (!inView || document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  if (current && playing) { t += dt; pose(current, t); }
  controls.update(dt);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(tick);
};
function kick() { if (!raf) { clock.getDelta(); raf = requestAnimationFrame(tick); } }

controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleTimer); });
controls.addEventListener("end", () => {
  clearTimeout(idleTimer);
  if (!reduce.matches) idleTimer = setTimeout(() => { controls.autoRotate = true; }, 4000);
});

const size = () => {
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  kick();
};
new ResizeObserver(size).observe(box);
new IntersectionObserver((es) => { inView = es[0].isIntersecting; kick(); }).observe(box);
document.addEventListener("visibilitychange", kick);
size();
setPlaying(playing);

window.robotViewer = { show };
show(window.robotViewerPending || document.querySelector(".chip[data-open]").getAttribute("data-robot"));
