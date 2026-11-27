export const DEFAULT_FOLDER_NAME: string;
export function mainCheckout(root: string): string;
export function cargoTargetDir(
  root: string,
  environment?: Record<string, string | undefined>,
): string;
export function withCargoTarget(
  root: string,
  environment?: Record<string, string | undefined>,
): Record<string, string | undefined>;
