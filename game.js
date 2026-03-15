// ============================================================
// SLIME SOCCER - A retro arcade 2D physics soccer game
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- Constants ---
const W = 960;
const H = 540;
canvas.width = W;
canvas.height = H;

const GRAVITY = 0.45;
const GROUND_Y = H - 80;
const FRICTION = 0.985;
const BALL_RADIUS = 18;
const SLIME_RADIUS = 55;
const SLIME_HEIGHT = 30; // half-height of semicircle visual
const GOAL_WIDTH = 12;
const GOAL_DEPTH = 70;
const GOAL_HEIGHT = 130;
const NET_POST_WIDTH = 8;
const CEILING_Y = 10;
const JUMP_FORCE = -10.5;
const MOVE_SPEED = 5.5;
const BALL_BOUNCE = 0.72;
const SLIME_BOUNCE = 0.8;
const WALL_BOUNCE = 0.6;
const GRAB_DISTANCE = 70;
const GRAB_HOLD_MAX = 45; // frames you can hold the ball
const GRAB_COOLDOWN = 60;
const THROW_SPEED = 14;
const CAMP_THRESHOLD = 180; // frames before camping penalty
const CAMP_PENALTY_FORCE = 8;
const MAX_BALL_SPEED = 18;
const BOOST_DURATION = 300; // 5 seconds at 60fps
const BOOST_COOLDOWN = 600; // 10 second cooldown
const BOOST_SPEED_MULT = 1.5;

// --- Game State ---
let gameState = 'menu'; // menu, modeSelect, durationSelect, playing, goal, gameOver
let gameMode = 'single'; // single, multi
let matchDuration = 120; // seconds
let timeRemaining = 0;
let lastTimestamp = 0;
let accumulator = 0;
let scores = [0, 0];
let goalAnimTimer = 0;
let goalScorer = -1;
let menuSelection = 0;
let modeSelection = 0;
let durationSelection = 2; // default 2 minutes
let durationOptions = [1, 2, 3, 4, 5, 6, 7, 8];
let particles = [];
let screenShake = 0;
let flashTimer = 0;

// --- Input ---
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD','KeyE'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// --- Ball ---
const ball = {
  x: W / 2, y: 200,
  vx: 0, vy: 0,
  radius: BALL_RADIUS,
  rotation: 0,
  angularVel: 0,
  grabbed: false,
  grabbedBy: -1,
  grabAngle: 0,
  trail: []
};

// --- Slime ---
function createSlime(x, color, facing) {
  return {
    x, y: GROUND_Y,
    vx: 0, vy: 0,
    radius: SLIME_RADIUS,
    color,
    facing, // 1 = right, -1 = left
    onGround: true,
    grabTimer: 0,
    grabCooldown: 0,
    isGrabbing: false,
    campTimer: 0,
    campPenalized: false,
    eyeX: 0, eyeY: 0,
    score: 0,
    boostTimer: 0,
    boostCooldown: 0,
    isBoosted: false
  };
}

let slimes = [];

function resetPositions(scoredGoal) {
  ball.x = W / 2;
  ball.y = 200;
  ball.vx = (scoredGoal === 0 ? 3 : -3);
  ball.vy = -2;
  ball.grabbed = false;
  ball.grabbedBy = -1;
  ball.angularVel = 0;
  ball.trail = [];

  slimes[0].x = W * 0.25;
  slimes[0].y = GROUND_Y;
  slimes[0].vx = 0;
  slimes[0].vy = 0;
  slimes[0].grabTimer = 0;
  slimes[0].grabCooldown = 0;
  slimes[0].isGrabbing = false;
  slimes[0].campTimer = 0;
  slimes[0].boostTimer = 0;
  slimes[0].boostCooldown = 0;
  slimes[0].isBoosted = false;

  slimes[1].x = W * 0.75;
  slimes[1].y = GROUND_Y;
  slimes[1].vx = 0;
  slimes[1].vy = 0;
  slimes[1].grabTimer = 0;
  slimes[1].grabCooldown = 0;
  slimes[1].isGrabbing = false;
  slimes[1].campTimer = 0;
  slimes[1].boostTimer = 0;
  slimes[1].boostCooldown = 0;
  slimes[1].isBoosted = false;
}

function startGame() {
  slimes = [
    createSlime(W * 0.25, '#00e5ff', 1),
    createSlime(W * 0.75, '#ff3d3d', -1)
  ];
  scores = [0, 0];
  timeRemaining = matchDuration;
  lastTimestamp = performance.now();
  accumulator = 0;
  particles = [];
  resetPositions(-1);
  gameState = 'playing';
}

