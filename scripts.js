/* ---------- Geometry & constants (inches space, then scaled to px) ---------- */
const TABLE_LEN = 100;   // playing surface length (inches) — long axis
const TABLE_WID = 50;    // playing surface width (inches)  — short axis
const BALL_D    = 2.25;  // ball diameter (inches)
const BALL_R    = BALL_D / 2;
const VSPACING  = BALL_D * Math.sqrt(3)/2; // row-to-row spacing in triangle packing
const HEAD_STRING_X = TABLE_LEN * 0.25;    // 25" from head rail
const FOOT_RAIL_OFFSET = 22;               // approx foot spot distance from foot rail
const FOOT_SPOT_X = TABLE_LEN - FOOT_RAIL_OFFSET;
const CENTER_Y   = TABLE_WID/2;
const POCKET_R   = 2.25;   // pocket radius (inches) to match drawing
const EDGE_CLEARANCE = BALL_R + 1.0; // keep ball centers well off the cushions

/* ---------- Color palette for balls (approximate) ---------- */
const COLORS = {
  0: "#ffffff", // cue
  1: "#f1c40f", 2: "#2980b9", 3: "#e74c3c", 4: "#8e44ad", 5: "#e67e22",
  6: "#27ae60", 7: "#8e2a2a", 8: "#111111",
  9: "#f1c40f", 10: "#2980b9", 11: "#e74c3c", 12: "#8e44ad", 13: "#e67e22", 14: "#27ae60", 15: "#8e2a2a"
};
const STRIPES = new Set([9, 10, 11, 12, 13, 14, 15]);

/* ---------- PRNG (Mulberry32) ---------- */
function mulberry32(a) { return function() { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; } }
function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min }
function randFloat(rng, min, max) { return rng() * (max - min) + min }
function hashSeed(s) {
  if (typeof s === "number") return (s >>> 0) || 0x9e3779b9;
  const str = String(s ?? "");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) || 0x9e3779b9;
}
function randomSeed() { if (crypto?.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0 } return (Date.now() >>> 0) }

/* ---------- Canvas setup ---------- */
const canvas = document.getElementById('table');
const ctx = canvas.getContext('2d', { alpha: false });
let scale = 14; // px per inch — larger by default
function resizeCanvas() {
  // Keep a pleasant aspect, max width based on container
  const parentW = canvas.parentElement.clientWidth - 12;
  const targetW = Math.min(1800, Math.max(900, parentW));
  const pxPerIn = targetW / TABLE_LEN;
  scale = pxPerIn;
  canvas.width = Math.round(TABLE_LEN * scale);
  canvas.height = Math.round(TABLE_WID * scale);
  draw();
}
window.addEventListener('resize', resizeCanvas);

/* ---------- Drawing helpers ---------- */
function drawDiamond(x, y, size, color){
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI/4);
  ctx.fillStyle = color;
  ctx.fillRect(-size/2, -size/2, size, size);
  ctx.restore();
}

/* ---------- State ---------- */
let state = {
  mode: "8",         // "8" or "9"
  seed: null,        // number
  rng: mulberry32(randomSeed()),
  lockRack: false,
  lockCue: false,
  showNumbers: true,
  balls: [],         // [{num,x,y}]
  cue: { x: 0, y: 0 },
  aimPoint: { x: FOOT_SPOT_X, y: CENTER_Y }, // where we aim on apex ball
  speedMph: 22,
  spin: { dx: 0, dy: 0, label: "Center" }
};

/* ---------- UI elements ---------- */
const $mode = document.getElementById('mode');
const $btnNext = document.getElementById('btnNext');

/* ---------- Helpers ---------- */
const toPx = (inches) => inches * scale;

// Playable insets (rails + cushion) in pixels for rendering
function getPlayInsets(){
  const railPx = Math.round(toPx(2.0));
  const cushionPx = Math.max(8, Math.round(toPx(0.9)));
  const originX = railPx + cushionPx;
  const originY = railPx + cushionPx;
  const innerWidthPx = canvas.width - (railPx + cushionPx) * 2;
  const innerHeightPx = canvas.height - (railPx + cushionPx) * 2;
  return { railPx, cushionPx, originX, originY, innerWidthPx, innerHeightPx };
}

