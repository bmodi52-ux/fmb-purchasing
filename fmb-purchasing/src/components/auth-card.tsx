import Image from "next/image";

/**
 * The centred branded card shared by every page someone can reach without a
 * working session: sign in, forgot password, reset password, and the forced
 * change after a temporary password.
 *
 * The logo used to be a 56px thumbnail inside the card. It is the first thing
 * anybody sees, so it stands above the card instead, at a size that does it
 * justice.
 */
export function AuthCard({
  title,
  titleArabic,
  subtitle,
  children,
}: {
  title: string;
  /** Set beside the title in Arabic script: the name on the sign-in page. */
  titleArabic?: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center px-4 py-10">
      <Image
        src="/fmb-logo.png"
        alt="Faiz ul Mawaid il Burhaniyah"
        width={224}
        height={224}
        priority
        className="mb-6 h-40 w-40 object-contain sm:h-56 sm:w-56"
      />
      <div className="w-full max-w-sm card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="flex items-baseline justify-center gap-2">
            <span className="brand-wordmark text-2xl">{title}</span>
            {titleArabic && (
              <span lang="ar" dir="rtl" className="brand-arabic text-2xl">
                {titleArabic}
              </span>
            )}
          </h1>
          <p className="text-sm text-ink/60">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
