import Image from "next/image";

/**
 * The branded frame shared by every page someone can reach without a working
 * session: sign in, forgot password, reset password, and the forced change
 * after a temporary password.
 *
 * The logo used to be a 56px thumbnail inside the form's card. It is the
 * first thing anybody sees, so it stands on its own, large, above the form.
 * It sits on the cream rather than the maroon because its calligraphy is
 * maroon and brown, and would vanish into the panel. On a phone the panel
 * shrinks to a band above the logo and form.
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
      <aside className="flex flex-col justify-end bg-maroon px-6 py-6 text-cream md:w-1/2 md:p-10 lg:p-12">
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
      </aside>

      <main className="flex flex-1 items-start justify-center px-6 py-8 md:items-center md:px-10 md:py-10">
        <div className="w-full max-w-sm">
          <Image
            src="/fmb-logo.png"
            alt="Faiz ul Mawaid il Burhaniyah"
            width={240}
            height={240}
            priority
            className="mx-auto mb-6 h-40 w-40 object-contain md:mb-8 md:h-60 md:w-60"
          />
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
