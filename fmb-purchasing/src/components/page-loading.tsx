/**
 * What a page looks like while its data crosses the Pacific.
 *
 * This used to be a block skeleton per route — a page-shaped arrangement of
 * grey bars, added because the 2px hairline alone was judged "enough to know
 * the tap registered, not enough to stop the page feeling stalled". In use it
 * went the other way. On a wide desktop viewport the bars stretch to the full
 * width of the content column and read as a broken page rather than a loading
 * one, and the Submit skeleton did not even match the form that replaced it
 * (four fields and a slab, where the real page opens with the attachments
 * area), so it never bought the no-jump benefit that justified it.
 *
 * So the hairline is the signal again, and it is drawn here rather than left
 * to the shared PendingProvider: a route with a loading.tsx resolves its
 * navigation as soon as this renders, which ends the pending state that would
 * otherwise be keeping the bar on screen. Without this the bar would vanish at
 * exactly the moment there is nothing else to look at.
 *
 * The label fades in after 450ms in CSS rather than in JavaScript, so a page
 * that resolves quickly shows a moving hairline and nothing else, and only a
 * wait long enough to worry about earns a word.
 */
export function PageLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-label="Loading">
      <span className="route-progress" aria-hidden="true" />
      <span className="page-loading-label" aria-hidden="true">
        {label}…
      </span>
    </div>
  );
}
