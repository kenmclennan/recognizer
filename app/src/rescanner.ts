import type { ScanOrigin } from "./footer-scan";
import type { Loaded } from "./scan-loading";
import type { ScanReport } from "./scan-report";

export type RescanPorts<Carried> = {
  scan: () => Promise<ScanReport>;
  load: (report: ScanReport) => Loaded;
  sense: (loaded: Loaded) => Promise<Loaded>;
  resense: () => Promise<Loaded | null>;
  adopt: () => Promise<ScanOrigin>;
  carry: () => Carried | null;
  replace: (loaded: Loaded, carried: Carried | null) => void;
  running: (on: boolean) => void;
  adopted: (origin: ScanOrigin) => void;
  notify: (text: string) => void;
};

export type Rescanner = {
  run: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function createRescanner<Carried>(
  ports: RescanPorts<Carried>,
): Rescanner {
  let busy = false;

  return {
    async run() {
      if (busy) {
        return;
      }

      busy = true;
      ports.running(true);

      try {
        const scanned = ports.load(await ports.scan());

        if (scanned.blocking !== null) {
          ports.notify(`Rescan failed: ${scanned.blocking}`);

          return;
        }

        const loaded = await ports.sense(scanned);

        const carried = ports.carry();
        const origin = await ports.adopt();

        ports.notify("");
        ports.adopted(origin);
        ports.replace(loaded, carried);
      } catch (error) {
        ports.notify(`Rescan failed: ${String(error)}`);
      } finally {
        busy = false;
        ports.running(false);
      }
    },
    async refresh() {
      if (busy) {
        return;
      }

      busy = true;

      try {
        const loaded = await ports.resense();

        if (loaded === null) {
          return;
        }

        ports.replace(loaded, ports.carry());
      } catch (error) {
        ports.notify(`Sensors failed: ${String(error)}`);
      } finally {
        busy = false;
      }
    },
  };
}
