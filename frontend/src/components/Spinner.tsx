export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-label="Загрузка"
    />
  );
}

export function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center text-primary">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