// --- Physics ---
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function updateBall() {
  if (ball.grabbed) {
    const slime = slimes[ball.grabbedBy];
    // Ball orbits around slime top
    ball.grabAngle += slime.facing * 0.08;
    ball.x = slime.x + Math.cos(ball.grabAngle) * (slime.radius * 0.7);
    ball.y = (slime.y - slime.radius * 0.3) + Math.sin(ball.grabAngle) * (slime.radius * 0.7);
    ball.vx = 0;
    ball.vy = 0;
    slime.grabTimer++;
    if (slime.grabTimer >= GRAB_HOLD_MAX) {
      releaseBall(ball.grabbedBy);
    }
    return;
  }

  ball.vy += GRAVITY;
  ball.x += ball.vx;
  ball.y += ball.vy;
  ball.vx *= FRICTION;

  ball.rotation += ball.angularVel;
  ball.angularVel *= 0.995;

  // Speed cap
  const speed = Math.sqrt(ball.vx ** 2 + ball.vy ** 2);
  if (speed > MAX_BALL_SPEED) {
    ball.vx = (ball.vx / speed) * MAX_BALL_SPEED;
    ball.vy = (ball.vy / speed) * MAX_BALL_SPEED;
  }

  // Ground bounce
  if (ball.y + ball.radius > GROUND_Y) {
    ball.y = GROUND_Y - ball.radius;
    ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    ball.angularVel = ball.vx * 0.05;
    if (Math.abs(ball.vy) < 1) ball.vy = 0;
  }

  // Ceiling
  if (ball.y - ball.radius < CEILING_Y) {
    ball.y = CEILING_Y + ball.radius;
    ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
  }

  // Wall bounces (accounting for goals)
  const goalTop = GROUND_Y - GOAL_HEIGHT;

  // Left wall
  if (ball.x - ball.radius < GOAL_DEPTH) {
    if (ball.y > goalTop && ball.y < GROUND_Y) {
      // In goal area - check for score
      if (ball.x - ball.radius < 0) {
        scoreGoal(1);
        return;
      }
      // Bounce off back wall of goal
      // Let ball enter goal area freely
    } else {
      // Above goal - bounce off wall at goal depth
      if (ball.x - ball.radius < GOAL_DEPTH) {
        // Check if hitting the crossbar area
        if (ball.y + ball.radius > goalTop - 10 && ball.y - ball.radius < goalTop + 10 && ball.x < GOAL_DEPTH + 10) {
          // Near crossbar
          ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE;
          ball.y = goalTop - ball.radius - 10;
        }
        ball.x = GOAL_DEPTH + ball.radius;
        ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
      }
    }
  }

  // Right wall
  if (ball.x + ball.radius > W - GOAL_DEPTH) {
    if (ball.y > goalTop && ball.y < GROUND_Y) {
      if (ball.x + ball.radius > W) {
        scoreGoal(0);
        return;
      }
    } else {
      if (ball.x + ball.radius > W - GOAL_DEPTH) {
        if (ball.y + ball.radius > goalTop - 10 && ball.y - ball.radius < goalTop + 10 && ball.x > W - GOAL_DEPTH - 10) {
          ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE;
          ball.y = goalTop - ball.radius - 10;
        }
        ball.x = W - GOAL_DEPTH - ball.radius;
        ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
      }
    }
  }

  // Goal post collisions
  collideWithGoalPosts();

  // Trail
  ball.trail.push({ x: ball.x, y: ball.y });
  if (ball.trail.length > 12) ball.trail.shift();
}

function collideWithGoalPosts() {
  const goalTop = GROUND_Y - GOAL_HEIGHT;
  // Left goal posts
  const posts = [
    { x: GOAL_DEPTH, y: goalTop }, // left goal top post
    { x: W - GOAL_DEPTH, y: goalTop }, // right goal top post
  ];

  for (const post of posts) {
    const d = dist(ball.x, ball.y, post.x, post.y);
    if (d < ball.radius + NET_POST_WIDTH / 2) {
      const nx = (ball.x - post.x) / d;
      const ny = (ball.y - post.y) / d;
      ball.x = post.x + nx * (ball.radius + NET_POST_WIDTH / 2);
      ball.y = post.y + ny * (ball.radius + NET_POST_WIDTH / 2);
      const dot = ball.vx * nx + ball.vy * ny;
      ball.vx -= 2 * dot * nx * (1 - WALL_BOUNCE);
      ball.vy -= 2 * dot * ny * (1 - WALL_BOUNCE);
      ball.vx -= dot * nx;
      ball.vy -= dot * ny;
      spawnParticles(post.x, post.y, '#fff', 3);
    }
  }
}

function releaseBall(playerIdx) {
  const slime = slimes[playerIdx];
  ball.grabbed = false;
  ball.grabbedBy = -1;
  slime.isGrabbing = false;
  slime.grabCooldown = GRAB_COOLDOWN;

  // Throw in facing direction with some upward arc
  const throwAngle = ball.grabAngle;
  ball.vx = Math.cos(throwAngle) * THROW_SPEED + slime.vx * 0.5;
  ball.vy = Math.sin(throwAngle) * THROW_SPEED - 3;
  ball.angularVel = slime.facing * 0.3;

  spawnParticles(ball.x, ball.y, slime.color, 8);
  screenShake = 5;
}

function tryGrabBall(playerIdx) {
  const slime = slimes[playerIdx];
  if (slime.grabCooldown > 0 || ball.grabbed) return;

  const d = dist(slime.x, slime.y - slime.radius * 0.3, ball.x, ball.y);
  if (d < GRAB_DISTANCE + ball.radius) {
    ball.grabbed = true;
    ball.grabbedBy = playerIdx;
    ball.grabAngle = Math.atan2(
      ball.y - (slime.y - slime.radius * 0.3),
      ball.x - slime.x
    );
    slime.isGrabbing = true;
    slime.grabTimer = 0;
    spawnParticles(ball.x, ball.y, '#fff', 5);
  }
}

function activateBoost(playerIdx) {
  const slime = slimes[playerIdx];
  if (slime.boostCooldown > 0 || slime.isBoosted) return;
  slime.isBoosted = true;
  slime.boostTimer = BOOST_DURATION;
  spawnParticles(slime.x, slime.y - slime.radius * 0.5, '#ffd740', 15);
  screenShake = 4;
}

function scoreGoal(scoringPlayer) {
  scores[scoringPlayer]++;
  goalScorer = scoringPlayer;
  goalAnimTimer = 120;
  gameState = 'goal';
  screenShake = 15;
  flashTimer = 10;

  // Explosion of particles at goal
  const gx = scoringPlayer === 0 ? W - GOAL_DEPTH / 2 : GOAL_DEPTH / 2;
  spawnParticles(gx, GROUND_Y - GOAL_HEIGHT / 2, slimes[scoringPlayer].color, 30);
  spawnParticles(gx, GROUND_Y - GOAL_HEIGHT / 2, '#fff', 15);
}

