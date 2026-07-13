/**
 * @file AsciiDoc/man page rendering and browser-open helpers.
 *
 * @module
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { convert as adoc_convert } from "asciidoctor";
import { exec, ExecException } from "child_process";
import url from "url";
import os from "os";
import { chiliErrLog } from "../screen/output.js";

interface ASCIIHeadingStyle {
  regex: RegExp;
  textTransform: (text: string) => string;
  color: chalk.Chalk;
}

interface HeadingStyle {
  regex: RegExp;
  font: string;
  color: chalk.Chalk;
}

const headingStyles: HeadingStyle[] = [
  { regex: /<h1.*?>(.*?)<\/h1>/g, font: "Standard", color: chalk.magenta },
  { regex: /<h2.*?>(.*?)<\/h2>/g, font: "Slant", color: chalk.yellow },
  { regex: /<h3.*?>(.*?)<\/h3>/g, font: "Small", color: chalk.green },
  { regex: /<h4.*?>(.*?)<\/h4>/g, font: "Mini", color: chalk.blue },
];

const asciiHeadingStyles: ASCIIHeadingStyle[] = [
  {
    regex: /<h1.*?>(.*?)<\/h1>/g,
    textTransform: (text) => text.toUpperCase(),
    color: chalk.yellow,
  },
  {
    regex: /<h2.*?>(.*?)<\/h2>/g,
    textTransform: (text) => text.toUpperCase(),
    color: chalk.yellow.italic,
  },
  {
    regex: /<h3.*?>(.*?)<\/h3>/g,
    textTransform: (text) => text,
    color: chalk.cyan,
  },
  {
    regex: /<h4.*?>(.*?)<\/h4>/g,
    textTransform: (text) => text,
    color: chalk.cyan.italic,
  },
];

/**
 * Determines the root project directory by looking for `package.json`.
 *
 * @returns The absolute path to the project directory.
 */
export function projectDir_get(): string {
  // Fallback for tests and dev environment
  let directoryToCheck: string | null = process.cwd();
  while (directoryToCheck) {
    const packageJsonPath: string = path.join(directoryToCheck, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return directoryToCheck;
    }
    const parent: string = path.dirname(directoryToCheck);
    if (parent === directoryToCheck) break; // Root reached
    directoryToCheck = parent;
  }
  return process.cwd();
}

/**
 * Converts AsciiDoc content to HTML.
 *
 * @param content - The AsciiDoc content string.
 * @returns The converted HTML string.
 */
async function adoc_htmlConvert(content: string): Promise<string> {
  let result: string = await adoc_convert(content, {
    standalone: false,
    attributes: {
      showtitle: "",
      sectlinks: "",
      sectanchors: "",
    },
  }) as string;
  return result;
}

/**
 * Wraps text to a specified width.
 *
 * @param text - The text to wrap.
 * @param width - The maximum line width.
 * @returns The wrapped text.
 */
function text_wrap(text: string, width: number): string {
  if (!width || width <= 0) return text;

  const words: string[] = text.split(" ");
  let wrappedText: string = "";
  let line: string = "";

  for (const word of words) {
    if ((line + word).length > width) {
      wrappedText += (wrappedText ? "\n" : "") + line.trim();
      line = "";
    }
    line += word + " ";
  }

  wrappedText += (wrappedText ? "\n" : "") + line.trim();
  return wrappedText;
}

/**
 * Renders AsciiDoc content to a formatted string for console display.
 *
 * @param content - The AsciiDoc content string.
 * @param style - The rendering style ('figlet' or 'ascii').
 * @param width - Optional width for text wrapping.
 * @returns A Promise resolving to the formatted string.
 */
export async function asciidoc_render(
  content: string,
  style: "figlet" | "ascii",
  width?: number,
): Promise<string> {
  let result: string = await adoc_htmlConvert(content);

  function ASCII_create(text: string, style: ASCIIHeadingStyle): string {
    const transformedText: string = style.textTransform(text);
    return style.color(transformedText);
  }

  const heading_process = async (
    text: string,
    style: "figlet" | "ascii",
    figletStyle: HeadingStyle,
    asciiStyle: ASCIIHeadingStyle,
  ): Promise<string> => {
    if (style === "figlet") {
      // Fallback to simple color as figlet is disabled in this environment
      return figletStyle.color(text);
    } else {
      return ASCII_create(text, asciiStyle);
    }
  };

  for (let i = 0; i < headingStyles.length; i++) {
    const figletStyle: HeadingStyle = headingStyles[i];
    const asciiStyle: ASCIIHeadingStyle = asciiHeadingStyles[i];
    const matches: [] | RegExpMatchArray = result.match(figletStyle.regex) || [];
    for (const match of matches) {
      const text: string = match
        .replace(/<\/?h[1-4].*?>/g, "")
        .replace(/<a.*?>(.*?)<\/a>/g, "$1");
      const processed: string = await heading_process(
        text,
        style,
        figletStyle,
        asciiStyle,
      );
      result = result.replace(match, `\n${processed}\n`);
    }
  }

  result = result
    .replace(/<code>(.*?)<\/code>/g, (_, p1) => chalk.cyan(p1))
    .replace(/<em>(.*?)<\/em>/g, (_, p1) => chalk.italic(p1))
    .replace(/<\/div.*?>/g, "")
    .replace(/<p>(.*?)<\/p>/g, "$1\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<a.*?>(.*?)<\/a>/g, "$1")
    .replace(/<\/?(?!a)[^>]+(>|$)/g, "")
    .replace(/\n{3,}/g, "\n\n") // Replace 3 or more newlines with 2
    .trim();

  // Wrap the result if width is specified
  if (width) {
    result = result
      .split("\n")
      .map((line) => text_wrap(line, width))
      .join("\n");
  }

  return result;
}

/**
 * Opens a local file in the default web browser.
 *
 * @param filePath - The path to the file to open.
 */
export async function browser_open(filePath: string): Promise<void> {
  const tempHtmlPath: string = path.join(
    os.tmpdir(),
    path.basename(filePath).replace(".adoc", ".html"),
  );

  try {
    const content: string = fs.readFileSync(filePath, "utf-8");

    const html: string = await adoc_convert(content, {
      safe: "safe",
      standalone: true,
      attributes: { showtitle: true },
    }) as string;

    fs.writeFileSync(tempHtmlPath, html);

    const command: string =
      process.platform === "win32"
        ? "start"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";

    exec(`${command} ${tempHtmlPath}`, (error: ExecException | null) => {
      if (error) {
        chiliErrLog("Error opening browser:", error);
      }
    });
  } catch (error: unknown) {
    chiliErrLog(
      "Error opening documentation in browser:",
      error instanceof Error ? error.message : String(error),
    );
  }
}