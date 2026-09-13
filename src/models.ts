export interface ModelLike {
  provider: string;
  id: string;
  reasoning?: boolean;
}

export interface ModelLookup {
  find(provider: string, id: string): ModelLike | undefined;
}

/** Resolve one explicitly configured provider/model reference. */
export function resolveForemanModel(
  reference: string | undefined,
  lookup: ModelLookup,
): ModelLike | undefined {
  if (!reference) return undefined;
  const slash = reference.indexOf("/");
  if (slash <= 0 || slash === reference.length - 1) return undefined;
  return lookup.find(reference.slice(0, slash), reference.slice(slash + 1));
}
