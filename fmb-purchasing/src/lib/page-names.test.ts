import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pageNameFor, pathPattern } from "./page-names";

const ID = "12ea1a65-f8be-4230-bc15-5b5d8e1648d5";

describe("pageNameFor", () => {
  test("a sidebar page by its sidebar name", () => {
    assert.equal(pageNameFor("/submit"), "Submit expense");
    assert.equal(pageNameFor("/expenses/"), "All expenses");
    assert.equal(pageNameFor("/pricelist/add-by-photo"), "Add item by photo or link");
  });

  test("one record's page by what it is", () => {
    assert.equal(pageNameFor(`/expenses/${ID}`), "expense");
    assert.equal(pageNameFor(`/pricelist/${ID}`), "item");
    assert.equal(pageNameFor(`/vendors/${ID}`), "vendor");
  });

  test("anything else under a section by the section's name", () => {
    assert.equal(pageNameFor("/payments/reconcile"), "Payments");
    assert.equal(pageNameFor("/"), "Home");
    assert.equal(pageNameFor("/somewhere-new"), "this page");
  });
});

describe("pathPattern", () => {
  test("record ids are taken out", () => {
    assert.equal(pathPattern(`/pricelist/${ID}`), "/pricelist/[id]");
    assert.equal(pathPattern("/submit"), "/submit");
  });
});
