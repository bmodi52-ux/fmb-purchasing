/**
 * Who can sign in to the sandbox (scratchpad #1).
 *
 * The reset creates or keeps exactly these logins, so a trainee's account and
 * anything they did to their own profile survives every reset, while all the
 * copied data around it is replaced. Adding a trainee is a one-line edit here,
 * then a reset.
 *
 * Teams are matched by name against the teams copied from live. A name that
 * matches nothing is reported by the seed script rather than silently ignored.
 */

export type Trainee = {
  name: string;
  /** A real address they can receive at — the sandbox only emails these. */
  email: string;
  teams: string[];
};

export const TRAINEES: Trainee[] = [
  { name: "Burhanuddin Modi", email: "bmodi52@gmail.com", teams: ["Admin"] },
  // Add trainees here, e.g.:
  // { name: "New Approver", email: "someone@example.org", teams: ["Procurement"] },
];
