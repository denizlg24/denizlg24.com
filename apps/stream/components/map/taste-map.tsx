"use client";

import type {
  MapHighlight,
  MapMeta,
  MapPoint,
  ProfileColor,
} from "@repo/schemas/stream";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  boundsOf,
  type Camera,
  clamp,
  clampCamera,
  contains,
  easeInOut,
  expandBounds,
  fitBounds,
  type Insets,
  interpolate,
  type Lod,
  layerTransform,
  lodFor,
  panBy,
  posterBlend,
  sameLod,
  smoothstep,
  toMap,
  toScreen,
  type Viewport,
  visibleBounds,
  type ZoomLimits,
  zoomAt,
  zoomLimits,
} from "./camera";
import { AudienceLegend, MapControls, MapHint } from "./controls";
import {
  batchDots,
  type DotBatch,
  drawConstellation,
  drawField,
  prepareCanvas,
} from "./draw";
import {
  FocusRing,
  GenreLabels,
  LABEL_SIZE,
  PickedRings,
  PosterLayer,
  VisibleList,
} from "./layers";
import {
  declutter,
  genreTints,
  nearestTo,
  type PosterTile,
  tileAt,
} from "./layout";
import { PEEK_WIDTH, Peek, type PeekTarget } from "./peek";
import { type MapKind, RegionStore } from "./region-store";
import { tileLoader, useHighlights, useMapSetup } from "./use-map-data";

export interface MapFocus {
  id: string;
  x: number;
  y: number;
  title: string;
}

export interface MapAudienceMember {
  id: string;
  name: string;
  color: ProfileColor;
  kids: boolean;
}

const FETCH_DEBOUNCE_MS = 150;
const FLIGHT_MS = 650;
const KEY_FLIGHT_MS = 220;
const ZOOM_STEP = 1.6;
const FOCUS_SCALE = 1.4;
const FOCUS_MARK_MS = 5000;
const MAX_LISTED = 50;
const INSETS: Insets = { top: 88, right: 72, bottom: 72, left: 40 };

export function TasteMap({
  audience,
  focus,
}: {
  audience: MapAudienceMember[];
  focus: MapFocus | null;
}) {
  const profile =
    (audience.find((member) => member.kids) ?? audience[0])?.id ?? null;
  const [setup, retry] = useMapSetup(profile);
  const highlights = useHighlights(audience.map((member) => member.id));

  if (setup.status === "loading") {
    return <div className="absolute inset-0 bg-ink" />;
  }
  if (setup.status === "error") {
    return (
      <CentredMessage>
        The map couldn't load just now.
        <button
          type="button"
          data-nav
          onClick={retry}
          className="mt-6 block w-fit rounded-full px-4 py-2 font-sans text-amber text-sm mx-auto hover:text-paper"
        >
          Try again
        </button>
      </CentredMessage>
    );
  }
  if (setup.data.empty) {
    return (
      <CentredMessage>
        The map fills in once the catalogue has loaded.
      </CentredMessage>
    );
  }
  return (
    <MapView
      meta={setup.data.meta}
      highlights={highlights.status === "ready" ? highlights.data : []}
      highlightsSettled={highlights.status !== "loading"}
      audience={audience}
      profile={profile}
      focus={focus}
    />
  );
}

function CentredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink px-8">
      <div className="max-w-xl text-balance text-center text-2xl text-paper/60 leading-snug">
        {children}
      </div>
    </div>
  );
}

interface Flight {
  from: Camera;
  to: Camera;
  start: number;
  duration: number;
}

interface TapStart {
  x: number;
  y: number;
  time: number;
  moved: boolean;
}

