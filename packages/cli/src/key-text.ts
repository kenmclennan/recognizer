import {
  addKeySection,
  addKeyValue,
  type EditOutcome,
  type KeyReadOutcome,
  type Listing,
  listKeyed,
  type PublishedKeys,
  readKeyValue,
  removeKeySection,
  setKeyValue,
  unsetKeyValue,
} from "@recognizer/core";
import { YamlKeyedTextAdapter } from "./adapters/filesystem/yaml-keyed-text-adapter.js";

const KEYED = new YamlKeyedTextAdapter();

export type { EditOutcome, Listing };

export function setValue(
  text: string,
  published: PublishedKeys,
  key: string,
  raw: string,
): EditOutcome {
  return setKeyValue(KEYED, text, published, key, raw);
}

export function addValue(
  text: string,
  published: PublishedKeys,
  key: string,
  raw: string,
): EditOutcome {
  return addKeyValue(KEYED, text, published, key, raw);
}

export function unsetValue(
  text: string,
  published: PublishedKeys,
  key: string,
  raw?: string,
): EditOutcome {
  return unsetKeyValue(KEYED, text, published, key, raw);
}

export function removeSection(
  text: string,
  published: PublishedKeys,
  section: string,
): EditOutcome {
  return removeKeySection(KEYED, text, published, section);
}

export function addSection(
  text: string,
  published: PublishedKeys,
  section: string,
): EditOutcome {
  return addKeySection(KEYED, text, published, section);
}

export function listKeys(text: string, published: PublishedKeys): Listing {
  return listKeyed(KEYED, text, published);
}

export function readKey(
  text: string,
  published: PublishedKeys,
  key: string,
): KeyReadOutcome {
  return readKeyValue(KEYED, text, published, key);
}
