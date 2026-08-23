import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PetSummary } from '../types';
import { PetArtwork } from './PetArtwork';

const POSITIONS = ['pos-a', 'pos-b', 'pos-c', 'pos-d', 'pos-e'];
const DOG_DRAG_LIFT_Y = 60;

export function House({ pets, onSelect }: { pets: PetSummary[]; onSelect: (pet: PetSummary) => void }) {
  const roomRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    petId: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  }>();
  const suppressClickRef = useRef<string>();
  const [grabbedId, setGrabbedId] = useState<string>();
  const [draggedPositions, setDraggedPositions] = useState<Record<string, { left: number; top: number }>>({});

  function startDrag(petId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const buttonRect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      petId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - buttonRect.left,
      offsetY: event.clientY - buttonRect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setGrabbedId(petId);
  }

  function movePet(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const room = roomRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !room) return;

    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
    drag.moved = true;
    const roomRect = room.getBoundingClientRect();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(0, Math.min(roomRect.width - buttonRect.width, event.clientX - roomRect.left - drag.offsetX));
    const top = Math.max(0, Math.min(roomRect.height - buttonRect.height, event.clientY - roomRect.top - drag.offsetY - DOG_DRAG_LIFT_Y));
    setDraggedPositions((current) => ({ ...current, [drag.petId]: { left, top } }));
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      suppressClickRef.current = drag.petId;
      window.setTimeout(() => {
        if (suppressClickRef.current === drag.petId) suppressClickRef.current = undefined;
      }, 0);
    }
    dragRef.current = undefined;
    setGrabbedId(undefined);
  }

  return (
    <section className="room" ref={roomRef} aria-label="강아지들이 있는 집">
      <div className="sun-glow" />
      <div className="window" aria-hidden="true"><div className="cloud" /><div className="hill" /></div>
      <div className="shelf" aria-hidden="true"><span className="pot" /><span className="book book-a" /><span className="book book-b" /></div>
      <div className="sofa" aria-hidden="true"><div className="cushion" /></div>
      <div className="rug" aria-hidden="true" />
      {pets.map((pet, index) => {
        const position = draggedPositions[pet.id];
        return (
          <button
            className={`pet-button ${POSITIONS[index]} ${position ? 'is-positioned' : ''} ${grabbedId === pet.id ? 'is-grabbed' : ''}`}
            key={pet.id}
            style={position}
            onPointerDown={(event) => startDrag(pet.id, event)}
            onPointerMove={movePet}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={() => {
              if (suppressClickRef.current === pet.id) {
                suppressClickRef.current = undefined;
                return;
              }
              onSelect(pet);
            }}
            aria-label={`${pet.name ?? '이름 없는 강아지'} 옮기기 또는 선택`}
          >
            <PetArtwork pet={pet} size={index === 2 ? 132 : 114} panting />
          </button>
        );
      })}
    </section>
  );
}
