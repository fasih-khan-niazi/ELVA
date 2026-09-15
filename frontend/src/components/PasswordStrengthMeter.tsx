import { validateStrongPassword, scorePasswordStrength } from '../utils/passwordPolicy';

const barColor: Record<string, string> = {
    weak: 'bg-red-400',
    medium: 'bg-amber-400',
    strong: 'bg-emerald-500',
};

const labelCls: Record<string, string> = {
    weak: 'text-red-700',
    medium: 'text-amber-800',
    strong: 'text-emerald-800',
};

export function PasswordStrengthMeter({
    password,
    showRequirements = true,
    dense = false,
}: {
    password: string;
    /** When false, only the bar + weak/medium/strong label (e.g. compact). */
    showRequirements?: boolean;
    /** Tighter bar + label for dense forms (e.g. signup grid). */
    dense?: boolean;
}) {
    const trimmed = (password ?? '').trim();
    const barH = dense ? 'h-1' : 'h-1.5';
    if (!trimmed.length) {
        return (
            <div className={dense ? '' : 'space-y-1.5'} role="presentation">
                <div className={`flex ${barH} rounded-full bg-ocean-mist`} />
            </div>
        );
    }

    const strength = scorePasswordStrength(password);
    const strict = validateStrongPassword(password);
    const fillPct = strength === 'weak' ? 33 : strength === 'medium' ? 66 : 100;

    return (
        <div className={dense ? 'space-y-0.5' : 'space-y-1.5'}>
            <div className={`flex ${barH} rounded-full bg-ocean-ice overflow-hidden`}>
                <div
                    className={`h-full rounded-full transition-all duration-200 ${barColor[strength]}`}
                    style={{ width: `${fillPct}%` }}
                />
            </div>
            <p
                className={`font-semibold capitalize ${dense ? 'text-[10px] leading-tight' : 'text-[11px]'} ${labelCls[strength]}`}
                aria-live="polite"
            >
                {dense ? strength : `Password strength: ${strength}`}
            </p>
            {showRequirements && !strict.ok && strict.message && (
                <p className={`text-ocean-deep/80 leading-snug ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
                    {strict.message}
                </p>
            )}
        </div>
    );
}
