import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Signing in · ROwO Academic",
  referrer: "no-referrer",
};

const CALLBACK_SCRIPT = String.raw`(() => {
  let fragment = window.location.hash;
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );

  const fragmentParams = new URLSearchParams(fragment.replace(/^#/, ""));
  const callbackParams = new URLSearchParams(window.location.search);
  let token = fragmentParams.get("token") || "";
  const state = callbackParams.get("state");
  const returnTo = callbackParams.get("returnTo");
  fragmentParams.delete("token");
  fragment = "";

  function showError(message) {
    const render = () => {
      const loading = document.getElementById("sso-callback-loading");
      const errorPanel = document.getElementById("sso-callback-error");
      const errorMessage = document.getElementById("sso-callback-message");
      if (loading) loading.hidden = true;
      if (errorPanel) errorPanel.hidden = false;
      if (errorMessage) errorMessage.textContent = message;
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", render, { once: true });
    } else {
      render();
    }
  }

  if (!token || !state) {
    token = "";
    showError("ROwO did not provide a complete sign-in response. Please start again.");
    return;
  }

  const exchange = window.fetch("/api/auth/exchange", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, state, returnTo }),
    cache: "no-store",
  });
  token = "";

  exchange
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.success || typeof body.redirectTo !== "string") {
        throw new Error(body.error || "ROwO sign-in could not be completed.");
      }
      const destination = new URL(body.redirectTo, window.location.origin);
      if (destination.origin !== window.location.origin) {
        throw new Error("ROwO sign-in returned an unsafe destination.");
      }
      window.location.replace(
        destination.pathname + destination.search + destination.hash,
      );
    })
    .catch((error) => {
      showError(
        error instanceof Error
          ? error.message
          : "ROwO sign-in could not be completed.",
      );
    });
})();`;

export default function SsoCallbackPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: CALLBACK_SCRIPT }} />
      <main className="mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-12">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div id="sso-callback-loading">
            <div
              aria-hidden="true"
              className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600"
            />
            <h1 className="mt-4 text-xl font-bold text-slate-900">
              Signing you in
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Securely connecting your ROwO account&hellip;
            </p>
          </div>

          <div id="sso-callback-error" hidden>
            <p className="text-sm font-semibold text-rose-700">Sign-in failed</p>
            <h1 className="mt-2 text-xl font-bold text-slate-900">
              We could not connect your ROwO account
            </h1>
            <p
              className="mt-3 text-sm leading-6 text-slate-600"
              id="sso-callback-message"
            />
            <a
              className="mt-6 inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              href="/auth/login"
            >
              Try again
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
