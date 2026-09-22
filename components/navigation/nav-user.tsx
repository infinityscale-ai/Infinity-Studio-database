"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserIcon } from "lucide-react";
import { EditProfileModal, useLocalProfileEditor } from "@/components/edit-profile-modal";
import FallbackAvatar from "@/components/fallback-avatar";

export type NavUserProps = {
  name?: string;
  email?: string;
  avatar?: string;
  dropdownAlign?: "start" | "end";
  dropdownSide?: "top" | "right" | "bottom" | "left";
};

// Avatar menu for the local user; its Profile entry opens the edit-profile modal.
export function NavUser({ name, email, avatar, dropdownAlign = "end", dropdownSide }: NavUserProps = {}) {
  const editor = useLocalProfileEditor({ name, email, avatar });
  const { profile } = editor;
  const displayName = profile.fullName || "User";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="size-7 cursor-pointer">
            {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} /> : null}
            <AvatarFallback className="overflow-hidden bg-transparent p-0">
              <FallbackAvatar name={displayName} size={28} />
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={dropdownAlign} side={dropdownSide} className="w-60">
          <DropdownMenuItem className="flex items-center justify-start gap-2">
            <DropdownMenuLabel className="flex items-center gap-3">
              <Avatar className="size-10">
                {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} /> : null}
                <AvatarFallback className="overflow-hidden bg-transparent p-0">
                  <FallbackAvatar name={displayName} size={40} />
                </AvatarFallback>
              </Avatar>
              <div>
                <span className="font-medium text-foreground">{displayName}</span>
                <div className="max-w-full overflow-hidden overflow-ellipsis whitespace-nowrap text-muted-foreground text-xs">
                  {profile.email}
                </div>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => editor.setOpen(true)}>
            <UserIcon />
            Profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditProfileModal
        open={editor.open}
        onOpenChange={editor.setOpen}
        profile={profile}
        onSave={editor.save}
      />
    </>
  );
}
