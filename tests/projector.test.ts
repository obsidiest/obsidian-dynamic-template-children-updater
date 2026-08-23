import { describe, expect, it } from "vitest";
import { projectTemplate } from "../src/projector";

describe("projectTemplate", () => {
  it("statically projects the Templater constructs used by the book template", () => {
    const source = `<%*
const ignored = await tp.system.prompt("Prompt");
const coverImageBlock = ignored ? "dynamic" : "Cover Image:";
tR += \`---
\${coverImageBlock}
\${sourceFileUrlsBlock}
File Qualities:
\${listBlock(parsed.fileQualities)}
Edited by Others Than the Original Publisher: \${parsed.edited}
Page Counts:
  Digital Page Count: \${digitalPageCount}
Creators:
  Publishers:
\${listBlock(parsed.publishers, 4)}
---
# \${noteTitle}
\`;
%><% tp.file.cursor() %>

### Pros
`;

    const projection = projectTemplate(source);

    expect(projection.sourceKind).toBe("templater");
    expect(projection.previewMarkdown).toBe(`---
Cover Image:
Source File URLs:
File Qualities:
  - 
Edited by Others Than the Original Publisher: false
Page Counts:
  Digital Page Count: 
Creators:
  Publishers:
    - 
---
# 


### Pros
`);
    expect(projection.diagnostics).toEqual([]);
    expect(projection.internalMarkdown).toContain(
      "Digital Page Count: __DTCU_DYNAMIC_digitalPageCount__",
    );
  });

  it("supports exact expression substitutions without executing code", () => {
    const projection = projectTemplate(
      "<%* tR += `Value: ${custom.defaultValue}`; %>",
      JSON.stringify({ "custom.defaultValue": "Safe default" }),
    );

    expect(projection.previewMarkdown).toBe("Value: Safe default");
  });

  it("projects core Templates title placeholders as dynamic defaults", () => {
    const projection = projectTemplate("# {{title}}\nCreated: {{date}}");

    expect(projection.sourceKind).toBe("core-templates");
    expect(projection.previewMarkdown).toBe("# \nCreated: ");
    expect(projection.internalMarkdown).toContain("__DTCU_DYNAMIC_title__");
  });
});
