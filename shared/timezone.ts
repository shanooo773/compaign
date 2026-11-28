function parts(value: Date, zone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map((x) => [x.type, x.value]),
  );
}
export function localDate(zone: string, value = new Date()) {
  const p = parts(value, zone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Resolve wall-clock input in its IANA zone independently of the browser timezone.
export function zonedISO(local: string, zone: string, rejectAmbiguous = false) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?$/.test(local))
    throw new Error("Choose a valid schedule");
  const wall = Date.parse(local + "Z");
  if (!Number.isFinite(wall)) throw new Error("Choose a valid schedule");
  if (new Date(wall).toISOString().slice(0, local.length) !== local)
    throw new Error("Invalid calendar date");
  let guess = wall;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(guess), zone);
    const represented = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    const diff = wall - represented - new Date(guess).getUTCMilliseconds();
    if (diff === 0) {
      if (rejectAmbiguous) {
        for (const shift of [
          -7200000, -3600000, -1800000, 1800000, 3600000, 7200000,
        ]) {
          const other = parts(new Date(guess + shift), zone);
          if (
            ["year", "month", "day", "hour", "minute", "second"].every(
              (key) => p[key] === other[key],
            )
          )
            throw new Error(
              "Ambiguous daylight-saving time. Use an explicit UTC ISO timestamp.",
            );
        }
      }
      return new Date(guess).toISOString();
    }
    guess += diff;
  }
  throw new Error(
    "This local time does not exist due to daylight saving. Choose another time.",
  );
}
