export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>© {new Date().getFullYear()} PiTrick Technology.</p>
        <div className="site-footer-links">
          <a href="https://rowo.link/privacy">Privacy</a>
          <a href="https://rowo.link">Back to ROwO</a>
        </div>
      </div>
    </footer>
  );
}
