// Kicks a one-shot, non-forced (TTL-gated) pricing refresh once per browser
// session. Emitted as an inline <script>, NOT a React client component: a
// client component that calls fetch() from a useEffect in the root layout trips a
// Next.js dev async-tracking recursion (visitAsyncNode stack overflow) on the
// first request. A raw inline script runs in the browser outside React entirely,
// so the network fetch never touches the server render or its async graph.
export function PricingWarmup() {
  const code = `(function(){try{if(sessionStorage.getItem('ccgauge.pw'))return;sessionStorage.setItem('ccgauge.pw','1');}catch(e){}fetch('/api/pricing/refresh?soft=1',{method:'POST',cache:'no-store'}).catch(function(){});})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
