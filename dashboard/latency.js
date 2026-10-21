// Presentation of the bench latency probe's results (decodeLatencyReport() in wire.js). Pure
// functions only, so tests/dashboard/latency.test.mjs can run them in Node.

/** Microseconds as milliseconds with one decimal, e.g. 12345 -> "12.3". */
export const ms = (us) => (us / 1000).toFixed(1);

/** Share of the IMU samples whose motion had to wait for a free report slot, as a percentage. */
export function deferredPercent(report) {
  return report.imuSamples ? (100 * report.deferred) / report.imuSamples : 0;
}

/** The report's headline and supporting lines, ready to show. */
export function describeLatency(report) {
  const seconds = report.elapsedMs / 1000;
  const perSecond = (count) => (seconds > 0 ? Math.round(count / seconds) : 0);
  return {
    tiles: [
      ["Median", ms(report.ackUs.p50)],
      ["p90", ms(report.ackUs.p90)],
      ["p99", ms(report.ackUs.p99)],
      ["Max", ms(report.ackUs.max)],
    ],
    lines: [
      `Min ${ms(report.ackUs.min)} ms · ${report.reports} reports in ${Math.round(seconds)} s (${perSecond(report.reports)}/s)`,
      `Connection interval ${report.connIntervalUs ? `${ms(report.connIntervalUs)} ms` : "–"} · IMU ${perSecond(report.imuSamples)} Hz`,
      `On the board (sample → Bluetooth stack): median ${ms(report.queueUs.p50)} ms, max ${ms(report.queueUs.max)} ms · longest loop step ${ms(report.loopMaxUs)} ms`,
      `Held for a free slot: ${deferredPercent(report).toFixed(1)}% of samples · send errors ${report.sendErrors}`,
    ],
  };
}

/** Column names for resultRow(), as the table in docs/latency-bench-test.md has them. */
export const RESULT_COLUMNS = [
  "Date", "Firmware", "Host", "Interval (ms)", "Reports", "Min", "Median", "p90", "p99", "Max",
  "On board median / max", "Held", "Errors",
];

/** One Markdown table row of results, for pasting into docs/latency-bench-test.md's results table. */
export function resultRow(report, { date, firmware, host }) {
  const cells = [
    date, firmware, host, report.connIntervalUs ? ms(report.connIntervalUs) : "–", report.reports,
    ms(report.ackUs.min), ms(report.ackUs.p50), ms(report.ackUs.p90), ms(report.ackUs.p99), ms(report.ackUs.max),
    `${ms(report.queueUs.p50)} / ${ms(report.queueUs.max)}`, `${deferredPercent(report).toFixed(1)}%`, report.sendErrors,
  ];
  return `| ${cells.join(" | ")} |`;
}
