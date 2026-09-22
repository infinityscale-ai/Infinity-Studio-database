"use client";

import { useState, type FormEvent } from "react";
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

type Step = "welcome" | "theme" | "name";

const STEPS: Step[] = ["welcome", "theme", "name"];

const DARK_THEME = BUILTIN_APP_THEMES.find((t) => t.id === "infinity-studio-dark");
const DARK_THEME_ID = DARK_THEME?.id ?? "dark";

const TIPS: string[] = [
  "Infinity Studio connects to Postgres, MySQL, Supabase, SQLite and more — all from one unified workspace.",
  "Turn on Schema Explorer in Settings to browse tables, functions, triggers and indexes without leaving the sidebar.",
  "You can pin favorite tables and queries for quick access from the sidebar.",
  "Export query results as CSV or JSON with a single click from the results grid.",
];

const APPEARANCE_OPTIONS: { id: string; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: DARK_THEME_ID, label: "Dark" },
];

// Themed via CSS variable tokens (same ones the rest of the app uses) so the
// onboarding chrome matches whatever appearance is currently active — light,
// dark, or a custom app theme — including live as the user picks one on the
// theme step.
const PRIMARY_BTN =
  "flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";

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

// Left-hand image panel with the tip that rotates per step.
function TipPanel({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="relative m-3 hidden w-[42%] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-sidebar via-studio-bg to-muted md:flex">
      {/* eslint-disable-next-line @next/next/no-img-element -- static onboarding art from /public */}
      <img
        src="/onboarding.png"
        alt="Infinity Studio onboarding"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute top-14 left-0 right-0 z-10 max-w-xs mx-auto px-8 text-center">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/70">
          Tip
        </p>
        <p className="text-lg leading-relaxed text-white/90">
          {TIPS[stepIndex % TIPS.length]}
        </p>
      </div>
    </div>
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
function StepDots({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {STEPS.map((s, i) => (
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

// First-run wizard: welcome, appearance, then the local user's name.
export function OnboardingFlow({
  open,
  appThemeId,
  setAppThemeId,
  onComplete,
}: {
  open: boolean;
  appThemeId: string;
  setAppThemeId: (id: string) => void;
  onComplete: (info: { name: string }) => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const stepIndex = STEPS.indexOf(step);

  // Steps back one screen; the welcome screen has no back button.
  function goBack() {
    if (step === "theme") setStep("welcome");
    else if (step === "name") setStep("theme");
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
          Set up Infinity Studio: pick an appearance and tell us your name.
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
              {step === "name" && <NameStep onComplete={(name) => onComplete({ name })} />}
            </div>

            <StepDots stepIndex={stepIndex} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