// Map playfield inches (0..TABLE_LEN/WID) to pixel coords inside playable area
function playToPxX(xIn){ const { originX, innerWidthPx } = getPlayInsets(); return originX + (xIn / TABLE_LEN) * innerWidthPx; }
function playToPxY(yIn){ const { originY, innerHeightPx } = getPlayInsets(); return originY + (yIn / TABLE_WID) * innerHeightPx; }

function drawTable() {
  // Rails (wood)
  const railColor = getComputedStyle(document.documentElement).getPropertyValue('--rail');
  const feltColor = getComputedStyle(document.documentElement).getPropertyValue('--felt');
  const feltDark = getComputedStyle(document.documentElement).getPropertyValue('--felt-dark');
  const { railPx, cushionPx, originX, originY, innerWidthPx, innerHeightPx } = getPlayInsets();

  // Background rails
  ctx.fillStyle = railColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Region inside wood rails
  const tlx = railPx, tly = railPx, tw = canvas.width - railPx * 2, th = canvas.height - railPx * 2;

  // Cushions
  ctx.fillStyle = feltDark;
  ctx.fillRect(tlx, tly, tw, cushionPx);
  ctx.fillRect(tlx, tly + th - cushionPx, tw, cushionPx);
  ctx.fillRect(tlx, tly, cushionPx, th);
  ctx.fillRect(tlx + tw - cushionPx, tly, cushionPx, th);

  // Playable felt
  ctx.fillStyle = feltColor;
  ctx.fillRect(originX, originY, innerWidthPx, innerHeightPx);

  // Pockets (simple circles)
  const pocketR = toPx(2.25);
  const pockets = [
    [tlx, tly], [tlx + tw / 2, tly - 2], [tlx + tw, tly],
    [tlx, tly + th], [tlx + tw / 2, tly + th + 2], [tlx + tw, tly + th]
  ];
  ctx.save();
  ctx.fillStyle = "#0c0c0c";
  for (const [px, py] of pockets) {
    ctx.beginPath();
    ctx.arc(px, py, pocketR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Diamonds positioned on cushion centers
  const diamondColor = "#e8edf3";
  const ds = Math.max(4, Math.round(toPx(0.35)));
  const topY = tly + cushionPx / 2;
  const botY = tly + th - cushionPx / 2;
  const leftX = tlx + cushionPx / 2;
  const rightX = tlx + tw - cushionPx / 2;
  const topXs = [tlx + tw * 1/8, tlx + tw * 3/8, tlx + tw * 5/8, tlx + tw * 7/8];
  const sideYs = [tly + th * 1/4, tly + th * 2/4, tly + th * 3/4];
  for (const x of topXs) drawDiamond(x, topY, ds, diamondColor);
  for (const x of topXs) drawDiamond(x, botY, ds, diamondColor);
  for (const y of sideYs) drawDiamond(leftX, y, ds, diamondColor);
  for (const y of sideYs) drawDiamond(rightX, y, ds, diamondColor);

  // Head string (dotted) inside playable
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  const headX = playToPxX(HEAD_STRING_X);
  ctx.moveTo(headX, originY + 6);
  ctx.lineTo(headX, originY + innerHeightPx - 6);
  ctx.stroke();
  ctx.restore();

  // Foot spot mark
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.beginPath();
  ctx.arc(playToPxX(FOOT_SPOT_X), playToPxY(CENTER_Y), 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBall(xIn, yIn, num) {
  const { originX, originY } = getPlayInsets();
  const cx = playToPxX(xIn);
  const cy = playToPxY(yIn);
  const r  = toPx(BALL_R);

  ctx.save();
  // Draw base circle path
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();

  if (num === 0){
    ctx.fillStyle = "#fff";
    ctx.fill();
  } else if (STRIPES.has(num)){
    // Stripe: white base with crisp colored band
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.fillStyle = COLORS[num];
    const bandH = r * 0.95;
    ctx.fillRect(cx - r, cy - bandH/2, r*2, bandH);
    ctx.restore();
  } else {
    ctx.fillStyle = COLORS[num];
    ctx.fill();
  }

  // Outline for clarity
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  // Number circle
  if (num !== 0 && state.showNumbers){
    const ncR = r * 0.46;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(cx, cy, ncR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#222"; ctx.lineWidth = Math.max(1, r*0.06); ctx.stroke();
    ctx.fillStyle = "#000";
    const fontPx = Math.max(11, Math.floor(r * 0.95));
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(num), cx, cy + 0.5);
  }

  // Cue ball spin dot
  if (num === 0){
    const dot = { dx: state.spin.dx, dy: state.spin.dy };
    const mag = Math.hypot(dot.dx, dot.dy);
    const max = 0.6 * r;
    const k = mag > 0 ? Math.min(max, mag) / (mag || 1) : 0;
    const ox = dot.dx * k, oy = dot.dy * k;
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r * 0.10, 0, Math.PI * 2); ctx.fill();
  }

  // Subtle highlight
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(cx - r*0.35, cy - r*0.35, r*0.35, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

// Aim line removed for simplified UI

function draw() {
  drawTable();
  // balls except cue first, then cue on top
  for (const b of state.balls) { if (b.num !== 0) drawBall(b.x, b.y, b.num) }
  // cue ball last
  drawBall(state.cue.x, state.cue.y, 0);
}

/* ---------- Rack generation ---------- */
function rack8(rng) {
  // Build triangle positions (apex at FOOT_SPOT_X, centered vertically)
  const positions = [];
  for (let i = 0; i < 5; i++) {
    const rowCount = i + 1;
    const x = FOOT_SPOT_X - i * VSPACING;
    const yStart = CENTER_Y - (i * BALL_D) / 2;
    for (let j = 0; j < rowCount; j++) {
      positions.push({ i, j, x, y: yStart + j * BALL_D });
    }
  }
  // Number assignment with constraints:
  // - 8 in center (row i=2, j=1)
  // - back row corners: one solid and one stripe (random sides)
  // Other balls random
  const idxCenter = positions.findIndex(p => p.i === 2 && p.j === 1);
  const idxBackL  = positions.findIndex(p => p.i === 4 && p.j === 0);
  const idxBackR  = positions.findIndex(p => p.i === 4 && p.j === 4);

  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];

  // choose which side gets stripe
  const stripeLeft = (rng() < 0.5);
  const assign = new Array(positions.length).fill(null);

  // center 8
  assign[idxCenter] = 8;

  // back corners
  const pick = (arr) => arr.splice(randInt(rng, 0, arr.length - 1), 1)[0];
  if (stripeLeft) {
    assign[idxBackL] = pick(stripes);
    assign[idxBackR] = pick(solids);
  } else {
    assign[idxBackL] = pick(solids);
    assign[idxBackR] = pick(stripes);
  }

  // fill remaining (including apex)
  let rest = solids.concat(stripes);
  rest = rest.filter(n => !assign.includes(n));
  // shuffle
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  for (let k = 0; k < assign.length; k++) {
    if (assign[k] == null) assign[k] = rest.pop();
  }

  return positions.map((p, idx) => ({ num: assign[idx], x: p.x, y: p.y }));
}

function rack9(rng) {
  // diamond: rows 1,2,3,2,1
  const positions = [];
  for (let i = 0; i < 5; i++) {
    const rowCount = 1 + Math.min(i, 4 - i);
    const x = FOOT_SPOT_X - i * VSPACING;
    const yStart = CENTER_Y - ((rowCount - 1) * BALL_D / 2);
    for (let j = 0; j < rowCount; j++) {
      positions.push({ i, j, x, y: yStart + j * BALL_D });
    }
  }
  // Mapping positions to a grid to find apex & center
  const idxApex = positions.findIndex(p => p.i === 0 && p.j === 0);
  const idxCenter = positions.findIndex(p => p.i === 2 && p.j === 1);
  const assign = new Array(positions.length).fill(null);
  assign[idxApex] = 1;   // 1-ball at apex on foot spot
  assign[idxCenter] = 9; // 9-ball at center
  let rest = [2, 3, 4, 5, 6, 7, 8];
  // shuffle
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  for (let k = 0; k < assign.length; k++) {
    if (assign[k] == null) assign[k] = rest.pop();
  }
  return positions.map((p, idx) => ({ num: assign[idx], x: p.x, y: p.y }));
}

/* ---------- Post-break layout (scatter approximation) ---------- */
function clamp(val, min, max){ return Math.max(min, Math.min(max, val)); }

function isInAnyPocket(x, y){
  const centers = [
    [0, 0], [TABLE_LEN/2, 0], [TABLE_LEN, 0],
    [0, TABLE_WID], [TABLE_LEN/2, TABLE_WID], [TABLE_LEN, TABLE_WID]
  ];
  const clearance = POCKET_R + BALL_R; // ensure ball edge stays outside pocket circle
  for(const [cx, cy] of centers){
    if (Math.hypot(x - cx, y - cy) < clearance) return true;
  }
  return false;
}

function isNonOverlapping(x, y, placedBalls){
  // Avoid pockets entirely
  if (isInAnyPocket(x, y)) return false;
  for(const b of placedBalls){
    const dx = x - b.x, dy = y - b.y;
    if (Math.hypot(dx, dy) < BALL_D + 0.05) return false;
  }
  return true;
}

function randomPosAfterBreak(rng){
  // Bias positions away from rails; never sample inside the rail clearance
  let x, y;
  const r = rng();
  if (r < 0.50){
    // Foot-end half of table
    x = randFloat(rng, Math.max(EDGE_CLEARANCE, TABLE_LEN*0.55), TABLE_LEN - EDGE_CLEARANCE);
    y = randFloat(rng, EDGE_CLEARANCE, TABLE_WID - EDGE_CLEARANCE);
  } else if (r < 0.85){
    // Central zone
    x = randFloat(rng, EDGE_CLEARANCE + 4, TABLE_LEN - EDGE_CLEARANCE - 4);
    y = randFloat(rng, EDGE_CLEARANCE + 3, TABLE_WID - EDGE_CLEARANCE - 3);
  } else {
    // Anywhere safe
    x = randFloat(rng, EDGE_CLEARANCE, TABLE_LEN - EDGE_CLEARANCE);
    y = randFloat(rng, EDGE_CLEARANCE, TABLE_WID - EDGE_CLEARANCE);
  }
  return {x, y};
}

function scatterBallsAfterBreak(rng, balls){
  // Keep the numbers, generate non-overlapping positions
  const placed = [];
  const order = [...balls].sort((a,b)=> a.num - b.num); // deterministic-ish across seeds
  for(const b of order){
    let placedPos = null;
    for(let tries=0; tries<600 && !placedPos; tries++){
      const {x, y} = randomPosAfterBreak(rng);
      if (isNonOverlapping(x, y, placed)){
        placedPos = {x, y};
      }
    }
    // Fallback: very light relaxation around center if crowded
    if (!placedPos){ placedPos = {x: clamp(TABLE_LEN*0.5, BALL_R+0.3, TABLE_LEN-BALL_R-0.3), y: clamp(TABLE_WID*0.5, BALL_R+0.3, TABLE_WID-BALL_R-0.3)} }
    placed.push({ num: b.num, x: placedPos.x, y: placedPos.y });
  }
  return placed;
}

function computeCueAfterBreak(rng, balls){
  // Cue typically drifts back to head half after contact
  const edgeMarginX = EDGE_CLEARANCE;
  const edgeMarginY = EDGE_CLEARANCE;
  for(let tries=0; tries<400; tries++){
    const x = randFloat(rng, edgeMarginX, Math.max(edgeMarginX, HEAD_STRING_X + 8));
    const y = randFloat(rng, edgeMarginY, TABLE_WID - edgeMarginY);
    if (isNonOverlapping(x, y, balls)) return {x, y};
  }
  // Fallback to kitchen anywhere non-overlapping
  for(let tries=0; tries<400; tries++){
    const x = randFloat(rng, edgeMarginX, HEAD_STRING_X - edgeMarginX);
    const y = randFloat(rng, edgeMarginY, TABLE_WID - edgeMarginY);
    if (isNonOverlapping(x, y, balls)) return {x, y};
  }
  return {x: HEAD_STRING_X*0.8, y: CENTER_Y};
}

function pickNextShotTarget(mode, balls){
  const objects = balls.filter(b=> b.num !== 0);
  if (mode === "9"){
    const lowest = Math.min(...objects.map(b=> b.num));
    return objects.find(b=> b.num === lowest) || objects[0];
  }
  // 8-ball: unknown group. Pick nearest non-8 to cue for a practical first shot
  const nonEight = objects.filter(b=> b.num !== 8);
  if (nonEight.length === 0) return objects[0];
  let best = nonEight[0], bestD = Infinity;
  for(const b of nonEight){
    const d = Math.hypot(b.x - state.cue.x, b.y - state.cue.y);
    if (d < bestD){ bestD = d; best = b; }
  }
  return best;
}

/* ---------- Cue ball + aim + spin + speed ---------- */
function randomCueInKitchen(rng) {
  const pad = EDGE_CLEARANCE; // keep away from rails a touch
  const x = randFloat(rng, pad, HEAD_STRING_X - pad);
  const y = randFloat(rng, pad, TABLE_WID - pad);
  return { x, y };
}
function randomAimOnApex(rng, apex) {
  // small cut range: up to ~0.6 ball radius off center vertically
  const max = BALL_R * 0.6;
  const dy = randFloat(rng, -max, max);
  return { x: apex.x, y: apex.y + dy, dy };
}
function randomSpeed(rng) {
  // Typical break suggestion — tune to preference
  const mph = randInt(rng, 18, 27);
  const ms  = mph * 0.44704;
  return { mph, ms: Math.round(ms * 10) / 10 };
}
function randomSpin(rng) {
  // Prefer top or slight side for breaks
  const options = [
    { dx: 0, dy: -1, label: "Top" },
    { dx: 0.5, dy: -0.8, label: "Top-Right" },
    { dx: -0.5, dy: -0.8, label: "Top-Left" },
    { dx: 0, dy: 0, label: "Center" },
    { dx: 0.4, dy: 0, label: "Right" },
    { dx: -0.4, dy: 0, label: "Left" },
    { dx: 0, dy: 0.6, label: "Bottom (rare)" }
  ];
  return options[randInt(rng, 0, options.length - 1)];
}

/* ---------- Scenario generation ---------- */
function buildScenario({ keepRack = false, keepCue = false } = {}) {
  // Seed handling
  state.seed = randomSeed();
  state.rng = mulberry32(hashSeed(state.seed));

  // Mode
  state.mode = $mode.value;

  // Rack → scatter into a post-break layout
  if (!keepRack) {
    const racked = (state.mode === "8") ? rack8(state.rng) : rack9(state.rng);
    state.balls = scatterBallsAfterBreak(state.rng, racked);
  }

  // Cue rest + target aim line
  if (!keepCue) {
    state.cue = computeCueAfterBreak(state.rng, state.balls);
    const target = pickNextShotTarget(state.mode, state.balls);
    state.aimPoint = { x: target.x, y: target.y };
    // Keep speed/spin for display completeness, though they are not used for aiming here
    state.speedMph = randomSpeed(state.rng).mph;
    const sp = randomSpeed(state.rng);
    state.speedMps = sp.ms;
    state.spin = randomSpin(state.rng);
  }

  updateInfo();
  draw();
}

function updateInfo() {
  // UI summary removed in simplified layout
}

/* ---------- URL share / parse ---------- */
function updateURL() {
  const params = new URLSearchParams();
  params.set("mode", state.mode);
  params.set("seed", String(state.seed >>> 0));
  const url = `${location.origin}${location.pathname}?${params.toString()}`;
  return url;
}
function loadFromURL() {
  const q = new URLSearchParams(location.search);
  const mode = q.get("mode");
  if (mode && (mode === "8" || mode === "9")) $mode.value = mode;
}

/* ---------- Events ---------- */
$btnNext.addEventListener('click', () => {
  buildScenario({ keepRack: false, keepCue: false });
});
$mode.addEventListener('change', () => buildScenario({ keepRack: false, keepCue: false }));

document.addEventListener('keydown', (e) => {
  if (e.key === "n" || e.key === "N") { e.preventDefault(); $btnNext.click(); }
  if (e.key === "b" || e.key === "B") { state.showNumbers = !state.showNumbers; draw(); }
});

/* ---------- Boot ---------- */
loadFromURL();
resizeCanvas();
buildScenario(); // initial
