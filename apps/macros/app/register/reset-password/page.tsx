import { primaryButton } from "@/app/_landing/site";
import { pageMetadata } from "@/app/metadata";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = pageMetadata(
  "Reset password",
  "Choose a new password for your Macros account.",
);

interface ResetPasswordPageProps {
  searchParams: Promise<{
    token?: string | string[];
    error?: string | string[];
  }>;
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = getSingleParam(params.token);
  const error = getSingleParam(params.error);

  if (error || !token) {
    return (
      <div className="space-y-5 pt-2">
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            Link is invalid
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            This reset link has expired or was already used. Request a new one
            from the sign-in screen in the Macros app.
          </p>
        </div>
        <a href="macros://sign-in" className={`${primaryButton} w-full`}>
          Open Macros
        </a>
      </div>
    );
  }

  return <ResetPasswordForm token={token} />;
}
