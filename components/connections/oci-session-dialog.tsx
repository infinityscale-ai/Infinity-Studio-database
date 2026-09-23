"use client";

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ociLogin } from "@/lib/api/discover-client";
import type { OciProfileStatus } from "@/lib/oci/oci-database";

/** What the dialog needs: which profile expired, whether the sign-in can run here, and how to report success. */
export type SessionDialogProps = {
  open: boolean;
  profile: OciProfileStatus;
  cliAvailable: boolean;
  onOpenChange: (open: boolean) => void;
  onRefreshed: () => void;
};

// signInCommand is the line the user runs when the studio cannot start the sign-in itself.
function signInCommand(profile: OciProfileStatus): string {
  return `oci session authenticate --profile-name ${profile.name} --region ${profile.region}`;
}

// OciSessionDialog tells the user their Oracle Cloud session ended and refreshes it in one click.
export function OciSessionDialog({ open, profile, cliAvailable, onOpenChange, onRefreshed }: SessionDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await ociLogin(profile.name);
      onRefreshed();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [profile.name, onRefreshed, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4 p-6">
        <DialogHeader>
          <DialogTitle>Your Oracle Cloud session ended</DialogTitle>
          <DialogDescription>
            The sign-in for {profile.name} in {profile.region} has expired, so the studio cannot read your databases until it is renewed.
          </DialogDescription>
        </DialogHeader>
        {cliAvailable ? (
          <p className="text-sm text-muted-foreground">Refresh opens your browser to sign in again. Nothing is created in Oracle Cloud.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Run this on your computer, then choose Check again:
            <code className="mt-2 block overflow-x-auto rounded-md bg-studio-bg/80 px-2 py-1 font-mono text-xs">{signInCommand(profile)}</code>
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Not now</Button>
          <Button size="sm" className="gap-1.5" onClick={cliAvailable ? () => void refresh() : onRefreshed} disabled={busy}>
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
            {cliAvailable ? (busy ? "Waiting for the browser…" : "Refresh sign-in") : "Check again"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
