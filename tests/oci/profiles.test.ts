import { describe, expect, test } from "bun:test";
import { parseOciConfig } from "../../server/oci/profiles";

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

[broken]
user=inherits-the-rest-from-DEFAULT
`;

describe("parseOciConfig", () => {
  test("reads api-key and session profiles, filling gaps from DEFAULT", () => {
    const profiles = parseOciConfig(CONFIG);
    expect(profiles.map((p) => p.name)).toEqual(["DEFAULT", "laprophan", "broken"]);
    expect(profiles[0]).toEqual({ name: "DEFAULT", region: "eu-frankfurt-1", tenancy: "ocid1.tenancy.oc1..tenancy1", sessionAuth: false });
    expect(profiles[1]).toEqual({ name: "laprophan", region: "af-casablanca-1", tenancy: "ocid1.tenancy.oc1..tenancy2", sessionAuth: true });
  });

  test("a profile without region and tenancy anywhere is skipped", () => {
    expect(parseOciConfig("[x]\nuser=u\n")).toEqual([]);
  });
});
