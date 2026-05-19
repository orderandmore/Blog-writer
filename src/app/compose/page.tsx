"use client";

import { Suspense } from "react";
import { WizardProvider, useWizard } from "@/components/WizardProvider";
import { Sidebar } from "@/components/Sidebar";
import { StepContent } from "@/components/steps/StepContent";
import { StepImages } from "@/components/steps/StepImages";
import { StepMetadata } from "@/components/steps/StepMetadata";
import { StepSyndication } from "@/components/steps/StepSyndication";
import { StepReview } from "@/components/steps/StepReview";
import { STEPS } from "@/lib/wizard-store";

function WizardContent() {
  const { state, dispatch } = useWizard();
  const currentStep = state.currentStep;

  const canGoNext = (() => {
    switch (currentStep) {
      case 1: // Content
        return state.rawMarkdown.length > 0;
      case 2: // Images
        return true; // Images are optional
      case 3: // Metadata — WP infers author from auth, so just title + description.
        return !!(state.postMeta.title && state.postMeta.description);
      case 4: // Syndication
        return true; // Syndication is optional
      default:
        return false;
    }
  })();

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          {currentStep === 1 && <StepContent />}
          {currentStep === 2 && <StepImages />}
          {currentStep === 3 && <StepMetadata />}
          {currentStep === 4 && <StepSyndication />}
          {currentStep === 5 && <StepReview />}

          {/* Navigation */}
          {currentStep < 5 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-[var(--border)]">
              <button
                onClick={() =>
                  dispatch({ type: "SET_STEP", step: currentStep - 1 })
                }
                disabled={currentStep === 1}
                className="px-4 py-2 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--foreground)] disabled:invisible"
              >
                Back
              </button>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">
                  Step {currentStep} of {STEPS.length}
                </span>
                <button
                  onClick={() =>
                    dispatch({ type: "SET_STEP", step: currentStep + 1 })
                  }
                  disabled={!canGoNext}
                  className="px-6 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ComposePage() {
  return (
    <Suspense fallback={null}>
      <WizardProvider>
        <WizardContent />
      </WizardProvider>
    </Suspense>
  );
}
