import { Snippet } from "./types";

export function mapStudioSnippet(s: any): Snippet {
  return {
    id: s.id,
    name: s.name,
    query: s.query,
    folderId: s.folderId,
    createdAt: s.createdAt,
    isShared: Boolean(s.isShared),
  };
}
