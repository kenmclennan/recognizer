export function route(req: any, mode: string): string {
  if (req.user && mode) {
    return "x";
  }
  for (const item of req.items) {
    if (item.a || item.b) {
      return "item";
    }
  }
  return req.user?.name ?? "anon";
}

export function shout(text: string): string {
  return text ? text.toUpperCase() : "";
}
