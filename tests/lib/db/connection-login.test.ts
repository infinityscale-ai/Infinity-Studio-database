import { describe, expect, test } from "bun:test";
import { loginOf, withLogin } from "../../../lib/db/connection-login";

const ROUTED = "mysql://root@10.0.10.56:3306/orderlink_prod?sslmode=require&infstudio_k8s_mode=k8s&infstudio_k8s_cluster=c1";

describe("withLogin", () => {
  test("puts the new user and password in and keeps host, database and cluster route", () => {
    const next = new URL(withLogin(ROUTED, { username: "ro", password: "p@ss:w/rd" }));
    expect(decodeURIComponent(next.username)).toBe("ro");
    expect(decodeURIComponent(next.password)).toBe("p@ss:w/rd");
    expect(next.host).toBe("10.0.10.56:3306");
    expect(next.pathname).toBe("/orderlink_prod");
    expect(next.searchParams.get("infstudio_k8s_cluster")).toBe("c1");
  });
  test("an empty password leaves none in the string", () => {
    expect(withLogin("mysql://x@h:3306/lims", { username: "root", password: "" })).toBe("mysql://root@h:3306/lims");
  });
});

describe("loginOf", () => {
  test("reads the decoded user back, and nothing from a string that is not a URL", () => {
    expect(loginOf(withLogin(ROUTED, { username: "app user", password: "pw" }))).toEqual({ username: "app user", password: "pw" });
    expect(loginOf("not a url")).toEqual({ username: "", password: "" });
  });
});

describe("a password-only login", () => {
  test("Redis keeps no user and carries just the password", () => {
    const next = new URL(withLogin("redis://host.docker.internal:6390", { username: "", password: "s3cret" }));
    expect(next.username).toBe("");
    expect(next.password).toBe("s3cret");
  });
});
