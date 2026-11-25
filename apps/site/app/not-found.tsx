import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-404"><div className="wrap">
      <span className="kick">404</span>
      <h1>There is no page here.</h1>
      <p className="lead">It may have moved when the docs were reorganised.</p>
      <div className="cta"><Link className="btn btn-primary btn-lg" href="/">Home</Link><Link className="btn btn-secondary btn-lg" href="/docs/">Docs</Link><Link className="btn btn-ghost btn-lg" href="/download/">Download</Link></div>
    </div></div>
  );
}
