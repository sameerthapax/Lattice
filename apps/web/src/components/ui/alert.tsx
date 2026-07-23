import * as React from 'react';

import { cn } from '../../lib/utils';

export function Alert({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950',
        className,
      )}
      {...props}
    />
  );
}
