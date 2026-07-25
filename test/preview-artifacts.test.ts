import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readPreviewArtifacts } from "../src/preview-artifacts";

describe("preview SVG artifacts", () => {
  it("loads every frame generated for one requested SVG output", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-preview-artifacts-"));
    try {
      await Promise.all([
        fs.writeFile(
          path.join(directory, "preview-overview.svg"),
          "<svg><text>to &lt;detail&gt;</text><text>to &lt;detail&gt;</text><text>from &lt;home&gt;</text></svg>"
        ),
        fs.writeFile(
          path.join(directory, "preview-detail.svg"),
          "<svg><text>from &lt;overview&gt;</text></svg>"
        ),
        fs.writeFile(path.join(directory, "unrelated.svg"), "<svg>ignored</svg>")
      ]);

      await expect(readPreviewArtifacts(directory, path.join(directory, "preview.svg"))).resolves.toEqual([
        {
          id: "detail",
          title: "detail",
          svg: "<svg><text>from &lt;overview&gt;</text></svg>",
          linksTo: []
        },
        {
          id: "overview",
          title: "overview",
          svg: "<svg><text>to &lt;detail&gt;</text><text>to &lt;detail&gt;</text><text>from &lt;home&gt;</text></svg>",
          linksTo: ["detail"]
        }
      ]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("loads the exact output used for a single-frame document", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-preview-artifacts-"));
    try {
      await fs.writeFile(path.join(directory, "preview.svg"), "<svg>single</svg>");
      await expect(readPreviewArtifacts(directory, path.join(directory, "preview.svg"))).resolves.toEqual([
        { id: "preview", title: "Preview", svg: "<svg>single</svg>", linksTo: [] }
      ]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