function collideBallSlime(slime) {
  if (ball.grabbed) return;

  // Semicircle collision - only the top half
  const slimeTopY = slime.y - slime.radius * 0.1;
  const dx = ball.x - slime.x;
  const dy = ball.y - slimeTopY;
  const d = Math.sqrt(dx * dx + dy * dy);
  const minDist = ball.radius + slime.radius;

  if (d < minDist && dy < slime.radius * 0.5) {
    // Normal vector
    const nx = dx / d;
    const ny = dy / d;

    // Separate
    ball.x = slime.x + nx * minDist;
    ball.y = slimeTopY + ny * minDist;

    // Relative velocity
    const rvx = ball.vx - slime.vx;
    const rvy = ball.vy - slime.vy;
    const rvDot = rvx * nx + rvy * ny;

    if (rvDot < 0) {
      const hitMult = slime.isBoosted ? BOOST_SPEED_MULT : 1;
      const impulse = -(1 + SLIME_BOUNCE) * rvDot * hitMult;
      ball.vx += impulse * nx;
      ball.vy += impulse * ny;

      // Add some of the slime's velocity
      ball.vx += slime.vx * 0.3 * hitMult;
      ball.vy += slime.vy * 0.3 * hitMult;

      // Spin based on hit position
      ball.angularVel += (ball.x - slime.x) * 0.01;

      // Particles on hard hits
      if (Math.abs(rvDot) > 5) {
        spawnParticles(ball.x - nx * ball.radius, ball.y - ny * ball.radius, slime.color, 5);
        screenShake = Math.min(Math.abs(rvDot) * 0.5, 8);
      }
    }
  }
}

function updateSlime(slime, idx) {
  // Apply gravity
  slime.vy += GRAVITY;
  slime.x += slime.vx;
  slime.y += slime.vy;

  // Ground collision
  if (slime.y >= GROUND_Y) {
    slime.y = GROUND_Y;
    slime.vy = 0;
    slime.onGround = true;
  } else {
    slime.onGround = false;
  }

  // Wall constraints
  const goalTop = GROUND_Y - GOAL_HEIGHT;
  const leftBound = GOAL_DEPTH + slime.radius;
  const rightBound = W - GOAL_DEPTH - slime.radius;

  if (slime.x - slime.radius < GOAL_DEPTH) {
    if (slime.y < goalTop) {
      slime.x = leftBound;
    }
  }
  if (slime.x + slime.radius > W - GOAL_DEPTH) {
    if (slime.y < goalTop) {
      slime.x = rightBound;
    }
  }

  // Keep on screen
  slime.x = clamp(slime.x, slime.radius, W - slime.radius);

  // Deceleration
  if (slime.onGround) {
    slime.vx *= 0.85;
  } else {
    slime.vx *= 0.97;
  }

  // Cooldowns
  if (slime.grabCooldown > 0) slime.grabCooldown--;

  // Boost update
  if (slime.isBoosted) {
    slime.boostTimer--;
    if (slime.boostTimer <= 0) {
      slime.isBoosted = false;
      slime.boostCooldown = BOOST_COOLDOWN;
    }
  } else if (slime.boostCooldown > 0) {
    slime.boostCooldown--;
  }

  // Anti-camping detection
  const ownGoalX = idx === 0 ? GOAL_DEPTH + slime.radius + 30 : W - GOAL_DEPTH - slime.radius - 30;
  if (Math.abs(slime.x - ownGoalX) < 80 && slime.y > goalTop) {
    slime.campTimer++;
    if (slime.campTimer > CAMP_THRESHOLD && !slime.campPenalized) {
      slime.campPenalized = true;
      // Push player away from goal
      slime.vx = slime.facing * CAMP_PENALTY_FORCE;
      slime.vy = -6;
      spawnParticles(slime.x, slime.y - slime.radius, '#ff0', 10);
    }
  } else {
    slime.campTimer = Math.max(0, slime.campTimer - 2);
    if (slime.campTimer === 0) slime.campPenalized = false;
  }

  // Eye tracking
  const eyeTargetX = ball.x - slime.x;
  const eyeTargetY = ball.y - (slime.y - slime.radius * 0.5);
  const eyeDist = Math.sqrt(eyeTargetX ** 2 + eyeTargetY ** 2);
  slime.eyeX = (eyeTargetX / eyeDist) * 5;
  slime.eyeY = (eyeTargetY / eyeDist) * 3;

  // Slime-ball collision
  collideBallSlime(slime);
}

// --- Slime vs Slime collision ---
function collideSlimes() {
  const s0 = slimes[0];
  const s1 = slimes[1];
  const dx = s1.x - s0.x;
  const dy = (s1.y - s1.radius * 0.3) - (s0.y - s0.radius * 0.3);
  const d = Math.sqrt(dx * dx + dy * dy);
  const minDist = s0.radius + s1.radius;

  if (d < minDist && d > 0) {
    const nx = dx / d;
    const ny = dy / d;
    const overlap = minDist - d;

    s0.x -= nx * overlap * 0.5;
    s1.x += nx * overlap * 0.5;

    const rvx = s0.vx - s1.vx;
    const dot = rvx * nx;
    if (dot > 0) {
      s0.vx -= dot * nx * 0.5;
      s1.vx += dot * nx * 0.5;
    }
  }
}

// --- Player Input ---
function handlePlayerInput(slime, idx) {
  const speed = slime.isBoosted ? MOVE_SPEED * BOOST_SPEED_MULT : MOVE_SPEED;
  if (idx === 0) {
    // Player 1: Arrow keys, Space = boost
    if (keys['ArrowLeft']) slime.vx = -speed;
    if (keys['ArrowRight']) slime.vx = speed;
    if (keys['ArrowUp'] && slime.onGround) slime.vy = JUMP_FORCE;
    if (keys['ArrowDown']) {
      if (slime.isGrabbing) {
        releaseBall(idx);
      } else {
        tryGrabBall(idx);
      }
    }
    if (keys['Space']) activateBoost(idx);
  } else if (idx === 1 && gameMode === 'multi') {
    // Player 2: WASD, E = boost
    if (keys['KeyA']) slime.vx = -speed;
    if (keys['KeyD']) slime.vx = speed;
    if (keys['KeyW'] && slime.onGround) slime.vy = JUMP_FORCE;
    if (keys['KeyS']) {
      if (slime.isGrabbing) {
        releaseBall(idx);
      } else {
        tryGrabBall(idx);
      }
    }
    if (keys['KeyE']) activateBoost(idx);
  }
}

