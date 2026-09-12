import { useEffect, useRef, useState, type RefObject } from 'react';

export type HousePosition = { x: number; y: number };
export type HousePositions = Record<string, HousePosition>;
type Point = { left: number; top: number };
type Size = { width: number; height: number };
type Rect = Point & Size;
type MovingPet = { id: string; slot: string; index: number };
type Metrics = { room: Size; pets: Record<string, Size> };
const INSET = 8;
export const HOUSE_DROP_PAUSE_MS = 1_500;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function clampHousePoint(point: Point, room: Size, pet: Size): Point {
  const minX = Math.min(INSET, Math.max(0, (room.width - pet.width) / 2));
  const minY = Math.min(INSET, Math.max(0, (room.height - pet.height) / 2));
  return { left: clamp(point.left, minX, Math.max(minX, room.width - pet.width - INSET)), top: clamp(point.top, minY, Math.max(minY, room.height - pet.height - INSET)) };
}

export function normalizedHousePoint(point: Point, room: Size, pet: Size): HousePosition {
  const start = clampHousePoint({ left: -Infinity, top: -Infinity }, room, pet);
  const end = clampHousePoint({ left: Infinity, top: Infinity }, room, pet);
  const safe = clampHousePoint(point, room, pet);
  return { x: end.left > start.left ? (safe.left - start.left) / (end.left - start.left) : 0, y: end.top > start.top ? (safe.top - start.top) / (end.top - start.top) : 0 };
}

export function absoluteHousePoint(position: HousePosition, room: Size, pet: Size): Point {
  const start = clampHousePoint({ left: -Infinity, top: -Infinity }, room, pet);
  const end = clampHousePoint({ left: Infinity, top: Infinity }, room, pet);
  return { left: start.left + clamp(Number.isFinite(position.x) ? position.x : 0, 0, 1) * (end.left - start.left), top: start.top + clamp(Number.isFinite(position.y) ? position.y : 0, 0, 1) * (end.top - start.top) };
}

function initialPoint(slot: string, room: Size, pet: Size): Point {
  switch (slot) {
    case 'daily-b': return { left: room.width * .97 - pet.width, top: room.height * .44 };
    case 'daily-c': return { left: room.width * .10, top: room.height - pet.height };
    case 'daily-d': return { left: room.width * .91 - pet.width, top: room.height - pet.height };
    case 'owner': return { left: room.width * .99 - pet.width, top: room.height * .19 };
    default: return { left: room.width * .03, top: room.height * .44 };
  }
}

function overlapArea(a: Rect, b: Rect) {
  return Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
}

/** 수동 겹침은 유지하지만 산책이 겹침을 더 크게 만들거나 다른 친구를 가로지르지는 않아요. */
export function chooseHouseRoamPoint(origin: Point, desired: Point, room: Size, pet: Size, neighbors: Rect[]): Point | undefined {
  const dx = desired.left - origin.left;
  const dy = desired.top - origin.top;
  for (const direction of [[dx, dy], [-dx, -dy], [dy, dx], [-dy, -dx]]) {
    const target = clampHousePoint({ left: origin.left + direction[0], top: origin.top + direction[1] }, room, pet);
    if (Math.hypot(target.left - origin.left, target.top - origin.top) < 8) continue;
    const start = { ...origin, ...pet };
    const end = { ...target, ...pet };
    const sweep = { left: Math.min(origin.left, target.left), top: Math.min(origin.top, target.top), width: pet.width + Math.abs(target.left - origin.left), height: pet.height + Math.abs(target.top - origin.top) };
    if (neighbors.every((neighbor) => {
      const before = overlapArea(start, neighbor);
      return before > 0 ? overlapArea(end, neighbor) < before : overlapArea(sweep, neighbor) === 0;
    })) return target;
  }
  return undefined;
}

