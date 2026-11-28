import { zonedISO } from "./timezone";

// Excel Date objects contain wall-clock components, not an intended time zone.
// read-excel-file has already interpreted the workbook's 1900/1904 date system.
export function spreadsheetSchedule(value: unknown, timezone: unknown): string {
  let wall: Date | undefined;
  if (value instanceof Date) wall = value;
  else if (
    typeof value === "number" ||
    (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))
  ) {
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial < 61 || serial > 2958465)
      throw new Error("scheduled_at has an invalid Excel date serial.");
    wall = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  }
  if (!wall) return typeof value === "string" ? value.trim() : "";
  if (!Number.isFinite(wall.getTime()))
    throw new Error("scheduled_at has an invalid Excel date.");
  if (typeof timezone !== "string" || !timezone.trim())
    throw new Error(
      "Excel date cells require an explicit IANA timezone (for example Asia/Karachi, Asia/Seoul or UTC).",
    );
  try {
    return zonedISO(wall.toISOString().slice(0, -1), timezone.trim(), true);
  } catch (error) {
    throw new Error("scheduled_at: " + (error as Error).message);
  }
}
