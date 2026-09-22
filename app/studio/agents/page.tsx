import { Suspense } from "react";
import AgentsClient from "./AgentsClient";

// Renders the agents window for the connection named by ?id=.
export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsClient />
    </Suspense>
  );
}
