const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function capitalise(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

/**
 * When something happened, as the project list shows it: "Today, 18:39", "Yesterday, 16:05",
 * "Monday, 10:12" within a week, and the date before that. The words come from the language's
 * own formats, so they need no translation keys.
 */
export function formatWhen(at: number, now: number, language: string): string {
  const time = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  let day: string;
  if (days >= 0 && days <= 1) {
    day = capitalise(
      new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(
        -days,
        "day",
      ),
      language,
    );
  } else if (days > 1 && days < 7) {
    day = new Intl.DateTimeFormat(language, { weekday: "long" }).format(at);
  } else {
    day = new Intl.DateTimeFormat(language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(at);
  }
  return `${day}, ${time}`;
}

/** How long ago, for "built 12 minutes ago" (PRJ-5). */
export function formatAgo(at: number, now: number, language: string): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (seconds < 60) return format.format(0, "minute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return format.format(-hours, "hour");
  return format.format(-Math.round(hours / 24), "day");
}
