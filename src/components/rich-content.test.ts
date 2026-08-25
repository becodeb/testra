import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RichContent } from "@/components/rich-content";

describe("RichContent", () => {
  it("renders inline and block math accessibly", () => {
    const html = renderToStaticMarkup(createElement(RichContent, { text: "Sea $x^2$ y $$\\frac{1}{2}$$" }));
    expect(html).toContain("katex-mathml");
    expect(html).toContain("x^2");
    expect(html).toContain("\\frac{1}{2}");
  });

  it("keeps user HTML as text and renders fenced code without executing it", () => {
    const html = renderToStaticMarkup(createElement(RichContent, { text: '<img src=x onerror=alert(1)>\n```js\nconst x = "safe";\n```' }));
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("const x = &quot;safe&quot;");
  });
});
