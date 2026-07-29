import Image from "next/image";

/**
 * The centred branded card shared by every page someone can reach without a
 * working session: sign in, forgot password, reset password, and the forced
 * change after a temporary password.
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
    <div className="flex min-h-screen flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-ink/10 bg-white/70 p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image src="/fmb-logo.png" alt="FMB" width={56} height={56} className="rounded" />
          <div>
            <h1 className="brand-wordmark text-xl font-semibold text-ink">{title}</h1>
            <p className="text-sm text-ink/60">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
