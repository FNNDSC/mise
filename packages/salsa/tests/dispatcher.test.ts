import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { VFSDispatcher } from "../src/vfs/dispatcher.js";
import { NativeVfsProvider } from "../src/vfs/providers/native.js";
import { Result, Ok } from "@fnndsc/cumin";
import { VFSItem } from "../src/vfs/provider.js";

describe("VFSDispatcher Path Resolution Hook", () => {
  let dispatcher: VFSDispatcher;
  let listSpy: any;
  let cpSpy: any;

  beforeEach(() => {
    dispatcher = new VFSDispatcher();
    listSpy = jest.spyOn(NativeVfsProvider.prototype, "list").mockResolvedValue(
      Ok<VFSItem[]>([
        {
          name: "data.txt",
          type: "file",
          size: 100,
          owner: "rudolph",
          date: "2026-05-27T00:00:00Z",
        },
      ])
    );
    cpSpy = jest.spyOn(NativeVfsProvider.prototype, "cp").mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should list using original path when no pathResolver is registered", async () => {
    const res = await dispatcher.list("/home/rudolph/public");
    expect(res.ok).toBe(true);
    expect(listSpy).toHaveBeenCalledWith("/home/rudolph/public", undefined);
  });

  it("should map logical to physical path via registered resolver for list()", async () => {
    dispatcher.pathResolver_register(async (logicalPath: string): Promise<string> => {
      if (logicalPath === "/home/rudolph/public") {
        return "/PUBLIC";
      }
      return logicalPath;
    });

    const res = await dispatcher.list("/home/rudolph/public");
    expect(res.ok).toBe(true);
    expect(listSpy).toHaveBeenCalledWith("/PUBLIC", undefined);
  });

  it("should fall back cleanly to original path if resolver throws", async () => {
    dispatcher.pathResolver_register(async (): Promise<string> => {
      throw new Error("Resolution failed");
    });

    const res = await dispatcher.list("/home/rudolph/public");
    expect(res.ok).toBe(true);
    expect(listSpy).toHaveBeenCalledWith("/home/rudolph/public", undefined);
  });

  it("should map paths in cp() using registered resolver", async () => {
    dispatcher.pathResolver_register(async (logicalPath: string): Promise<string> => {
      if (logicalPath === "/home/rudolph/public/file.txt") {
        return "/PUBLIC/file.txt";
      }
      if (logicalPath === "/home/rudolph/shared/file.txt") {
        return "/SHARED/file.txt";
      }
      return logicalPath;
    });

    const success = await dispatcher.cp(
      "/home/rudolph/public/file.txt",
      "/home/rudolph/shared/file.txt",
      {}
    );
    expect(success).toBe(true);
    expect(cpSpy).toHaveBeenCalledWith(
      "/PUBLIC/file.txt",
      "/SHARED/file.txt",
      {}
    );
  });
});
