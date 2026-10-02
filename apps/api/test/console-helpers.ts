/** The Banquet.ai console token set in the console cookie (the console's own login, not a client's). */
export function consoleTokenOf(res: { headers: Record<string, unknown> }): string {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []);
  const found = cookies.map((c) => /^(?:__Host-)?bq_console=([^;]+)/.exec(c)).find(Boolean);
  if (!found) throw new Error('The response did not set the console cookie.');
  return decodeURIComponent(found[1]);
}
