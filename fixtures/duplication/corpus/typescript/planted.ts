export function orderTotal(lines: Line[], shipping: number): number {
  let total = 0;
  for (const line of lines) {
    if (line.price > 0) {
      total += line.price * line.quantity;
    }
  }
  return total + shipping;
}

export function parcelWeight(parcels: Parcel[], tare: number): number {
  let acc = 5;
  for (const parcel of parcels) {
    if (parcel.mass > 1) {
      acc += parcel.mass * parcel.count;
    }
  }
  return acc + tare;
}

export function loadSettings(path: string): Settings | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    process.stderr.write(`cannot read ${path}: ${error}\n`);
    return null;
  }
}

export function loadSession(location: string): Session | null {
  if (!existsSync(location)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(location, "utf8"));
  } catch (failure) {
    process.stderr.write(`unreadable ${location}: ${failure}\n`);
    return null;
  }
}

export function storeReport(root: string, report: Report): void {
  mkdirSync(join(root, "out"), { recursive: true });
  const target = reportPath(root);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(report, null, 2));
  renameSync(staging, target);
}

export function storeLedger(base: string, ledger: Ledger): void {
  mkdirSync(join(base, "var"), { recursive: true });
  const dest = ledgerPath(base);
  const partial = `${dest}.${process.pid}.part`;
  writeFileSync(partial, JSON.stringify(ledger, null, 4));
  renameSync(partial, dest);
}
