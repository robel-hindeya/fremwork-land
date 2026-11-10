'use client';

import Link from 'next/link';
import { FramSvg, type FramFace } from '@/components/fram/FramSvg';
import '@/styles/not-found.css';
import { useFram } from '@/components/fram/useFram';

/** 404 · ported from NotFound.dc.html. Fram looks around while idle. */
export function NotFoundScreen() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: Record<string, any> = useFram('', { scan: true });

  return (
      <div className="pg-404">
      <div onMouseMove={v.onMove} onMouseEnter={v.onEnter} onMouseLeave={v.onLeave} style={{ position: "relative", minHeight: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column", fontFamily: "'Geist', system-ui, sans-serif", color: "#0A0A0A", background: "#FAFAF8", overflow: "hidden" }}>
      <div aria-hidden="true" className="glow" style={{ position: "absolute", left: "15%", top: "22%", width: "70%", height: "60%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(198,244,50,0.45), rgba(198,244,50,0.15) 60%, rgba(198,244,50,0) 100%)", filter: "blur(40px)" }}></div>
      <header style={{ position: "relative", zIndex: "1", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", padding: "24px clamp(20px, 4vw, 48px)" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", fontSize: "19px", letterSpacing: "-0.03em", textDecoration: "none", color: "#0A0A0A" }}><span aria-hidden="true" style={{ width: "14px", height: "14px", background: "#C6F432", boxShadow: "inset 0 0 0 2px #0A0A0A" }}></span>Fremwork</Link>
      <Link href="/login" className="lnk" style={{ fontSize: "14px", color: "#5E5E5E" }}>Log in</Link>
      </header>
      <main style={{ position: "relative", zIndex: "1", flex: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "24px 20px 64px" }}>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.08em", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "999px", padding: "5px 12px" }}>ERROR 404</span>
      <h1 aria-label="404" style={{ margin: "28px 0 0", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.04em", fontSize: "clamp(96px, 26vw, 280px)", lineHeight: "0.9", letterSpacing: "-0.06em", fontWeight: "600" }}>
      <span aria-hidden="true">4</span>
      <span aria-hidden="true" style={{ display: "inline-block", width: "0.92em", margin: "0 0.02em", transform: "translateY(0.06em)" }}>
      <FramSvg f={v as FramFace} label="Fram, the Fremwork character, waving hello" className="fram-svg" svgRef={v.setFram} onMouseDown={v.onPoke} style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }} />
      </span>
      <span aria-hidden="true">4</span>
      </h1>
      <h2 style={{ margin: "36px 0 0", fontSize: "clamp(26px, 3vw, 36px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "600" }}>This page wandered off.</h2>
      <p style={{ margin: "12px 0 0", maxWidth: "440px", fontSize: "16px", lineHeight: "26px", color: "#5E5E5E" }}>We could not find the page you were looking for. It may have moved, or the link may be wrong. Fram is still looking.</p>
      <div className="nf-btns" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px", marginTop: "32px", width: "100%", maxWidth: "360px" }}>
      <Link href="/" className="btn-dark" style={{ textDecoration: "none", fontSize: "15px", fontWeight: "500", color: "#FFFFFF", background: "#0A0A0A", borderRadius: "6px", padding: "13px 22px", boxShadow: "0 10px 24px rgba(10,10,10,0.2)" }}>Back to home</Link>
      <Link href="/login" className="sso" style={{ textDecoration: "none", fontSize: "15px", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "6px", padding: "12px 22px" }}>Sign Up</Link>
      </div>
      </main>
      <footer style={{ position: "relative", zIndex: "1", textAlign: "center", padding: "0 20px 28px", fontSize: "12px", color: "#8C8C8C" }}>Lost a link from us? Tell us at <a href="mailto:support@fremwork.com" className="lnk" style={{ color: "#5E5E5E" }}>support@fremwork.com</a>.</footer>
      </div>
      </div>
  );
}
