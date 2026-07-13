import { SearchForm } from "@dinosales/ui/SearchForm";
import type { NormalizedSearch } from "@dinosales/ui/search";

/**
 * Desktop host for the shared SearchForm — identical to the web's, so a search
 * queued here and one queued on the web behave the same. "Queue" just adds to the
 * search queue (auto-run picks it up); "Start on this device" queues then claims
 * the next immediately so scraping begins now.
 */
export function NewSearch() {
  async function onQueue(n: NormalizedSearch) {
    return window.leadEngine.search.queue(n);
  }

  async function onRunOnDevice(n: NormalizedSearch) {
    const res = await window.leadEngine.search.queue(n);
    if (res.ok) void window.leadEngine.run.claimNext();
    return res.ok ? { ok: true, message: `${res.message ?? ""} Starting on this device…`.trim() } : res;
  }

  return (
    <section className="card panel grow">
      <div className="panel-head">
        <h2>New search</h2>
      </div>
      <div className="leads-scroll" style={{ padding: 14 }}>
        <SearchForm showDeviceButton onQueue={onQueue} onRunOnDevice={onRunOnDevice} />
      </div>
    </section>
  );
}
