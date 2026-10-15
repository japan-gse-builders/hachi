export const callTimeZoneLabel = (timeZone: string): string =>
  timeZone === 'Asia/Tokyo' ? 'Japan time (JST)' : timeZone.replaceAll('_', ' ');
