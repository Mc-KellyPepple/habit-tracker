/** Local hour (0-23) the user picked -> UTC hour (0-23) to store. */
export function localHourToUtcHour(localHour: number): number {
  const offsetMinutes = new Date().getTimezoneOffset(); // e.g. UTC-1 (WAT) => -60
  const utcHour = Math.floor((localHour * 60 + offsetMinutes) / 60);
  return ((utcHour % 24) + 24) % 24;
}

/** UTC hour stored in the database -> local hour to display back to the user. */
export function utcHourToLocalHour(utcHour: number): number {
  const offsetMinutes = new Date().getTimezoneOffset();
  const localHour = Math.floor((utcHour * 60 - offsetMinutes) / 60);
  return ((localHour % 24) + 24) % 24;
}

export function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${period}`;
}
