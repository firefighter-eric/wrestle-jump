const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const W = canvas.width;
const H = canvas.height;
const GROUND_Y = H - 90;

const GRAVITY = 1900;
const TORSO_LEN = 92;
const THIGH_LEN = 66;
const CALF_LEN = 60;
const HEAD_R = 24;
const FOOT_R = 14;
const DT_MAX = 1 / 30;
const RIGID_SOLVE_ITERS = 2;
const ARM_BASE_FACTOR = 0.4;
const CHARGE_MAX = 0.5;
const KNEE_FOLD_ANGLE = 1.18;
const LEG_BEND_SPEED = 13;
const LEG_BEND_REST = 0.78;
const CHARGE_RELEASE_SPEED = 4;
const LEG_THRUST_BASE = 1100;
const LEG_THRUST_GAIN = 3200;
const LEG_TWIST = 980;
const WIN_SCORE = 5;
const ROUND_RESET_DELAY_MS = 700;

const state = {
  running: true,
  winner: null,
  players: [],
  baseRigidLength: 0,
  rigidLength: 0,
  roundResetAt: 0
};

function makePlayer(x, color, controls) {
  return {
    x,
    y: GROUND_Y - (TORSO_LEN * 0.5 + THIGH_LEN + CALF_LEN),
    vx: 0,
    vy: 0,
    angle: (Math.random() - 0.5) * 0.3,
    color,
    grounded: true,
    controls,
    score: 0,
    charging: false,
    chargeTime: 0,
    legBend: LEG_BEND_REST,
    legSide: controls === 'KeyA' ? -1 : 1
  };
}

function resetRound() {
  state.running = true;
  state.winner = null;
  state.players = [
    makePlayer(W * 0.38, '#d94848', 'KeyA'),
    makePlayer(W * 0.62, '#2c78d8', 'KeyL')
  ];
  const p1 = state.players[0];
  const p2 = state.players[1];
  state.baseRigidLength = Math.hypot(p2.x - p1.x, p2.y - p1.y) * ARM_BASE_FACTOR;
  state.rigidLength = state.baseRigidLength;
  state.roundResetAt = 0;
}

function resetPositionsKeepScore() {
  const p1 = state.players[0];
  const p2 = state.players[1];
  p1.x = W * 0.38;
  p2.x = W * 0.62;
  p1.y = GROUND_Y - (TORSO_LEN * 0.5 + THIGH_LEN + CALF_LEN);
  p2.y = GROUND_Y - (TORSO_LEN * 0.5 + THIGH_LEN + CALF_LEN);
  p1.vx = 0;
  p1.vy = 0;
  p2.vx = 0;
  p2.vy = 0;
  p1.angle = (Math.random() - 0.5) * 0.3;
  p2.angle = p1.angle;
  p1.grounded = true;
  p2.grounded = true;
  p1.charging = false;
  p2.charging = false;
  p1.chargeTime = 0;
  p2.chargeTime = 0;
  p1.legBend = LEG_BEND_REST;
  p2.legBend = LEG_BEND_REST;
  state.baseRigidLength = Math.hypot(p2.x - p1.x, p2.y - p1.y) * ARM_BASE_FACTOR;
  state.rigidLength = state.baseRigidLength;
  state.running = true;
  state.winner = null;
  state.roundResetAt = 0;
}

function getPoints(p) {
  const ax = Math.sin(p.angle);
  const ay = -Math.cos(p.angle);
  const halfTorso = TORSO_LEN * 0.5;
  const butt = {
    x: p.x - ax * halfTorso,
    y: p.y - ay * halfTorso
  };
  // Legs are driven by gravity direction, not torso direction.
  const straightX = 0;
  const straightY = 1;
  const halfFold = KNEE_FOLD_ANGLE * p.legBend * p.legSide * 0.5;
  const c1 = Math.cos(halfFold);
  const s1 = Math.sin(halfFold);
  const c2 = Math.cos(-halfFold);
  const s2 = Math.sin(-halfFold);
  const thighX = straightX * c1 - straightY * s1;
  const thighY = straightX * s1 + straightY * c1;
  const calfX = straightX * c2 - straightY * s2;
  const calfY = straightX * s2 + straightY * c2;

  const head = {
    x: p.x + ax * (halfTorso + HEAD_R * 0.4),
    y: p.y + ay * (halfTorso + HEAD_R * 0.4)
  };

  const knee = {
    x: butt.x + thighX * THIGH_LEN,
    y: butt.y + thighY * THIGH_LEN
  };

  const foot = {
    x: knee.x + calfX * CALF_LEN,
    y: knee.y + calfY * CALF_LEN
  };

  const hand = {
    x: p.x + ax * 12,
    y: p.y + ay * 12
  };

  return { head, butt, knee, foot, hand, axis: { x: ax, y: ay } };
}

function startCharge(i) {
  if (!state.running) return;
  const p = state.players[i];
  if (p.charging) return;
  p.charging = true;
  p.chargeTime = 0;
}

function releaseCharge(i) {
  if (!state.running) return;
  const p = state.players[i];
  if (!p.charging) return;
  p.charging = false;
}

