"use client";

import { DatabasesStep } from "@/components/onboarding/databases-step";
import { PRIMARY_BTN } from "@/components/onboarding/primary-button";
import { TipPanel } from "@/components/onboarding/tip-panel";
import { localToolsEnabled } from "@/lib/api/discover-client";
import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Check, ChevronLeft } from "@/lib/icon-theme/lucide-react";
import { BUILTIN_APP_THEMES } from "@/lib/studio/app-themes";
import { activateLocalUserProfile } from "@/lib/auth/user-profile";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Step = "welcome" | "theme" | "name" | "databases";

const BASE_STEPS: Step[] = ["welcome", "theme", "name"];
const LOCAL_STEPS: Step[] = [...BASE_STEPS, "databases"];

const DARK_THEME = BUILTIN_APP_THEMES.find((t) => t.id === "infinity-studio-dark");
const DARK_THEME_ID = DARK_THEME?.id ?? "dark";

const APPEARANCE_OPTIONS: { id: string; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: DARK_THEME_ID, label: "Dark" },
];

// Radio-style pill used by the appearance picker.
function OptionPill({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary" : "border-border",
        )}
      >
        {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
      </span>
      {label}
    </button>
  );
}

// Step 1: greeting and the Get Started button.
function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Infinity Studio</h1>
        <p className="text-muted-foreground">
          Let&apos;s get your workspace set up. This will only take a moment.
        </p>
      </div>
      <button type="button" className={PRIMARY_BTN} onClick={onContinue}>
        Get Started
      </button>
    </>
  );
}

// Step 2: pick the appearance; the choice applies live.
function ThemeStep({
  appThemeId,
  setAppThemeId,
  onContinue,
}: {
  appThemeId: string;
  setAppThemeId: (id: string) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Which look works for you?</h1>
        <p className="text-muted-foreground">You can change this anytime in Settings.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {APPEARANCE_OPTIONS.map((option) => (
          <OptionPill
            key={option.id}
            label={option.label}
            selected={appThemeId === option.id}
            onClick={() => setAppThemeId(option.id)}
          />
        ))}
      </div>
      <button type="button" className={PRIMARY_BTN} onClick={onContinue}>
        Continue
      </button>
    </>
  );
}

// Step 3: ask for the display name and create the local profile with it.
function NameStep({ onComplete }: { onComplete: (name: string) => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // Saves the typed name as the local profile, then finishes onboarding.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter your name to continue.");
      return;
    }
    setLoading(true);
    const { result } = await activateLocalUserProfile(trimmed);
    setLoading(false);
    if (!result.success) {
      toast.error(result.error || "Failed to save your name. Try again.");
      return;
    }
    toast.success(`Welcome, ${trimmed}.`);
    onComplete(trimmed);
  }

  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">What should we call you?</h1>
        <p className="text-muted-foreground">
          Your name is stored on this device only. You can change it later in Settings.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="onboarding-name" className="sr-only">
          Your name
        </label>
        <Input
          id="onboarding-name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="h-11 border-border/60 bg-background/70"
        />
        <button type="submit" disabled={loading} className={PRIMARY_BTN}>
          {loading ? "Saving..." : "Continue"}
        </button>
      </form>
    </>
  );
}

// Progress dots, one per step.
function StepDots({ steps, stepIndex }: { steps: Step[]; stepIndex: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {steps.map((s, i) => (
        <span
          key={s}
          className={cn(
            "h-1 w-8 rounded-full transition-all",
            i === stepIndex ? "bg-primary" : i < stepIndex ? "bg-primary/50" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

// First-run wizard: welcome, appearance, the local user's name, then the databases already running here.
export function OnboardingFlow({
  open,
  appThemeId,
  setAppThemeId,
  onComplete,
}: {
  open: boolean;
  appThemeId: string;
  setAppThemeId: (id: string) => void;
  onComplete: (info: { name: string; connectionString?: string }) => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [localTools, setLocalTools] = useState(false);
  useEffect(() => {
    void localToolsEnabled().then(setLocalTools);
  }, []);
  const steps = localTools ? LOCAL_STEPS : BASE_STEPS;
  const stepIndex = steps.indexOf(step);

  // Steps back one screen; the welcome screen has no back button.
  function goBack() {
    if (step === "theme") setStep("welcome");
    else if (step === "name") setStep("theme");
    else if (step === "databases") setStep("name");
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        hideCloseButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="w-[94vw] h-[86vh] max-w-[1200px] sm:max-w-[1200px] gap-0 overflow-hidden rounded-2xl border border-border bg-studio-bg p-0 text-foreground"
      >
        <DialogTitle className="sr-only">Welcome to Infinity Studio</DialogTitle>
        <DialogDescription className="sr-only">
          Set up Infinity Studio: pick an appearance, tell us your name, and pick a database already running here.
        </DialogDescription>

        <div className="flex h-full">
          <TipPanel stepIndex={stepIndex} />

          <div className="relative flex flex-1 flex-col px-10 py-10 md:px-14">
            {step !== "welcome" && (
              <button
                type="button"
                onClick={goBack}
                aria-label="Back"
                className="absolute left-6 top-6 flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground md:left-10 md:top-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}

            <div className="flex flex-1 flex-col justify-center gap-6 max-w-md">
              {step === "welcome" && <WelcomeStep onContinue={() => setStep("theme")} />}
              {step === "theme" && (
                <ThemeStep
                  appThemeId={appThemeId}
                  setAppThemeId={setAppThemeId}
                  onContinue={() => setStep("name")}
                />
              )}
              {step === "name" && (
                <NameStep
                  onComplete={(typed) => {
                    setName(typed);
                    if (localTools) setStep("databases");
                    else onComplete({ name: typed });
                  }}
                />
              )}
              {step === "databases" && (
                <DatabasesStep onUse={(connectionString) => onComplete({ name, connectionString })} onSkip={() => onComplete({ name })} />
              )}
            </div>

            <StepDots steps={steps} stepIndex={stepIndex} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
