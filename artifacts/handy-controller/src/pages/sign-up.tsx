import { SignUp } from "@clerk/react";
import { usePageMeta } from "@/hooks/use-page-meta";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignUpPage() {
  usePageMeta({
    title: "Create Account — HapticOS",
    noindex: true,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}
