import * as cumin from "@fnndsc/cumin";
import {
  pacsQuery_resultDecode,
  pacsRetrieve_create,
  pacsRetrieves_list,
  pacsRetrieve_delete,
  pacsRetrieve_statusForQuery,
} from "../src/pacs/index.js";

describe("pacs intents", () => {
  it("exposes a pacsQuery_resultDecode function", () => {
    expect(typeof pacsQuery_resultDecode).toBe("function");
  });

  it("exposes a pacsRetrieve_create function", () => {
    expect(typeof pacsRetrieve_create).toBe("function");
  });

  it("exposes a pacsRetrieves_list function", () => {
    expect(typeof pacsRetrieves_list).toBe("function");
  });

  it("exposes a pacsRetrieve_delete function", () => {
    expect(typeof pacsRetrieve_delete).toBe("function");
  });

  it("exposes a pacsRetrieve_statusForQuery function", () => {
    expect(typeof pacsRetrieve_statusForQuery).toBe("function");
  });
});
