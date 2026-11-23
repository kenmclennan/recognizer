export function folderOf(id: string): string {
  const at = id.lastIndexOf("/");

  return at < 0 ? "." : id.slice(0, at);
}
