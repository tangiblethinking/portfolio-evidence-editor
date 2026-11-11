const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://portforag-test.vercel.app data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self' https://github.com",
  "base-uri 'none'",
].join("; ");
export default {
  outputFileTracingIncludes: { "/api/refresh/preview": ["./lib/master-core.mjs", "./lib/master-validate.mjs"], "/api/refresh/apply": ["./lib/master-core.mjs", "./lib/master-validate.mjs"] },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Strict-Transport-Security", value: "max-age=63072000" },
    ] }];
  },
};
