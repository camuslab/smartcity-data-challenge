import { createAgent, spawn, step, trailIndex, visibility, TRAIL_POINTS, type Agent } from './agents';
import { pointAt, type Graph, type Point } from './graph';
import { buildLayers, buildSprite, COOL_RGB, WARM_RGB, type Layers } from './layers';
import { computeView, isOnScreen, toScreen, type View, type ViewOptions } from './view';

export interface RendererOptions {
  /** 화면 크기에 따라 초점과 배율을 정한다. */
  readonly viewFor: (width: number, height: number) => ViewOptions;
  readonly agentsFor: (width: number, height: number) => number;
  readonly intro: boolean;
  readonly reducedMotion: boolean;
  /** 지도가 다 펼쳐진 뒤 이 시간(초)만큼 머물면 onSceneEnd를 한 번 부른다. 여러 지역을 돌려 보일 때 쓴다. */
  readonly holdSeconds?: number;
  readonly onSceneEnd?: () => void;
}

interface Ping {
  x: number;
  y: number;
  age: number;
}

const MAX_DPR = 2;
const MAX_PIXELS = 3_400_000;
const MAX_FRAME_DT = 0.05;
const MAX_SCENE_DT = 0.5;
const INTRO_SECONDS = 2.6;
/** 지역을 바꿀 때는 처음보다 빨리 펼친다. */
const SWITCH_INTRO_SECONDS = 1.2;
/** 빛 점은 지도가 어느 정도 펼쳐진 뒤에 나타난다. */
const AGENT_DELAY = 0.35;
const AGENT_FADE_SECONDS = 1;
const INTRO_FEATHER = 220;
const CAMPUS_GLOW = 150;
const BREATHE_AMOUNT = 0.05;
const POINTER_GLOW = 200;
const POINTER_EASE = 7;
const SPRITE_SIZE = 14;
const PING_SECONDS = 0.8;
const MAX_PINGS = 14;
const OFFSCREEN_MARGIN = 60;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export class RoadRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly spot: HTMLCanvasElement = document.createElement('canvas');
  private readonly spotCtx: CanvasRenderingContext2D;
  private readonly sprites = { warm: buildSprite(WARM_RGB, SPRITE_SIZE * 2), cool: buildSprite(COOL_RGB, SPRITE_SIZE * 2) };
  private readonly agents: Agent[] = [];
  private readonly pings: Ping[] = [];
  private readonly scratch: Point = { x: 0, y: 0 };
  private readonly campus: Point = { x: 0, y: 0 };
  private readonly pointer = { x: 0, y: 0, targetX: 0, targetY: 0, strength: 0, active: false };
  private view: View = { scale: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
  private layers: Layers | null = null;
  private visibleEdges: number[] = [];
  private dpr = 1;
  /** 계속 흐르는 시간. 기준점 불빛의 숨쉬기에 쓴다. */
  private clock = 0;
  /** 지금 지역을 보여 주기 시작한 뒤 흐른 시간 */
  private sceneClock = 0;
  private introSeconds = INTRO_SECONDS;
  private sceneEnded = false;
  private lastTime = 0;
  private frame = 0;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private graph: Graph,
    private readonly options: RendererOptions,
  ) {
    const ctx = canvas.getContext('2d');
    const spotCtx = this.spot.getContext('2d');
    if (!ctx || !spotCtx) throw new Error('2D 캔버스를 사용할 수 없습니다.');
    this.ctx = ctx;
    this.spotCtx = spotCtx;
  }

  /** 캔버스 크기에 맞춰 레이어와 빛 점을 다시 만든다. */
  resize(width: number, height: number): void {
    if (width < 2 || height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR, Math.sqrt(MAX_PIXELS / (width * height)));
    if (this.layers && width === this.view.width && height === this.view.height && dpr === this.dpr) return;
    this.dpr = dpr;
    // 비춤용 캔버스는 가장 큰 반지름에 맞춰 한 번만 잡아 둔다. 매 프레임 크기를 바꾸면 버퍼를 다시 할당한다.
    const spotSize = Math.ceil(Math.max(POINTER_GLOW, CAMPUS_GLOW * (1 + BREATHE_AMOUNT)) * 2 * dpr) + 2;
    this.spot.width = spotSize;
    this.spot.height = spotSize;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.rebuild(width, height);
  }

  /** 다른 지역의 도로망으로 바꾸고, 기준점에서부터 다시 펼친다. */
  setGraph(graph: Graph): void {
    this.graph = graph;
    this.sceneClock = 0;
    this.sceneEnded = false;
    this.introSeconds = SWITCH_INTRO_SECONDS;
    this.pings.length = 0;
    if (this.layers) this.rebuild(this.view.width, this.view.height);
  }

  /** 지금 도로망과 화면 크기에 맞춰 도로 레이어와 빛 점을 새로 만든다. */
  private rebuild(width: number, height: number): void {
    this.view = computeView(this.graph, this.graph.campus, { width, height }, this.options.viewFor(width, height));
    this.layers = buildLayers(this.graph, this.view, this.dpr);
    toScreen(this.view, this.graph.campus, this.campus);
    this.visibleEdges = this.findVisibleEdges();
    this.resetAgents(this.options.reducedMotion ? 0 : this.options.agentsFor(width, height));
    if (!this.running) this.draw(this.introProgress());
  }

  /** 도입 연출 진행도(0~1). 연출을 쓰지 않으면 항상 1. */
  private introProgress(): number {
    if (!this.options.intro || this.options.reducedMotion) return 1;
    return Math.min(this.sceneClock / this.introSeconds, 1);
  }

  /** 지도가 다 펼쳐지고 정해진 시간만큼 머물렀으면 한 번 알린다. */
  private notifySceneEnd(): void {
    const { holdSeconds, onSceneEnd } = this.options;
    if (this.sceneEnded || !onSceneEnd || holdSeconds === undefined) return;
    if (this.sceneClock < this.introSeconds + holdSeconds) return;
    this.sceneEnded = true;
    onSceneEnd();
  }

  start(): void {
    if (this.running || this.options.reducedMotion || !this.layers) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** 포인터 위치(캔버스 기준 px). 벗어났으면 null. */
  setPointer(position: Point | null): void {
    this.pointer.active = position !== null;
    if (!position) return;
    this.pointer.targetX = position.x;
    this.pointer.targetY = position.y;
    if (this.pointer.strength < 0.02) {
      this.pointer.x = position.x;
      this.pointer.y = position.y;
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const elapsed = (now - this.lastTime) / 1000;
    const dt = Math.min(elapsed, MAX_FRAME_DT);
    this.lastTime = now;
    this.clock += dt;
    // 움직임은 프레임이 느려져도 튀지 않게 짧게 끊어 가지만, 지역을 바꾸는 시각은 실제 시간에 가깝게 센다.
    this.sceneClock += Math.min(elapsed, MAX_SCENE_DT);
    this.update(dt);
    this.draw(this.introProgress());
    this.notifySceneEnd();
    this.frame = requestAnimationFrame(this.tick);
  };

  private findVisibleEdges(): number[] {
    const visible: number[] = [];
    this.graph.edges.forEach((edge, index) => {
      pointAt(edge, edge.length / 2, this.scratch);
      toScreen(this.view, this.scratch, this.scratch);
      if (isOnScreen(this.view, this.scratch.x, this.scratch.y, 0)) visible.push(index);
    });
    return visible;
  }

  private resetAgents(count: number): void {
    this.agents.length = 0;
    for (let i = 0; i < count; i += 1) {
      const agent = createAgent();
      spawn(agent, this.graph, this.visibleEdges, Math.random);
      agent.age = Math.random() * agent.life * 0.6;
      this.agents.push(agent);
    }
  }

  private update(dt: number): void {
    const p = this.pointer;
    const ease = Math.min(dt * POINTER_EASE, 1);
    p.x += (p.targetX - p.x) * ease;
    p.y += (p.targetY - p.y) * ease;
    p.strength += ((p.active ? 1 : 0) - p.strength) * Math.min(dt * 4, 1);
    for (const agent of this.agents) this.advance(agent, dt);
    for (const ping of this.pings) ping.age += dt;
    while (this.pings.length > 0 && this.pings[0]!.age >= PING_SECONDS) this.pings.shift();
  }

  private advance(agent: Agent, dt: number): void {
    const result = step(agent, this.graph, dt, this.view.scale, Math.random, this.scratch);
    if (result === 'ended') {
      spawn(agent, this.graph, this.visibleEdges, Math.random);
      return;
    }
    pointAt(this.graph.edges[agent.edge]!, agent.s, this.scratch);
    toScreen(this.view, this.scratch, this.scratch);
    if (!isOnScreen(this.view, this.scratch.x, this.scratch.y, OFFSCREEN_MARGIN)) {
      spawn(agent, this.graph, this.visibleEdges, Math.random);
    } else if (result === 'turned' && this.pings.length < MAX_PINGS && Math.random() < 0.35) {
      this.pings.push({ x: this.scratch.x, y: this.scratch.y, age: 0 });
    }
  }

  private draw(intro: number): void {
    if (!this.layers) return;
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layers.base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const breathe = 1 + Math.sin(this.clock * 1.3) * BREATHE_AMOUNT;
    this.drawSpot(this.campus.x, this.campus.y, CAMPUS_GLOW * breathe, 0.95);
    if (this.pointer.strength > 0.01) {
      this.drawSpot(this.pointer.x, this.pointer.y, POINTER_GLOW, this.pointer.strength);
    }
    if (intro < 1) this.maskIntro(intro);
    ctx.globalCompositeOperation = 'lighter';
    const agentStart = this.introSeconds * AGENT_DELAY;
    const agentAlpha = this.options.intro ? Math.min(Math.max((this.sceneClock - agentStart) / AGENT_FADE_SECONDS, 0), 1) : 1;
    for (const agent of this.agents) this.drawAgent(agent, agentAlpha);
    this.drawPings(agentAlpha);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** 앰버 레이어를 (x, y) 주변 원형으로만 비춘다. */
  private drawSpot(x: number, y: number, radius: number, alpha: number): void {
    if (!this.layers) return;
    const size = Math.min(Math.ceil(radius * 2 * this.dpr), this.spot.width);
    const left = Math.round((x - radius) * this.dpr);
    const top = Math.round((y - radius) * this.dpr);
    const s = this.spotCtx;
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, size, size);
    // 필요한 사각형만 잘라 온다. 지도 밖으로 나간 부분은 브라우저가 알아서 잘라 낸다.
    s.drawImage(this.layers.hot, left, top, size, size, 0, 0, size, size);
    const half = size / 2;
    const gradient = s.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgb(0 0 0 / 1)');
    gradient.addColorStop(0.45, 'rgb(0 0 0 / 0.6)');
    gradient.addColorStop(1, 'rgb(0 0 0 / 0)');
    s.globalCompositeOperation = 'destination-in';
    s.fillStyle = gradient;
    s.fillRect(0, 0, size, size);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.spot, 0, 0, size, size, left / this.dpr, top / this.dpr, size / this.dpr, size / this.dpr);
    this.ctx.globalAlpha = 1;
  }

  /** 캠퍼스에서 바깥으로 지도가 퍼져 나가는 도입 연출 */
  private maskIntro(progress: number): void {
    const { ctx, view, campus } = this;
    const reach = Math.hypot(Math.max(campus.x, view.width - campus.x), Math.max(campus.y, view.height - campus.y));
    const radius = easeOutCubic(progress) * (reach + INTRO_FEATHER);
    const gradient = ctx.createRadialGradient(campus.x, campus.y, 0, campus.x, campus.y, Math.max(radius, 1));
    const solid = Math.max(1 - INTRO_FEATHER / Math.max(radius, INTRO_FEATHER), 0);
    gradient.addColorStop(0, 'rgb(0 0 0 / 1)');
    gradient.addColorStop(solid, 'rgb(0 0 0 / 1)');
    gradient.addColorStop(1, 'rgb(0 0 0 / 0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawAgent(agent: Agent, baseAlpha: number): void {
    const alpha = visibility(agent) * baseAlpha;
    if (alpha <= 0.01 || agent.trailCount < 2) return;
    const { ctx, view } = this;
    const { scale, offsetX, offsetY } = view;
    ctx.strokeStyle = `rgb(${agent.warm ? WARM_RGB : COOL_RGB})`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    let prev = trailIndex(agent, 0);
    for (let i = 1; i < agent.trailCount; i += 1) {
      const current = trailIndex(agent, i);
      ctx.globalAlpha = alpha * (1 - i / TRAIL_POINTS) * 0.75;
      ctx.beginPath();
      ctx.moveTo(agent.trail[prev * 2]! * scale + offsetX, agent.trail[prev * 2 + 1]! * scale + offsetY);
      ctx.lineTo(agent.trail[current * 2]! * scale + offsetX, agent.trail[current * 2 + 1]! * scale + offsetY);
      ctx.stroke();
      prev = current;
    }
    const head = trailIndex(agent, 0);
    const hx = agent.trail[head * 2]! * scale + offsetX;
    const hy = agent.trail[head * 2 + 1]! * scale + offsetY;
    ctx.globalAlpha = alpha;
    ctx.drawImage(agent.warm ? this.sprites.warm : this.sprites.cool, hx - SPRITE_SIZE / 2, hy - SPRITE_SIZE / 2, SPRITE_SIZE, SPRITE_SIZE);
  }

  private drawPings(baseAlpha: number): void {
    const { ctx } = this;
    ctx.strokeStyle = `rgb(${WARM_RGB})`;
    ctx.lineWidth = 1;
    for (const ping of this.pings) {
      const t = ping.age / PING_SECONDS;
      ctx.globalAlpha = (1 - t) * 0.5 * baseAlpha;
      ctx.beginPath();
      ctx.arc(ping.x, ping.y, 2 + easeOutCubic(t) * 12, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
