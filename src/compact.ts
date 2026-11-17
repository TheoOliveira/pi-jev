import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";

export interface CompactResult {
  summary: string;
  kept: number;
  considered: number;
  skipped?: "disabled" | "unconfigured" | "empty" | "error";
}

const MAX_ENTRIES = 24;
const KEEP_THRESHOLD = 0.55;

function textOf(entry: any): string {
  return JSON.stringify(entry)
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 900);
}

function isCandidate(entry: any): boolean {
  const text = JSON.stringify(entry).toLowerCase();
  return text.includes("tool") || text.includes("bash") || text.includes("assistant");
}

function selectCompactionEntries(event: any): any[] {
  if (Array.isArray(event?.branchEntries) && event.branchEntries.length > 0) {
    let slice = event.branchEntries;
    const cutId = event.preparation?.firstKeptEntryId;
    if (cutId) {
      const idx = slice.findIndex((e: any) => e?.id === cutId);
      if (idx === 0) slice = [];
      else if (idx > 0) slice = slice.slice(0, idx);
    }
    return slice.slice(-MAX_ENTRIES);
  }
  const prep = event?.preparation;
  if (prep?.messagesToSummarize?.length || prep?.turnPrefixMessages?.length) {
    return [...(prep.messagesToSummarize ?? []), ...(prep.turnPrefixMessages ?? [])].slice(-MAX_ENTRIES);
  }
  return [];
}

/** Jev-guided compaction summary. Original user/assistant meaning is never rewritten in place. */
export class JevCompactor {
  public enabled: boolean;

  constructor(private jevClient: JevClient, enabled = false) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void { this.enabled = enabled; }

  private async summarizeEntries(
    entries: any[],
    options: {
      goal?: string;
      previousSummary?: string;
      header: string;
      emptyKeptMessage: string;
      signal?: AbortSignal;
    }
  ): Promise<CompactResult> {
    if (!this.enabled) return { summary: "", kept: 0, considered: 0, skipped: "disabled" };
    if (!this.jevClient.isConfigured()) return { summary: "", kept: 0, considered: 0, skipped: "unconfigured" };
    if (entries.length === 0) return { summary: "", kept: 0, considered: 0, skipped: "empty" };

    try {
      const candidates = entries.map((entry: any, index: number) => ({ index, text: textOf(entry), candidate: isCandidate(entry) }));
      const questions: Record<string, { type: "noul"; instructions: string }> = {};
      for (const item of candidates) {
        if (item.candidate) {
          questions[`keep_${item.index}`] = {
            type: "noul",
            instructions: `Should this historical entry remain available in compacted context? Keep it if it contains facts, errors, constraints, file paths, or tool results needed to continue the task. Entry: ${item.text}`,
          };
        }
      }

      const answer = Object.keys(questions).length
        ? await this.jevClient.evaluate({
            state: { goal: options.goal ?? "Continue the user's ongoing coding task", entries: candidates },
            questions,
          }, options.signal)
        : { answers: {} } as any;

      const kept: string[] = [];
      for (const item of candidates) {
        const probability = item.candidate
          ? Number(answer.answers[`keep_${item.index}`]?.value ?? 0)
          : 1;
        if (probability >= KEEP_THRESHOLD) kept.push(`[entry ${item.index}] ${item.text}`);
      }

      const prev = typeof options.previousSummary === "string" && options.previousSummary.trim()
        ? `Previous summary: ${options.previousSummary.trim()}`
        : "";

      const summary = [
        options.header,
        options.goal ? `Goal: ${options.goal}` : "",
        prev,
        kept.length ? kept.join("\n") : options.emptyKeptMessage,
      ].filter(Boolean).join("\n");
      return { summary, kept: kept.length, considered: candidates.length };
    } catch {
      return { summary: "", kept: 0, considered: entries.length, skipped: "error" };
    }
  }

  public async compact(event: any, _ctx: ExtensionContext): Promise<CompactResult> {
    if (!this.enabled) return { summary: "", kept: 0, considered: 0, skipped: "disabled" };
    if (!this.jevClient.isConfigured()) return { summary: "", kept: 0, considered: 0, skipped: "unconfigured" };

    const entries = selectCompactionEntries(event);
    return this.summarizeEntries(entries, {
      goal: event.customInstructions ?? event.preparation?.customInstructions,
      previousSummary: event.preparation?.previousSummary,
      header: "Jev compaction summary (tool history retained selectively; user/assistant intent preserved):",
      emptyKeptMessage: "No historical tool entries were judged necessary to retain.",
      signal: event.signal,
    });
  }

  public async compactTree(event: any, _ctx: ExtensionContext): Promise<CompactResult> {
    if (!this.enabled) return { summary: "", kept: 0, considered: 0, skipped: "disabled" };
    if (!this.jevClient.isConfigured()) return { summary: "", kept: 0, considered: 0, skipped: "unconfigured" };
    if (event?.preparation && event.preparation.userWantsSummary === false) {
      return { summary: "", kept: 0, considered: 0, skipped: "empty" };
    }

    const entries = (event?.preparation?.entriesToSummarize ?? event?.branchEntries ?? []).slice(-MAX_ENTRIES);
    return this.summarizeEntries(entries, {
      goal: event?.preparation?.customInstructions ?? event?.customInstructions,
      header: "Jev branch summary (tool history retained selectively; user/assistant intent preserved):",
      emptyKeptMessage: "No branch tool entries were judged necessary to retain.",
      signal: event?.signal,
    });
  }
}
