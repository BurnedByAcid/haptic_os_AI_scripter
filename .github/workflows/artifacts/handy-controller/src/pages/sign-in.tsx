import { SignIn } from "@clerk/react";
import { usePageMeta } from "@/hooks/use-page-meta";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  usePageMeta({
    title: "Sign In — HapticOS",
    noindex: true,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}