// --- AI ---
function updateAI(slime, idx) {
  const targetX = ball.x;
  const targetY = ball.y;
  const myGoalX = W - GOAL_DEPTH;
  const opponentGoalX = GOAL_DEPTH;

  // Predict ball position
  const predictFrames = 20;
  let predX = ball.x + ball.vx * predictFrames;
  let predY = ball.y + ball.vy * predictFrames + 0.5 * GRAVITY * predictFrames * predictFrames;
  predX = clamp(predX, GOAL_DEPTH, W - GOAL_DEPTH);

  const distToBall = dist(slime.x, slime.y, ball.x, ball.y);
  const ballOnMySide = ball.x > W / 2;
  const ballHeadingToMe = ball.vx > 0;
  const ballNearMyGoal = ball.x > W * 0.7;

  // Decision making
  let targetPosX = W * 0.65; // default defensive position
  let shouldJump = false;
  let shouldGrab = false;

  if (ball.grabbed && ball.grabbedBy === idx) {
    // I have the ball - throw it toward opponent's goal
    releaseBall(idx);
    return;
  }

  if (ballNearMyGoal || (ballOnMySide && ballHeadingToMe)) {
    // Defensive - go to ball
    targetPosX = predX + 20; // slightly behind ball to hit it forward
    shouldJump = ball.y < slime.y - slime.radius && distToBall < 200;
    shouldGrab = distToBall < GRAB_DISTANCE + ball.radius + 20 && slime.grabCooldown <= 0;
  } else if (ball.x < W * 0.45) {
    // Ball on opponent's side - push forward
    targetPosX = Math.min(ball.x + 50, W * 0.6);
    shouldJump = distToBall < 150 && ball.y < slime.y - 30;
  } else {
    // Ball in middle - position for interception
    targetPosX = clamp(predX + 30, W * 0.5, W * 0.85);
    shouldJump = distToBall < 180 && ball.y < slime.y - 20;
  }

  // Aggressive when behind
  if (scores[0] > scores[1] && timeRemaining < matchDuration * 0.3) {
    targetPosX = Math.min(targetPosX, ball.x + 40);
    shouldJump = shouldJump || (distToBall < 200 && ball.y < slime.y);
  }

  // AI boost: activate when ball is close and on my side, or when behind on score
  const aiSpeed = slime.isBoosted ? MOVE_SPEED * BOOST_SPEED_MULT : MOVE_SPEED;
  if (!slime.isBoosted && slime.boostCooldown <= 0) {
    const shouldBoost = (ballNearMyGoal && distToBall < 150) ||
      (scores[0] > scores[1] && timeRemaining < matchDuration * 0.3 && distToBall < 200);
    if (shouldBoost) activateBoost(idx);
  }

  // Movement
  const moveThreshold = 15;
  if (slime.x < targetPosX - moveThreshold) {
    slime.vx = aiSpeed * 0.9;
  } else if (slime.x > targetPosX + moveThreshold) {
    slime.vx = -aiSpeed * 0.9;
  }

  // Jump
  if (shouldJump && slime.onGround) {
    slime.vy = JUMP_FORCE;
  }

  // Grab
  if (shouldGrab && !ball.grabbed) {
    tryGrabBall(idx);
  }
}

// --- Particles ---
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5 + 1;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 30 + Math.random() * 20,
      maxLife: 50,
      color,
      size: Math.random() * 4 + 2
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// --- Drawing ---
function drawField() {
  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGrad.addColorStop(0, '#1a237e');
  skyGrad.addColorStop(0.5, '#283593');
  skyGrad.addColorStop(1, '#3949ab');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, GROUND_Y);

  // Field lines
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, CEILING_Y);
  ctx.lineTo(W / 2, GROUND_Y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(W / 2, GROUND_Y, 80, Math.PI, 0);
  ctx.stroke();

  // Ground
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  groundGrad.addColorStop(0, '#546e7a');
  groundGrad.addColorStop(1, '#37474f');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  // Ground line
  ctx.strokeStyle = '#78909c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(W, GROUND_Y);
  ctx.stroke();

  // Ground texture
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let x = 0; x < W; x += 30) {
    ctx.fillRect(x, GROUND_Y + 5, 15, H - GROUND_Y - 10);
  }
}

function drawGoal(x, side) {
  const goalTop = GROUND_Y - GOAL_HEIGHT;

  // Goal back
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  if (side === 'left') {
    ctx.fillRect(0, goalTop, GOAL_DEPTH, GOAL_HEIGHT);
  } else {
    ctx.fillRect(W - GOAL_DEPTH, goalTop, GOAL_DEPTH, GOAL_HEIGHT);
  }

  // Net pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  const netX = side === 'left' ? 0 : W - GOAL_DEPTH;
  for (let ny = goalTop; ny < GROUND_Y; ny += 12) {
    ctx.beginPath();
    ctx.moveTo(netX, ny);
    ctx.lineTo(netX + GOAL_DEPTH, ny);
    ctx.stroke();
  }
  for (let nx = netX; nx <= netX + GOAL_DEPTH; nx += 12) {
    ctx.beginPath();
    ctx.moveTo(nx, goalTop);
    ctx.lineTo(nx, GROUND_Y);
    ctx.stroke();
  }

  // Goal frame
  ctx.fillStyle = '#eceff1';
  // Post
  if (side === 'left') {
    ctx.fillRect(GOAL_DEPTH - NET_POST_WIDTH / 2, goalTop, NET_POST_WIDTH, GOAL_HEIGHT);
    // Crossbar
    ctx.fillRect(0, goalTop - NET_POST_WIDTH / 2, GOAL_DEPTH, NET_POST_WIDTH);
  } else {
    ctx.fillRect(W - GOAL_DEPTH - NET_POST_WIDTH / 2, goalTop, NET_POST_WIDTH, GOAL_HEIGHT);
    ctx.fillRect(W - GOAL_DEPTH, goalTop - NET_POST_WIDTH / 2, GOAL_DEPTH, NET_POST_WIDTH);
  }
}

