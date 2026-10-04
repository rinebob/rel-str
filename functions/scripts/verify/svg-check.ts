/**
 * Minimal SVG well-formedness check shared by the screenshot-capture verify
 * scripts — tag balance only, no text parsing. Returns null when balanced,
 * or a short failure description.
 */
export function checkXmlBalance(svg: string): string | null {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)[^>]*?(\/?)>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(svg))) {
    const [raw, name, selfClose] = m;
    if (raw.startsWith('</')) {
      const top = stack.pop();
      if (top !== name) return `mismatched </${name}> (expected </${top}>)`;
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  return stack.length === 0 ? null : `unclosed <${stack[stack.length - 1]}>`;
}
