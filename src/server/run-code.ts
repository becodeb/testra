export const RUN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRunCode(length = 6, randomValues: (bytes: Uint8Array) => Uint8Array = crypto.getRandomValues.bind(crypto)) {
  if (!Number.isInteger(length) || length < 1 || length > 32) {
    throw new RangeError("La longitud del código debe estar entre 1 y 32");
  }

  const output: string[] = [];
  const maxUnbiased = 256 - (256 % RUN_CODE_ALPHABET.length);

  while (output.length < length) {
    const bytes = randomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= maxUnbiased) continue;
      output.push(RUN_CODE_ALPHABET[byte % RUN_CODE_ALPHABET.length]);
      if (output.length === length) break;
    }
  }

  return output.join("");
}
