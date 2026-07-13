import { useEffect, useState } from "react";
import type { AutoRunState } from "../../shared/ipc.ts";

/**
 * Auto-run switch — the desktop claims the next queued search on its own when
 * idle. On by default; this lets the operator pause it and shows what the loop is
 * doing (watching / cooling down / resting). Self-contained: subscribes to main.
 */
export function AutoRunToggle() {
  const [state, setState] = useState<AutoRunState>({ enabled: true, ranThisHour: 0 });

  useEffect(() => {
    void window.leadEngine.autorun.getState().then(setState);
    return window.leadEngine.on.autorunChanged(setState);
  }, []);

  const cooling = state.cooldownUntil && state.cooldownUntil > Date.now();

  return (
    <div className="autorun" title={state.status ?? ""}>
      <button
        className={`switch ${state.enabled ? "on" : "off"}`}
        onClick={() => void window.leadEngine.autorun.setEnabled(!state.enabled)}
        aria-pressed={state.enabled}
        aria-label="Toggle auto-run"
      >
        <span className="knob" />
      </button>
      <span className="autorun-label">
        Auto-run
        <span className="autorun-status">
          {state.enabled ? (cooling ? "cooling down" : (state.status ?? "on")) : "off"}
        </span>
      </span>
    </div>
  );
}
