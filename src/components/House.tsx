import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PetSummary } from '../types';
import { playHaptic } from '../lib/haptics';
import { isPetRevisitActive } from '../lib/petAccess';
import { useHousePositions, type HousePositions } from '../lib/housePositions';
import type { SoundEffect } from '../lib/sound';
import { PetArtwork } from './PetArtwork';
import { PetArtworkButton } from './PetArtworkButton';
import './House.css';

export const HOUSE_DAILY_SLOTS = ['daily-a', 'daily-b', 'daily-c', 'daily-d'] as const;
export type HouseDailySlot = (typeof HOUSE_DAILY_SLOTS)[number];

type HouseSlot = HouseDailySlot | 'owner';

function getServerHouseSlot(pet: PetSummary): HouseDailySlot | undefined {
  if (!Number.isInteger(pet.houseSlot) || (pet.houseSlot ?? 0) < 1 || (pet.houseSlot ?? 0) > HOUSE_DAILY_SLOTS.length) {
    return undefined;
  }
  return HOUSE_DAILY_SLOTS[(pet.houseSlot as number) - 1];
}

function assignHouseSlots(pets: readonly PetSummary[]): Record<string, HouseDailySlot> {
  const assigned: Record<string, HouseDailySlot> = {};
  const occupied = new Set<HouseDailySlot>();
  const waiting: PetSummary[] = [];

  for (const pet of pets) {
    const serverSlot = getServerHouseSlot(pet);
    if (!serverSlot || occupied.has(serverSlot)) {
      waiting.push(pet);
      continue;
    }
    assigned[pet.id] = serverSlot;
    occupied.add(serverSlot);
  }

  for (const pet of waiting) {
    const fallback = HOUSE_DAILY_SLOTS.find((slot) => !occupied.has(slot));
    if (!fallback) break;
    assigned[pet.id] = fallback;
    occupied.add(fallback);
  }
  return assigned;
}

const DOG_DRAG_MAX_LIFT_Y = 30;
const LOADING_VISIBLE_DELAY_MS = 300;
const LOADING_SLOW_COPY_DELAY_MS = 3_000;
const LOADING_RETRY_DELAY_MS = 8_000;
const FIRST_HINT_DURATION_MS = 3_000;

export interface HouseProps {
  /** 구버전 App 호환용. API v2에서는 dailyPets와 ownerBonusPet을 따로 넘겨요. */
  pets?: PetSummary[];
  dailyPets?: PetSummary[];
  ownerBonusPet?: PetSummary;
  metPetIds?: readonly string[];
  onSelect: (pet: PetSummary) => void;
  onSound: (effect: SoundEffect) => void;
  loading?: boolean;
  onLoadingVisible?: () => void;
  onRetry?: () => void;
  showFirstHint?: boolean;
  showDragHint?: boolean;
  onHintDismiss?: () => void;
  onFirstDrag?: () => void;
  dateKey?: string;
  /** 오늘 집의 마지막 위치. 사방 8px과 버튼 크기를 제외한 영역의 0~1 비율이에요. */
  positions?: HousePositions;
  onPositionsChange?: (positions: HousePositions) => void;
}

function getDragLift(distance: number) {
  const progress = Math.max(0, Math.min(1, (distance - 7) / 65));
  const easedProgress = progress * progress * (3 - 2 * progress);
  return DOG_DRAG_MAX_LIFT_Y * easedProgress;
}

function HouseLoading({ onVisible, onRetry }: { onVisible?: () => void; onRetry?: () => void }) {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'waiting' | 'slow' | 'retry'>('waiting');

  useEffect(() => {
    const visibleTimer = window.setTimeout(() => {
      setVisible(true);
      onVisible?.();
    }, LOADING_VISIBLE_DELAY_MS);
    const slowTimer = window.setTimeout(() => setPhase('slow'), LOADING_SLOW_COPY_DELAY_MS);
    const retryTimer = window.setTimeout(() => setPhase('retry'), LOADING_RETRY_DELAY_MS);
    return () => {
      window.clearTimeout(visibleTimer);
      window.clearTimeout(slowTimer);
      window.clearTimeout(retryTimer);
    };
  }, [onVisible]);

  return (
    <div className={`house-loading ${visible ? 'is-visible' : ''}`} aria-live="polite" aria-busy="true" aria-hidden={!visible}>
      <span className="house-loading-tail" aria-hidden="true" />
      <div className="house-loading-content">
        <div className="house-loading-paws" aria-hidden="true">
          <span className="house-loading-paw" /><span className="house-loading-paw" /><span className="house-loading-paw" />
        </div>
        <p>{phase === 'waiting' ? '친구들이 놀러 오는 중이에요' : '친구들을 조금만 더 기다려 주세요'}</p>
        {phase === 'retry' && <button type="button" onClick={onRetry}>다시 불러오기</button>}
      </div>
    </div>
  );
}

