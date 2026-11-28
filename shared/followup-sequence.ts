// Increase this shared limit and regenerate templates to support longer campaigns.
export const MAX_FOLLOWUPS = 10;
export const MAX_SEQUENCE_DAYS = 60;
export type FollowupStep = {
  subject: string;
  body: string;
  delay_value: number;
  delay_unit: "minutes" | "hours" | "days";
  relative_to: "original" | "previous";
};

export function delayMilliseconds(step: FollowupStep) {
  return (
    step.delay_value *
    { minutes: 60000, hours: 3600000, days: 86400000 }[step.delay_unit]
  );
}

export function validateSequence(value: unknown): FollowupStep[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_FOLLOWUPS)
    throw new Error(`A sequence requires 1-${MAX_FOLLOWUPS} follow-up steps.`);
  let offset = 0;
  return value.map((step, index) => {
    if (
      !step ||
      !Number.isInteger(step.delay_value) ||
      step.delay_value < 1 ||
      !["minutes", "hours", "days"].includes(step.delay_unit) ||
      !["original", "previous"].includes(step.relative_to) ||
      typeof step.subject !== "string" ||
      !step.subject.trim() ||
      step.subject.length > 500 ||
      /[\r\n]/.test(step.subject) ||
      typeof step.body !== "string" ||
      !step.body.trim() ||
      step.body.length > 20000
    )
      throw new Error(
        `Invalid follow-up step ${index + 1}: provide content, a positive integer delay, minutes/hours/days and original/previous timing.`,
      );
    const delay = delayMilliseconds(step);
    const next = step.relative_to === "original" ? delay : offset + delay;
    if (
      delay > MAX_SEQUENCE_DAYS * 86400000 ||
      next <= offset ||
      next > MAX_SEQUENCE_DAYS * 86400000
    )
      throw new Error(
        `Follow-up schedules must increase and finish within ${MAX_SEQUENCE_DAYS} days.`,
      );
    offset = next;
    return {
      subject: step.subject,
      body: step.body,
      delay_value: step.delay_value,
      delay_unit: step.delay_unit,
      relative_to: step.relative_to,
    };
  });
}
