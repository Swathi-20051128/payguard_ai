import { errorHandler } from "../src/middleware/errorHandler";

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("errorHandler — database unavailable mapping", () => {
  it("maps mongoose's disconnected-buffer error to 503 DATABASE_UNAVAILABLE", () => {
    const err = new Error(
      "Cannot call `users.findOne()` before initial connection is complete if `bufferCommands = false`."
    );
    const res = mockRes();

    errorHandler(err, {} as any, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "DATABASE_UNAVAILABLE" }) })
    );
  });

  it("falls back to 500 INTERNAL_ERROR for a genuinely unexpected error", () => {
    const err = new Error("Something totally unrelated broke");
    const res = mockRes();

    errorHandler(err, {} as any, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "INTERNAL_ERROR" }) })
    );
  });
});
