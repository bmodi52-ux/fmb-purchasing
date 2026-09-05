-- A place for the submitter to say something about their own expense.
--
-- expenses already had decision_comment, but that belongs to the approver and
-- is written after the fact. There was nowhere for the person submitting to
-- explain the thing only they know — why a receipt is missing, that a price
-- looks wrong because the vendor applied a credit, which event the spend was
-- for, that half a delivery arrived damaged.
--
-- Without it that context either went unsaid, or was smuggled into a line
-- item description where it corrupts receipt matching: descriptions are what
-- vendor_item_descriptions learns from (0023), so "Chicken - short delivery,
-- see Yusuf" would be remembered as a wording that means chicken.
--
-- Deliberately one free-text note rather than a comment thread. An approver
-- who needs a conversation has decision_comment and, failing that, a phone;
-- a thread would need notifications, read state and a UI nobody asked for.

alter table expenses add column submitter_comment text;

comment on column expenses.submitter_comment is
  'Free-text note written by the submitter at submission time. Distinct from decision_comment, which the approver writes.';
