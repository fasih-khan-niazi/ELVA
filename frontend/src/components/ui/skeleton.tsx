import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
    return (
        <div
            aria-busy="true"
            aria-hidden="true"
            className={cn('animate-pulse rounded-md bg-slate-200/80', className)}
            {...props}
        />
    );
}

export { Skeleton };
