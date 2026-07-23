import { GitBranch } from '@phosphor-icons/react';

export function RepositoryLoader({
  label,
  fullscreen = false,
}: {
  readonly label: string;
  readonly fullscreen?: boolean;
}) {
  return (
    <div
      className={`${fullscreen ? 'fixed' : 'absolute'} inset-0 z-20 grid place-items-center bg-background/55 backdrop-blur-[5px]`}
    >
      <div
        className="w-[min(360px,calc(100%-32px))] rounded-xl border border-border bg-background px-5 py-4 shadow-[0_18px_50px_-24px_rgba(24,24,27,0.35)]"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <div className="relative grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <GitBranch size={19} weight="bold" />
            <span className="absolute -right-1 -bottom-1 size-3 animate-pulse rounded-full border-2 border-background bg-[#d97706]" />
          </div>
          <div>
            <p className="text-sm font-semibold">{label}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              resolving structural connections
            </p>
          </div>
        </div>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[repository-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}
