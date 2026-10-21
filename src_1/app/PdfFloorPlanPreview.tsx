import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export async function pdfPageToPng(
  pdfBuffer: Buffer,
  pageNumber = 1,
): Promise<Buffer> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "plan2ifc-pdf-"),
  );

  const pdfPath = path.join(
    tempDir,
    "input.pdf",
  );

  const outputPrefix = path.join(
    tempDir,
    "page",
  );

  try {
    await fs.writeFile(pdfPath, pdfBuffer);

    await execFileAsync(
      "pdftoppm",
      [
        "-png",
        "-r",
        "300",
        "-f",
        String(pageNumber),
        "-singlefile",
        pdfPath,
        outputPrefix,
      ],
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const pngPath = `${outputPrefix}.png`;

    return await fs.readFile(pngPath);
  } finally {
    await fs.rm(tempDir, {
      recursive: true,
      force: true,
    });
  }
}