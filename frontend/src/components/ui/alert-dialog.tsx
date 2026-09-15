import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
    return <AlertDialogPrimitive.Root {...props} />;
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
    return <AlertDialogPrimitive.Trigger {...props} />;
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
    return <AlertDialogPrimitive.Portal {...props} />;
}

function AlertDialogOverlay({
    className,
    ...props
}: AlertDialogPrimitive.Backdrop.Props) {
    return (
        <AlertDialogPrimitive.Backdrop
            className={cn(
                'fixed inset-0 z-[10000] bg-slate-900/60 backdrop-blur-sm data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200',
                className,
            )}
            {...props}
        />
    );
}

function AlertDialogContent({
    className,
    size = 'default',
    ...props
}: AlertDialogPrimitive.Popup.Props & { size?: 'default' | 'sm' }) {
    return (
        <AlertDialogPortal>
            <AlertDialogOverlay />
            <AlertDialogPrimitive.Popup
                className={cn(
                    'fixed left-1/2 top-1/2 z-[10001] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-ocean-ice bg-white p-6 shadow-2xl outline-none',
                    'data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-all duration-200',
                    size === 'default' ? 'sm:max-w-lg' : 'sm:max-w-md',
                    className,
                )}
                {...props}
            />
        </AlertDialogPortal>
    );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div className={cn('flex flex-col gap-2 text-left', className)} {...props} />
    );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
            {...props}
        />
    );
}

function AlertDialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
    return (
        <AlertDialogPrimitive.Title
            className={cn('text-lg font-semibold text-ocean-navy', className)}
            {...props}
        />
    );
}

function AlertDialogDescription({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
    return (
        <AlertDialogPrimitive.Description
            className={cn('text-sm text-ocean-deep/80', className)}
            {...props}
        />
    );
}

function AlertDialogAction({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Close>) {
    return (
        <AlertDialogPrimitive.Close
            render={<Button className={className} />}
            {...props}
        />
    );
}

function AlertDialogCancel({
    className,
    variant = 'outline',
    size = 'default',
    ...props
}: AlertDialogPrimitive.Close.Props &
    Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
    return (
        <AlertDialogPrimitive.Close
            render={<Button variant={variant} size={size} className={className} />}
            {...props}
        />
    );
}

export {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    AlertDialogPortal,
    AlertDialogTitle,
    AlertDialogTrigger,
};
