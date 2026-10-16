"use client";

import { type LocationExplored, locationExploredSchema } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Skeleton } from "@repo/ui/skeleton";
import { Earth, Globe, Locate, Minus, Plus } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAdmin } from "../provider";
import {
  projectX,
  projectY,
  unitsPerMetre,
  unprojectLatitude,
  unprojectLongitude,
  WORLD_SIZE,
  type WorldMapData,
} from "./mercator";
import { MAP_WATER, StreetTiles } from "./street-tiles";

/** About 1 m to 6 px at Copenhagen's latitude. */
const MAX_SCALE = 2 ** 17;
/** World units to pixels at which the 10m coastlines replace the 50m ones. */
const DETAIL_SCALE = 16;
/** Above this only countries in view are drawn. */
const CULL_SCALE = 6;
/** Explored geometry lives in its own frame so float32 holds at street zoom. */
const LOCAL_SCALE = 1e5;
const MIN_TRACK_PX = 2.5;
const HALO_PX = 10;

type Radius = "5" | "10";

interface View {
  scale: number;
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

function clampView(view: View, size: Size): View {
  const minScale = Math.max(size.width, size.height) / WORLD_SIZE;
  const scale = Math.max(minScale, Math.min(MAX_SCALE, view.scale));
  const span = WORLD_SIZE * scale;
  const x =
    span <= size.width
      ? (size.width - span) / 2
      : Math.min(0, Math.max(size.width - span, view.x));
  const y =
    span <= size.height
      ? (size.height - span) / 2
      : Math.min(0, Math.max(size.height - span, view.y));
  return { scale, x, y };
}

function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = Math.max(1e-3, Math.min(MAX_SCALE, view.scale * factor));
  const applied = scale / view.scale;
  return {
    scale,
    x: px - (px - view.x) * applied,
    y: py - (py - view.y) * applied,
  };
}

function fitBounds(
  bounds: [number, number, number, number],
  size: Size,
  padding = 48,
): View {
  const [west, south, east, north] = bounds;
  const x0 = projectX(west);
  const x1 = projectX(east);
  const y0 = projectY(north);
  const y1 = projectY(south);
  // A single spot has no extent; frame a few hundred metres around it.
  const minSpan = 400 * unitsPerMetre((south + north) / 2);
  const spanX = Math.max(x1 - x0, minSpan);
  const spanY = Math.max(y1 - y0, minSpan);
  const scale = Math.min(
    MAX_SCALE,
    Math.max(1, size.width - padding * 2) / spanX,
    Math.max(1, size.height - padding * 2) / spanY,
  );
  return {
    scale,
    x: size.width / 2 - ((x0 + x1) / 2) * scale,
    y: size.height / 2 - ((y0 + y1) / 2) * scale,
  };
}

function graticulePath(stepDegrees: number) {
  let d = "";
  for (let lon = -180; lon <= 180; lon += stepDegrees) {
    const x = projectX(lon);
    d += `M${x} 0V${WORLD_SIZE}`;
  }
  for (let lat = -80; lat <= 80; lat += stepDegrees) {
    const y = projectY(lat);
    d += `M0 ${y}H${WORLD_SIZE}`;
  }
  return d;
}

const GRATICULE = graticulePath(15);

function exploredPath(
  explored: LocationExplored,
  originX: number,
  originY: number,
) {
  const local = (lon: number, lat: number) =>
    `${((projectX(lon) - originX) * LOCAL_SCALE).toFixed(2)} ${((projectY(lat) - originY) * LOCAL_SCALE).toFixed(2)}`;
  let d = "";
  for (const track of explored.tracks) {
    for (let index = 0; index + 1 < track.length; index += 2) {
      d += `${index === 0 ? "M" : "L"}${local(track[index] ?? 0, track[index + 1] ?? 0)}`;
    }
  }
  // A zero-length segment with a round cap is a dot of the stroke's width.
  for (const [lon, lat] of explored.spots) d += `M${local(lon, lat)}l0 0`;
  return d;
}

function formatArea(squareMetres: number) {
  if (squareMetres < 100_000) {
    return `${Math.round(squareMetres).toLocaleString()} m²`;
  }
  const km = squareMetres / 1_000_000;
  return `${km.toLocaleString(undefined, { maximumFractionDigits: km < 10 ? 3 : 1 })} km²`;
}

