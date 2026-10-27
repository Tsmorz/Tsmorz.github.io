// What's worth a desktop notification in a board's state: its battery running low and its flash
// recorder stopping by itself. Pure (Node test), so app.js only shows what this returns.

export const LOW_BATTERY_PERCENT = 20;
// A low-battery warning is given again only once the charge has been back above this.
const LOW_BATTERY_REARM_PERCENT = 25;

/**
 * One board's watch, kept across its reconnects (a dropped board shouldn't warn twice). Feed it
 * every change with { battery, log } as board.js decodes them; it returns the alerts that change
 * brings, each { kind, title, body }.
 */
export class AlertWatch {
  constructor(name) {
    this.name = name;
    this.lowWarned = false;
    this.faultWarned = false;
    this.logState = null;
  }

  update({ battery, log }) {
    return [...this.batteryAlerts(battery), ...this.logAlerts(log)];
  }

  batteryAlerts(battery) {
    if (!battery) return [];
    const alerts = [];
    if (battery.state === "fault") {
      if (!this.faultWarned) alerts.push(this.alert("battery", "charger fault", "Its charger reports a fault: check the cell."));
      this.faultWarned = true;
    } else {
      this.faultWarned = false;
    }
    const percent = battery.percent;
    if (battery.state !== "discharging" || percent === null || percent > LOW_BATTERY_REARM_PERCENT) {
      this.lowWarned = false;
    } else if (percent <= LOW_BATTERY_PERCENT && !this.lowWarned) {
      this.lowWarned = true;
      alerts.push(this.alert("battery", `battery at ${percent}%`, "It sleeps by itself when the cell runs flat; plug it in to keep it recording."));
    }
    return alerts;
  }

  logAlerts(log) {
    if (!log) return [];
    const was = this.logState;
    this.logState = log.state;
    if (was === null || was === log.state) return [];
    if (log.state === "full") return [this.alert("flash", "flash full", "Its recording stopped: upload and erase to record again.")];
    if (log.state === "error") return [this.alert("flash", "flash recorder error", `Its recording stopped (error ${log.error}).`)];
    if (was === "recording" && log.state === "idle") return [this.alert("flash", "flash recording stopped", "Stopped on the board (a voice command, or it went to sleep).")];
    return [];
  }

  alert(kind, what, body) {
    return { kind, title: `${this.name}: ${what}`, body };
  }
}
