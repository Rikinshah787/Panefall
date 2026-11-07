/*
 * Panefall's ambient sound: rain, wind, thunder and a crackling fireplace, all generated live
 * with Web Audio from noise (no audio files, never loops). With "match the weather" on, rain
 * only plays while it rains and the wind follows the gusts on screen; thunder rolls in a
 * moment after each lightning flash, and snowballs land with a soft thud.
 */
(function (global) {
  'use strict';

  const DEFAULTS = { on: false, master: 0.6, rain: 0.7, wind: 0.5, fire: 0, thunder: 0.8, match: true };

  class Soundscape {
    constructor(engine) {
      this.engine = engine;
      this.config = { ...DEFAULTS };
      this.ctx = null;
      this.dropIn = 0;
      this.crackleIn = 0;
    }

    configure(config) {
      this.config = { ...this.config, ...config };
      if (this.config.on) this.start();
      else if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); // silent and idle
    }

    start() {
      if (!this.ctx) this.build();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    build() {
      const ctx = (this.ctx = new AudioContext());
      this.out = ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(ctx.destination);
      this.whiteNoise = this.noise(false);
      this.brownNoise = this.noise(true);

      this.rainBed = this.loop(this.whiteNoise, [['highpass', 500], ['lowpass', 7000]]);
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 400;
      this.windFilter.Q.value = 1.2;
      this.windBed = this.loop(this.brownNoise, [], this.windFilter);
      this.fireBed = this.loop(this.brownNoise, [['lowpass', 260]]);
    }

    /** Three seconds of white or brown noise to loop or slice from. */
    noise(brown) {
      const ctx = this.ctx;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.5;
        } else {
          data[i] = white;
        }
      }
      return buffer;
    }

    loop(buffer, filters, tail) {
      const ctx = this.ctx;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      let node = source;
      for (const [type, frequency] of filters) {
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        node.connect(filter);
        node = filter;
      }
      if (tail) {
        node.connect(tail);
        node = tail;
      }
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(this.out);
      source.start();
      return gain;
    }

    /** A short filtered noise burst: a raindrop, a crackle, a thud, a roll of thunder. */
    burst({ buffer, filter, frequency, q = 1, level, attack, decay, delay = 0 }) {
      const ctx = this.ctx;
      const start = ctx.currentTime + delay;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const shape = ctx.createBiquadFilter();
      shape.type = filter;
      shape.frequency.value = frequency;
      shape.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
      source.connect(shape);
      shape.connect(gain);
      gain.connect(this.out);
      const length = attack + decay + 0.05;
      source.start(start, Math.random() * Math.max(0, buffer.duration - length - 0.1), length);
    }

    /** Called every frame with the elapsed time. */
    update(dt) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const c = this.config;
      const e = this.engine;
      const now = this.ctx.currentTime;
      const weather = e.settings.weather;
      const wet = weather === 'rain' || weather === 'storm';
      const gusting = Math.min(1, Math.abs(e.wind) / 140);
      const rain = c.rain * (c.match ? (wet ? 0.35 + 0.65 * e.settings.intensity : 0) : 1);
      const wind = c.wind * (c.match ? 0.12 + 0.88 * gusting : 1);

      this.out.gain.setTargetAtTime(c.master, now, 0.3);
      this.rainBed.gain.setTargetAtTime(rain * 0.35, now, 0.5);
      this.windBed.gain.setTargetAtTime(wind * 0.7, now, 0.5);
      this.windFilter.frequency.setTargetAtTime(220 + gusting * 900, now, 0.4);
      this.fireBed.gain.setTargetAtTime(c.fire * 0.4, now, 0.5);

      if (rain > 0.02) {
        this.dropIn -= dt;
        while (this.dropIn <= 0) {
          this.dropIn += 1 / (10 + 50 * rain);
          this.burst({ buffer: this.whiteNoise, filter: 'bandpass', frequency: 1400 + Math.random() * 4600, q: 3, level: 0.18 * rain * Math.random(), attack: 0.002, decay: 0.03 });
        }
      }
      if (c.fire > 0.02) {
        this.crackleIn -= dt;
        while (this.crackleIn <= 0) {
          this.crackleIn += 0.05 + Math.random() * 0.4;
          this.burst({ buffer: this.whiteNoise, filter: 'highpass', frequency: 1800 + Math.random() * 3200, q: 0.7, level: (0.1 + Math.random() * 0.45) * c.fire, attack: 0.001, decay: 0.015 + Math.random() * 0.05 });
        }
      }
    }

    /** Engine events: 'thunder', 'splat', 'topple', 'snowman'. */
    event(name) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const c = this.config;
      if (name === 'thunder' && c.thunder > 0) {
        const delay = 0.3 + Math.random() * 1.6; // sound travels slower than light
        this.burst({ buffer: this.brownNoise, filter: 'lowpass', frequency: 150, q: 0.8, level: 1.2 * c.thunder, attack: 0.25, decay: 3.4, delay });
        this.burst({ buffer: this.whiteNoise, filter: 'lowpass', frequency: 900, q: 0.5, level: 0.35 * c.thunder, attack: 0.02, decay: 0.5, delay });
      } else if (name === 'splat' || name === 'topple') {
        this.burst({ buffer: this.brownNoise, filter: 'lowpass', frequency: 700, q: 0.6, level: 0.6, attack: 0.004, decay: 0.16 });
      } else if (name === 'snowman') {
        for (let i = 0; i < 3; i++) {
          this.burst({ buffer: this.whiteNoise, filter: 'bandpass', frequency: 900 + i * 300, q: 1.5, level: 0.12, attack: 0.01, decay: 0.12, delay: i * 0.35 });
        }
      }
    }
  }

  global.PanefallSound = Soundscape;
})(window);
