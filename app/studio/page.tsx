import { Suspense } from "react";
import StudioClient from "./StudioClient";

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioClient />
    </Suspense>
  );
}
