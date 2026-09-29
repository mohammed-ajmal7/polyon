/**
 * Helpers for packing prompt context blocks into a character budget without
 * silently dropping everything after the first block that does not fit.
 */

/**
 * Joins non-empty blocks within `maxCharacters`. When they do not all fit,
 * each block gets a fair share of the budget: blocks smaller than their share
 * are kept whole, the remaining budget is split evenly among the larger ones,
 * and each block cut short ends with a visible truncation marker.
 */
export function fitBlocksToBudget(
  blocks: readonly string[],
  maxCharacters: number,
  separator = "\n\n",
): string {
  const present = blocks.filter((block) => block !== "");
  const joined = present.join(separator);
  if (joined.length <= maxCharacters) return joined;

  let remaining = Math.max(0, maxCharacters - separator.length * (present.length - 1));
  const allocations = new Array<number>(present.length);
  const bySize = present.map((block, index) => ({ index, length: block.length }));
  bySize.sort((left, right) => left.length - right.length);

  bySize.forEach(({ index, length }, position) => {
    const share = Math.floor(remaining / (bySize.length - position));
    const allocation = Math.min(length, share);
    allocations[index] = allocation;
    remaining -= allocation;
  });

  return present
    .map((block, index) => truncateBlock(block, allocations[index]!))
    .filter((block) => block !== "")
    .join(separator);
}

/**
 * Joins non-empty blocks within `maxCharacters`, keeping the most recent
 * (last) blocks whole. The newest block that no longer fits is truncated to
 * the remaining budget, and a marker states how many older blocks were left
 * out. Output keeps the original chronological order.
 */
export function fitRecentBlocksToBudget(
  blocks: readonly string[],
  maxCharacters: number,
  separator = "\n",
): string {
  const present = blocks.filter((block) => block !== "");
  const joined = present.join(separator);
  if (joined.length <= maxCharacters) return joined;

  const reserved = omittedMarker(present.length).length + separator.length;
  const budget = Math.max(0, maxCharacters - reserved);
  const kept: string[] = [];
  let used = 0;
  let firstKept = present.length;

  for (let index = present.length - 1; index >= 0; index -= 1) {
    const block = present[index]!;
    const cost = block.length + (kept.length === 0 ? 0 : separator.length);

    if (used + cost <= budget) {
      kept.unshift(block);
      used += cost;
      firstKept = index;
      continue;
    }

    const available = budget - used - (kept.length === 0 ? 0 : separator.length);
    const truncated = truncateBlock(block, available);
    if (truncated !== "") {
      kept.unshift(truncated);
      firstKept = index;
    }
    break;
  }

  return [...(firstKept > 0 ? [omittedMarker(firstKept)] : []), ...kept].join(separator);
}

/** Cuts `block` to at most `maxCharacters`, ending it with a visible truncation marker. */
export function truncateBlock(block: string, maxCharacters: number): string {
  if (block.length <= maxCharacters) return block;
  if (maxCharacters <= 0) return "";

  const marker = truncationMarker(block.length);
  if (marker.length >= maxCharacters) return block.slice(0, maxCharacters);

  const kept = maxCharacters - marker.length;
  return block.slice(0, kept) + truncationMarker(block.length - kept);
}

function truncationMarker(omittedCharacters: number): string {
  return `\n[... truncated ${omittedCharacters} characters]`;
}

function omittedMarker(omittedBlocks: number): string {
  return `[... ${omittedBlocks} earlier entries omitted to fit the context budget]`;
}
