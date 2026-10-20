import { describe, expect, test } from "bun:test";
import { defaultSchemaFor } from "../../lib/studio/default-schema";

const ORACLE = "mysql://orderlink:x@10.0.10.56:3306/orderlink_prod?sslmode=require&infstudio_k8s_mode=k8s&infstudio_k8s_cluster=c1";

describe("defaultSchemaFor", () => {
  test("a MySQL connection opens on its own database, never on information_schema that sorts first", () => {
    expect(defaultSchemaFor(ORACLE, ["information_schema", "orderlink_prod", "performance_schema"])).toBe("orderlink_prod");
  });
  test("with no database in the string, the first schema that is not a system one", () => {
    expect(defaultSchemaFor("mysql://root@h:3306", ["information_schema", "lims", "mysql", "sys"])).toBe("lims");
  });
  test("PostgreSQL opens on public, SQL Server on dbo", () => {
    expect(defaultSchemaFor("postgresql://u@h:5432/app", ["information_schema", "audit", "public"])).toBe("public");
    expect(defaultSchemaFor("sqlserver://u@h:1433/app", ["audit", "dbo"])).toBe("dbo");
  });
  test("nothing listed, nothing chosen", () => {
    expect(defaultSchemaFor(ORACLE, [])).toBeNull();
  });
});
