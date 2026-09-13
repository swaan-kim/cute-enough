import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Asset, Top } from '@toss/tds-mobile';
import type { SoundEffect } from '../lib/sound';
import { playHaptic } from '../lib/haptics';
import type { PetSummary } from '../types';
import { withSubjectParticle } from '../lib/koreanCopy';
import { PetArtwork } from './PetArtwork';
import { usePetDesign } from '../lib/petDesignResource';
import '../album.css';

type TreatId = 'sweet-potato' | 'bone' | 'meat';
type Phase = 'treat' | 'happy' | 'petting' | 'done';
export type PetInteractionMethod = 'stroke' | 'tap' | 'keyboard';

const TREATS: Array<{ id: TreatId; label: string; objectLabel: string; image: string }> = [
  { id: 'sweet-potato', label: '고구마', objectLabel: '고구마를', image: 'https://static.toss.im/2d-emojis/png/4x/u1F360.png' },
  { id: 'bone', label: '개껌', objectLabel: '개껌을', image: 'https://static.toss.im/2d-emojis/png/4x/u1F9B4.png' },
  { id: 'meat', label: '고기', objectLabel: '고기를', image: 'https://static.toss.im/2d-emojis/png/4x/u1F356.png' },
];
const TREAT_DRAG_MAX_LIFT_Y = 32;
const PET_STROKE_DISTANCE = 72;
const PET_POINTER_NOISE = 2;
const PET_REACTION_MS = 450;
const FINAL_REACTION_MS = 900;

type DragState = {
  treatId: TreatId;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  target?: HTMLButtonElement;
};

function getTreatDragLift(event: ReactPointerEvent<HTMLElement>, drag: DragState) {
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  const progress = Math.max(0, Math.min(1, (distance - 7) / 60));
  const easedProgress = progress * progress * (3 - 2 * progress);
  return TREAT_DRAG_MAX_LIFT_Y * easedProgress;
}

