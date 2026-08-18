import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/SuperAdminDashboard.jsx"),
  "utf8"
);

test("Active Stores keeps existing Blinkit entities and adds AMB exactly once", () => {
  const entityConstant = source.match(
    /const BLINKIT_ENTITIES\s*=\s*\[([\s\S]*?)\];/
  );
  expect(entityConstant).toBeTruthy();

  const options = [...entityConstant[1].matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1]
  );
  expect(options).toEqual(["BCPL", "BISTRO", "ZHPL", "AMB"]);
  expect(options.filter((option) => option === "AMB")).toHaveLength(1);
});

test("searchable Entity selection keeps the existing entity request field", () => {
  expect(source).toMatch(
    /<SearchableSelection\s+[\s\S]*?value=\{newStoreEntity\}[\s\S]*?onChange=\{setNewStoreEntity\}[\s\S]*?options=\{entityOptions\}/
  );
  expect(source).toMatch(
    /newStoreChannel === ["']BLINKIT["'][\s\S]*?\? BLINKIT_ENTITIES/
  );
  expect(source).toMatch(
    /entity:\s*String\(newStoreEntity\s*\|\|\s*["']["']\)\.trim\(\)/
  );
});

test("unrelated Active Stores filters remain present", () => {
  expect(source).toContain("newStoreRegion");
  expect(source).toContain("newStoreState");
  expect(source).toContain("newStoreCity");
  expect(source).toContain("storeStatusFilter");
  expect(source).toContain("assigned_manager");
});
