"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FallbackAvatar from "@/components/fallback-avatar";
import { useAuthState } from "@/hooks/use-auth-state";
import { saveLocalUserProfile } from "@/lib/auth/user-profile";
import { toast } from "sonner";

export const USER_AVATAR_STORAGE_KEY = "infinity-studio-user-avatar";

export interface ProfileData {
  fullName: string;
  email: string;
  avatarUrl?: string;
}

export interface EditProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: ProfileData;
  lastUpdated?: string;
  onSave: (data: ProfileData) => void | Promise<void>;
}

// Reads the avatar data URL cached for the local user, or undefined.
export function loadStoredAvatar(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(USER_AVATAR_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

// Caches the avatar data URL for the local user, or clears it when empty.
export function storeAvatar(avatarUrl?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (avatarUrl) window.localStorage.setItem(USER_AVATAR_STORAGE_KEY, avatarUrl);
    else window.localStorage.removeItem(USER_AVATAR_STORAGE_KEY);
  } catch {
    // Storage unavailable: the avatar then lives only for this session.
  }
}

// Reads a picked image file as a data URL and hands it to the callback.
export function readAvatarFile(file: File, onLoad: (dataUrl: string) => void): void {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") onLoad(reader.result);
  };
  reader.readAsDataURL(file);
}

interface LocalProfileOverrides {
  name?: string;
  email?: string;
  avatar?: string;
}

export interface LocalProfileEditor {
  open: boolean;
  setOpen: (open: boolean) => void;
  resolved: boolean;
  profile: ProfileData;
  save: (data: ProfileData) => Promise<void>;
}

// Drives profile editing for the single local user: resolves the stored profile and saves name, email and avatar.
export function useLocalProfileEditor(
  overrides: LocalProfileOverrides = {},
): LocalProfileEditor {
  const auth = useAuthState();
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setAvatarUrl(loadStoredAvatar());
  }, []);

  const save = useCallback(async (data: ProfileData) => {
    const { result } = await saveLocalUserProfile(data.fullName, data.email);
    if (!result.success) {
      toast.error(result.error || "Failed to save profile. Try again.");
      return;
    }
    storeAvatar(data.avatarUrl);
    setAvatarUrl(data.avatarUrl);
    setOpen(false);
    toast.success("Profile updated.");
  }, []);

  const overrideName = overrides.name?.trim();
  const overrideEmail = overrides.email?.trim();
  const overrideAvatar = overrides.avatar;
  const profile = useMemo<ProfileData>(
    () => ({
      fullName: auth.authResolved ? auth.displayName : overrideName || "User",
      email: auth.authResolved ? (auth.email ?? "") : (overrideEmail ?? ""),
      avatarUrl: avatarUrl || overrideAvatar,
    }),
    [auth.authResolved, auth.displayName, auth.email, overrideName, overrideEmail, avatarUrl, overrideAvatar],
  );

  return { open, setOpen, resolved: auth.authResolved, profile, save };
}

// Modal for editing the local user's name, email and avatar.
export function EditProfileModal({
  open,
  onOpenChange,
  profile,
  lastUpdated,
  onSave,
}: EditProfileModalProps) {
  const [draft, setDraft] = useState<ProfileData>(profile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setDraft(profile);
  }, [open, profile]);

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readAvatarFile(file, (dataUrl) => setDraft((d) => ({ ...d, avatarUrl: dataUrl })));
    e.target.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl gap-0 rounded-2xl p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="px-8 pt-6 pb-5">
          <DialogTitle className="text-base font-semibold">Edit your profile</DialogTitle>
        </div>

        <div className="grid grid-cols-[1fr_280px] gap-8 px-8 pb-8">
          {/* Left: form */}
          <div className="space-y-5 border-r border-dashed border-border pr-8">
            <Field label="Full name" htmlFor="edit-profile-name">
              <Input
                id="edit-profile-name"
                value={draft.fullName}
                onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                className="rounded-xl"
              />
            </Field>

            <Field label="Email" htmlFor="edit-profile-email">
              <Input
                id="edit-profile-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="rounded-xl"
              />
            </Field>
          </div>

          {/* Right: preview */}
          <div className="flex flex-col items-center pt-1">
            <div className="text-muted-foreground mb-3 text-xs">Preview</div>
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFile}
              />
              <button
                type="button"
                onClick={handleAvatarClick}
                className="bg-muted h-24 w-24 overflow-hidden rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Change avatar"
              >
                {draft.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL avatar, not an optimizable asset
                  <img
                    src={draft.avatarUrl}
                    alt={draft.fullName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <FallbackAvatar
                    name={draft.fullName || "User"}
                    size={96}
                    className="h-full w-full"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={handleAvatarClick}
                className="bg-background absolute right-0 bottom-0 flex h-7 w-7 items-center justify-center rounded-full border border-border shadow-sm hover:bg-accent"
                aria-label="Edit avatar"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-3 text-center">
              <div className="text-base font-semibold">{draft.fullName || "Your name"}</div>
              <div className="text-muted-foreground text-sm">{draft.email || "No email"}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-8 py-5">
          <div className="text-muted-foreground text-xs">
            {lastUpdated ? `Last updated: ${lastUpdated}` : ""}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-full">
              Cancel
            </Button>
            <Button
              onClick={() => onSave(draft)}
              className="rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              Save changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Labelled form row used by the modal's inputs.
function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-normal">{label}</Label>
      {children}
    </div>
  );
}
