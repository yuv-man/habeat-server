import mongoose from "mongoose";
import { UserSchema } from "../../../src/user/user.model";

/**
 * The bcrypt hash used to reach clients on signup and GET /auth/users/me.
 * Two layers keep it server-side: the field is not selected by default, and a
 * document that does hold it never serialises it.
 */
describe("User password never leaves the server", () => {
  const User = mongoose.models.UserPasswordSpec || mongoose.model("UserPasswordSpec", UserSchema);

  it("is excluded from queries unless explicitly selected", () => {
    expect((UserSchema.path("password") as any).options.select).toBe(false);
  });

  it("is stripped when a document holding it is serialised", () => {
    const doc = new User({ name: "Chloe Mark", email: "c@example.com", password: "$2b$10$hash" });
    expect(doc.get("password")).toBe("$2b$10$hash");

    const json = JSON.parse(JSON.stringify({ user: doc }));
    expect(json.user).not.toHaveProperty("password");
    expect(json.user.name).toBe("Chloe Mark");
  });
});
