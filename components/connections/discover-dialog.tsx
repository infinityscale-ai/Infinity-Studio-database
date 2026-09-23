"use client";

import { Cloud, Laptop } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiscoverLocalPanel } from "@/components/connections/discover-local-panel";
import { DiscoverOciPanel } from "@/components/connections/discover-oci-panel";

/** What the dialog hands back: a string to prefill, or the news that a connection was saved. */
export type DiscoverDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (connectionString: string) => void;
  onSaved: () => void;
};

// DiscoverDialog finds databases for the user: the ones on this machine, and the ones in their Oracle Cloud tenancy.
export function DiscoverDialog({ open, onOpenChange, onPick, onSaved }: DiscoverDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-4 p-6">
        <DialogHeader>
          <DialogTitle>Discover databases</DialogTitle>
          <DialogDescription>Pick a database that is already running here, or one in your Oracle Cloud tenancy.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="local" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="local" className="gap-1.5">
              <Laptop className="size-3.5" aria-hidden /> This machine
            </TabsTrigger>
            <TabsTrigger value="oci" className="gap-1.5">
              <Cloud className="size-3.5" aria-hidden /> Oracle Cloud
            </TabsTrigger>
          </TabsList>
          <TabsContent value="local" className="mt-4">
            {open && <DiscoverLocalPanel onPick={onPick} />}
          </TabsContent>
          <TabsContent value="oci" className="mt-4">
            {open && <DiscoverOciPanel onSaved={onSaved} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