/** 집에 있는 동안만 동작하는 위치 관리. 부모에게는 URL/서버 데이터 없이 좌표만 돌려줘요. */
export function useHousePositions({ roomRef, pets, dateKey, positions, onPositionsChange }: {
  roomRef: RefObject<HTMLElement>;
  pets: MovingPet[];
  dateKey?: string;
  positions?: HousePositions;
  onPositionsChange?: (positions: HousePositions) => void;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const current = useRef({ pets, positions, onPositionsChange });
  current.current = { pets, positions, onPositionsChange };
  const pointsRef = useRef<HousePositions>({});
  const metricsRef = useRef<Metrics>();
  const timers = useRef(new Map<string, number>());
  const steps = useRef(new Map<string, number>());
  const holding = useRef<string>();
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [layout, setLayout] = useState<{ points: HousePositions; metrics?: Metrics; walking: Record<string, number> }>({ points: {}, walking: {} });
  const key = `${dateKey ?? ''}:${pets.map((pet) => `${pet.id}:${pet.slot}`).join('|')}`;

  function publish() { current.current.onPositionsChange?.({ ...pointsRef.current }); }
  function stopTimer(id: string) { const timer = timers.current.get(id); if (timer !== undefined) window.clearTimeout(timer); timers.current.delete(id); }
  function stopTimers() { for (const id of timers.current.keys()) stopTimer(id); }
  function readMetrics(): Metrics | undefined {
    const room = roomRef.current?.getBoundingClientRect();
    if (!room?.width || !room.height) return undefined;
    return { room: { width: room.width, height: room.height }, pets: Object.fromEntries(current.current.pets.map((pet) => {
      const button = buttons.current.get(pet.id);
      const rect = button?.getBoundingClientRect();
      const width = button?.offsetWidth || rect?.width || clamp(room.width * .27, 88, 114);
      return [pet.id, { width, height: button?.offsetHeight || rect?.height || width + 18 }];
    })) };
  }
  function setPoint(id: string, point: Point, metrics = metricsRef.current) {
    if (!metrics?.pets[id]) return;
    pointsRef.current = { ...pointsRef.current, [id]: normalizedHousePoint(point, metrics.room, metrics.pets[id]) };
    setLayout((value) => ({ ...value, points: pointsRef.current, metrics }));
  }
  function removeWalking(id: string) {
    setLayout((value) => { const walking = { ...value.walking }; delete walking[id]; return { ...value, walking }; });
  }
  function schedule(id: string, delay: number) {
    stopTimer(id);
    if (pausedRef.current || holding.current === id || !buttons.current.has(id)) return;
    timers.current.set(id, window.setTimeout(() => beginWalk(id), delay));
  }
  function beginWalk(id: string) {
    const metrics = metricsRef.current;
    const pet = current.current.pets.find((item) => item.id === id);
    const position = pointsRef.current[id];
    if (!metrics?.pets[id] || !pet || !position || pausedRef.current || holding.current === id) return;
    const step = steps.current.get(id) ?? 0;
    steps.current.set(id, step + 1);
    const origin = absoluteHousePoint(position, metrics.room, metrics.pets[id]);
    const direction = (Math.floor(step / 3) % 2 === 0 ? 1 : -1) * (pet.slot === 'daily-b' || pet.slot === 'daily-d' || pet.slot === 'owner' ? -1 : 1);
    const dx = direction * [26, 38, 20][step % 3];
    const dy = [-7, 9, -3][step % 3];
    const roomRect = roomRef.current?.getBoundingClientRect();
    const neighbors = current.current.pets.filter((other) => other.id !== id).flatMap((other) => {
      const size = metrics.pets[other.id];
      const reserved = pointsRef.current[other.id];
      if (!size || !reserved) return [];
      const rect = buttons.current.get(other.id)?.getBoundingClientRect();
      const target = { ...absoluteHousePoint(reserved, metrics.room, size), ...size };
      return rect?.width && roomRect ? [target, { left: rect.left - roomRect.left, top: rect.top - roomRect.top, ...size }] : [target];
    });
    const target = chooseHouseRoamPoint(origin, { left: origin.left + dx, top: origin.top + dy }, metrics.room, metrics.pets[id], neighbors);
    if (!target) { schedule(id, 1_500 + pet.index * 150); return; }
    const duration = 3_800 + pet.index * 270;
    setLayout((value) => ({ ...value, walking: { ...value.walking, [id]: duration } }));
    setPoint(id, target, metrics);
    timers.current.set(id, window.setTimeout(() => {
      removeWalking(id); publish(); schedule(id, 900 + pet.index * 180);
    }, duration));
  }
  function syncLayout(reset: boolean) {
    const metrics = readMetrics();
    if (!metrics) return;
    const roomRect = roomRef.current?.getBoundingClientRect();
    const visiblePoints = !reset && metricsRef.current && roomRect ? Object.fromEntries(current.current.pets.flatMap((pet) => {
      const rect = buttons.current.get(pet.id)?.getBoundingClientRect();
      return rect?.width ? [[pet.id, normalizedHousePoint({ left: rect.left - roomRect.left, top: rect.top - roomRect.top }, metrics.room, metrics.pets[pet.id])]] : [];
    })) as HousePositions : {};
    stopTimers();
    metricsRef.current = metrics;
    pointsRef.current = Object.fromEntries(current.current.pets.map((pet) => {
      const saved = reset ? current.current.positions?.[pet.id] : visiblePoints[pet.id] ?? pointsRef.current[pet.id] ?? current.current.positions?.[pet.id];
      const position = saved ?? normalizedHousePoint(initialPoint(pet.slot, metrics.room, metrics.pets[pet.id]), metrics.room, metrics.pets[pet.id]);
      return [pet.id, { x: clamp(position.x, 0, 1), y: clamp(position.y, 0, 1) }];
    }));
    setLayout({ points: pointsRef.current, metrics, walking: {} });
    current.current.pets.forEach((pet) => schedule(pet.id, HOUSE_DROP_PAUSE_MS + pet.index * 240));
  }
  function freezeMotion() {
    stopTimers();
    const roomRect = roomRef.current?.getBoundingClientRect();
    const metrics = metricsRef.current;
    if (roomRect && metrics) {
      for (const pet of current.current.pets) {
        const rect = buttons.current.get(pet.id)?.getBoundingClientRect();
        if (rect?.width) pointsRef.current[pet.id] = normalizedHousePoint({ left: rect.left - roomRect.left, top: rect.top - roomRect.top }, metrics.room, metrics.pets[pet.id]);
      }
    }
    pointsRef.current = { ...pointsRef.current };
    setLayout((value) => ({ ...value, points: pointsRef.current, walking: {} }));
    publish();
  }

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const setVisibility = () => {
      pausedRef.current = document.hidden || Boolean(media?.matches);
      setPaused(pausedRef.current);
      if (pausedRef.current) freezeMotion();
      else current.current.pets.forEach((pet) => schedule(pet.id, HOUSE_DROP_PAUSE_MS + pet.index * 240));
    };
    pausedRef.current = document.hidden || Boolean(media?.matches);
    setPaused(pausedRef.current);
    syncLayout(true);
    const resize = () => syncLayout(false);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    if (roomRef.current) observer?.observe(roomRef.current);
    for (const button of buttons.current.values()) observer?.observe(button);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', setVisibility);
    media?.addEventListener?.('change', setVisibility);
    return () => {
      stopTimers(); observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', setVisibility);
      media?.removeEventListener?.('change', setVisibility);
    };
  }, [key]);

  return {
    paused,
    buttonRef: (id: string, button: HTMLButtonElement | null) => { if (button) buttons.current.set(id, button); else buttons.current.delete(id); },
    style: (id: string) => {
      const size = layout.metrics?.pets[id];
      const position = layout.points[id];
      return size && position && layout.metrics ? { ...absoluteHousePoint(position, layout.metrics.room, size), transitionDuration: `${layout.walking[id] ?? 0}ms` } : undefined;
    },
    isWalking: (id: string) => Boolean(layout.walking[id]),
    hold: (id: string) => {
      holding.current = id;
      if (!metricsRef.current) syncLayout(false);
      stopTimer(id); removeWalking(id);
      const room = roomRef.current?.getBoundingClientRect();
      const rect = buttons.current.get(id)?.getBoundingClientRect();
      if (room && rect) setPoint(id, { left: rect.left - room.left, top: rect.top - room.top });
    },
    place: (id: string, point: Point) => {
      const metrics = readMetrics();
      if (metrics) { metricsRef.current = metrics; setPoint(id, point, metrics); }
    },
    release: (id: string) => {
      holding.current = undefined;
      publish(); schedule(id, HOUSE_DROP_PAUSE_MS);
    },
    snapshotForSelection: () => {
      freezeMotion();
      // 놀이로 이동하면 cleanup이 예약을 해제하고, 사진창만 여는 경우에는 자연스럽게 이어가요.
      current.current.pets.forEach((pet) => schedule(pet.id, HOUSE_DROP_PAUSE_MS + pet.index * 240));
    },
  };
}
