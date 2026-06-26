export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <svg className="brand__mark" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 4 54 12v17c0 14-8.5 25.3-22 31C18.5 54.3 10 43 10 29V12L32 4Z" />
        <rect x="20" y="24" width="24" height="22" rx="5" />
        <path d="M25 24v-4a7 7 0 0 1 14 0v4" />
        <circle cx="32" cy="35" r="3" />
        <path d="M32 38v4" />
      </svg>
      {!compact ? (
        <div>
          <strong>PassDeck</strong>
          <span>Local KDBX vault</span>
        </div>
      ) : null}
    </div>
  );
}
