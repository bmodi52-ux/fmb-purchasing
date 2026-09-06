import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pgrstValue, ilikeContains, orFilter, inList } from "./pgrst-filter.ts";

/**
 * These are regression tests for real search terms. Every "breaks the filter"
 * case below is something a person would plausibly type into the vendor or
 * item box on the submit form, and every one of them silently returned
 * nothing before the values were quoted.
 */
describe("pgrstValue", () => {
  test("wraps a plain value in quotes", () => {
    assert.equal(pgrstValue("chicken"), '"chicken"');
  });

  test("a comma stays inside the value instead of starting a new term", () => {
    assert.equal(pgrstValue("Smith, John"), '"Smith, John"');
  });

  test("parentheses are literal, so a pack size cannot unbalance the group", () => {
    assert.equal(pgrstValue("Coca-Cola (2L)"), '"Coca-Cola (2L)"');
  });

  test("a dot cannot be read as the column.operator.value separator", () => {
    assert.equal(pgrstValue("St. George"), '"St. George"');
  });

  test("escapes a double quote", () => {
    assert.equal(pgrstValue('7" pan'), '"7\\" pan"');
  });

  test("escapes a backslash, and does so before quotes so it cannot double-escape", () => {
    assert.equal(pgrstValue("a\\b"), '"a\\\\b"');
    assert.equal(pgrstValue('a\\"b'), '"a\\\\\\"b"');
  });

  test("an attempt to inject another filter term is inert", () => {
    // Before quoting this added a second OR term to the query.
    assert.equal(
      pgrstValue("x,status.eq.pending"),
      '"x,status.eq.pending"'
    );
  });
});

describe("ilikeContains", () => {
  test("builds a contains match with the wildcards outside the escaping", () => {
    assert.equal(ilikeContains("name", "chicken"), 'name.ilike."%chicken%"');
  });

  test("a term with delimiters still produces one well-formed term", () => {
    assert.equal(ilikeContains("name", "Coca-Cola (2L)"), 'name.ilike."%Coca-Cola (2L)%"');
  });
});

describe("orFilter", () => {
  test("joins terms with the comma PostgREST expects", () => {
    assert.equal(
      orFilter(ilikeContains("vendor_number", "V-1"), ilikeContains("name", "V-1")),
      'vendor_number.ilike."%V-1%",name.ilike."%V-1%"'
    );
  });

  test("a comma inside a term does not become a term boundary", () => {
    const built = orFilter(ilikeContains("name", "a,b"));
    assert.equal(built, 'name.ilike."%a,b%"');
    // One term, not two: the only unquoted comma would be a separator.
    assert.equal(built.split('",').length, 1);
  });
});

describe("inList", () => {
  test("quotes each id", () => {
    assert.equal(
      inList("id", ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]),
      'id.in.("11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222")'
    );
  });

  test("an empty list produces an empty group rather than malformed SQL", () => {
    assert.equal(inList("id", []), "id.in.()");
  });
});