function drawSlime(slime) {
  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(slime.x, GROUND_Y + 3, slime.radius * 0.8, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body (semicircle)
  const bodyGrad = ctx.createRadialGradient(
    slime.x - 10, slime.y - slime.radius * 0.5, 5,
    slime.x, slime.y, slime.radius
  );
  bodyGrad.addColorStop(0, lightenColor(slime.color, 40));
  bodyGrad.addColorStop(1, slime.color);
  ctx.fillStyle = bodyGrad;

  ctx.beginPath();
  ctx.arc(slime.x, slime.y, slime.radius, Math.PI, 0);
  ctx.closePath();
  ctx.fill();

  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Eye white
  const eyeBaseX = slime.x + slime.facing * 15;
  const eyeBaseY = slime.y - slime.radius * 0.45;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(eyeBaseX, eyeBaseY, 12, 0, Math.PI * 2);
  ctx.fill();

  // Pupil
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(eyeBaseX + slime.eyeX, eyeBaseY + slime.eyeY, 5, 0, Math.PI * 2);
  ctx.fill();

  // Grab indicator
  if (slime.isGrabbing) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(slime.x, slime.y - slime.radius * 0.3, GRAB_DISTANCE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Super Mode SSJ aura effect
  if (slime.isBoosted) {
    const t = Date.now() * 0.001;
    ctx.save();

    // Outer aura glow (pulsing)
    const glowAlpha = 0.2 + Math.sin(t * 4) * 0.1;
    ctx.shadowColor = '#ffd740';
    ctx.shadowBlur = 35 + Math.sin(t * 5) * 10;
    ctx.fillStyle = `rgba(255, 215, 64, ${glowAlpha})`;
    ctx.beginPath();
    ctx.arc(slime.x, slime.y, slime.radius + 12 + Math.sin(t * 6) * 4, Math.PI, 0);
    ctx.closePath();
    ctx.fill();

    // Flame-like aura tendrils rising upward
    ctx.shadowBlur = 0;
    for (let i = 0; i < 7; i++) {
      const angle = Math.PI + (i / 6) * Math.PI;
      const baseX = slime.x + Math.cos(angle) * (slime.radius * 0.8);
      const baseY = slime.y + Math.sin(angle) * (slime.radius * 0.4);
      const flameH = 20 + Math.sin(t * 6 + i * 2.3) * 15 + Math.sin(t * 3.7 + i) * 8;
      const flameW = 8 + Math.sin(t * 5 + i) * 4;
      const sway = Math.sin(t * 4.5 + i * 1.7) * 6;

      const auraGrad = ctx.createLinearGradient(baseX, baseY, baseX + sway, baseY - flameH);
      auraGrad.addColorStop(0, 'rgba(255, 215, 64, 0.6)');
      auraGrad.addColorStop(0.4, 'rgba(255, 180, 0, 0.35)');
      auraGrad.addColorStop(1, 'rgba(255, 255, 200, 0)');
      ctx.fillStyle = auraGrad;

      ctx.beginPath();
      ctx.moveTo(baseX - flameW / 2, baseY);
      ctx.quadraticCurveTo(baseX + sway - flameW / 3, baseY - flameH * 0.6, baseX + sway, baseY - flameH);
      ctx.quadraticCurveTo(baseX + sway + flameW / 3, baseY - flameH * 0.6, baseX + flameW / 2, baseY);
      ctx.closePath();
      ctx.fill();
    }

    // Lightning bolts - arcing outward/diagonally like SSJ2
    // Use a seeded slow cycle so bolts persist and animate smoothly
    const boltCycle = Math.floor(t * 2.5); // new bolt pattern every ~0.4s
    const boltFade = (t * 2.5) % 1; // 0-1 fade within each cycle
    const boltAlpha = boltFade < 0.7 ? 1 : 1 - (boltFade - 0.7) / 0.3; // fade out last 30%

    // Seeded random for consistent bolts within a cycle
    function seededRand(seed) {
      const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    }

    const numBolts = 3;
    for (let b = 0; b < numBolts; b++) {
      const seed = boltCycle * 10 + b;

      // Start from body surface
      const startAngle = Math.PI + seededRand(seed) * Math.PI;
      const startX = slime.x + Math.cos(startAngle) * (slime.radius + 5);
      const startY = slime.y + Math.sin(startAngle) * (slime.radius * 0.4);

      // Arc direction: outward and slightly up/down, spreading wide
      const outDir = startAngle + (seededRand(seed + 1) - 0.5) * 1.2;
      const boltLen = 50 + seededRand(seed + 2) * 50; // 50-100px long

      ctx.beginPath();
      let lx = startX;
      let ly = startY;
      ctx.moveTo(lx, ly);

      const segments = 5 + Math.floor(seededRand(seed + 3) * 3);
      for (let s = 0; s < segments; s++) {
        const progress = (s + 1) / segments;
        // Main direction is outward along outDir
        const mainX = startX + Math.cos(outDir) * boltLen * progress;
        const mainY = startY + Math.sin(outDir) * boltLen * progress;
        // Add jagged offsets perpendicular to the bolt direction
        const perpX = -Math.sin(outDir);
        const perpY = Math.cos(outDir);
        const jag = (seededRand(seed + s * 7 + 4) - 0.5) * 30;
        lx = mainX + perpX * jag;
        ly = mainY + perpY * jag;
        ctx.lineTo(lx, ly);

        // Occasional branch fork
        if (seededRand(seed + s * 13 + 50) < 0.3) {
          const branchDir = outDir + (seededRand(seed + s * 17) - 0.5) * 1.5;
          const branchLen = 15 + seededRand(seed + s * 19) * 25;
          ctx.moveTo(lx, ly);
          let bx = lx, by = ly;
          for (let bs = 0; bs < 3; bs++) {
            bx += Math.cos(branchDir) * (branchLen / 3) + (seededRand(seed + s * 23 + bs) - 0.5) * 12;
            by += Math.sin(branchDir) * (branchLen / 3) + (seededRand(seed + s * 29 + bs) - 0.5) * 12;
            ctx.lineTo(bx, by);
          }
          ctx.moveTo(lx, ly);
        }
      }

      // Outer glow stroke
      ctx.strokeStyle = `rgba(100, 180, 255, ${0.35 * boltAlpha})`;
      ctx.lineWidth = 4;
      ctx.stroke();

      // Main bolt
      ctx.strokeStyle = `rgba(150, 210, 255, ${0.7 * boltAlpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Bright core
      ctx.strokeStyle = `rgba(220, 240, 255, ${0.9 * boltAlpha})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    ctx.restore();

    // Aura particles rising up (slower spawn)
    if (Math.random() < 0.35) {
      spawnParticles(
        slime.x + (Math.random() - 0.5) * slime.radius * 1.5,
        slime.y - Math.random() * slime.radius * 0.8,
        Math.random() < 0.7 ? '#ffd740' : '#ffe082', 1
      );
    }
    // Occasional electric spark particle
    if (Math.random() < 0.08) {
      spawnParticles(
        slime.x + (Math.random() - 0.5) * slime.radius * 2.5,
        slime.y - Math.random() * slime.radius * 1.2,
        '#aaddff', 1
      );
    }
  }

  // Camp warning
  if (slime.campTimer > CAMP_THRESHOLD * 0.6) {
    const warningAlpha = (Math.sin(Date.now() * 0.01) + 1) * 0.3;
    ctx.fillStyle = `rgba(255, 255, 0, ${warningAlpha})`;
    ctx.font = 'bold 14px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('! CAMPING !', slime.x, slime.y - slime.radius - 15);
  }

  ctx.restore();
}

function drawBall() {
  // Trail
  for (let i = 0; i < ball.trail.length; i++) {
    const t = ball.trail[i];
    const alpha = (i / ball.trail.length) * 0.3;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    const trailSize = (i / ball.trail.length) * ball.radius;
    ctx.arc(t.x, t.y, trailSize, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(ball.x, GROUND_Y + 3, ball.radius * 0.6, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ball body
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.rotation);

  const ballGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, ball.radius);
  ballGrad.addColorStop(0, '#fff');
  ballGrad.addColorStop(1, '#ccc');
  ctx.fillStyle = ballGrad;
  ctx.beginPath();
  ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // Ball pattern (soccer pentagon pattern)
  ctx.fillStyle = '#333';
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const px = Math.cos(angle) * ball.radius * 0.5;
    const py = Math.sin(angle) * ball.radius * 0.5;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Grab cooldown indicator near ball if recently released
  if (ball.grabbed) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    const progress = slimes[ball.grabbedBy].grabTimer / GRAB_HOLD_MAX;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
}

function drawParticles() {
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  // Score
  ctx.font = 'bold 48px Courier New';
  ctx.textAlign = 'center';

  // Player 1 score
  ctx.fillStyle = slimes[0].color;
  ctx.fillText(scores[0], W * 0.35, 55);

  // Dash
  ctx.fillStyle = '#fff';
  ctx.fillText('-', W * 0.5, 55);

  // Player 2 score
  ctx.fillStyle = slimes[1].color;
  ctx.fillText(scores[1], W * 0.65, 55);

  // Timer
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = Math.floor(timeRemaining % 60);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  ctx.font = 'bold 20px Courier New';
  ctx.fillStyle = timeRemaining < 30 ? '#ff5252' : '#fff';
  ctx.fillText(timeStr, W / 2, 80);

  // Labels
  ctx.font = '14px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('P1', W * 0.35, 70);
  ctx.fillText(gameMode === 'single' ? 'AI' : 'P2', W * 0.65, 70);

  // Grab cooldown indicators
  for (let i = 0; i < 2; i++) {
    const slime = slimes[i];
    if (slime.grabCooldown > 0) {
      const barX = i === 0 ? 20 : W - 120;
      const barW = 100;
      const progress = 1 - slime.grabCooldown / GRAB_COOLDOWN;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(barX, H - 25, barW, 8);
      ctx.fillStyle = slime.color;
      ctx.fillRect(barX, H - 25, barW * progress, 8);
      ctx.font = '10px Courier New';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText('GRAB', i === 0 ? barX : barX + barW, H - 30);
    }
  }

  // Super Mode HUD indicators
  for (let i = 0; i < 2; i++) {
    const slime = slimes[i];
    const barX = i === 0 ? 20 : W - 120;
    const barW = 100;
    const barY = H - 45;

    if (slime.isBoosted) {
      // Active — show remaining duration
      const progress = slime.boostTimer / BOOST_DURATION;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(barX, barY, barW, 8);
      ctx.fillStyle = '#ffd740';
      ctx.fillRect(barX, barY, barW * progress, 8);
      ctx.font = 'bold 10px Courier New';
      ctx.fillStyle = '#ffd740';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText('SUPER MODE', i === 0 ? barX : barX + barW, barY - 4);
    } else if (slime.boostCooldown > 0) {
      // On cooldown — show recharge progress
      const progress = 1 - slime.boostCooldown / BOOST_COOLDOWN;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(barX, barY, barW, 8);
      ctx.fillStyle = 'rgba(255, 215, 64, 0.4)';
      ctx.fillRect(barX, barY, barW * progress, 8);
      ctx.font = '10px Courier New';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText('SUPER MODE', i === 0 ? barX : barX + barW, barY - 4);
    } else {
      // Ready to use
      const pulse = 0.5 + Math.sin(Date.now() * 0.005) * 0.2;
      ctx.fillStyle = `rgba(255, 215, 64, ${pulse})`;
      ctx.fillRect(barX, barY, barW, 8);
      ctx.font = 'bold 10px Courier New';
      ctx.fillStyle = '#ffd740';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText('SUPER READY', i === 0 ? barX : barX + barW, barY - 4);
    }
  }

  ctx.textAlign = 'center';
}

function drawMenu() {
  // Background
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, W, H);

  // Animated background particles
  const time = Date.now() * 0.001;
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 50; i++) {
    const x = (Math.sin(time + i * 1.3) * 0.5 + 0.5) * W;
    const y = (Math.cos(time * 0.7 + i * 0.9) * 0.5 + 0.5) * H;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Title
  ctx.font = 'bold 72px Courier New';
  ctx.textAlign = 'center';

  // Title shadow
  ctx.fillStyle = 'rgba(0,229,255,0.3)';
  ctx.fillText('SLIME SOCCER', W / 2 + 3, 140 + 3);

  // Title gradient effect
  const titleGrad = ctx.createLinearGradient(W / 2 - 250, 100, W / 2 + 250, 140);
  titleGrad.addColorStop(0, '#00e5ff');
  titleGrad.addColorStop(0.5, '#fff');
  titleGrad.addColorStop(1, '#ff3d3d');
  ctx.fillStyle = titleGrad;
  ctx.fillText('SLIME SOCCER', W / 2, 140);

  // Decorative slimes
  drawMenuSlime(W * 0.3, 250, '#00e5ff', 1);
  drawMenuSlime(W * 0.7, 250, '#ff3d3d', -1);

  // Ball between them
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(W / 2, 235, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(W / 2, 235, 4, 0, Math.PI * 2);
  ctx.fill();

  // Menu options
  const options = ['PLAY', 'CONTROLS'];
  ctx.font = 'bold 28px Courier New';

  for (let i = 0; i < options.length; i++) {
    const y = 340 + i * 55;
    const selected = i === menuSelection;

    if (selected) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(W / 2 - 150, y - 25, 300, 40);
      ctx.fillStyle = '#00e5ff';
      ctx.fillText('> ' + options[i] + ' <', W / 2, y);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(options[i], W / 2, y);
    }
  }

  // Footer
  ctx.font = '14px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('Arrow Keys to Navigate  |  Enter to Select', W / 2, H - 30);
}

function drawMenuSlime(x, baseY, color, facing) {
  const bounce = Math.sin(Date.now() * 0.003) * 5;
  const y = baseY + bounce;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 40, Math.PI, 0);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + facing * 12, y - 18, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(x + facing * 14, y - 18, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawModeSelect() {
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, W, H);

  ctx.font = 'bold 40px Courier New';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('SELECT MODE', W / 2, 100);

  const modes = [
    { label: 'SINGLE PLAYER', desc: 'Play against AI', icon: 'VS AI' },
    { label: 'LOCAL MULTIPLAYER', desc: 'P1: Arrows  P2: WASD', icon: 'VS P2' }
  ];

  for (let i = 0; i < modes.length; i++) {
    const y = 200 + i * 120;
    const selected = i === modeSelection;

    if (selected) {
      ctx.fillStyle = 'rgba(0,229,255,0.1)';
      ctx.fillRect(W / 2 - 250, y - 40, 500, 80);
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - 250, y - 40, 500, 80);
    }

    ctx.font = 'bold 28px Courier New';
    ctx.fillStyle = selected ? '#00e5ff' : 'rgba(255,255,255,0.5)';
    ctx.fillText(modes[i].label, W / 2, y);

    ctx.font = '16px Courier New';
    ctx.fillStyle = selected ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
    ctx.fillText(modes[i].desc, W / 2, y + 25);
  }

  ctx.font = '14px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('Up/Down to Select  |  Enter to Confirm  |  Esc to Back', W / 2, H - 30);
}

function drawDurationSelect() {
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, W, H);

  ctx.font = 'bold 40px Courier New';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('MATCH DURATION', W / 2, 80);

  ctx.font = '16px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('How long should the match be?', W / 2, 115);

  // Duration grid
  const cols = 4;
  const cellW = 100;
  const cellH = 60;
  const startX = W / 2 - (cols * cellW + (cols - 1) * 15) / 2;
  const startY = 160;

  for (let i = 0; i < durationOptions.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cellW + 15);
    const y = startY + row * (cellH + 15);
    const selected = i === durationSelection;

    ctx.fillStyle = selected ? 'rgba(0,229,255,0.2)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, cellW, cellH);

    if (selected) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cellW, cellH);
    }

    ctx.font = 'bold 24px Courier New';
    ctx.fillStyle = selected ? '#00e5ff' : 'rgba(255,255,255,0.6)';
    ctx.fillText(durationOptions[i] + 'min', x + cellW / 2, y + cellH / 2 + 8);
  }

  ctx.font = '14px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('Arrow Keys to Select  |  Enter to Start  |  Esc to Back', W / 2, H - 30);
}

