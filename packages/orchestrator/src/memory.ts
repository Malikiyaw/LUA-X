import type { AgentRole } from "@lua-x/shared";

export type MemoryKind = "decision" | "convention" | "architecture" | "constraint" | "known_issue";

export interface ProjectMemoryEntry {
  readonly id: string;
  readonly projectId: string;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: "creator" | "project" | "tool" | "agent";
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryStore {
  list(projectId: string): readonly ProjectMemoryEntry[];
  put(entry: ProjectMemoryEntry): void;
}

export class InMemoryProjectMemory implements MemoryStore {
  private readonly entries = new Map<string, ProjectMemoryEntry>();

  list(projectId: string): readonly ProjectMemoryEntry[] {
    return [...this.entries.values()].filter((entry) => entry.projectId === projectId);
  }

  put(entry: ProjectMemoryEntry): void {
    if (entry.confidence < 0 || entry.confidence > 1) {
      throw new Error("Memory confidence must be between 0 and 1.");
    }
    this.entries.set(entry.id, entry);
  }
}

export function memoryForPrompt(
  projectId: string | null,
  store: MemoryStore,
  maxEntries = 12,
): readonly ProjectMemoryEntry[] {
  if (!projectId) return [];
  return [...store.list(projectId)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, maxEntries);
}

export function relevantRoles(memory: readonly ProjectMemoryEntry[]): readonly AgentRole[] {
  const roles = new Set<AgentRole>();
  for (const entry of memory) {
    if (entry.tags.includes("animation")) roles.add("animation");
    if (entry.tags.includes("ui")) roles.add("ui");
    if (entry.tags.includes("security")) roles.add("security");
    if (entry.tags.includes("performance")) roles.add("performance");
  }
  return [...roles];
}
