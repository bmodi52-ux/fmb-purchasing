import Image from "next/image";

/**
 * The branded frame shared by every page someone can reach without a working
 * session: sign in, forgot password, reset password, and the forced change
 * after a temporary password.
 *
 * The logo used to be a 56px thumbnail inside the form's card. It is the
 * first thing anybody sees, so it gets a panel of its own: large, on the
 * maroon, above the name. On a phone the panel shrinks to a band above the
 * form rather than disappearing.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="flex flex-col justify-between gap-5 bg-maroon px-6 py-6 md:gap-8 text-cream md:w-1/2 md:p-10 lg:p-12">
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-cream p-2.5 shadow-lg md:h-56 md:w-56 md:p-5">
          <Image src="/fmb-logo.png" alt="FMB" width={200} height={200} priority className="h-full w-full object-contain" />
        </div>
        <div>
          <p lang="ar" dir="rtl" className="text-left font-arabic text-xl text-gold md:text-2xl">
            فيض الموائد البرهانية
          </p>
          <p className="brand-wordmark mt-1 text-3xl leading-tight font-semibold md:text-5xl">
            FMB Sydney
            <br />
            Purchasing
          </p>
          <p className="mt-3 max-w-sm text-sm text-cream/75">
            Receipts, approvals and payments for the thaali kitchen, in one place.
          </p>
        </div>
      </aside>

      <main className="flex flex-1 items-start justify-center px-6 py-8 md:items-center md:px-10 md:py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h1 className="page-title text-ink">{title}</h1>
            <p className="mt-1 text-sm text-ink/60">{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
