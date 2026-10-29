import type { ScanOrigin } from "./footer-scan";
import type { Loaded } from "./scan-loading";
import type { ScanReport } from "./scan-report";

export type RescanPorts<Carried> = {
  scan: () => Promise<ScanReport>;
  load: (report: ScanReport) => Loaded;
  adopt: () => Promise<ScanOrigin>;
  carry: () => Carried | null;
  replace: (loaded: Loaded, carried: Carried | null) => void;
  running: (on: boolean) => void;
  adopted: (origin: ScanOrigin) => void;
  notify: (text: string) => void;
};

export type Rescanner = {
  run: () => Promise<void>;
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
        const loaded = ports.load(await ports.scan());

        if (loaded.blocking !== null) {
          ports.notify(`Rescan failed: ${loaded.blocking}`);

          return;
        }

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
  };
}
