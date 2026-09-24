import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isPrivateAddress,
  LinkUnreadable,
  pageToProductText,
  parseLink,
  productRecords,
  shopDomain,
  shopName,
  visibleText,
} from "./product-link";

const page = `<!doctype html><html><head>
<title>Taj Classic Basmati Rice 5kg | Coles</title>
<meta property="og:site_name" content="Coles">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList","itemListElement":[]},
  {"@type":"Product","name":"Taj Classic Basmati Rice 5kg","brand":{"@type":"Brand","name":"Taj"},
   "offers":{"@type":"Offer","price":37,"priceCurrency":"AUD"}}]}</script>
<script>window.tracking = "$999 should not appear";</script>
<style>.price{color:red}</style>
</head><body>
<nav>Home Pantry Rice</nav>
<h1>Taj Classic Basmati Rice 5kg</h1>
<div>$37.00</div><div>Was $42.00</div><div>$0.74 per 100g</div>
<p>Long grain, aged.</p>
</body></html>`;

describe("reading a product page (#29)", () => {
  test("finds the Product record, even inside a @graph", () => {
    const records = productRecords(page);
    assert.equal(records.length, 1);
    assert.equal(records[0].name, "Taj Classic Basmati Rice 5kg");
  });

  test("a lowercase type still counts, and a broken block is skipped", () => {
    const html = `<script type="application/ld+json">{broken</script>
      <script type="application/ld+json">{"@type":"product","name":"Daawat Super Basmati 5kg"}</script>`;
    assert.deepEqual(productRecords(html).map((r) => r.name), ["Daawat Super Basmati 5kg"]);
  });

  test("the text given to the reader has the record and the price lines, not scripts", () => {
    const { text, siteName } = pageToProductText(page, "https://www.coles.com.au/product/x");
    assert.equal(siteName, "Coles");
    assert.match(text, /Structured product data/);
    assert.match(text, /Was \$42\.00/);
    assert.match(text, /\$0\.74 per 100g/);
    assert.ok(!text.includes("$999"), "script contents left out");
  });

  test("visible text drops markup and styles", () => {
    const text = visibleText(page);
    assert.ok(!text.includes("color:red"));
    assert.match(text, /Long grain, aged\./);
  });
});

describe("which shop a link is", () => {
  test("domain without www", () => {
    assert.equal(shopDomain("https://www.woolworths.com.au/shop/productdetails/1/x"), "woolworths.com.au");
  });
  test("known shops by name, others from the site or the domain", () => {
    assert.equal(shopName("woolworths.com.au", null), "Woolworths");
    assert.equal(shopName("shop.coles.com.au", null), "Coles");
    assert.equal(shopName("tajmart.com.au", "Taj Mart"), "Taj Mart");
    assert.equal(shopName("spicesdirect.com.au", null), "Spicesdirect");
  });
});

describe("only public web pages are fetched", () => {
  test("private and local addresses are refused", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.103", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      assert.ok(isPrivateAddress(ip), ip);
    }
  });
  test("public addresses are allowed", () => {
    for (const ip of ["4.237.22.38", "142.250.70.100", "2404:6800:4006:80a::200e"]) assert.ok(!isPrivateAddress(ip), ip);
  });
  test("only http(s) links on normal ports, with no credentials", () => {
    assert.equal(parseLink(" https://www.coles.com.au/product/x ").hostname, "www.coles.com.au");
    for (const bad of ["ftp://x.com/a", "file:///etc/passwd", "https://user:pw@x.com/", "https://x.com:8080/", "not a link"]) {
      assert.throws(() => parseLink(bad), LinkUnreadable, bad);
    }
  });
});
