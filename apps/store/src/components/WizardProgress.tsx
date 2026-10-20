const STEPS = ["Personalize", "Preview", "Checkout"];

export function WizardProgress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center">
      {/* Mobile: compact "step X of 3" */}
      <span className="sm:hidden text-xs font-semibold text-ink/50">
        Step {current} of {STEPS.length}
      </span>

      {/* Desktop: full step labels */}
      <div className="hidden sm:flex items-center gap-2">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 ${
                  active ? "text-ink" : done ? "text-brand-600" : "text-ink/30"
                }`}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0 ${
                    active
                      ? "bg-brand-500 text-white"
                      : done
                        ? "bg-brand-100 text-brand-600"
                        : "bg-ink/5 text-ink/30"
                  }`}
                >
                  {done ? "✓" : step}
                </span>
                <span className="text-xs font-semibold">{label}</span>
              </div>
              {i < STEPS.length - 1 && <div className="w-5 h-px bg-ink/15" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
