import { useState, useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/react";
import { useLocation, Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  Loader2,
  XCircle,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";
type VerifyState =
  | "idle"
  | "starting"
  | "checking"
  | "verified"
  | "failed"
  | "requires_input";

export default function OnboardingPage() {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const [location, setLocation] = useLocation();

  const [step, setStep] = useState<1 | 2>(1);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifyError, setVerifyError] = useState("");

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [usernameError, setUsernameError] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

  function validateLocalUsername(value: string): string | null {
    if (value.length === 0) return null;
    if (value.length < 5) return "Must be at least 5 characters.";
    if (value.length > 32) return "Must be 32 characters or fewer.";
    if (!USERNAME_RE.test(value))
      return "Only letters, numbers, hyphens, and underscores allowed.";
    return null;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  async function checkVerificationStatus(): Promise<boolean> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/billing/verification-status`, { headers });
      if (!res.ok) return false;
      const data = (await res.json()) as { status: string; verified: boolean };
      if (data.verified) {
        setVerifyState("verified");
        stopPolling();
        setTimeout(() => setStep(2), 800);
        return true;
      }
      if (data.status === "requires_input") {
        setVerifyState("requires_input");
        stopPolling();
      }
      if (data.status === "canceled") {
        setVerifyState("failed");
        setVerifyError("Verification was canceled. Please try again.");
        stopPolling();
      }
      return false;
    } catch {
      return false;
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(() => {
      checkVerificationStatus();
    }, 3000);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("step") === "verify-return") {
      setVerifyState("checking");
      checkVerificationStatus().then((done) => {
        if (!done) startPolling();
      });
      window.history.replaceState({}, "", location.split("?")[0]);
    }
    return () => stopPolling();
  }, []);

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
        if (!res.ok) { setUsernameStatus("invalid"); setUsernameError("Could not check availability."); return; }
        const data = (await res.json()) as { available: boolean };
        setUsernameStatus(data.available ? "available" : "taken");
        setUsernameError(data.available ? "" : "Username is already taken.");
      } catch {
        setUsernameStatus("invalid");
        setUsernameError("Could not check availability.");
      }
    }, 500);
  }, [username]);

  async function handleStartVerification() {
    setVerifyState("starting");
    setVerifyError("");
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/billing/start-verification`, {
        method: "POST",
        headers,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setVerifyState("failed");
        setVerifyError(data.error ?? "Could not start verification. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setVerifyState("failed");
      setVerifyError("Network error. Please try again.");
    }
  }

  async function handleSubmit() {
    if (usernameStatus !== "available") return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/users/onboard`, {
        method: "POST",
        headers,
        body: JSON.stringify({ username }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
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
      <div className="w-full max-w-md rounded-2xl border border-[#302840] bg-[#0D0B12] p-8 shadow-2xl shadow-[#A855F7]/5 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Welcome to HapticOS</h1>
          <p className="text-sm text-[#8CA9AD]">
            Just a couple of things before you get started.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                s <= step ? "bg-[#A855F7]" : "bg-[#302840]"
              }`}
            />
          ))}
        </div>

        {/* ── Step 1: Age Verification via Stripe Identity ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white mb-1">Age Verification</h2>
              <p className="text-sm text-[#8CA9AD] leading-relaxed">
                This platform contains adult content. Florida law and our terms require
                you to verify your age with a government-issued ID. Your document is
                processed by Stripe — we never see or store it.
              </p>
            </div>

            {/* Idle / ready to start */}
            {verifyState === "idle" && (
              <Button
                className="w-full bg-[#A855F7] text-white font-bold hover:bg-[#A855F7]/90 gap-2"
                onClick={handleStartVerification}
              >
                <ShieldCheck className="h-4 w-4" />
                Verify My Age with ID
              </Button>
            )}

            {/* Redirecting to Stripe */}
            {verifyState === "starting" && (
              <div className="flex items-center justify-center gap-2 py-4 text-[#8CA9AD] text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Redirecting to Stripe…
              </div>
            )}

            {/* Returned from Stripe — polling */}
            {verifyState === "checking" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-[#302840] bg-[#17131F] p-4 text-sm text-[#8CA9AD]">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0 text-[#A855F7]" />
                  <span>Confirming your verification with Stripe…</span>
                </div>
                <p className="text-[11px] text-[#8CA9AD] text-center">
                  This usually takes a few seconds.
                </p>
              </div>
            )}

            {/* Verified — brief success before advancing */}
            {verifyState === "verified" && (
              <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Age verified! Setting up your account…
              </div>
            )}

            {/* Requires additional input */}
            {verifyState === "requires_input" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Stripe needs more information to complete your verification. Please
                    return to Stripe and follow the prompts.
                  </span>
                </div>
                <Button
                  className="w-full bg-[#A855F7] text-white font-bold hover:bg-[#A855F7]/90 gap-2"
                  onClick={handleStartVerification}
                >
                  <ExternalLink className="h-4 w-4" />
                  Resume Verification
                </Button>
              </div>
            )}

            {/* Failed */}
            {verifyState === "failed" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
                  <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{verifyError || "Verification failed. Please try again."}</span>
                </div>
                <Button
                  className="w-full bg-[#A855F7] text-white font-bold hover:bg-[#A855F7]/90 gap-2"
                  onClick={handleStartVerification}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Try Again
                </Button>
              </div>
            )}

            <p className="text-[11px] text-[#8CA9AD] text-center leading-relaxed">
              Your ID is scanned by{" "}
              <a
                href="https://stripe.com/identity"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#A855F7] hover:underline"
              >
                Stripe Identity
              </a>
              . HapticOS does not receive or store your document.
            </p>
          </div>
        )}

        {/* ── Step 2: Choose Username ── */}
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
                  className="bg-[#17131F] border-[#302840] text-white pr-9 focus:border-[#A855F7] focus:ring-[#A855F7]"
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
                  {(usernameStatus === "taken" || usernameStatus === "invalid") &&
                    username.length > 0 && <XCircle className="h-4 w-4 text-red-400" />}
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

            {submitError && <p className="text-sm text-red-400">{submitError}</p>}

            <Button
              className="w-full bg-[#A855F7] text-white font-bold hover:bg-[#A855F7]/90 disabled:opacity-40"
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
        )}
      </div>
    </div>
  );
}
