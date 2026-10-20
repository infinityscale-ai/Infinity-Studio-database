"use client";

import { useEffect, useState } from "react";
import { localTools, type LocalTools } from "@/lib/api/discover-client";

// useLocalTools reports whether this studio serves the local tools and how it names this computer; null until the studio answers.
export function useLocalTools(): LocalTools | null {
  const [tools, setTools] = useState<LocalTools | null>(null);
  useEffect(() => {
    void localTools().then(setTools);
  }, []);
  return tools;
}
