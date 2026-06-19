// Parse a day-precision ISO date ("2024-06-01") as a LOCAL calendar date.
// `new Date(iso)` reads a date-only string as UTC midnight, which renders a
// day early in timezones behind UTC; splitting the parts sidesteps that.
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