function solveRigidPair() {
  const p1 = state.players[0];
  const p2 = state.players[1];
  let dx = p2.x - p1.x;
  let dy = p2.y - p1.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-5) {
    dx = 1;
    dy = 0;
    dist = 1;
  }

  const nx = dx / dist;
  const ny = dy / dist;
  const mx = (p1.x + p2.x) * 0.5;
  const my = (p1.y + p2.y) * 0.5;
  const half = state.rigidLength * 0.5;

  p1.x = mx - nx * half;
  p1.y = my - ny * half;
  p2.x = mx + nx * half;
  p2.y = my + ny * half;

  const vcx = (p1.vx + p2.vx) * 0.5;
  const vcy = (p1.vy + p2.vy) * 0.5;
  const rvx = p2.vx - p1.vx;
  const rvy = p2.vy - p1.vy;
  const omega = (dx * rvy - dy * rvx) / (dist * dist);

  const r1x = -nx * half;
  const r1y = -ny * half;
  const r2x = nx * half;
  const r2y = ny * half;
  p1.vx = vcx - omega * r1y;
  p1.vy = vcy + omega * r1x;
  p2.vx = vcx - omega * r2y;
  p2.vy = vcy + omega * r2x;

  const angle = Math.atan2(ny, nx);
  p1.angle = angle;
  p2.angle = angle;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    resetRound();
    return;
  }

  if (e.code === state.players[0].controls) startCharge(0);
  if (e.code === state.players[1].controls) startCharge(1);
});

window.addEventListener('keyup', (e) => {
  if (e.code === state.players[0].controls) releaseCharge(0);
  if (e.code === state.players[1].controls) releaseCharge(1);
});

function physics(dt) {
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    if (p.charging) {
      p.chargeTime = Math.min(CHARGE_MAX, p.chargeTime + dt);
    } else {
      p.chargeTime = Math.max(0, p.chargeTime - CHARGE_RELEASE_SPEED * dt);
    }
    const charge01 = Math.min(p.chargeTime / CHARGE_MAX, 1);
    const bendTarget = p.charging ? LEG_BEND_REST * (1 - charge01) : LEG_BEND_REST;
    const bendRate = Math.min(1, LEG_BEND_SPEED * dt);
    p.legBend += (bendTarget - p.legBend) * bendRate;
    p.grounded = false;
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    p.vx *= 0.995;

    p.x = Math.max(80, Math.min(W - 80, p.x));

    const pts = getPoints(p);
    const footPen = pts.foot.y + FOOT_R - GROUND_Y;

    if (footPen > 0) {
      p.y -= footPen;
      if (p.vy > 0) p.vy *= -0.18;
      p.vx *= 0.92;
      p.grounded = true;
    }

    if (p.grounded && p.charging && charge01 > 0) {
      const axis = pts.axis;
      const tx = -axis.y;
      const ty = axis.x;
      const twistDir = i === 0 ? 1 : -1;
      const thrust = LEG_THRUST_BASE + LEG_THRUST_GAIN * charge01;
      const twist = LEG_TWIST * (0.5 + 0.5 * charge01);
      const impulseDt = dt * 4;

      p.vx += (axis.x * thrust + tx * twist * twistDir) * impulseDt;
      p.vy += (axis.y * thrust + ty * twist * twistDir) * impulseDt;
      p.grounded = false;
    }

    const headPen = pts.head.y + HEAD_R - GROUND_Y;
    const headHitWall = pts.head.x - HEAD_R < 0 || pts.head.x + HEAD_R > W;
    if (state.running && (headPen > 0 || headHitWall)) {
      state.running = false;
      state.winner = p === state.players[0] ? 2 : 1;
      const winner = state.players[state.winner - 1];
      winner.score += 1;
      if (winner.score < WIN_SCORE) {
        state.roundResetAt = performance.now() + ROUND_RESET_DELAY_MS;
      }
    }
  }

  state.rigidLength = state.baseRigidLength;

  for (let i = 0; i < RIGID_SOLVE_ITERS; i += 1) {
    solveRigidPair();
  }
}

function drawGround() {
  ctx.fillStyle = '#9acd86';
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  ctx.strokeStyle = '#334';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(W, GROUND_Y);
  ctx.stroke();
}

function drawPlayer(p) {
  const pts = getPoints(p);

  ctx.strokeStyle = '#222';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts.foot.x, pts.foot.y);
  ctx.lineTo(pts.knee.x, pts.knee.y);
  ctx.lineTo(pts.butt.x, pts.butt.y);
  ctx.lineTo(pts.head.x, pts.head.y);
  ctx.stroke();

  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(pts.head.x, pts.head.y, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(pts.foot.x, pts.foot.y, FOOT_R, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(pts.knee.x, pts.knee.y, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(pts.butt.x, pts.butt.y, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = '700 30px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.fillText(String(p.score), p.x, 60);
}

function drawLink() {
  const h1 = getPoints(state.players[0]).hand;
  const h2 = getPoints(state.players[1]).hand;

  ctx.strokeStyle = '#111';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(h1.x, h1.y);
  ctx.lineTo(h2.x, h2.y);
  ctx.stroke();
}

function drawHud() {
  if (!state.running) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '700 64px Trebuchet MS';
    const winner = state.players[state.winner - 1];
    if (winner.score >= WIN_SCORE) {
      ctx.fillText(`玩家 ${state.winner} 胜利`, W / 2, H / 2 - 20);
      ctx.font = '600 30px Trebuchet MS';
      ctx.fillText('按 R 重新开始', W / 2, H / 2 + 40);
      return;
    }
    ctx.fillText(`玩家 ${state.winner} 得分`, W / 2, H / 2 - 20);

    ctx.font = '600 30px Trebuchet MS';
    ctx.fillText('准备下一回合...', W / 2, H / 2 + 40);
  }
}

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, DT_MAX);
  last = now;

  if (state.running) {
    physics(dt);
  } else if (state.roundResetAt && now >= state.roundResetAt) {
    resetPositionsKeepScore();
  }

  ctx.clearRect(0, 0, W, H);
  drawGround();
  drawLink();
  drawPlayer(state.players[0]);
  drawPlayer(state.players[1]);
  drawHud();

  requestAnimationFrame(frame);
}

resetRound();
requestAnimationFrame(frame);
