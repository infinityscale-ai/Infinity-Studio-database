"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FailureAdvice } from "@/lib/db/connection-failure";

// CommandLine shows the one command the user has to run, with a copy button.
function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-studio-border bg-muted/40 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">{command}</code>
      <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1.5 px-2" onClick={() => void copy()} aria-label="Copy the command">
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

// ConnectionFailureDetails explains why a connection failed and what to do, above the raw error.
export function ConnectionFailureDetails({ advice, error }: { advice: FailureAdvice; error: string }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {advice.summary ? <p className="text-sm text-foreground/90">{advice.summary}</p> : <p className="text-sm text-muted-foreground">Check the connection details and make sure:</p>}
        <ul className="space-y-1 text-sm text-foreground/85">
          {advice.steps.map((step) => (
            <li key={step} className="ml-4 list-disc">{step}</li>
          ))}
        </ul>
      </div>
      {advice.command ? <CommandLine command={advice.command} /> : null}
      <div className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3">
        <p className="mb-1 text-xs font-medium tracking-[0.14em] text-destructive/80">Error details</p>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-destructive">{error}</pre>
      </div>
    </div>
  );
}
