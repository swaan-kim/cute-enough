import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Asset, Top, TopNavigation, TopNavigationBackButton } from '@toss/tds-mobile';
import type { SoundEffect } from '../lib/sound';
import type { PetSummary } from '../types';
import { PetArtwork } from './PetArtwork';

type TreatId = 'sweet-potato' | 'bone' | 'meat';
type Phase = 'treat' | 'happy' | 'petting' | 'done';

const TREATS: Array<{ id: TreatId; label: string; objectLabel: string; image: string }> = [
  { id: 'sweet-potato', label: '고구마', objectLabel: '고구마를', image: 'https://static.toss.im/2d-emojis/png/4x/u1F360.png' },
  { id: 'bone', label: '개껌', objectLabel: '개껌을', image: 'https://static.toss.im/2d-emojis/png/4x/u1F9B4.png' },
  { id: 'meat', label: '고기', objectLabel: '고기를', image: 'https://static.toss.im/2d-emojis/png/4x/u1F356.png' },
];
const TREAT_DRAG_MAX_LIFT_Y = 32;

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

export function PlayScene({ pet, onFed, onBack, onSound }: { pet: PetSummary; onFed: () => void; onBack: () => void; onSound: (effect: SoundEffect, variant?: number) => void }) {
  const [selectedTreat, setSelectedTreat] = useState<TreatId>();
  const [phase, setPhase] = useState<Phase>('treat');
  const [eating, setEating] = useState(false);
  const [greeting, setGreeting] = useState(true);
  const [petCount, setPetCount] = useState(0);
  const [dragGhost, setDragGhost] = useState<{ treatId: TreatId; x: number; y: number }>();
  const zoneRef = useRef<HTMLDivElement>(null);
  const treatDragRef = useRef<DragState>();
  const petGestureRef = useRef<{ pointerId: number; startX: number; startY: number; counted: boolean }>();
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const completedRef = useRef(false);

  useEffect(() => {
    timersRef.current.push(setTimeout(() => setGreeting(false), 520));
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  const selected = TREATS.find((treat) => treat.id === selectedTreat);
  const hint = useMemo(() => {
    if (phase === 'happy') return `${selected?.label ?? '간식'}을 맛있게 먹고 있어요`;
    if (phase === 'petting') return '기분이 좋아졌어요. 머리를 살살 쓰다듬어 주세요';
    if (phase === 'done') return '마음이 전해졌어요';
    if (selected) return `${selected.objectLabel} 강아지에게 끌어주세요`;
    return '간식 하나를 골라 입까지 끌어주세요';
  }, [phase, selected]);

  function giveTreat(treatId: TreatId) {
    if (phase !== 'treat') return;
    onSound('eat');
    setSelectedTreat(treatId);
    setEating(true);
    setPhase('happy');
    timersRef.current.push(setTimeout(() => {
      setEating(false);
      setPhase('petting');
    }, 950));
  }

  function addPet() {
    if (phase !== 'petting' || completedRef.current) return;
    setPetCount((count) => {
      const next = Math.min(3, count + 1);
      onSound('pet', next - 1);
      if (next === 3) {
        completedRef.current = true;
        setPhase('done');
        timersRef.current.push(setTimeout(onFed, 450));
      }
      return next;
    });
  }

  function startTreatDrag(event: ReactPointerEvent<HTMLButtonElement>, treatId: TreatId) {
    if (phase !== 'treat') return;
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
    if (droppedOnDog) giveTreat(drag.treatId);
  }

  function startPetting(event: ReactPointerEvent<HTMLDivElement>) {
    if (phase !== 'petting') return;
    petGestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, counted: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePetting(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = petGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.counted) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 24) {
      gesture.counted = true;
      addPet();
    }
  }

  function finishPetting(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = petGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.counted) addPet();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    petGestureRef.current = undefined;
  }

  function useSelectedTreat() {
    if (phase === 'treat' && selectedTreat) giveTreat(selectedTreat);
  }

  const ghostTreat = TREATS.find((treat) => treat.id === dragGhost?.treatId);

  return (
    <main className="play-screen" onPointerMoveCapture={moveTreat} onPointerUpCapture={finishTreatDrag} onPointerCancelCapture={finishTreatDrag}>
      <TopNavigation leading={<TopNavigationBackButton onClick={onBack} aria-label="집으로 돌아가기" />} background="transparent" withSafeAreaTop={false} />
      <Top
        className="play-copy"
        upperGap={4}
        lowerGap={0}
        title={<Top.TitleParagraph size={28}>{pet.name ?? '이 친구'}가 기다리고 있어요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph><span aria-live="polite">{hint}</span></Top.SubtitleParagraph>}
      />

      <div
        className={`feed-zone phase-${phase} ${greeting ? 'is-greeting' : ''} ${dragGhost ? 'is-dragging-treat' : ''}`}
        ref={zoneRef}
        role="button"
        tabIndex={0}
        aria-label={phase === 'petting' ? `${pet.name ?? '강아지'} 쓰다듬기, ${petCount}번 완료` : phase === 'done' ? `${pet.name ?? '강아지'}와 교감 완료` : selectedTreat ? `${pet.name ?? '강아지'}에게 간식 주기` : `${pet.name ?? '강아지'}`}
        onClick={useSelectedTreat}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (phase === 'petting') addPet();
          else useSelectedTreat();
        }}
        onPointerDown={startPetting}
        onPointerMove={movePetting}
        onPointerUp={finishPetting}
        onPointerCancel={finishPetting}
      >
        <PetArtwork
          pet={pet}
          active={phase !== 'treat' || Boolean(selectedTreat)}
          eating={eating}
          happy={phase === 'happy' || phase === 'petting' || phase === 'done'}
          size={245}
        />
        <div className="heart-pop" aria-hidden="true">♥</div>
        {phase === 'petting' && <div className="petting-hand" aria-hidden="true">👋</div>}
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
                  className={`treat-option ${selectedTreat === treat.id ? 'selected' : ''}`}
                  aria-label={`${treat.label} 간식${selectedTreat === treat.id ? ', 선택됨' : ''}`}
                  aria-pressed={selectedTreat === treat.id}
                  onPointerDown={(event) => startTreatDrag(event, treat.id)}
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
            <strong>{phase === 'done' ? '마음이 전해졌어요' : '머리를 살살 쓰다듬어 주세요'}</strong>
            <small>{phase === 'done' ? '귀여운 모습을 보여드릴게요' : '톡톡 눌러도 좋아요'}</small>
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
