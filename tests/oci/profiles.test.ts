import { describe, expect, test } from "bun:test";
import { expandHome, parseOciConfig, publicProfile } from "../../server/oci/profiles";

const CONFIG = `[DEFAULT]
user=ocid1.user.oc1..aaaa
fingerprint=aa:bb
tenancy=ocid1.tenancy.oc1..tenancy1
region=eu-frankfurt-1
key_file=~/.oci/oci_api_key.pem

# a session-token profile
[laprophan]
fingerprint=cc:dd
key_file=/home/x/.oci/sessions/laprophan/oci_api_key.pem
tenancy=ocid1.tenancy.oc1..tenancy2
region=af-casablanca-1
security_token_file=/home/x/.oci/sessions/laprophan/token

[nokey]
region=af-casablanca-1
tenancy=t
key_file=
`;

describe("parseOciConfig", () => {
  test("reads api-key and session profiles, filling gaps from DEFAULT, skipping ones that cannot sign", () => {
    const profiles = parseOciConfig(CONFIG, "/home/x");
    expect(profiles.map((p) => p.name)).toEqual(["DEFAULT", "laprophan"]);
    expect(profiles[0]).toMatchObject({ name: "DEFAULT", region: "eu-frankfurt-1", sessionAuth: false, user: "ocid1.user.oc1..aaaa", fingerprint: "aa:bb", keyFile: "/home/x/.oci/oci_api_key.pem", tokenFile: null });
    expect(profiles[1]).toMatchObject({ name: "laprophan", region: "af-casablanca-1", tenancy: "ocid1.tenancy.oc1..tenancy2", sessionAuth: true, tokenFile: "/home/x/.oci/sessions/laprophan/token", keyFile: "/home/x/.oci/sessions/laprophan/oci_api_key.pem" });
  });
  test("the browser-safe view carries no key or token paths", () => {
    const pub = publicProfile(parseOciConfig(CONFIG, "/home/x")[1]);
    expect(pub).toEqual({ name: "laprophan", region: "af-casablanca-1", tenancy: "ocid1.tenancy.oc1..tenancy2", sessionAuth: true });
  });
  test("~ expands to the home directory", () => {
    expect(expandHome("~/.oci/key.pem", "/home/x")).toBe("/home/x/.oci/key.pem");
    expect(expandHome("/abs/key.pem", "/home/x")).toBe("/abs/key.pem");
  });
});
