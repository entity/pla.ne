// Drive regression (review round 1): every system toggle in every phase, followed by every later phase key, must
// arrive. Run inside the page (drive.mjs eval); prints one line per case and a summary. Keys go to the stage.
(async () => {
  const A3 = window.__a380;
  const stage = document.querySelector(".a3-stage");
  const key = (k, shift = false) => stage.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ORDER = ["GATE", "PUSHBACK", "TAXI", "LINEUP", "TAKEOFF", "CLIMB", "FL100"];
  const arrive = async (phase, limit) => {
    const t0 = performance.now();
    while (performance.now() - t0 < limit) {
      if (!A3.pv.seek && A3.state.phase === phase) return (performance.now() - t0) / 1000;
      await sleep(30);
    }
    return null;
  };
  const toggles = (window.__regressToggles ?? "d,f,ff,e,g,b,k,c,s").split(",");
  const from = window.__regressFrom ?? [1, 2, 3, 4, 5, 6];
  const out = [];
  let worst = 0;
  let fails = 0;
  for (const p of from) {
    for (const t of toggles) {
      key(String(p));
      const a0 = await arrive(ORDER[p - 1], 12000);
      if (a0 === null) {
        out.push(`setup ${p} did not arrive`);
        fails++;
        continue;
      }
      await sleep(250);
      for (const ch of t) key(ch);
      await sleep(250);
      for (let q = p + 1; q <= 7; q++) {
        key(String(q));
        const a = await arrive(ORDER[q - 1], 9000);
        if (a === null || a > 3.6) fails++;
        worst = Math.max(worst, a ?? 99);
        out.push(`${p}:${t}→${q} ${a === null ? "STUCK " + document.querySelector("[data-readout]").textContent : a.toFixed(2) + " s"}`);
        if (a === null) break;
      }
    }
  }
  return `${out.join("\n")}\nseek regression: ${fails} late or stuck, worst ${worst.toFixed(2)} s`;
})()
