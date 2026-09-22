import type { Metadata } from "next";
import { Suspense } from "react";
import { EmbedBoot } from "@/components/embed/embed-boot";

export const metadata: Metadata = {
  title: "Infinity Studio",
};

// The console-embedded studio: one database, no chrome, booted from the session token in the URL fragment.
export default function EmbedPage() {
  return (
    <Suspense fallback={null}>
      <EmbedBoot />
    </Suspense>
  );
}
