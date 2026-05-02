import { useState, useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/react";
import { useLocation, Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function OnboardingPage() {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const [, setLocation] = useLocation();

  const [ageChecked, setAgeChecked] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [usernameError, setUsernameError] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

  function validateLocalUsername(value: string): string | null {
    if (value.length === 0) return null;
    if (value.length < 5) return "Must be at least 5 characters.";
    if (value.length > 32) return "Must be 32 characters or fewer.";
    if (!USERNAME_RE.test(value))
      return "Only letters, numbers, hyphens, and underscores allowed.";
    return null;
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const localError = validateLocalUsername(username);
    if (username.length === 0) {
      setUsernameStatus("idle");
      setUsernameError("");
      return;
    }
    if (localError) {
      setUsernameStatus("invalid");
      setUsernameError(localError);
      return;
    }

    setUsernameStatus("checking");
    setUsernameError("");

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/users/check-username?username=${encodeURIComponent(username)}`,
        );
        if (!res.ok) {
          setUsernameStatus("invalid");
          setUsernameError("Could not check availability.");
          return;
        }
        const data = (await res.json()) as { available: boolean };
        setUsernameStatus(data.available ? "available" : "taken");
        setUsernameError(data.available ? "" : "Username is already taken.");
      } catch {
        setUsernameStatus("invalid");
        setUsernameError("Could not check availability.");
      }
    }, 500);
  }, [username]);

  async function handleSubmit() {
    if (!ageChecked) return;
    if (usernameStatus !== "available") return;

    setSubmitting(true);
    setSubmitError("");
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/users/onboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username, ageVerified: true }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      // Reload Clerk user so publicMetadata.onboarded is updated
      await user?.reload();
      setLocation("/");
    } catch {
      setSubmitError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (!isAuthLoaded || !isUserLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if ((user?.publicMetadata as Record<string, unknown>)?.onboarded === true) {
    return <Redirect to="/" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#30363D] bg-[#0D1117] p-8 shadow-2xl shadow-[#00E5FF]/5 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Welcome</h1>
          <p className="text-sm text-[#8CA9AD]">
            Just a couple of things before you get started.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-[#00E5FF]" : "bg-[#30363D]"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-white mb-1">Age Verification</h2>
              <p className="text-sm text-[#8CA9AD]">
                This platform contains adult content. You must be 18 or older to continue.
              </p>
            </div>
            <label htmlFor="age-check" className="flex items-start gap-3 cursor-pointer group">
              <input
                id="age-check"
                type="checkbox"
                checked={ageChecked}
                onChange={(e) => setAgeChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded-sm accent-[#00E5FF] cursor-pointer"
              />
              <span className="text-sm text-white leading-relaxed">
                I confirm I am 18 years of age or older.
              </span>
            </label>
            <Button
              className="w-full bg-[#00E5FF] text-black font-bold hover:bg-[#00E5FF]/90 disabled:opacity-40"
              disabled={!ageChecked}
              onClick={() => setStep(2)}
            >
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-white mb-1">Choose a Username</h2>
              <p className="text-sm text-[#8CA9AD]">
                This will identify you across the platform. You can't change it later.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="username" className="text-sm text-[#8CA9AD]">
                Username
              </label>
              <div className="relative">
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="e.g. cool_user42"
                  maxLength={32}
                  className="bg-[#161B22] border-[#30363D] text-white pr-9 focus:border-[#00E5FF] focus:ring-[#00E5FF]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {usernameStatus === "checking" && (
                    <Loader2 className="h-4 w-4 animate-spin text-[#8CA9AD]" />
                  )}
                  {usernameStatus === "available" && (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  )}
                  {(usernameStatus === "taken" || usernameStatus === "invalid") && username.length > 0 && (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                </div>
              </div>

              {usernameError && (
                <p className="text-xs text-red-400">{usernameError}</p>
              )}
              {usernameStatus === "available" && (
                <p className="text-xs text-green-400">Username is available.</p>
              )}
              <p className="text-[11px] text-[#8CA9AD]">
                5–32 characters. Letters, numbers, hyphens, and underscores only.
              </p>
            </div>

            {submitError && (
              <p className="text-sm text-red-400">{submitError}</p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-[#30363D] text-[#8CA9AD] hover:bg-[#161B22]"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-[#00E5FF] text-black font-bold hover:bg-[#00E5FF]/90 disabled:opacity-40"
                disabled={usernameStatus !== "available" || submitting}
                onClick={handleSubmit}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
                  </span>
                ) : (
                  "Get Started"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
