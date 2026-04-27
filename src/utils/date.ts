export function dateTimeToYMD(dateTime: string): string {
  return dateTime.slice(0, 10)
}

export function currentTime(): string {
  return new Date().toTimeString().slice(0, 8)
}

export function currentDate(): string {
  return dateTimeToYMD(new Date().toISOString())
}

export function computeFromDate(lastSyncDate: string, lookbackDays = 14): string {
  const d = new Date(lastSyncDate)
  d.setDate(d.getDate() - lookbackDays)
  return dateTimeToYMD(d.toISOString())
}
