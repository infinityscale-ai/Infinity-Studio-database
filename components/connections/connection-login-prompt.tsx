"use client";

import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginOf, withLogin } from "@/lib/db/connection-login";

/** What the prompt needs: the connection that was refused, and what to do with the string carrying the new login. */
export type ConnectionLoginPromptProps = { connectionString: string; onSubmit: (connectionString: string) => Promise<void> };

// ConnectionLoginPrompt asks for a user and password only after the database refused to open without them, keeping the rest of the connection.
export function ConnectionLoginPrompt({ connectionString, onSubmit }: ConnectionLoginPromptProps) {
  const [username, setUsername] = useState(() => loginOf(connectionString).username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(withLogin(connectionString, { username, password }));
    } catch (e) {
      setError((e as Error).message || "Could not save the login.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-lg border border-studio-border bg-muted/30 p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" aria-hidden /> Enter the login for this database</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="login-user">User</Label>
          <Input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" placeholder="Leave empty if only a password is used" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="login-password">Password</Label>
          <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Connecting…" : "Save and connect"}</Button>
    </form>
  );
}