function formatDistance(metres: number) {
  return metres < 1_000
    ? `${metres} m`
    : `${(metres / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
}

/** The longest 1/2/5 × 10ⁿ metres that fits in `maxPx`. */
function scaleBar(metresPerPx: number, maxPx = 96) {
  const target = metresPerPx * maxPx;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const metres =
    [5, 2, 1].map((step) => step * magnitude).find((m) => m <= target) ??
    magnitude;
  return {
    px: metres / metresPerPx,
    label: metres >= 1_000 ? `${metres / 1_000} km` : `${metres} m`,
  };
}

function useWorld(detailed: boolean) {
  const [base, setBase] = useState<WorldMapData | null>(null);
  const [detail, setDetail] = useState<WorldMapData | null>(null);
  useEffect(() => {
    let live = true;
    void import("./generated/world-50m").then((module) => {
      if (live) setBase(module.default);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!detailed || detail) return;
    let live = true;
    void import("./generated/world-10m").then((module) => {
      if (live) setDetail(module.default);
    });
    return () => {
      live = false;
    };
  }, [detailed, detail]);
  return detailed && detail ? detail : base;
}

function useExplored() {
  const { client } = useAdmin();
  const [explored, setExplored] = useState<LocationExplored | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    client
      .get<unknown>("location/explored", { signal: controller.signal })
      .then((response) => setExplored(locationExploredSchema.parse(response)))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [client]);
  return { explored, failed };
}

export function ExploredMap() {
  const { slots } = useAdmin();
  const { explored, failed } = useExplored();
  const [radius, setRadius] = useState<Radius>("10");
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setViewState] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const clipId = `world-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const framed = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; view: View } | null>(null);

  const setView = useCallback(
    (next: View | ((current: View) => View)) =>
      setViewState((current) =>
        clampView(typeof next === "function" ? next(current) : next, size),
      ),
    [size],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frameExplored = useCallback(() => {
    if (!size.width) return;
    setView(
      explored?.bounds
        ? fitBounds(explored.bounds, size)
        : { scale: 0, x: 0, y: 0 },
    );
  }, [explored, size, setView]);

  useEffect(() => {
    if (framed.current || !size.width || (!explored && !failed)) return;
    framed.current = true;
    frameExplored();
  }, [explored, failed, size, frameExplored]);

  // React registers wheel listeners as passive, which cannot stop the page
  // from scrolling under the map.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const lines = event.deltaMode === 1 ? 16 : 1;
      const sensitivity = event.ctrlKey ? 0.01 : 0.0025;
      setView((current) =>
        zoomAt(
          current,
          Math.exp(-event.deltaY * lines * sensitivity),
          event.clientX - rect.left,
          event.clientY - rect.top,
        ),
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [setView]);

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        pinch.current = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          view,
        };
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = localPoint(event);
    setCursor([
      unprojectLongitude((point.x - view.x) / view.scale),
      unprojectLatitude((point.y - view.y) / view.scale),
    ]);
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const start = pinch.current;
      const factor = Math.hypot(a.x - b.x, a.y - b.y) / start.distance;
      setView(zoomAt(start.view, factor, (a.x + b.x) / 2, (a.y + b.y) / 2));
      return;
    }
    setView((current) => ({
      ...current,
      x: current.x + point.x - previous.x,
      y: current.y + point.y - previous.y,
    }));
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const zoomCentre = (factor: number) =>
    setView((current) =>
      zoomAt(current, factor, size.width / 2, size.height / 2),
    );

  const world = useWorld(view.scale >= DETAIL_SCALE);

  const visibleCountries = useMemo(() => {
    if (!world) return [];
    if (view.scale < CULL_SCALE) return world.countries;
    const x0 = -view.x / view.scale;
    const y0 = -view.y / view.scale;
    const x1 = (size.width - view.x) / view.scale;
    const y1 = (size.height - view.y) / view.scale;
    return world.countries.filter(
      ({ bbox }) =>
        bbox[0] <= x1 && bbox[2] >= x0 && bbox[1] <= y1 && bbox[3] >= y0,
    );
  }, [world, view, size]);

  const exploredFrame = useMemo(() => {
    if (!explored?.bounds) return null;
    const [west, south, , north] = explored.bounds;
    const originX = projectX(west);
    const originY = projectY(north);
    return {
      originX,
      originY,
      latitude: (south + north) / 2,
      d: exploredPath(explored, originX, originY),
    };
  }, [explored]);

  const centreLatitude = unprojectLatitude(
    (size.height / 2 - view.y) / view.scale,
  );
  const bar = scaleBar(1 / (view.scale * unitsPerMetre(centreLatitude)));
  const radiusMetres = Number(radius);

  let exploredLayer = null;
  if (exploredFrame) {
    const toLocal = LOCAL_SCALE / view.scale;
    const trueWidth =
      2 * radiusMetres * unitsPerMetre(exploredFrame.latitude) * LOCAL_SCALE;
    const width = Math.max(trueWidth, MIN_TRACK_PX * toLocal);
    exploredLayer = (
      <g
        transform={`translate(${view.x + view.scale * exploredFrame.originX} ${view.y + view.scale * exploredFrame.originY}) scale(${view.scale / LOCAL_SCALE})`}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d={exploredFrame.d}
          stroke="var(--primary)"
          strokeOpacity={0.18}
          strokeWidth={Math.max(trueWidth * 2.2, HALO_PX * toLocal)}
        />
        <path d={exploredFrame.d} stroke="var(--primary)" strokeWidth={width} />
      </g>
    );
  }

  const area = explored
    ? radius === "5"
      ? explored.areaSquareMetres.r5
      : explored.areaSquareMetres.r10
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Earth className="size-4 text-muted-foreground" />}
        title="Explored"
      >
        <SegmentedControl
          ariaLabel="Radius"
          value={radius}
          onValueChange={setRadius}
          options={[
            { value: "5", label: "5 m" },
            { value: "10", label: "10 m" },
          ]}
          className="[&>button]:min-h-7 [&>button]:px-2 [&>button]:text-xs"
        />
      </PageHeader>
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 border-b px-4 py-2 text-xs tabular-nums text-muted-foreground">
        {explored ? (
          <>
            <span>
              <span className="text-sm font-medium text-foreground">
                {area !== null ? formatArea(area) : "—"}
              </span>{" "}
              explored
            </span>
            <span>
              <span className="text-foreground">
                {formatDistance(explored.distanceMetres)}
              </span>{" "}
              tracked
            </span>
            <span>
              <span className="text-foreground">
                {explored.points.toLocaleString()}
              </span>{" "}
              fixes
            </span>
            {explored.firstAt ? (
              <span>
                since{" "}
                <span className="text-foreground">
                  {new Date(explored.firstAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </span>
            ) : null}
          </>
        ) : failed ? (
          <span className="text-destructive">Failed to load</span>
        ) : (
          <>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
      >
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={(event) => {
            const point = localPoint(event);
            setView((current) =>
              zoomAt(current, event.shiftKey ? 0.5 : 2, point.x, point.y),
            );
          }}
        >
          <rect
            width={size.width}
            height={size.height}
            fill="var(--background)"
          />
          <defs>
            <clipPath id={clipId}>
              <rect width={WORLD_SIZE} height={WORLD_SIZE} />
            </clipPath>
          </defs>
          <g
            transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
            clipPath={`url(#${clipId})`}
          >
            <rect width={WORLD_SIZE} height={WORLD_SIZE} fill={MAP_WATER} />
            {view.scale < 64 ? (
              <path
                d={GRATICULE}
                fill="none"
                stroke="var(--border)"
                strokeOpacity={0.6}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <g fill="var(--muted)" fillRule="evenodd">
              {visibleCountries.map((country) => (
                <path key={country.name + country.bbox.join()} d={country.d}>
                  <title>{country.name}</title>
                </path>
              ))}
            </g>
            {world ? (
              <path
                d={world.borders}
                fill="none"
                stroke="var(--background)"
                strokeWidth={0.75}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </g>
          <StreetTiles view={view} width={size.width} height={size.height} />
          {exploredLayer}
        </svg>

        {!world ? (
          <Skeleton className="absolute inset-4 rounded-md opacity-60" />
        ) : null}

        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[10px] tabular-nums text-muted-foreground">
          <div className="flex items-end gap-1.5">
            <div
              className="h-1.5 border-x border-b border-foreground/60"
              style={{ width: bar.px }}
            />
            <span>{bar.label}</span>
          </div>
          {cursor ? (
            <span>
              {cursor[1].toFixed(5)}, {cursor[0].toFixed(5)}
            </span>
          ) : null}
        </div>

        <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none"
            aria-label="Zoom in"
            onClick={() => zoomCentre(2)}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none border-t"
            aria-label="Zoom out"
            onClick={() => zoomCentre(0.5)}
          >
            <Minus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none border-t"
            aria-label="Fit explored"
            disabled={!explored?.bounds}
            onClick={frameExplored}
          >
            <Locate className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none border-t"
            aria-label="Whole world"
            onClick={() => setView({ scale: 0, x: 0, y: 0 })}
          >
            <Globe className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
