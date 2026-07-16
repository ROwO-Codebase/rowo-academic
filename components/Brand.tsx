import Link from "next/link";

type BrandProps = {
  href?: string;
};

export function Brand({ href = "/" }: BrandProps) {
  return (
    <Link className="brand" href={href} aria-label="ROwO Academic home">
      {/* The shared ROwO CDN asset is intentionally used verbatim across subdomains. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="brand-logo"
        src="https://cdn.rowo.link/logo.png"
        alt=""
        width="32"
        height="32"
        referrerPolicy="no-referrer"
      />
      <span className="brand-name">
        ROwO{" "}
        <span className="brand-product">Academic</span>
      </span>
    </Link>
  );
}
