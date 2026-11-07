/*
 * The snowplow: when snow along the bottom of the screen gets deep, a little plow drives
 * across and pushes it away. It is drawn facing right with its origin at the middle of
 * its tracks on the ground, and mirrored when driving left.
 */
(function (global) {
  'use strict';

  const SPEED = 140; // px/s
  const BLADE = 40; // from the plow's origin to the front of its blade
  const MOUND_MAX = 700; // snow the blade can carry; the rest is thrown up over it
  const TAU = Math.PI * 2;

  const rand = (a, b) => a + Math.random() * (b - a);

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawMound(ctx, vol) {
    if (vol < 8) return;
    const h = Math.min(24, Math.sqrt(vol) * 0.9);
    const w = h * 1.6 + 4;
    const x = BLADE - 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x, -h * 1.1, x + w * 0.45, -h);
    ctx.quadraticCurveTo(x + w, -h * 0.8, x + w, 0);
    ctx.closePath();
    ctx.fillStyle = '#f7fafd';
    ctx.fill();
  }

  function drawPlow(ctx, wheel, t) {
    // Shadow on the ground.
    ctx.beginPath();
    ctx.ellipse(-4, -1, 40, 3, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fill();

    // Tracks and wheels.
    roundRect(ctx, -34, -15, 58, 14, 7, '#2b2f36');
    for (const wx of [-26, -13, 0, 13]) {
      ctx.beginPath();
      ctx.arc(wx + 2, -8, 5, 0, TAU);
      ctx.fillStyle = '#5a606b';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(wx + 2 + Math.cos(wheel) * 4, -8 + Math.sin(wheel) * 4);
      ctx.lineTo(wx + 2 - Math.cos(wheel) * 4, -8 - Math.sin(wheel) * 4);
      ctx.strokeStyle = '#a7adb6';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Exhaust stack, body and cab.
    roundRect(ctx, -34, -45, 3.5, 16, 1, '#3b4048');
    roundRect(ctx, -36, -31, 58, 17, 4, '#f2b630');
    ctx.fillStyle = '#d7951b';
    ctx.fillRect(-36, -18, 58, 4);
    roundRect(ctx, -28, -50, 26, 21, 4, '#f2b630');
    roundRect(ctx, -24, -46, 18, 13, 2.5, '#2d4260');
    ctx.beginPath();
    ctx.moveTo(-22, -46);
    ctx.lineTo(-15, -46);
    ctx.lineTo(-22, -37);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();

    // Snow on the roof.
    roundRect(ctx, -30, -54, 30, 6, 3, '#fbfdff');

    // Flashing beacon.
    const on = Math.sin(t * 9) > 0;
    if (on) {
      const glow = ctx.createRadialGradient(-15, -56, 0, -15, -56, 14);
      glow.addColorStop(0, 'rgba(255, 176, 32, 0.55)');
      glow.addColorStop(1, 'rgba(255, 176, 32, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-29, -70, 28, 28);
    }
    ctx.beginPath();
    ctx.arc(-15, -55, 3.2, Math.PI, 0);
    ctx.fillStyle = on ? '#ffb020' : '#b8720f';
    ctx.fill();

    // Arms and blade.
    ctx.strokeStyle = '#3b4048';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, -24);
    ctx.lineTo(30, -19);
    ctx.moveTo(20, -14);
    ctx.lineTo(30, -11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(27, -31);
    ctx.quadraticCurveTo(44, -22, BLADE + 2, 0);
    ctx.lineTo(BLADE - 5, 0);
    ctx.quadraticCurveTo(36, -17, 25, -28);
    ctx.closePath();
    ctx.fillStyle = '#e0503a';
    ctx.fill();
    ctx.strokeStyle = '#ff8a6d';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  class Plow {
    constructor(snow) {
      this.snow = snow;
      this.run = null;
      this.cooldown = 30; // seconds before the plow may come out on its own
      this.nextDir = 1;
      this.puffs = [];
    }

    trigger() {
      if (this.run || !this.snow.width) return;
      const dir = this.nextDir;
      this.nextDir = -dir;
      this.run = { dir, x: dir > 0 ? -70 : this.snow.width + 70, mound: 0, wheel: 0, puffIn: 0, t: 0 };
    }

    reset() {
      this.run = null;
      this.puffs.length = 0;
    }

    step(dt) {
      const snow = this.snow;
      for (let i = this.puffs.length - 1; i >= 0; i--) {
        const p = this.puffs[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += 6 * dt;
        if (p.life <= 0) this.puffs.splice(i, 1);
      }

      if (!this.run) {
        this.cooldown -= dt;
        if (snow.settings.plow && this.cooldown <= 0 && snow.groundFullness() > 0.6) this.trigger();
        return;
      }

      const run = this.run;
      const ground = snow.ground;
      const COL = global.Panefall.COL;
      const before = run.x + run.dir * BLADE;
      run.x += run.dir * SPEED * dt;
      run.t += dt;
      run.wheel += (SPEED * dt) / 5;
      const after = run.x + run.dir * BLADE;

      // Scoop up the ground snow the blade just passed over.
      let scooped = 0;
      const c0 = Math.max(0, Math.floor(Math.min(before, after) / COL));
      const c1 = Math.min(ground.n, Math.ceil(Math.max(before, after) / COL));
      for (let c = c0; c < c1; c++) {
        scooped += ground.h[c] * COL;
        ground.h[c] = 0;
      }
      if (scooped > 0) ground.dirty = true;
      run.mound += scooped;

      const overflow = Math.max(0, run.mound - MOUND_MAX);
      run.mound -= overflow;
      const thrown = Math.min(8, Math.round(overflow / 12 + (scooped > 0 ? Math.random() * 1.2 : 0)));
      for (let i = 0; i < thrown; i++) {
        snow.addSpray(after + run.dir * rand(4, 16), snow.height - rand(8, 24), run.dir * rand(40, 150), -rand(90, 220));
      }

      run.puffIn -= dt;
      if (run.puffIn <= 0) {
        run.puffIn = 0.35;
        this.puffs.push({ x: run.x - run.dir * 32, y: snow.height - 47, vx: -run.dir * 10, vy: -22, r: 2.5, life: 1.2, max: 1.2 });
      }

      if ((run.dir > 0 && run.x > snow.width + 140) || (run.dir < 0 && run.x < -140)) {
        this.run = null;
        this.cooldown = 40;
      }
    }

    draw(ctx) {
      for (const p of this.puffs) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fillStyle = `rgba(205, 210, 220, ${(0.45 * p.life) / p.max})`;
        ctx.fill();
      }
      if (!this.run) return;
      const run = this.run;
      ctx.save();
      ctx.translate(run.x, this.snow.height);
      ctx.scale(run.dir, 1);
      ctx.shadowColor = 'rgba(20, 32, 56, 0.3)';
      ctx.shadowBlur = 3 * this.snow.dpr;
      ctx.shadowOffsetY = this.snow.dpr;
      drawMound(ctx, run.mound);
      ctx.shadowColor = 'transparent';
      drawPlow(ctx, run.wheel, run.t);
      ctx.restore();
    }
  }

  global.PanefallPlow = Plow;
})(window);