function drawControls() {
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, W, H);

  ctx.font = 'bold 40px Courier New';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('CONTROLS', W / 2, 80);

  const sections = [
    {
      title: 'PLAYER 1 (Cyan)',
      color: '#00e5ff',
      controls: [
        ['Left / Right', 'Move'],
        ['Up', 'Jump'],
        ['Down', 'Grab / Throw Ball'],
        ['Space', 'Super Mode (5s)']
      ]
    },
    {
      title: 'PLAYER 2 (Red)',
      color: '#ff3d3d',
      controls: [
        ['A / D', 'Move'],
        ['W', 'Jump'],
        ['S', 'Grab / Throw Ball'],
        ['E', 'Super Mode (5s)']
      ]
    }
  ];

  let yOff = 130;
  for (const section of sections) {
    ctx.font = 'bold 22px Courier New';
    ctx.fillStyle = section.color;
    ctx.fillText(section.title, W / 2, yOff);
    yOff += 10;

    for (const [key, action] of section.controls) {
      yOff += 30;
      ctx.font = 'bold 16px Courier New';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(key, W / 2 - 20, yOff);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(action, W / 2 + 20, yOff);
    }
    yOff += 30;
  }

  ctx.textAlign = 'center';
  ctx.font = '16px Courier New';
  ctx.fillStyle = 'rgba(255,255,0,0.7)';
  yOff += 10;
  ctx.fillText('TIP: Don\'t camp in your own goal - you\'ll get pushed out!', W / 2, yOff);
  yOff += 25;
  ctx.fillText('TIP: Grab the ball and use rotation to aim your throws!', W / 2, yOff);

  ctx.font = '14px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('Press Esc or Enter to go back', W / 2, H - 30);
}

