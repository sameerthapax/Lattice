import { cn } from '../../lib/utils';

export function Separator({ className }: { readonly className?: string }) {
  return <div role="separator" className={cn('h-px bg-border', className)} />;
}
