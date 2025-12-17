import * as cumin from "@fnndsc/cumin";
import { pacsQuery_resultDecode } from "../src/pacs/index.js";

describe("pacs intents", () => {
  it("exposes a pacsQuery_resultDecode function", () => {
    expect(typeof pacsQuery_resultDecode).toBe("function");
  });
});
