"use client";

import Link from "next/link";
import { useWizard } from "./WizardProvider";
import { STEPS } from "@/lib/wizard-store";

export function Sidebar() {
  const { state, dispatch } = useWizard();

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-6 flex flex-col">
      <div className="mb-8">
        <h1 className="text-lg font-semibold text-white">Blog Portal</h1>
        <p className="text-xs text-[var(--muted)] mt-1">orderandmore.com</p>
      </div>

      <nav className="flex-1">
        <ol className="space-y-1">
          {STEPS.map((step) => {
            const isCurrent = state.currentStep === step.id;
            const isCompleted = state.currentStep > step.id;
            const isClickable = step.id <= state.currentStep;

            return (
              <li key={step.id}>
                <button
                  onClick={() =>
                    isClickable &&
                    dispatch({ type: "SET_STEP", step: step.id })
                  }
                  disabled={!isClickable}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-start gap-3 transition-colors ${
                    isCurrent
                      ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                      : isCompleted
                        ? "text-[var(--foreground)] hover:bg-[var(--surface-hover)] cursor-pointer"
                        : "text-[var(--muted)] cursor-not-allowed"
                  }`}
                >
                  <span
                    className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium mt-0.5 ${
                      isCurrent
                        ? "bg-[var(--primary)] text-white"
                        : isCompleted
                          ? "bg-[var(--success)] text-white"
                          : "bg-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    {isCompleted ? (
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      step.id
                    )}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{step.label}</div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">
                      {step.description}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-auto pt-4 border-t border-[var(--border)] space-y-2">
        <Link
          href="/"
          className="block text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          &larr; Dashboard
        </Link>
        <Link
          href="/settings"
          className="block text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          Settings &rarr;
        </Link>
        {state.draftId && (
          <p className="text-xs text-[var(--muted)]">
            Draft: {state.draftId.slice(0, 8)} · auto-saved
          </p>
        )}
      </div>
    </aside>
  );
}
