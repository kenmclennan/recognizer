export async function configHash(text: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(text ?? "");
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