function getPetStateLabel(pet: PetSummary, metPetIds: ReadonlySet<string>, now: Date) {
  if (pet.isMine) return { kind: 'owner', label: '내 강아지' } as const;
  if (isPetRevisitActive(pet, now)) return { kind: 'revisit', label: '사진 보기' } as const;
  if (metPetIds.has(pet.id) || pet.revealedToday) return { kind: 'met', label: '♥' } as const;
  return undefined;
}

export function House({
  pets = [],
  dailyPets,
  ownerBonusPet,
  metPetIds = [],
  onSelect,
  onSound,
  loading = false,
  onLoadingVisible,
  onRetry,
  showFirstHint = false,
  showDragHint = true,
  onHintDismiss,
  onFirstDrag,
  dateKey,
  positions,
  onPositionsChange,
}: HouseProps) {
  const legacyOwner = dailyPets === undefined
    ? pets.find((pet) => pet.isMine && pet.ownerPinned)
    : undefined;
  const resolvedOwner = ownerBonusPet ?? legacyOwner;
  const resolvedDailyPets = (dailyPets ?? pets)
    .filter((pet) => pet.id !== resolvedOwner?.id)
    .slice(0, HOUSE_DAILY_SLOTS.length);
  const dailyAssignmentKey = resolvedDailyPets.map((pet) => `${pet.id}:${pet.houseSlot ?? ''}`).join('|');
  const metIdSet = useMemo(() => new Set(metPetIds), [metPetIds]);
  const roomRef = useRef<HTMLElement>(null);
  const wasLoadingRef = useRef(loading);
  const didReportFirstDragRef = useRef(false);
  const onHintDismissRef = useRef(onHintDismiss);
  const onFirstDragRef = useRef(onFirstDrag);
  const dragRef = useRef<{
    petId: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    pantPlayed: boolean;
  }>();
  const suppressClickRef = useRef<string>();
  const [grabbedId, setGrabbedId] = useState<string>();
  const slotByPetId = useMemo(() => assignHouseSlots(resolvedDailyPets), [dailyAssignmentKey]);
  const motion = useHousePositions({
    roomRef,
    pets: [...resolvedDailyPets.map((pet, index) => ({ id: pet.id, slot: slotByPetId[pet.id] ?? HOUSE_DAILY_SLOTS[index], index })),
      ...(resolvedOwner ? [{ id: resolvedOwner.id, slot: 'owner', index: resolvedDailyPets.length }] : [])],
    dateKey, positions, onPositionsChange,
  });
  const [arriving, setArriving] = useState(false);
  const [hintVisible, setHintVisible] = useState(showFirstHint);

  useEffect(() => {
    onHintDismissRef.current = onHintDismiss;
    onFirstDragRef.current = onFirstDrag;
  }, [onHintDismiss, onFirstDrag]);

  useEffect(() => {
    const finishedLoading = wasLoadingRef.current && !loading && resolvedDailyPets.length > 0;
    wasLoadingRef.current = loading;
    if (!finishedLoading) return;
    setArriving(true);
    const timer = window.setTimeout(() => setArriving(false), 850);
    return () => window.clearTimeout(timer);
  }, [loading, resolvedDailyPets.length]);

  useEffect(() => {
    setHintVisible(showFirstHint);
    if (!showFirstHint) return undefined;
    const timer = window.setTimeout(() => {
      setHintVisible(false);
      onHintDismissRef.current?.();
    }, FIRST_HINT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [showFirstHint]);

  function dismissHint() {
    if (!hintVisible) return;
    setHintVisible(false);
    onHintDismissRef.current?.();
  }

  function startDrag(petId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const buttonRect = event.currentTarget.getBoundingClientRect();
    motion.hold(petId);
    dragRef.current = {
      petId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - buttonRect.left,
      offsetY: event.clientY - buttonRect.top,
      moved: false,
      pantPlayed: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setGrabbedId(petId);
  }

  function movePet(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const room = roomRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !room) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < 7) return;
    if (!drag.moved) {
      drag.moved = true;
      void playHaptic('dragStart');
      dismissHint();
      if (!didReportFirstDragRef.current) {
        didReportFirstDragRef.current = true;
        onFirstDragRef.current?.();
      }
    }
    if (!drag.pantPlayed) {
      drag.pantPlayed = true;
      onSound('pant');
    }
    const roomRect = room.getBoundingClientRect();
    const liftY = getDragLift(distance);
    motion.place(drag.petId, { left: event.clientX - roomRect.left - drag.offsetX, top: event.clientY - roomRect.top - drag.offsetY - liftY });
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved || event.type === 'pointercancel') {
      suppressClickRef.current = drag.petId;
      window.setTimeout(() => {
        if (suppressClickRef.current === drag.petId) suppressClickRef.current = undefined;
      }, 0);
    }
    motion.release(drag.petId);
    setGrabbedId(undefined);
  }

  function renderPet(pet: PetSummary, slot: HouseSlot, index: number, owner = false) {
    const position = motion.style(pet.id);
    const state = owner
      ? ({ kind: 'owner', label: '내 강아지' } as const)
      : getPetStateLabel(pet, metIdSet, new Date());
    const petName = pet.name ?? '이름 없는 강아지';
    return (
      <PetArtworkButton pet={pet}
        className={`pet-button house-pet house-slot--${slot} is-idle-active ${motion.isWalking(pet.id) ? 'is-walking' : ''} ${position ? 'is-positioned' : ''} ${grabbedId === pet.id ? 'is-grabbed' : ''} ${arriving ? 'is-arriving' : ''}`}
        data-house-slot={slot}
        data-pet-kind={owner ? 'owner' : 'daily'}
        data-pet-state={state?.kind ?? 'available'}
        key={`${pet.id}-${pet.designVersion ?? 1}`}
        ref={(button) => motion.buttonRef(pet.id, button)}
        style={{
          ...position,
          '--arrival-index': index,
        } as CSSProperties}
        onPointerDown={(event) => startDrag(pet.id, event)}
        onPointerMove={movePet}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onClick={() => {
          if (suppressClickRef.current === pet.id) {
            suppressClickRef.current = undefined;
            return;
          }
          dismissHint();
          motion.snapshotForSelection();
          onSelect(pet);
        }}
        aria-label={`${petName} 옮기기 또는 선택`}
      >
        <span className="house-pet-artwork">
          <PetArtwork pet={pet} size={owner ? 108 : 114} panting retryControl={false} />
        </span>
        <span className={`house-pet-name${owner ? ' house-pet-name--owner' : ''}`} aria-hidden="true">
          <span>{petName}</span>
          {owner && <small>내 강아지</small>}
        </span>
      </PetArtworkButton>
    );
  }

  const occupiedSlots = new Set(resolvedDailyPets.map((pet, index) => slotByPetId[pet.id] ?? HOUSE_DAILY_SLOTS[index]));

  return (
    <section className={`room house-room${motion.paused ? ' is-motion-paused' : ''}`} ref={roomRef} aria-label="강아지들이 있는 집">
      <div className="sun-glow" />
      <div className="window" aria-hidden="true"><div className="cloud" /><div className="hill" /></div>
      <div className="shelf" aria-hidden="true"><span className="pot" /><span className="book book-a" /><span className="book book-b" /></div>
      <div className="sofa" aria-hidden="true"><div className="cushion" /></div>
      <div className="rug" aria-hidden="true" />
      {loading && <HouseLoading onVisible={onLoadingVisible} onRetry={onRetry} />}
      {!loading && HOUSE_DAILY_SLOTS.filter((slot) => !occupiedSlots.has(slot)).map((slot) => (
        <div className={`house-empty-slot house-slot--${slot}`} key={slot} aria-label="새 친구를 기다리는 빈자리">
          <span aria-hidden="true">♡</span>
          <small>새 친구를<br />기다려요</small>
        </div>
      ))}
      {resolvedDailyPets.map((pet, index) => renderPet(pet, slotByPetId[pet.id] ?? HOUSE_DAILY_SLOTS[index], index))}
      {resolvedOwner && renderPet(resolvedOwner, 'owner', resolvedDailyPets.length, true)}
      {hintVisible && (
        <div className="house-first-hint" role="status">
          <strong>마음 가는 친구를 톡 눌러보세요</strong>
          {showDragHint && <small>끌어 옮길 수도 있어요</small>}
        </div>
      )}
    </section>
  );
}
