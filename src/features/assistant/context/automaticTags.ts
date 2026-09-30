/** Only exact, unambiguous resource names are pinned. Spoken text remains untouched. */
export function matchContextOptions<T extends { id: string; label: string }>(text: string, options: readonly T[]): T[] {
  const unique = [...new Map(options.map(option => [option.id, option])).values()];
  const counts = new Map<string, number>();
  unique.forEach(option => counts.set(option.label.toLowerCase(), (counts.get(option.label.toLowerCase()) ?? 0) + 1));
  const lower = text.toLowerCase();
  return unique
    .filter(option => {
      const label = option.label.trim().toLowerCase();
      if (label.length < 3 || counts.get(label) !== 1) return false;
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\w/])${escaped}(?=$|[^\\w/])`, 'i').test(lower);
    })
    .sort((a, b) => b.label.length - a.label.length)
    .slice(0, 8);
}