function drawGoalAnim() {
  // Flash
  if (flashTimer > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashTimer / 10 * 0.5})`;
    ctx.fillRect(0, 0, W, H);
    flashTimer--;
  }

  // GOAL text
  const progress = 1 - goalAnimTimer / 120;
  const scale = 1 + Math.sin(progress * Math.PI) * 0.3;
  ctx.save();
  ctx.translate(W / 2, H / 2 - 40);
  ctx.scale(scale, scale);
  ctx.font = 'bold 80px Courier New';
  ctx.textAlign = 'center';
  ctx.fillStyle = slimes[goalScorer].color;
  ctx.fillText('GOAL!', 0, 0);
  ctx.restore();

  ctx.font = '24px Courier New';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(`${scores[0]} - ${scores[1]}`, W / 2, H / 2 + 30);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);

  ctx.font = 'bold 60px Courier New';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('FULL TIME', W / 2, 160);

  ctx.font = 'bold 80px Courier New';
  ctx.fillStyle = '#00e5ff';
  ctx.fillText(scores[0], W / 2 - 80, 280);
  ctx.fillStyle = '#fff';
  ctx.fillText('-', W / 2, 280);
  ctx.fillStyle = '#ff3d3d';
  ctx.fillText(scores[1], W / 2 + 80, 280);

  // Winner text
  ctx.font = 'bold 36px Courier New';
  if (scores[0] > scores[1]) {
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(gameMode === 'single' ? 'YOU WIN!' : 'PLAYER 1 WINS!', W / 2, 350);
  } else if (scores[1] > scores[0]) {
    ctx.fillStyle = '#ff3d3d';
    ctx.fillText(gameMode === 'single' ? 'AI WINS!' : 'PLAYER 2 WINS!', W / 2, 350);
  } else {
    ctx.fillStyle = '#ffd740';
    ctx.fillText('DRAW!', W / 2, 350);
  }

  ctx.font = '20px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Press Enter to Play Again  |  Esc for Menu', W / 2, 420);
}

// --- Utility ---
function lightenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

// --- Menu Input Handling ---
let enterPressed = false;
let escPressed = false;
let prevEnter = false;
let prevEsc = false;
let prevUp = false;
let prevDown = false;
let prevLeft = false;
let prevRight = false;

function menuInput() {
  const enterNow = keys['Enter'] || false;
  const escNow = keys['Escape'] || false;
  const upNow = keys['ArrowUp'] || false;
  const downNow = keys['ArrowDown'] || false;
  const leftNow = keys['ArrowLeft'] || false;
  const rightNow = keys['ArrowRight'] || false;

  const enterJust = enterNow && !prevEnter;
  const escJust = escNow && !prevEsc;
  const upJust = upNow && !prevUp;
  const downJust = downNow && !prevDown;
  const leftJust = leftNow && !prevLeft;
  const rightJust = rightNow && !prevRight;

  prevEnter = enterNow;
  prevEsc = escNow;
  prevUp = upNow;
  prevDown = downNow;
  prevLeft = leftNow;
  prevRight = rightNow;

  if (gameState === 'menu') {
    if (upJust) menuSelection = (menuSelection - 1 + 2) % 2;
    if (downJust) menuSelection = (menuSelection + 1) % 2;
    if (enterJust) {
      if (menuSelection === 0) gameState = 'modeSelect';
      else gameState = 'controls';
    }
  } else if (gameState === 'controls') {
    if (enterJust || escJust) gameState = 'menu';
  } else if (gameState === 'modeSelect') {
    if (upJust) modeSelection = (modeSelection - 1 + 2) % 2;
    if (downJust) modeSelection = (modeSelection + 1) % 2;
    if (escJust) gameState = 'menu';
    if (enterJust) {
      gameMode = modeSelection === 0 ? 'single' : 'multi';
      gameState = 'durationSelect';
    }
  } else if (gameState === 'durationSelect') {
    const cols = 4;
    if (leftJust) durationSelection = Math.max(0, durationSelection - 1);
    if (rightJust) durationSelection = Math.min(durationOptions.length - 1, durationSelection + 1);
    if (upJust) durationSelection = Math.max(0, durationSelection - cols);
    if (downJust) durationSelection = Math.min(durationOptions.length - 1, durationSelection + cols);
    if (escJust) gameState = 'modeSelect';
    if (enterJust) {
      matchDuration = durationOptions[durationSelection] * 60;
      startGame();
    }
  } else if (gameState === 'goal') {
    // handled in update
  } else if (gameState === 'gameOver') {
    if (enterJust) {
      startGame();
    }
    if (escJust) {
      gameState = 'menu';
    }
  }
}

// --- Main Loop ---
function update() {
  if (gameState === 'playing') {
    // Player 1 input
    handlePlayerInput(slimes[0], 0);

    // Player 2 / AI
    if (gameMode === 'single') {
      updateAI(slimes[1], 1);
    } else {
      handlePlayerInput(slimes[1], 1);
    }

    // Physics
    for (let i = 0; i < slimes.length; i++) {
      updateSlime(slimes[i], i);
    }
    collideSlimes();
    updateBall();
    updateParticles();

    // Timer
    timeRemaining -= 1 / 60;
    if (timeRemaining <= 0) {
      timeRemaining = 0;
      gameState = 'gameOver';
    }

    // Screen shake decay
    if (screenShake > 0) screenShake *= 0.85;
    if (screenShake < 0.5) screenShake = 0;
  } else if (gameState === 'goal') {
    updateParticles();
    goalAnimTimer--;
    if (screenShake > 0) screenShake *= 0.85;
    if (screenShake < 0.5) screenShake = 0;
    if (goalAnimTimer <= 0) {
      resetPositions(goalScorer);
      gameState = 'playing';
    }
  }
}

function draw() {
  ctx.save();

  // Screen shake
  if (screenShake > 0) {
    const sx = (Math.random() - 0.5) * screenShake * 2;
    const sy = (Math.random() - 0.5) * screenShake * 2;
    ctx.translate(sx, sy);
  }

  if (gameState === 'menu') {
    drawMenu();
  } else if (gameState === 'controls') {
    drawControls();
  } else if (gameState === 'modeSelect') {
    drawModeSelect();
  } else if (gameState === 'durationSelect') {
    drawDurationSelect();
  } else if (gameState === 'playing' || gameState === 'goal') {
    drawField();
    drawGoal(0, 'left');
    drawGoal(W, 'right');
    drawBall();
    for (const slime of slimes) drawSlime(slime);
    drawParticles();
    drawHUD();

    if (gameState === 'goal') drawGoalAnim();
  } else if (gameState === 'gameOver') {
    drawField();
    drawGoal(0, 'left');
    drawGoal(W, 'right');
    drawBall();
    for (const slime of slimes) drawSlime(slime);
    drawGameOver();
  }

  ctx.restore();
}

function gameLoop() {
  menuInput();
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
