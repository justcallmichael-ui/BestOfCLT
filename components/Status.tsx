export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="panel flex min-h-40 items-center justify-center p-6 text-muted">
      <span className="display text-xl">{label}...</span>
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="panel flex flex-col items-start gap-4 p-5">
      <p className="text-lg">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
