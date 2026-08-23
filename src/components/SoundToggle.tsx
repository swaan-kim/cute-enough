export function SoundToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`sound-toggle ${enabled ? 'is-enabled' : ''}`}
      aria-label={enabled ? '소리 끄기' : '소리 켜기'}
      aria-pressed={enabled}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9.2h3.3L12 5.4v13.2l-4.7-3.8H4z" />
        {enabled ? (
          <><path className="sound-wave" d="M15 9a4 4 0 0 1 0 6" /><path className="sound-wave" d="M17.7 6.7a7.4 7.4 0 0 1 0 10.6" /></>
        ) : <path className="sound-wave" d="m15.4 9 5.2 6m0-6-5.2 6" />}
      </svg>
    </button>
  );
}
