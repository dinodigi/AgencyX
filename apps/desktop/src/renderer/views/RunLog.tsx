import { useEffect, useRef } from "react";
import type { RunLogLine } from "../../shared/ipc.ts";

export function RunLog({ lines }: { lines: RunLogLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <section className="card panel fixed">
      <div className="panel-head">
        <h2>Run log</h2>
      </div>
      <div className="log">
        {lines.length === 0 && <p className="muted pad">Idle. Activity appears here during a run.</p>}
        {lines.map((l, i) => (
          <div key={i} className={`log-line ${l.level}`}>
            <span className="log-time">{new Date(l.at).toLocaleTimeString()}</span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
