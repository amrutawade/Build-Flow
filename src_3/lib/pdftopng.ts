import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export async function pdfPageToPng(
  pdfBuffer: Buffer,
  pageNumber: number = 1,
  dpi: number = 400,
): Promise<Buffer> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "buildflow-pdf-"),
  );

  const pdfPath = path.join(
    tempDir,
    "input.pdf",
  );

  const outputPrefix = path.join(
    tempDir,
    "page",
  );

  const outputPath = `${outputPrefix}.png`;

  try {
    await fs.writeFile(
      pdfPath,
      pdfBuffer,
    );

    const safeDpi = Math.max(
      150,
      Math.min(600, Math.round(dpi)),
    );

    await execFileAsync(
      "pdftoppm",
      [
        "-png",

        "-r",
        String(safeDpi),

        "-f",
        String(pageNumber),

        "-singlefile",

        pdfPath,
        outputPrefix,
      ],
      {
        maxBuffer: 100 * 1024 * 1024,
      },
    );

    return await fs.readFile(
      outputPath,
    );
  } finally {
    await fs.rm(
      tempDir,
      {
        recursive: true,
        force: true,
      },
    );
  }
}