function MapView({
  meta,
  highlights,
  highlightsSettled,
  audience,
  profile,
  focus,
}: {
  meta: MapMeta;
  highlights: MapHighlight[];
  highlightsSettled: boolean;
  audience: MapAudienceMember[];
  profile: string | null;
  focus: MapFocus | null;
}) {
  const size = meta.size;
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const postersRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);

  const cameraRef = useRef<Camera | null>(null);
  const viewportRef = useRef<Viewport>({ width: 0, height: 0 });
  const limitsRef = useRef<ZoomLimits>({ min: 0.01, max: 6 });
  const flightRef = useRef<Flight | null>(null);
  const velocityRef = useRef<{ vx: number; vy: number } | null>(null);
  const lastFrameRef = useRef(0);
  const rafRef = useRef(0);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = useRef(false);
  const storeRef = useRef<RegionStore | null>(null);
  const lodRef = useRef<Lod | null>(null);
  const kindRef = useRef<MapKind | null>(null);
  const batchesRef = useRef<DotBatch[]>([]);
  const tilesRef = useRef<PosterTile[]>([]);
  const tilesByIdRef = useRef<Map<string, PosterTile>>(new Map());
  const pointsRef = useRef<MapPoint[]>([]);
  const highlightsRef = useRef(highlights);
  const captionRef = useRef(-1);
  const peekTargetRef = useRef<PeekTarget | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const tapRef = useRef<TapStart | null>(null);
  const samplesRef = useRef<{ t: number; x: number; y: number }[]>([]);

  const [ready, setReady] = useState(false);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [lod, setLod] = useState<Lod>({
    mode: "dots",
    cell: Math.round(size / 100),
  });
  const [kind, setKind] = useState<MapKind | null>(null);
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const [viewBounds, setViewBounds] = useState<ReturnType<
    typeof visibleBounds
  > | null>(null);
  const [focusMark, setFocusMark] = useState<MapFocus | null>(focus);

  const tints = useMemo(() => genreTints(meta.anchors, size), [meta, size]);
  const tiles = useMemo(
    () => (lod.mode === "posters" ? declutter(points, lod.posterWidth) : []),
    [points, lod],
  );
  const shownTiles = useMemo(() => {
    if (!viewBounds) return tiles;
    const near = expandBounds(viewBounds, 0.5);
    return tiles.filter((tile) => contains(near, tile.point.x, tile.point.y));
  }, [tiles, viewBounds]);
  const inView = useMemo(() => {
    if (!viewBounds) return [];
    return points
      .filter((point) => contains(viewBounds, point.x, point.y))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_LISTED);
  }, [points, viewBounds]);
  const pickedIds = useMemo(
    () =>
      new Set(highlights.filter((h) => h.kind === "picked").map((h) => h.id)),
    [highlights],
  );

  function schedule() {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(frame);
  }

  function blendNow(): number {
    const camera = cameraRef.current;
    return camera && lodRef.current?.mode === "posters"
      ? posterBlend(camera.scale)
      : 0;
  }

  function anchorFor(highlight: MapHighlight): readonly [number, number] {
    const blend = blendNow();
    const tile = blend > 0 ? tilesByIdRef.current.get(highlight.id) : undefined;
    if (!tile) return [highlight.x, highlight.y];
    const cornerX = tile.left + tile.width;
    const cornerY = tile.top;
    return [
      highlight.x + (cornerX - highlight.x) * blend,
      highlight.y + (cornerY - highlight.y) * blend,
    ];
  }

  function render(camera: Camera) {
    const viewport = viewportRef.current;
    const layer = layerRef.current;
    if (layer) {
      layer.style.transform = layerTransform(camera, viewport);
      layer.style.setProperty("--inv", String(1 / camera.scale));
    }
    if (labelsRef.current) {
      labelsRef.current.style.opacity = String(
        1 - smoothstep(70, 150, LABEL_SIZE * camera.scale),
      );
    }
    const blend = blendNow();
    if (postersRef.current) postersRef.current.style.opacity = String(blend);
    const current = lodRef.current;
    const caption =
      current?.mode === "posters"
        ? smoothstep(100, 124, current.posterWidth * camera.scale)
        : 0;
    if (layer && Math.abs(caption - captionRef.current) > 0.02) {
      captionRef.current = caption;
      layer.style.setProperty("--caption", caption.toFixed(2));
    }
    const field = fieldRef.current;
    const fieldContext = field ? prepareCanvas(field, viewport) : null;
    if (fieldContext) {
      const boost = clamp(
        (camera.scale / limitsRef.current.min) ** 0.18,
        1,
        1.9,
      );
      drawField(
        fieldContext,
        viewport,
        camera,
        batchesRef.current,
        1 - blend,
        boost,
      );
    }
    const overlay = overlayRef.current;
    const overlayContext = overlay ? prepareCanvas(overlay, viewport) : null;
    if (overlayContext) {
      drawConstellation(
        overlayContext,
        viewport,
        camera,
        highlightsRef.current,
        anchorFor,
        blend,
      );
    }
    placePeek(camera);
  }

  function placePeek(camera: Camera) {
    const target = peekTargetRef.current;
    const panel = peekRef.current;
    if (!target || !panel) return;
    const viewport = viewportRef.current;
    const [sx, sy] = toScreen(camera, viewport, target.x, target.y);
    const tile = tilesByIdRef.current.get(target.id);
    const gap =
      tile && blendNow() > 0.5 ? (tile.width * camera.scale) / 2 + 14 : 28;
    let px = sx + gap;
    if (px + PEEK_WIDTH > viewport.width - 16) px = sx - gap - PEEK_WIDTH;
    px = clamp(px, 16, Math.max(16, viewport.width - PEEK_WIDTH - 16));
    const height = panel.offsetHeight;
    const py = clamp(
      sy - height / 2,
      80,
      Math.max(80, viewport.height - height - 16),
    );
    panel.style.setProperty("--px", `${Math.round(px)}px`);
    panel.style.setProperty("--py", `${Math.round(py)}px`);
  }

  function frame(now: number) {
    rafRef.current = 0;
    let camera = cameraRef.current;
    if (!camera || viewportRef.current.width === 0) return;
    const dt = lastFrameRef.current
      ? Math.min(now - lastFrameRef.current, 48)
      : 16;
    lastFrameRef.current = now;
    let moving = false;
    const flight = flightRef.current;
    const velocity = velocityRef.current;
    if (flight) {
      const t = Math.min((now - flight.start) / flight.duration, 1);
      camera = interpolate(flight.from, flight.to, easeInOut(Math.max(t, 0)));
      if (t >= 1) flightRef.current = null;
      else moving = true;
    } else if (velocity) {
      camera = panBy(camera, velocity.vx * dt, velocity.vy * dt);
      const decay = 0.9 ** (dt / 16);
      velocity.vx *= decay;
      velocity.vy *= decay;
      if (Math.hypot(velocity.vx, velocity.vy) < 0.02)
        velocityRef.current = null;
      else moving = true;
    }
    camera = clampCamera(camera, limitsRef.current, size);
    cameraRef.current = camera;
    render(camera);
    afterView(camera);
    if (moving) schedule();
    else lastFrameRef.current = 0;
  }

  function afterView(camera: Camera) {
    const next = lodFor(camera.scale, size);
    if (!lodRef.current || !sameLod(lodRef.current, next)) {
      lodRef.current = next;
      setLod(next);
    }
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(requestRegion, FETCH_DEBOUNCE_MS);
  }

  function requestRegion() {
    fetchTimerRef.current = null;
    const camera = cameraRef.current;
    const current = lodRef.current;
    if (!camera || !current) return;
    const bounds = visibleBounds(camera, viewportRef.current);
    setViewBounds(bounds);
    storeRef.current?.request({
      bounds: expandBounds(bounds, 0.1),
      cell: current.cell,
      kind: kindRef.current,
    });
  }

  function setCamera(camera: Camera) {
    flightRef.current = null;
    velocityRef.current = null;
    cameraRef.current = clampCamera(camera, limitsRef.current, size);
    schedule();
  }

  function flyTo(target: Camera, duration = FLIGHT_MS) {
    const from = cameraRef.current;
    const to = clampCamera(target, limitsRef.current, size);
    if (!from || reducedMotionRef.current) {
      setCamera(to);
      return;
    }
    velocityRef.current = null;
    flightRef.current = { from, to, start: performance.now(), duration };
    schedule();
  }

  /** Where a chained key press should start from: the end of the flight already under way. */
  function destination(): Camera | null {
    return flightRef.current?.to ?? cameraRef.current;
  }

  function zoomBy(factor: number) {
    const base = destination();
    const viewport = viewportRef.current;
    if (!base) return;
    flyTo(
      zoomAt(
        base,
        viewport,
        factor,
        viewport.width / 2,
        viewport.height / 2,
        limitsRef.current,
      ),
      reducedMotionRef.current ? 0 : 360,
    );
  }

  function constellationCamera(): Camera | null {
    const bounds = boundsOf(highlightsRef.current);
    if (!bounds) return null;
    return fitBounds(
      bounds,
      viewportRef.current,
      INSETS,
      limitsRef.current,
      FOCUS_SCALE,
    );
  }

  function findUs() {
    const camera = destination();
    if (!camera) return;
    flyTo(
      constellationCamera() ?? {
        x: size / 2,
        y: size / 2,
        scale: camera.scale,
      },
    );
  }

  function openPeek(target: PeekTarget) {
    peekTargetRef.current = target;
    setPeek(target);
    schedule();
  }

  function closePeek() {
    peekTargetRef.current = null;
    setPeek(null);
    containerRef.current?.focus({ preventScroll: true });
  }

  function hitTest(sx: number, sy: number): PeekTarget | null {
    const camera = cameraRef.current;
    if (!camera) return null;
    const viewport = viewportRef.current;
    const [mx, my] = toMap(camera, viewport, sx, sy);
    const byId = new Map(pointsRef.current.map((point) => [point.id, point]));
    const stars = highlightsRef.current
      .filter((h) => h.kind !== "picked")
      .map((h) => {
        const [x, y] = anchorFor(h);
        return { h, x, y };
      });
    const star = nearestTo(stars, mx, my, 14 / camera.scale);
    if (star) {
      return {
        id: star.h.id,
        x: star.h.x,
        y: star.h.y,
        point: byId.get(star.h.id) ?? null,
      };
    }
    if (blendNow() > 0.5) {
      const tile = tileAt(tilesRef.current, mx, my);
      if (tile)
        return {
          id: tile.point.id,
          x: tile.point.x,
          y: tile.point.y,
          point: tile.point,
        };
    } else {
      const point = nearestTo(pointsRef.current, mx, my, 12 / camera.scale);
      if (point) return { id: point.id, x: point.x, y: point.y, point };
    }
    const picked = nearestTo(
      highlightsRef.current.filter((h) => h.kind === "picked"),
      mx,
      my,
      16 / camera.scale,
    );
    if (picked) {
      return {
        id: picked.id,
        x: picked.x,
        y: picked.y,
        point: byId.get(picked.id) ?? null,
      };
    }
    return null;
  }

  function localPoint(event: {
    clientX: number;
    clientY: number;
  }): [number, number] {
    const rect = containerRef.current?.getBoundingClientRect();
    return [
      event.clientX - (rect?.left ?? 0),
      event.clientY - (rect?.top ?? 0),
    ];
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = localPoint(event);
    pointersRef.current.set(event.pointerId, { x, y });
    flightRef.current = null;
    velocityRef.current = null;
    samplesRef.current = [{ t: event.timeStamp, x, y }];
    tapRef.current =
      pointersRef.current.size === 1
        ? { x, y, time: event.timeStamp, moved: false }
        : null;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    const previous = pointers.get(event.pointerId);
    const camera = cameraRef.current;
    if (!previous || !camera) return;
    const [x, y] = localPoint(event);
    const tap = tapRef.current;
    if (tap && Math.hypot(x - tap.x, y - tap.y) > 6) tap.moved = true;
    if (pointers.size === 1) {
      pointers.set(event.pointerId, { x, y });
      cameraRef.current = clampCamera(
        panBy(camera, x - previous.x, y - previous.y),
        limitsRef.current,
        size,
      );
      const samples = samplesRef.current;
      samples.push({ t: event.timeStamp, x, y });
      while (samples.length > 2 && event.timeStamp - samples[0].t > 100)
        samples.shift();
      schedule();
      return;
    }
    const others = [...pointers.entries()].filter(
      ([id]) => id !== event.pointerId,
    );
    const other = others[0]?.[1];
    if (!other) return;
    const before = {
      mx: (previous.x + other.x) / 2,
      my: (previous.y + other.y) / 2,
      d: Math.hypot(previous.x - other.x, previous.y - other.y),
    };
    pointers.set(event.pointerId, { x, y });
    const after = {
      mx: (x + other.x) / 2,
      my: (y + other.y) / 2,
      d: Math.hypot(x - other.x, y - other.y),
    };
    const zoomed = zoomAt(
      camera,
      viewportRef.current,
      before.d > 0 ? after.d / before.d : 1,
      before.mx,
      before.my,
      limitsRef.current,
    );
    cameraRef.current = clampCamera(
      panBy(zoomed, after.mx - before.mx, after.my - before.my),
      limitsRef.current,
      size,
    );
    schedule();
  }

  function onPointerEnd(
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) {
    const pointers = pointersRef.current;
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size > 0) {
      tapRef.current = null;
      samplesRef.current = [];
      return;
    }
    const tap = tapRef.current;
    tapRef.current = null;
    if (!cancelled && tap && !tap.moved && event.timeStamp - tap.time < 500) {
      const target = hitTest(tap.x, tap.y);
      if (target) openPeek(target);
      else if (peekTargetRef.current) closePeek();
      return;
    }
    const samples = samplesRef.current;
    samplesRef.current = [];
    if (cancelled || reducedMotionRef.current || samples.length < 2) return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.t - first.t;
    if (elapsed <= 0 || event.timeStamp - last.t > 60) return;
    const vx = (last.x - first.x) / elapsed;
    const vy = (last.y - first.y) / elapsed;
    if (Math.hypot(vx, vy) < 0.2) return;
    velocityRef.current = { vx: clamp(vx, -3, 3), vy: clamp(vy, -3, 3) };
    lastFrameRef.current = 0;
    schedule();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const viewport = viewportRef.current;
    const step = Math.min(viewport.width, viewport.height) * 0.2;
    const pan: Record<string, [number, number]> = {
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
    };
    const delta = pan[event.key];
    if (delta) {
      event.preventDefault();
      const base = destination();
      if (base) flyTo(panBy(base, delta[0], delta[1]), KEY_FLIGHT_MS);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const camera = cameraRef.current;
      if (camera && blendNow() > 0.5) {
        const nearest = nearestTo(
          tilesRef.current.map((tile) => ({
            tile,
            x: tile.point.x,
            y: tile.point.y,
          })),
          camera.x,
          camera.y,
        );
        if (nearest) {
          const { point } = nearest.tile;
          openPeek({ id: point.id, x: point.x, y: point.y, point });
          return;
        }
      }
      zoomBy(2);
    } else if (event.key === "Escape" && peekTargetRef.current) {
      event.preventDefault();
      closePeek();
    }
  }

  function changeKind(next: MapKind | null) {
    kindRef.current = next;
    setKind(next);
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    requestRegion();
  }

  useEffect(() => {
    const store = new RegionStore(size, tileLoader(profile), (next) =>
      setPoints(next),
    );
    storeRef.current = store;
    return () => {
      store.dispose();
      storeRef.current = null;
    };
  }, [size, profile]);

  useEffect(() => {
    pointsRef.current = points;
    batchesRef.current = batchDots(points, meta.anchors, tints);
    schedule();
  }, [points, meta, tints]);

  useEffect(() => {
    tilesRef.current = tiles;
    tilesByIdRef.current = new Map(tiles.map((tile) => [tile.point.id, tile]));
    schedule();
  }, [tiles]);

  useEffect(() => {
    highlightsRef.current = highlights;
    schedule();
  }, [highlights]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      viewportRef.current = { width: rect.width, height: rect.height };
      limitsRef.current = zoomLimits(viewportRef.current, size);
      if (cameraRef.current) {
        cameraRef.current = clampCamera(
          cameraRef.current,
          limitsRef.current,
          size,
        );
        schedule();
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [size]);

  useEffect(() => {
    if (cameraRef.current || (!highlightsSettled && !focus)) return;
    if (viewportRef.current.width === 0) return;
    const viewport = viewportRef.current;
    const limits = limitsRef.current;
    const whole = fitBounds(
      { x0: 0, y0: 0, x1: size, y1: size },
      viewport,
      INSETS,
      limits,
    );
    cameraRef.current = clampCamera(
      focus
        ? { x: focus.x, y: focus.y, scale: FOCUS_SCALE }
        : (constellationCamera() ?? whole),
      limits,
      size,
    );
    setReady(true);
    schedule();
  }, [highlightsSettled, highlights, focus, size]);

  useEffect(() => {
    if (!focusMark) return;
    const timer = setTimeout(() => setFocusMark(null), FOCUS_MARK_MS);
    return () => clearTimeout(timer);
  }, [focusMark]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      const camera = cameraRef.current;
      if (!camera) return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewportRef.current.height
            : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const [sx, sy] = localPoint(event);
      const wheelLike =
        event.deltaMode !== 0 ||
        (event.deltaX === 0 &&
          Math.abs(event.deltaY) >= 40 &&
          Number.isInteger(event.deltaY));
      let next: Camera;
      if (event.ctrlKey) {
        next = zoomAt(
          camera,
          viewportRef.current,
          Math.exp(-dy * 0.01),
          sx,
          sy,
          limitsRef.current,
        );
      } else if (event.shiftKey && wheelLike) {
        next = panBy(camera, -dy, 0);
      } else if (wheelLike) {
        next = zoomAt(
          camera,
          viewportRef.current,
          Math.exp(-dy * 0.0025),
          sx,
          sy,
          limitsRef.current,
        );
      } else {
        next = panBy(camera, -dx, -dy);
      }
      setCamera(next);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = null;
    },
    [],
  );

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink">
      <div
        ref={containerRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the map is a keyboard-driven application surface: arrows pan, plus and minus zoom.
        tabIndex={0}
        data-nav
        data-nav-own="all"
        role="application"
        aria-roledescription="map"
        aria-label="Taste map. Arrow keys move, plus and minus zoom, Enter zooms in or opens the title in the middle."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, false)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        onDoubleClick={(event) => {
          const base = destination();
          if (!base) return;
          if (peekTargetRef.current) closePeek();
          const [sx, sy] = localPoint(event);
          flyTo(
            zoomAt(base, viewportRef.current, 2, sx, sy, limitsRef.current),
            360,
          );
        }}
        onKeyDown={onKeyDown}
        className="group/map absolute inset-0 cursor-grab touch-none select-none outline-none active:cursor-grabbing"
      >
        <canvas
          ref={fieldRef}
          aria-hidden
          className="absolute inset-0 size-full"
        />
        <div
          ref={layerRef}
          className={`absolute top-0 left-0 origin-top-left ${ready ? "" : "invisible"}`}
          style={{ width: 0, height: 0 }}
        >
          <GenreLabels anchors={meta.anchors} ref={labelsRef} />
          <PosterLayer tiles={shownTiles} ref={postersRef} />
          <PickedRings highlights={highlights} />
          {focusMark ? <FocusRing x={focusMark.x} y={focusMark.y} /> : null}
        </div>
        <canvas
          ref={overlayRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 hidden size-10 -translate-x-1/2 -translate-y-1/2 group-focus-visible/map:block"
        >
          <span className="absolute inset-0 rounded-full ring-2 ring-amber" />
          <span className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber" />
        </div>
      </div>
      {audience.length > 1 ? <AudienceLegend audience={audience} /> : null}
      <MapHint />
      <MapControls
        kind={kind}
        onKind={changeKind}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
        onFindUs={findUs}
      />
      <VisibleList points={inView} />
      {peek ? (
        <Peek
          key={peek.id}
          ref={peekRef}
          target={peek}
          picked={pickedIds.has(peek.id)}
          onClose={closePeek}
        />
      ) : null}
    </div>
  );
}