export function PlayScene({ pet, photoHint, onInteractionComplete, onFed, onSound }: {
  pet: PetSummary;
  photoHint?: string;
  onInteractionComplete?: (method: PetInteractionMethod) => void;
  onFed: (method: PetInteractionMethod) => void;
  onSound: (effect: SoundEffect, variant?: number) => void;
}) {
  const artworkImage = usePetDesign(pet);
  const artworkReady = !artworkImage || artworkImage.snapshot.status === 'ready';
  const [selectedTreat, setSelectedTreat] = useState<TreatId>();
  const [phase, setPhase] = useState<Phase>('treat');
  const [eating, setEating] = useState(false);
  const [greeting, setGreeting] = useState(true);
  const [petCount, setPetCount] = useState(0);
  const [petReactionSequence, setPetReactionSequence] = useState(0);
  const [petReactionActive, setPetReactionActive] = useState(false);
  const [hasPetInteraction, setHasPetInteraction] = useState(false);
  const petCountRef = useRef(0);
  const [dragGhost, setDragGhost] = useState<{ treatId: TreatId; x: number; y: number }>();
  const zoneRef = useRef<HTMLDivElement>(null);
  const treatDragRef = useRef<DragState>();
  const petGestureRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    distance: number;
    recognizedStroke: boolean;
  }>();
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const petReactionTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const completedRef = useRef(false);

  useEffect(() => {
    timersRef.current.push(setTimeout(() => setGreeting(false), 520));
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  const selected = TREATS.find((treat) => treat.id === selectedTreat);
  const hint = useMemo(() => {
    if (phase === 'happy') return `${selected?.objectLabel ?? '간식을'} 맛있게 먹고 있어요`;
    if (phase === 'petting') return '강아지를 살살 쓰다듬어 주세요';
    if (phase === 'done') return '마음이 전해졌어요';
    if (selected) return `${selected.objectLabel} 끌어주거나 강아지를 톡 눌러주세요`;
    return '간식을 끌어주거나 톡 눌러 골라주세요';
  }, [phase, selected]);

  function giveTreat(treatId: TreatId) {
    if (phase !== 'treat' || !artworkReady) return;
    onSound('eat');
    void playHaptic('treatSuccess');
    setSelectedTreat(treatId);
    setEating(true);
    setPhase('happy');
    timersRef.current.push(setTimeout(() => {
      setEating(false);
      setPhase('petting');
    }, 950));
  }

  function addPet(method: PetInteractionMethod) {
    if (phase !== 'petting' || completedRef.current || !artworkReady) return;
    const next = Math.min(3, petCountRef.current + 1);
    petCountRef.current = next;
    setPetCount(next);
    setPetReactionSequence((sequence) => sequence + 1);
    setPetReactionActive(true);
    if (petReactionTimerRef.current) clearTimeout(petReactionTimerRef.current);
    petReactionTimerRef.current = setTimeout(() => setPetReactionActive(false), next === 3 ? FINAL_REACTION_MS : PET_REACTION_MS);
    timersRef.current.push(petReactionTimerRef.current);
    setHasPetInteraction(true);
    onSound('pet', next - 1);
    void playHaptic('pet');
    if (next === 3) {
      completedRef.current = true;
      setPhase('done');
      onInteractionComplete?.(method);
      timersRef.current.push(setTimeout(() => onFed(method), FINAL_REACTION_MS));
    }
  }

  function startTreatDrag(event: ReactPointerEvent<HTMLButtonElement>, treatId: TreatId) {
    if (phase !== 'treat' || event.button !== 0 || treatDragRef.current) return;
    onSound('pick');
    setSelectedTreat(treatId);
    treatDragRef.current = {
      treatId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      target: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTreat(event: ReactPointerEvent<HTMLElement>) {
    const drag = treatDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance > 7) drag.moved = true;
    if (drag.moved) setDragGhost({ treatId: drag.treatId, x: event.clientX, y: event.clientY - getTreatDragLift(event, drag) });
  }

  function finishTreatDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = treatDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const zone = zoneRef.current?.getBoundingClientRect();
    const dropX = event.clientX;
    const dropY = event.clientY - getTreatDragLift(event, drag);
    const droppedOnDog = drag.moved && zone && dropX >= zone.left && dropX <= zone.right && dropY >= zone.top && dropY <= zone.bottom;
    if (drag.target?.hasPointerCapture(event.pointerId)) drag.target.releasePointerCapture(event.pointerId);
    treatDragRef.current = undefined;
    setDragGhost(undefined);
    if (event.type !== 'pointercancel' && droppedOnDog) giveTreat(drag.treatId);
  }

  function startPetting(event: ReactPointerEvent<HTMLDivElement>) {
    if (phase !== 'petting' || event.button !== 0 || petGestureRef.current) return;
    petGestureRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      distance: 0,
      recognizedStroke: false,
    };
    setHasPetInteraction(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePetting(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = petGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.recognizedStroke) return;
    const segmentDistance = Math.hypot(event.clientX - gesture.lastX, event.clientY - gesture.lastY);
    if (segmentDistance > PET_POINTER_NOISE) {
      gesture.distance += segmentDistance;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
    }
    if (gesture.distance >= PET_STROKE_DISTANCE) {
      gesture.recognizedStroke = true;
    }
  }

  function finishPetting(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = petGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    addPet(gesture.recognizedStroke ? 'stroke' : 'tap');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    petGestureRef.current = undefined;
  }

  function cancelPetting(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = petGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    petGestureRef.current = undefined;
  }

  function useSelectedTreat() {
    if (artworkImage?.snapshot.status === 'error') { void artworkImage.resource.retry(); return; }
    if (phase === 'treat' && selectedTreat) giveTreat(selectedTreat);
  }

  const ghostTreat = TREATS.find((treat) => treat.id === dragGhost?.treatId);

  return (
    <main className="play-screen" onPointerMoveCapture={moveTreat} onPointerUpCapture={finishTreatDrag} onPointerCancelCapture={finishTreatDrag}>
      <Top
        className="play-copy"
        upperGap={4}
        lowerGap={0}
        title={<Top.TitleParagraph size={28}>{withSubjectParticle(pet.name ?? '이 친구')} 기다리고 있어요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph><span aria-live="polite">{hint}</span></Top.SubtitleParagraph>}
      />
      {photoHint && <p className="play-photo-hint">{photoHint}</p>}

      <div
        className={`feed-zone phase-${phase} ${greeting ? 'is-greeting' : ''} ${dragGhost ? 'is-dragging-treat' : ''} ${petReactionActive ? 'is-pet-reacting' : ''} ${petReactionSequence ? `pet-reaction-${petReactionSequence % 2 ? 'a' : 'b'}` : ''}`}
        style={{ '--pet-reaction-duration': `${phase === 'done' ? FINAL_REACTION_MS : PET_REACTION_MS}ms` } as CSSProperties}
        ref={zoneRef}
        role="button"
        tabIndex={0}
        aria-label={artworkImage?.snapshot.status === 'error' ? `${pet.name ?? '강아지'} 캐릭터 다시 불러오기` : phase === 'petting' ? `${pet.name ?? '강아지'} 쓰다듬기, ${petCount}번 완료` : phase === 'done' ? `${pet.name ?? '강아지'} 교감 완료` : selectedTreat ? `${pet.name ?? '강아지'}에게 간식 주기` : `${pet.name ?? '강아지'}`}
        onClick={useSelectedTreat}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (event.repeat || petGestureRef.current) return;
          if (artworkImage?.snapshot.status === 'error') { void artworkImage.resource.retry(); return; }
          if (phase === 'petting') addPet('keyboard');
          else useSelectedTreat();
        }}
        onPointerDown={startPetting}
        onPointerMove={movePetting}
        onPointerUp={finishPetting}
        onPointerCancel={cancelPetting}
      >
        <PetArtwork
          pet={pet}
          active={phase !== 'treat' || Boolean(selectedTreat)}
          eating={eating}
          happy={phase === 'happy'}
          smiling={petReactionActive}
          size={245}
          retryControl={false}
        />
        <div className="heart-pop" aria-hidden="true">♥</div>
        {phase === 'petting' && !hasPetInteraction && <div className="petting-hand" aria-hidden="true">👋</div>}
      </div>

      <section className="interaction-dock" aria-label="강아지와 놀기">
        {phase === 'treat' && (
          <div className="treat-tray">
            <p>간식 하나를 골라주세요</p>
            <div className="treat-options">
              {TREATS.map((treat) => (
                <button
                  key={treat.id}
                  type="button"
                  disabled={!artworkReady}
                  className={`treat-option ${selectedTreat === treat.id ? 'selected' : ''}`}
                  aria-label={`${treat.label} 간식${selectedTreat === treat.id ? ', 선택됨' : ''}`}
                  aria-pressed={selectedTreat === treat.id}
                  onPointerDown={(event) => startTreatDrag(event, treat.id)}
                  onClick={(event) => {
                    if (phase !== 'treat') return;
                    if (event.detail === 0) onSound('pick');
                    setSelectedTreat(treat.id);
                  }}
                >
                  <Asset.Image src={treat.image} frameShape={{ width: 42, height: 42 }} alt="" />
                  <span>{treat.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'happy' && (
          <div className="interaction-status" aria-live="polite">
            <span className="happy-hearts" aria-hidden="true">♥ ♥</span>
            <strong>냠냠, 맛있게 먹는 중이에요</strong>
            <small>조금만 기다려 주세요</small>
          </div>
        )}

        {(phase === 'petting' || phase === 'done') && (
          <div className="petting-guide" aria-live="polite">
            <div className="pet-progress" aria-label={`쓰다듬기 ${petCount}/3`}>
              {[1, 2, 3].map((step) => <span key={step} className={`pet-heart ${petCount >= step ? 'is-filled' : ''}`}>♥</span>)}
            </div>
            <strong>{phase === 'done' ? '마음이 전해졌어요' : '강아지를 살살 쓰다듬어 주세요'}</strong>
            <small>{phase === 'done' ? '귀여운 모습을 보여드릴게요' : '세 번 쓸어주거나 톡톡 세 번 눌러도 좋아요'}</small>
          </div>
        )}
      </section>

      {dragGhost && ghostTreat && (
        <div className="treat-ghost" style={{ left: dragGhost.x, top: dragGhost.y }} aria-hidden="true">
          <Asset.Image src={ghostTreat.image} frameShape={{ width: 58, height: 58 }} alt="" />
        </div>
      )}
    </main>
  );
}
