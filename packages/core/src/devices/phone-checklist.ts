/**
 * The checklist shown for phones (DEV-6), in order. The interface turns each key into text in the
 * user's language. `simulated-input` applies only to some brands, such as Xiaomi.
 */
export const PHONE_CHECKLIST = [
  "usb-debugging",
  "accept-prompt",
  "screen-on-unlocked",
  "simulated-input",
] as const;

export type PhoneChecklistItem = (typeof PHONE_CHECKLIST)[number];
