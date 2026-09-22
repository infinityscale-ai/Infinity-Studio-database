"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FallbackAvatar from "@/components/fallback-avatar";
import {
  readAvatarFile,
  useLocalProfileEditor,
  type ProfileData,
} from "@/components/edit-profile-modal";

// Skeleton shaped like the profile form, shown until the stored profile resolves.
function ProfileSettingsSkeleton() {
  return (
    <div className="flex-1 overflow-auto bg-background text-foreground h-full" aria-busy="true">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center px-8 pt-18 space-y-6">
        <div className="h-20 w-20 animate-pulse rounded-2xl bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}

// Avatar preview with a hidden file input; a picked image comes back as a data URL.
function AvatarPicker({
  name,
  avatarUrl,
  onChange,
}: {
  name: string;
  avatarUrl?: string;
  onChange: (dataUrl: string | undefined) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readAvatarFile(file, onChange);
    e.target.value = "";
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Change avatar"
        className="h-20 w-20 overflow-hidden rounded-2xl border border-border/60 bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL avatar, not an optimizable asset
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FallbackAvatar name={name || "User"} size={80} className="h-full w-full" />
        )}
      </button>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-8 px-3 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          Change avatar
        </Button>
        {avatarUrl && (
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-3 text-xs"
            onClick={() => onChange(undefined)}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

// Local profile settings: display name and avatar, saved to the users table and the avatar cache.
export function ProfileSettingsView() {
  const { profile, resolved, save } = useLocalProfileEditor();
  const [draft, setDraft] = useState<ProfileData>(profile);
  const [saving, setSaving] = useState(false);

  // 1. Seed the draft whenever the stored profile changes (initial load and after a save).
  useEffect(() => {
    if (resolved) setDraft(profile);
  }, [resolved, profile]);

  const hasChanges =
    draft.fullName.trim() !== profile.fullName || draft.avatarUrl !== profile.avatarUrl;

  // 2. Persist name and avatar; the stored email is carried through unchanged.
  const handleSave = async () => {
    setSaving(true);
    try {
      await save({ ...draft, fullName: draft.fullName.trim() || "User", email: profile.email });
    } finally {
      setSaving(false);
    }
  };

  if (!resolved) return <ProfileSettingsSkeleton />;

  return (
    <div className="flex-1 overflow-auto bg-background text-foreground h-full">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-8">
        <div className="mx-auto flex h-full w-full max-w-xl flex-col px-2 pt-10 space-y-8">
          <AvatarPicker
            name={draft.fullName}
            avatarUrl={draft.avatarUrl}
            onChange={(avatarUrl) => setDraft((d) => ({ ...d, avatarUrl }))}
          />

          <div className="space-y-2">
            <Label htmlFor="profile-full-name" className="text-sm font-medium">
              Name
            </Label>
            <Input
              id="profile-full-name"
              value={draft.fullName}
              onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
              placeholder="Your name"
              className="h-10 rounded-lg border-studio-border bg-background text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Shown in the header and the avatar menu. Stored on this device only.
            </p>
          </div>

          <div className="mt-auto flex items-center justify-center gap-3 pb-4 pt-8">
            <Button
              variant="outline"
              onClick={() => setDraft(profile)}
              disabled={saving || !hasChanges}
              className="h-9 min-w-28 border-studio-border bg-transparent text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !hasChanges}
              className="h-9 min-w-36 bg-primary text-sm text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
