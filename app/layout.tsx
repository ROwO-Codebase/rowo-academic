import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const PRODUCTION_ORIGIN = "https://academic.rowo.link";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? requestHeaders.get("host");
  const safeHost = host && /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? host : null;
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const isLocal = safeHost ? /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(safeHost) : false;
  const protocol = isLocal && forwardedProtocol === "http" ? "http" : "https";
  const origin = safeHost ? `${protocol}://${safeHost}` : PRODUCTION_ORIGIN;
  const socialImage = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: {
      default: "ROwO Academic",
      template: "%s · ROwO Academic",
    },
    description:
      "Track Waterloo program progress, validate course requirements, and plan future terms with your ROwO account.",
    applicationName: "ROwO Academic",
    icons: {
      icon: "https://cdn.rowo.link/logo.png",
      shortcut: "https://cdn.rowo.link/logo.png",
    },
    openGraph: {
      type: "website",
      siteName: "ROwO Academic",
      title: "ROwO Academic",
      description:
        "See what you have finished, understand what remains, and plan what comes next.",
      url: origin,
      images: [{ url: socialImage, alt: "ROwO Academic degree planning preview" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ROwO Academic",
      description:
        "Track program progress, validate requirements, and plan future terms.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8fafc",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
