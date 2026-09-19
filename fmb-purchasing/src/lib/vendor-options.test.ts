import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { filterVendorOptions, type VendorOption } from "./vendor-options";

const v = (name: string, vendorNumber: string, recent = false): VendorOption => ({ id: name, name, vendorNumber, recent });

const VENDORS = [
  v("KMA HOLDINGS (NSW) PTY LTD", "V-0008", true),
  v("BLF & MIX", "V-0018"),
  v("Fresh Poultry", "V-0005"),
  v("Foodworks Guildford", "V-0010", true),
];

const names = (list: VendorOption[]) => list.map((x) => x.name);

describe("filterVendorOptions", () => {
  test("nothing typed: everyone, recent first, then by name", () => {
    assert.deepEqual(names(filterVendorOptions(VENDORS, "", "name")), [
      "Foodworks Guildford",
      "KMA HOLDINGS (NSW) PTY LTD",
      "BLF & MIX",
      "Fresh Poultry",
    ]);
  });

  test("the Vendor # list is in number order", () => {
    assert.deepEqual(
      filterVendorOptions(VENDORS, "", "number").map((x) => x.vendorNumber),
      ["V-0008", "V-0010", "V-0005", "V-0018"]
    );
  });

  test("a number typed in full comes first, however it's written", () => {
    assert.equal(filterVendorOptions(VENDORS, "8", "number")[0].vendorNumber, "V-0008");
    assert.equal(filterVendorOptions(VENDORS, "v-0005", "number")[0].vendorNumber, "V-0005");
  });

  test("names starting with what's typed come before names containing it", () => {
    assert.deepEqual(names(filterVendorOptions(VENDORS, "f", "name")), ["Foodworks Guildford", "Fresh Poultry", "BLF & MIX"]);
  });

  test("case doesn't matter, and nothing matching lists nothing", () => {
    assert.deepEqual(names(filterVendorOptions(VENDORS, "kma", "name")), ["KMA HOLDINGS (NSW) PTY LTD"]);
    assert.deepEqual(filterVendorOptions(VENDORS, "zzz", "name"), []);
  });
});
