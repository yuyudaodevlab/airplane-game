"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "hangar" | "aiming" | "flying" | "result";
type UpgradeKey = "launcher" | "wings" | "engine" | "armor";
type UpgradeState = Record<UpgradeKey, number>;
type SaveData = {
  coins: number;
  best: number;
  flights: number;
  upgrades: UpgradeState;
  cheat: boolean;
  sound: boolean;
  vibration: boolean;
};

type Plane = {
  x: number; y: number; vx: number; vy: number; angle: number;
  fuel: number; wingHp: number; bodyHp: number; engineHp: number;
  brokenWing: boolean; brokenEngine: boolean; grounded: boolean;
};

type Particle = {
  x: number; y: number; vx: number; vy: number; life: number;
  color: string; size: number; kind?: "wing" | "wheel";
};

const W = 390;
const H = 844;
const START_X = 118;
const START_Y = 596;
const MAX_LEVEL = 8;
const DEFAULT_SAVE: SaveData = {
  coins: 320,
  best: 0,
  flights: 0,
  upgrades: { launcher: 1, wings: 1, engine: 1, armor: 1 },
  cheat: false,
  sound: true,
  vibration: true,
};

const UPGRADE_INFO: Record<UpgradeKey, { icon: string; name: string; color: string; copy: string }> = {
  launcher: { icon: "↗", name: "ランチャー", color: "#ff7a3d", copy: "初速と最大パワー" },
  wings: { icon: "⌁", name: "ウイング", color: "#42bde8", copy: "揚力と操作性" },
  engine: { icon: "⚡", name: "エンジン", color: "#8a63ff", copy: "ブースト時間" },
  armor: { icon: "◆", name: "ボディ", color: "#36c982", copy: "衝撃への耐久" },
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const upgradeCost = (level: number) => Math.round(120 * Math.pow(1.72, level - 1));

function loadSave(): SaveData {
  if (typeof window === "undefined") return DEFAULT_SAVE;
  try {
    const parsed = JSON.parse(localStorage.getItem("pocket-flight-save") || "{}");
    return {
      ...DEFAULT_SAVE,
      ...parsed,
      upgrades: { ...DEFAULT_SAVE.upgrades, ...(parsed.upgrades || {}) },
    };
  } catch {
    return DEFAULT_SAVE;
  }
}

export default function AirplaneGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const planeRef = useRef<Plane | null>(null);
  const phaseRef = useRef<Phase>("hangar");
  const cameraRef = useRef(0);
  const dragRef = useRef({ active: false, x: START_X, y: START_Y, power: 0 });
  const controlRef = useRef({ pitch: 0, boost: false });
  const particlesRef = useRef<Particle[]>([]);
  const collectedRef = useRef<Set<number>>(new Set());
  const lastRef = useRef(0);
  const distanceRef = useRef(0);
  const earnedRef = useRef(0);
  const saveRef = useRef<SaveData>(DEFAULT_SAVE);
  const [save, setSave] = useState<SaveData>(DEFAULT_SAVE);
  const [phase, setPhaseState] = useState<Phase>("hangar");
  const [hud, setHud] = useState({ distance: 0, speed: 0, altitude: 0, fuel: 100, hp: 100, wind: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [code, setCode] = useState("");
  const [codeMessage, setCodeMessage] = useState("");
  const [toast, setToast] = useState("");
  const [newBest, setNewBest] = useState(false);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const persist = useCallback((next: SaveData) => {
    saveRef.current = next;
    setSave(next);
    localStorage.setItem("pocket-flight-save", JSON.stringify(next));
  }, []);

  useEffect(() => {
    const stored = loadSave();
    saveRef.current = stored;
    setSave(stored);
  }, []);

  const tone = useCallback((frequency: number, duration = 0.08, type: OscillatorType = "sine") => {
    if (!saveRef.current.sound) return;
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      osc.type = type;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
      osc.onended = () => ctx.close();
    } catch { /* audio is optional */ }
  }, []);

  const vibrate = useCallback((pattern: number | number[]) => {
    if (saveRef.current.vibration && navigator.vibrate) navigator.vibrate(pattern);
  }, []);

  const resetPlane = useCallback(() => {
    const armor = saveRef.current.upgrades.armor;
    planeRef.current = {
      x: START_X, y: START_Y, vx: 0, vy: 0, angle: -0.08,
      fuel: 100 + saveRef.current.upgrades.engine * 9,
      wingHp: 70 + armor * 8,
      bodyHp: 80 + armor * 12,
      engineHp: 65 + armor * 7,
      brokenWing: false, brokenEngine: false, grounded: false,
    };
    cameraRef.current = 0;
    distanceRef.current = 0;
    earnedRef.current = 0;
    collectedRef.current.clear();
    particlesRef.current = [];
    dragRef.current = { active: false, x: START_X, y: START_Y, power: 0 };
    setHud({ distance: 0, speed: 0, altitude: 0, fuel: 100, hp: 100, wind: 0 });
  }, []);

  const startAiming = useCallback(() => {
    resetPlane();
    setNewBest(false);
    setPhase("aiming");
    tone(420, 0.08);
  }, [resetPlane, setPhase, tone]);

  const finishFlight = useCallback(() => {
    const meters = Math.max(0, Math.floor(distanceRef.current));
    const bonus = Math.floor(meters / 18);
    const total = earnedRef.current + bonus;
    const old = saveRef.current;
    const best = Math.max(old.best, meters);
    setNewBest(meters > old.best);
    persist({ ...old, coins: old.cheat ? old.coins : old.coins + total, best, flights: old.flights + 1 });
    earnedRef.current = total;
    setPhase("result");
    tone(meters > old.best ? 740 : 210, 0.2, meters > old.best ? "triangle" : "sawtooth");
  }, [persist, setPhase, tone]);

  useEffect(() => {
    if (phase === "hangar") resetPlane();
  }, [phase, resetPlane]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const groundY = (worldX: number) => {
      if (worldX < 840) return 708;
      return 698 + Math.sin(worldX * 0.006) * 34 + Math.sin(worldX * 0.017) * 12;
    };

    const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    };

    const drawCloud = (x: number, y: number, s: number, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x, y, 20 * s, 0, Math.PI * 2);
      ctx.arc(x + 24 * s, y - 9 * s, 28 * s, 0, Math.PI * 2);
      ctx.arc(x + 55 * s, y, 22 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawPlane = (p: Plane, cam: number, ghost = false) => {
      const x = p.x - cam;
      const y = p.y;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.angle);
      if (ghost) ctx.globalAlpha = 0.65;

      if (!p.brokenWing) {
        ctx.fillStyle = p.wingHp < 35 ? "#d64536" : "#f05243";
        roundedRect(-34, -7, 72, 14, 7); ctx.fill();
        ctx.fillStyle = "#d5352a";
        ctx.fillRect(-22, 5, 48, 7);
      }

      ctx.fillStyle = p.bodyHp < 30 ? "#8f563d" : "#d99a56";
      ctx.beginPath();
      ctx.moveTo(-24, 3); ctx.lineTo(27, -9); ctx.lineTo(39, 0);
      ctx.lineTo(24, 10); ctx.lineTo(-26, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#f1c178";
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(29, -6); ctx.lineTo(38, 0); ctx.lineTo(5, 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#57c9ef";
      ctx.beginPath();
      ctx.moveTo(11, -8); ctx.lineTo(24, -6); ctx.lineTo(28, -2); ctx.lineTo(10, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e44737";
      ctx.beginPath();
      ctx.moveTo(-22, 3); ctx.lineTo(-38, -11); ctx.lineTo(-26, -9); ctx.lineTo(-12, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#373743";
      ctx.beginPath(); ctx.arc(25, 10, 5, 0, Math.PI * 2); ctx.arc(-13, 11, 5, 0, Math.PI * 2); ctx.fill();

      if (!p.brokenEngine) {
        ctx.fillStyle = "#3e5267";
        roundedRect(25, -6, 15, 12, 5); ctx.fill();
        ctx.strokeStyle = "#243340"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(40, -12); ctx.lineTo(40, 12); ctx.stroke();
      }
      ctx.restore();
    };

    const drawBackground = (cam: number) => {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#62d5ee");
      sky.addColorStop(0.62, "#c5f3ef");
      sky.addColorStop(1, "#f8dda2");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

      const parallax = cam * 0.15;
      ctx.fillStyle = "#8dc6b1";
      ctx.beginPath();
      ctx.moveTo(0, 520);
      for (let x = -40; x <= 430; x += 50) {
        const wy = 520 + Math.sin((x + parallax) * 0.018) * 35;
        ctx.lineTo(x, wy);
      }
      ctx.lineTo(W, 730); ctx.lineTo(0, 730); ctx.fill();

      drawCloud(55 - (cam * 0.08) % 520, 145, 0.75, 0.82);
      drawCloud(315 - (cam * 0.045) % 650, 245, 0.5, 0.65);
      drawCloud(495 - (cam * 0.08) % 520, 145, 0.75, 0.82);

      if (cam < 430) {
        const roomX = -cam * 0.75;
        ctx.fillStyle = "#f6b660"; ctx.fillRect(roomX, 610, 750, 120);
        ctx.fillStyle = "#cd764d"; ctx.fillRect(roomX, 706, 760, 30);
        ctx.fillStyle = "#fff1c9"; ctx.fillRect(roomX + 430, 440, 230, 170);
        ctx.fillStyle = "#95d8e7"; ctx.fillRect(roomX + 448, 457, 198, 136);
        ctx.fillStyle = "#ef6b56";
        for (let i = 0; i < 5; i++) ctx.fillRect(roomX + 530 + i * 18, 545 - i * 9, 15, 65 + i * 9);
        ctx.fillStyle = "#5a705b"; ctx.fillRect(roomX + 685, 497, 24, 112);
        ctx.beginPath(); ctx.arc(roomX + 697, 474, 42, 0, Math.PI * 2); ctx.fill();
      }

      ctx.fillStyle = "#78b45e";
      ctx.beginPath();
      ctx.moveTo(0, groundY(cam));
      for (let sx = 0; sx <= W + 30; sx += 22) ctx.lineTo(sx, groundY(cam + sx));
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
      ctx.fillStyle = "#5e963f";
      for (let sx = 0; sx < W; sx += 34) {
        const gy = groundY(cam + sx);
        ctx.fillRect(sx, gy + 8, 22, 3);
      }
    };

    const obstacleDefs = [
      { x: 990, w: 58, h: 96, type: "crate" },
      { x: 1640, w: 88, h: 48, type: "book" },
      { x: 2320, w: 55, h: 144, type: "tower" },
      { x: 3090, w: 92, h: 62, type: "crate" },
    ];

    const drawWorld = (cam: number) => {
      const start = Math.floor(cam / 260) * 260;
      for (let wx = start; wx < cam + W + 300; wx += 260) {
        const id = Math.floor(wx / 260);
        const cx = wx + 170;
        const cy = 370 + Math.sin(id * 2.17) * 125;
        if (!collectedRef.current.has(id) && id > 1) {
          const x = cx - cam;
          ctx.fillStyle = "#ffbd22"; ctx.strokeStyle = "#fff0a5"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x, cy, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#d8860b"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
          ctx.fillText("★", x, cy + 5);
        }
      }

      for (const ob of obstacleDefs) {
        const x = ob.x - cam;
        if (x < -120 || x > W + 120) continue;
        const gy = groundY(ob.x);
        if (ob.type === "crate") {
          ctx.fillStyle = "#c47a40"; roundedRect(x, gy - ob.h, ob.w, ob.h, 6); ctx.fill();
          ctx.strokeStyle = "#8c4c28"; ctx.lineWidth = 5; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + 8, gy - ob.h + 8); ctx.lineTo(x + ob.w - 8, gy - 8);
          ctx.moveTo(x + ob.w - 8, gy - ob.h + 8); ctx.lineTo(x + 8, gy - 8); ctx.stroke();
        } else if (ob.type === "book") {
          ctx.fillStyle = "#5845ad"; roundedRect(x, gy - ob.h, ob.w, ob.h, 7); ctx.fill();
          ctx.fillStyle = "#fff3c2"; ctx.fillRect(x + 8, gy - ob.h + 10, ob.w - 12, ob.h - 18);
          ctx.fillStyle = "#ef5d52"; ctx.fillRect(x, gy - 16, ob.w, 12);
        } else {
          ctx.fillStyle = "#70889b"; ctx.fillRect(x, gy - ob.h, ob.w, ob.h);
          ctx.fillStyle = "#b7e6f2"; ctx.fillRect(x + 10, gy - ob.h + 12, ob.w - 20, 34);
          ctx.fillStyle = "#efbf48"; ctx.beginPath(); ctx.arc(x + ob.w / 2, gy - ob.h - 10, 11, 0, Math.PI * 2); ctx.fill();
        }
      }

      const windStart = 1180;
      const windX = windStart - cam;
      if (windX > -450 && windX < W + 100) {
        ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 3;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(windX + i * 75, 250 + i * 75);
          ctx.bezierCurveTo(windX + 55 + i * 75, 230 + i * 75, windX + 80 + i * 75, 270 + i * 75, windX + 130 + i * 75, 245 + i * 75);
          ctx.stroke();
        }
      }
    };

    const spawnDamage = (p: Plane, severe: boolean) => {
      const colors = ["#f05243", "#d99a56", "#353945", "#ffd06a"];
      const count = severe ? 18 : 7;
      for (let i = 0; i < count; i++) {
        particlesRef.current.push({
          x: p.x, y: p.y, vx: (Math.random() - 0.5) * 8,
          vy: -Math.random() * 6, life: 1, color: colors[i % colors.length],
          size: 3 + Math.random() * 6,
        });
      }
    };

    const damagePlane = (p: Plane, impact: number, source: "ground" | "obstacle") => {
      const protection = 1 - saveRef.current.upgrades.armor * 0.045;
      const amount = Math.max(0, impact - 2.5) * 7 * protection;
      if (amount < 2) return;
      if (source === "ground") {
        p.bodyHp -= amount * 0.75;
        p.wingHp -= amount * 0.35;
        p.engineHp -= amount * 0.22;
      } else {
        p.bodyHp -= amount * 0.45;
        p.wingHp -= amount * 0.8;
        p.engineHp -= amount * 0.65;
      }
      if (p.wingHp <= 0 && !p.brokenWing) {
        p.brokenWing = true;
        particlesRef.current.push({ x: p.x, y: p.y, vx: -2, vy: -5, life: 1.8, color: "#f05243", size: 20, kind: "wing" });
      }
      if (p.engineHp <= 0 && !p.brokenEngine) {
        p.brokenEngine = true;
        particlesRef.current.push({ x: p.x + 20, y: p.y, vx: 3, vy: -3, life: 1.5, color: "#444", size: 9 });
      }
      spawnDamage(p, amount > 20);
      vibrate(amount > 20 ? [45, 30, 70] : 30);
      tone(100 + Math.random() * 60, 0.12, "sawtooth");
    };

    const update = (dt: number) => {
      const p = planeRef.current;
      if (!p) return;
      const currentPhase = phaseRef.current;

      if (currentPhase === "aiming" && dragRef.current.active) {
        p.x += (dragRef.current.x - p.x) * Math.min(1, dt * 18);
        p.y += (dragRef.current.y - p.y) * Math.min(1, dt * 18);
        p.angle = clamp((p.y - START_Y) * 0.008, -0.42, 0.42);
      }

      if (currentPhase === "flying") {
        const speed = Math.hypot(p.vx, p.vy);
        const wingFactor = p.brokenWing ? 0.18 : clamp(p.wingHp / 80, 0.35, 1);
        const wingLevel = saveRef.current.upgrades.wings;
        const wind = p.x > 1180 && p.x < 1580 ? Math.sin(performance.now() * 0.004) * 0.08 + 0.055 : 0;
        const targetAngle = controlRef.current.pitch * 0.58;
        p.angle += (targetAngle - p.angle) * dt * (1.7 + wingLevel * 0.1);
        p.angle += p.vy * 0.0018;

        const lift = p.vx * p.vx * (0.00095 + wingLevel * 0.00009) * wingFactor * Math.max(0.12, Math.cos(p.angle));
        const stall = p.vx < 2.7 ? (2.7 - p.vx) * 0.12 : 0;
        p.vy += (0.2 + stall - lift + Math.sin(p.angle) * 0.07 + wind) * dt * 60;
        p.vx *= Math.pow(0.9984 - Math.abs(p.angle) * 0.0007, dt * 60);
        p.vy *= Math.pow(0.998, dt * 60);

        if (controlRef.current.boost && p.fuel > 0 && !p.brokenEngine) {
          const engineLevel = saveRef.current.upgrades.engine;
          p.vx += (0.055 + engineLevel * 0.008) * Math.cos(p.angle) * dt * 60;
          p.vy += (0.055 + engineLevel * 0.008) * Math.sin(p.angle) * dt * 60;
          p.fuel -= (0.85 - engineLevel * 0.035) * dt * 60;
          if (Math.random() > 0.45) particlesRef.current.push({
            x: p.x - 30, y: p.y + 2, vx: -3 - Math.random() * 2, vy: (Math.random() - 0.5) * 1.5,
            life: 0.35, color: Math.random() > 0.5 ? "#ffd12e" : "#ff6b35", size: 4 + Math.random() * 5,
          });
        }

        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;
        distanceRef.current = Math.max(distanceRef.current, (p.x - START_X) / 7.4);
        cameraRef.current += (Math.max(0, p.x - 118) - cameraRef.current) * Math.min(1, dt * 4.5);

        const coinBase = Math.floor((p.x - 170) / 260);
        for (let id = coinBase - 1; id <= coinBase + 1; id++) {
          if (id <= 1 || collectedRef.current.has(id)) continue;
          const cx = id * 260 + 170;
          const cy = 370 + Math.sin(id * 2.17) * 125;
          if (Math.hypot(p.x - cx, p.y - cy) < 30) {
            collectedRef.current.add(id);
            earnedRef.current += 25;
            tone(760 + (id % 3) * 90, 0.08, "triangle");
            vibrate(12);
          }
        }

        for (const ob of obstacleDefs) {
          const gy = groundY(ob.x);
          if (p.x + 30 > ob.x && p.x - 28 < ob.x + ob.w && p.y + 13 > gy - ob.h && p.y - 13 < gy) {
            damagePlane(p, speed, "obstacle");
            p.vx *= -0.22; p.vy -= 1.6; p.angle += 0.7;
          }
        }

        const gy = groundY(p.x);
        if (p.y + 13 >= gy) {
          const impact = Math.abs(p.vy) + Math.abs(p.angle) * 7;
          p.y = gy - 13;
          if (!p.grounded) damagePlane(p, impact, "ground");
          p.grounded = true;
          if (impact < 4.6 && Math.abs(p.angle) < 0.35 && !p.brokenWing) {
            p.vy = -Math.abs(p.vy) * 0.12;
            p.angle *= 0.55;
            p.vx *= Math.pow(0.965, dt * 60);
          } else {
            p.vy = -Math.abs(p.vy) * 0.28;
            p.vx *= 0.72;
            p.angle += (Math.random() - 0.5) * 0.45;
          }
        } else {
          p.grounded = false;
        }

        const totalHp = Math.max(0, p.bodyHp) + Math.max(0, p.wingHp) + Math.max(0, p.engineHp);
        if (p.bodyHp <= 0 || p.y > H + 120 || (p.grounded && Math.abs(p.vx) < 0.25) || p.x < cameraRef.current - 100) {
          if (p.bodyHp <= 0) spawnDamage(p, true);
          finishFlight();
        }

        const hpMax = (80 + saveRef.current.upgrades.armor * 12) + (70 + saveRef.current.upgrades.armor * 8) + (65 + saveRef.current.upgrades.armor * 7);
        setHud({
          distance: Math.floor(distanceRef.current),
          speed: Math.floor(speed * 13),
          altitude: Math.max(0, Math.floor((gy - p.y) / 3.2)),
          fuel: Math.max(0, Math.floor((p.fuel / (100 + saveRef.current.upgrades.engine * 9)) * 100)),
          hp: Math.max(0, Math.floor((totalHp / hpMax) * 100)),
          wind: Math.round(wind * 100),
        });
      }

      particlesRef.current = particlesRef.current.filter(part => {
        part.x += part.vx * dt * 60;
        part.y += part.vy * dt * 60;
        part.vy += 0.18 * dt * 60;
        part.life -= dt;
        return part.life > 0;
      });
    };

    const render = () => {
      const cam = cameraRef.current;
      drawBackground(cam);
      drawWorld(cam);

      if (phaseRef.current === "aiming") {
        const d = dragRef.current;
        ctx.strokeStyle = "#7d4c72"; ctx.lineWidth = 4; ctx.setLineDash([7, 5]);
        ctx.beginPath(); ctx.moveTo(39, 608); ctx.lineTo((planeRef.current?.x || START_X) - cam, planeRef.current?.y || START_Y);
        ctx.moveTo(180, 608); ctx.lineTo((planeRef.current?.x || START_X) - cam, planeRef.current?.y || START_Y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#825635"; ctx.fillRect(32, 565, 13, 125); ctx.fillRect(174, 565, 13, 125);

        if (d.active) {
          const pct = Math.round(d.power * 100);
          ctx.fillStyle = "rgba(18,31,47,.72)"; roundedRect(115, 470, 106, 45, 22); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "900 24px sans-serif"; ctx.textAlign = "center";
          ctx.fillText(`${pct}%`, 168, 501);
        }
      }

      if (planeRef.current) drawPlane(planeRef.current, cam);

      for (const part of particlesRef.current) {
        const x = part.x - cam;
        ctx.save(); ctx.globalAlpha = clamp(part.life, 0, 1);
        ctx.translate(x, part.y); ctx.rotate(part.x * 0.05);
        ctx.fillStyle = part.color;
        if (part.kind === "wing") { roundedRect(-part.size, -5, part.size * 2, 10, 4); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(0, 0, part.size, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    };

    const loop = (time: number) => {
      const dt = Math.min(0.033, (time - lastRef.current) / 1000 || 0.016);
      lastRef.current = time;
      update(dt);
      render();
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameRef.current);
  }, [finishFlight, tone, vibrate]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = pointerPos(e);
    if (phaseRef.current === "hangar") {
      startAiming();
      dragRef.current = { active: true, x: pos.x, y: pos.y, power: 0 };
      return;
    }
    if (phaseRef.current === "aiming") {
      dragRef.current.active = true;
      dragRef.current.x = clamp(pos.x, 28, START_X + 12);
      dragRef.current.y = clamp(pos.y, START_Y - 105, START_Y + 82);
    } else if (phaseRef.current === "flying") {
      controlRef.current.pitch = clamp((pos.y - H * 0.46) / (H * 0.33), -1, 1);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pos = pointerPos(e);
    if (phaseRef.current === "aiming" && dragRef.current.active) {
      const x = clamp(pos.x, 25, START_X + 12);
      const y = clamp(pos.y, START_Y - 110, START_Y + 90);
      const dx = START_X - x;
      const dy = START_Y - y;
      dragRef.current = { active: true, x, y, power: clamp(Math.hypot(dx, dy) / 130, 0, 1) };
    } else if (phaseRef.current === "flying") {
      controlRef.current.pitch = clamp((pos.y - H * 0.46) / (H * 0.33), -1, 1);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current === "aiming" && dragRef.current.active) {
      const d = dragRef.current;
      if (d.power < 0.12) {
        dragRef.current = { active: false, x: START_X, y: START_Y, power: 0 };
        if (planeRef.current) { planeRef.current.x = START_X; planeRef.current.y = START_Y; }
        return;
      }
      const p = planeRef.current;
      if (p) {
        const launcher = saveRef.current.upgrades.launcher;
        const factor = (0.075 + launcher * 0.0065);
        p.vx = (START_X - d.x) * factor + 3.4;
        p.vy = (START_Y - d.y) * factor * 0.72 - 1.4;
        p.x = START_X; p.y = START_Y;
        p.angle = Math.atan2(p.vy, p.vx);
      }
      dragRef.current.active = false;
      setPhase("flying");
      tone(180, 0.2, "sawtooth");
      vibrate(35);
    }
    if (phaseRef.current === "flying") controlRef.current.pitch = 0;
  };

  const buyUpgrade = (key: UpgradeKey) => {
    const level = save.upgrades[key];
    if (level >= MAX_LEVEL) return;
    const cost = upgradeCost(level);
    if (!save.cheat && save.coins < cost) {
      setToast("コインが足りません");
      window.setTimeout(() => setToast(""), 1500);
      tone(120, 0.12, "square");
      return;
    }
    const next = {
      ...save,
      coins: save.cheat ? save.coins : save.coins - cost,
      upgrades: { ...save.upgrades, [key]: level + 1 },
    };
    persist(next);
    tone(620, 0.12, "triangle");
    vibrate(18);
  };

  const applyCode = () => {
    if (code.trim().toLowerCase() === "nyanyacheat") {
      persist({ ...saveRef.current, cheat: true });
      setCodeMessage("∞ コインモードを有効にしました！");
      setCode("");
      tone(880, 0.22, "triangle");
    } else {
      setCodeMessage("コードが見つかりません");
    }
  };

  const hpTone = hud.hp > 60 ? "safe" : hud.hp > 28 ? "warn" : "danger";

  return (
    <main className="game-shell">
      <section className="game-frame" aria-label="ポケット・フライト">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="game-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="飛行ゲーム画面。機体を後ろへ引き、指を離して発射します"
        />

        <header className="topbar">
          <div className="brand">
            <span className="brand-kicker">POCKET</span>
            <strong>FLIGHT</strong>
          </div>
          <div className="coin-pill" aria-label={`コイン ${save.cheat ? "無限" : save.coins}`}>
            <span className="coin-icon">★</span>
            <b>{save.cheat ? "∞" : save.coins.toLocaleString()}</b>
          </div>
          <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="設定">⚙</button>
        </header>

        {(phase === "hangar" || phase === "aiming") && (
          <>
            <div className="mission-card">
              <span>TODAY&apos;S RUN</span>
              <strong>{save.best ? `${save.best.toLocaleString()} m` : "はじめての飛行"}</strong>
              <small>自己ベストを更新しよう</small>
            </div>
            <div className="launch-copy">
              <span className="eyebrow">{phase === "aiming" ? "指を離してテイクオフ" : "READY FOR TAKEOFF"}</span>
              <h1>{phase === "aiming" ? "引っぱって狙おう" : "空の向こうまで飛ばそう"}</h1>
              <p>{phase === "aiming" ? "後ろへ大きく引くほどパワーアップ" : "機体をタッチして後ろへ引っぱる"}</p>
              {phase === "hangar" && <button className="launch-button" onClick={startAiming}><span>↗</span> フライト開始</button>}
            </div>
            <div className="upgrade-dock">
              <div className="dock-title"><span>機体アップグレード</span><small>全 {MAX_LEVEL} LEVEL</small></div>
              <div className="upgrade-grid">
                {(Object.keys(UPGRADE_INFO) as UpgradeKey[]).map(key => {
                  const info = UPGRADE_INFO[key];
                  const level = save.upgrades[key];
                  const maxed = level >= MAX_LEVEL;
                  return (
                    <button key={key} className="upgrade-card" onClick={() => buyUpgrade(key)} style={{ "--accent": info.color } as React.CSSProperties}>
                      <span className="upgrade-icon">{info.icon}</span>
                      <span className="upgrade-text"><b>{info.name}</b><small>LV.{level} · {info.copy}</small></span>
                      <span className="upgrade-cost">{maxed ? "MAX" : <><i>★</i>{save.cheat ? "FREE" : upgradeCost(level)}</>}</span>
                      <span className="level-track">{Array.from({ length: MAX_LEVEL }, (_, i) => <i key={i} className={i < level ? "filled" : ""} />)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {phase === "flying" && (
          <>
            <div className="flight-distance"><strong>{hud.distance}</strong><span>m</span><small>BEST {save.best} m</small></div>
            <div className="flight-stats">
              <div><span>速度</span><b>{hud.speed}</b><small>km/h</small></div>
              <div><span>高度</span><b>{hud.altitude}</b><small>m</small></div>
            </div>
            <div className="condition-stack">
              <div className={`condition ${hpTone}`}><span>機体</span><i><b style={{ width: `${hud.hp}%` }} /></i><em>{hud.hp}%</em></div>
              <div className="condition fuel"><span>燃料</span><i><b style={{ width: `${hud.fuel}%` }} /></i><em>{hud.fuel}%</em></div>
            </div>
            <div className="control-hint"><span>↕</span> 指を上下に動かして姿勢を制御</div>
            <button
              className={`boost-button ${controlRef.current.boost ? "active" : ""}`}
              onPointerDown={(e) => { e.stopPropagation(); controlRef.current.boost = true; tone(150, 0.08, "sawtooth"); }}
              onPointerUp={() => { controlRef.current.boost = false; }}
              onPointerCancel={() => { controlRef.current.boost = false; }}
              aria-label="ブースト"
            ><span>⚡</span><b>BOOST</b></button>
          </>
        )}

        {phase === "result" && (
          <div className="result-backdrop">
            <div className="result-card">
              <span className="result-kicker">{newBest ? "NEW RECORD!" : "FLIGHT COMPLETE"}</span>
              <h2>{newBest ? "自己ベスト更新！" : "ナイス・フライト！"}</h2>
              <div className="result-distance"><strong>{Math.floor(distanceRef.current)}</strong><span>m</span></div>
              <div className="result-reward"><span>獲得コイン</span><b><i>★</i> +{earnedRef.current}</b></div>
              <div className="damage-report">
                <span>フライトレポート</span>
                <div><i>翼</i><b>{planeRef.current?.brokenWing ? "破損" : "OK"}</b></div>
                <div><i>エンジン</i><b>{planeRef.current?.brokenEngine ? "停止" : "OK"}</b></div>
                <div><i>着地</i><b>{(planeRef.current?.bodyHp || 0) > 25 ? "生還" : "大破"}</b></div>
              </div>
              <button className="retry-button" onClick={startAiming}>もう一度飛ぶ <span>↗</span></button>
              <button className="hangar-button" onClick={() => setPhase("hangar")}>ハンガーへ戻る</button>
            </div>
          </div>
        )}

        {showSettings && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="設定">
            <div className="settings-card">
              <div className="settings-heading"><div><span>GAME SETTINGS</span><h2>設定</h2></div><button onClick={() => setShowSettings(false)} aria-label="閉じる">×</button></div>
              <label className="setting-row"><span><b>サウンド</b><small>効果音を再生</small></span><input type="checkbox" checked={save.sound} onChange={e => persist({ ...save, sound: e.target.checked })} /></label>
              <label className="setting-row"><span><b>振動</b><small>衝突時のフィードバック</small></span><input type="checkbox" checked={save.vibration} onChange={e => persist({ ...save, vibration: e.target.checked })} /></label>
              <div className="code-box">
                <label htmlFor="secret-code">シークレットコード</label>
                <div><input id="secret-code" value={code} onChange={e => { setCode(e.target.value); setCodeMessage(""); }} onKeyDown={e => e.key === "Enter" && applyCode()} placeholder="コードを入力" autoCapitalize="none" /><button onClick={applyCode}>適用</button></div>
                {codeMessage && <p className={save.cheat ? "success" : ""}>{codeMessage}</p>}
              </div>
              <div className="stats-row"><span><small>ベスト</small><b>{save.best} m</b></span><span><small>総フライト</small><b>{save.flights} 回</b></span></div>
            </div>
          </div>
        )}

        {toast && <div className="toast">{toast}</div>}
      </section>
      <p className="desktop-note">スマートフォンの縦画面で遊ぶのがおすすめです</p>
    </main>
  );
}
